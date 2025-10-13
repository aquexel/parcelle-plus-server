#!/usr/bin/env node

/**
 * Création base DVF + DPE + Annexes - VERSION OPTIMISÉE
 * Utilise des tables temporaires SQLite au lieu de charger tout en mémoire
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');
const proj4 = require('proj4');

// Définition Lambert 93
proj4.defs('EPSG:2154', '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const BDNB_DIR = process.argv[2] || path.join(__dirname, 'bdnb_data', 'csv');
const DB_FILE = path.join(__dirname, 'database', 'dvf_avec_dpe_et_annexes.db');

console.log('🏗️  === CRÉATION BASE DVF + DPE + ANNEXES (OPTIMISÉ) ===\n');
console.log(`📂 Répertoire BDNB : ${BDNB_DIR}`);
console.log(`💾 Base de données : ${DB_FILE}\n\n`);

// Vérifier que le répertoire existe
if (!fs.existsSync(BDNB_DIR)) {
    console.error(`❌ Répertoire introuvable : ${BDNB_DIR}`);
    process.exit(1);
}

// Supprimer ancienne base
if (fs.existsSync(DB_FILE)) {
    fs.unlinkSync(DB_FILE);
}

// Créer la base
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64 MB cache

console.log('📊 ÉTAPE 1 : Création des tables...');

// Table finale
db.exec(`
    CREATE TABLE IF NOT EXISTS dvf_avec_dpe_et_annexes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_mutation TEXT,
        id_parcelle TEXT,
        batiment_groupe_id TEXT,
        valeur_fonciere REAL,
        date_mutation TEXT,
        surface_bati_maison REAL,
        surface_bati_appartement REAL,
        surface_terrain REAL,
        nb_pieces INTEGER,
        latitude REAL,
        longitude REAL,
        code_departement TEXT,
        classe_dpe TEXT,
        presence_piscine INTEGER DEFAULT 0,
        presence_garage INTEGER DEFAULT 0,
        presence_veranda INTEGER DEFAULT 0,
        date_permis_annexes TEXT,
        type_bien TEXT,
        prix_m2_bati REAL,
        prix_m2_terrain REAL
    );
    
    CREATE INDEX IF NOT EXISTS idx_coords ON dvf_avec_dpe_et_annexes(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_dept ON dvf_avec_dpe_et_annexes(code_departement);
    CREATE INDEX IF NOT EXISTS idx_type ON dvf_avec_dpe_et_annexes(type_bien);
    CREATE INDEX IF NOT EXISTS idx_dpe ON dvf_avec_dpe_et_annexes(classe_dpe);
`);

// Tables temporaires
db.exec(`
    CREATE TEMP TABLE temp_batiment (
        batiment_groupe_id TEXT PRIMARY KEY,
        latitude REAL,
        longitude REAL,
        code_departement TEXT
    );
    
    CREATE TEMP TABLE temp_dpe (
        batiment_groupe_id TEXT PRIMARY KEY,
        classe_dpe TEXT
    );
    
    CREATE TEMP TABLE temp_dvf (
        batiment_groupe_id TEXT,
        valeur_fonciere REAL,
        date_mutation TEXT,
        surface_bati_maison REAL,
        surface_bati_appartement REAL,
        surface_terrain REAL,
        nb_pieces INTEGER,
        type_bien TEXT
    );
    
    CREATE TEMP TABLE temp_rel_bat_parcelle (
        batiment_groupe_id TEXT,
        id_parcelle TEXT
    );
    
    CREATE TEMP TABLE temp_rel_parcelle_sitadel (
        id_parcelle TEXT,
        sitadel_id TEXT
    );
    
    CREATE TEMP TABLE temp_sitadel (
        sitadel_id TEXT,
        presence_piscine INTEGER,
        presence_garage INTEGER,
        presence_veranda INTEGER,
        date_permis TEXT
    );
`);

console.log('✅ Tables créées\n');

/**
 * Conversion Lambert 93 → WGS84
 */
function lambert93ToWGS84(x, y) {
    try {
        const [lon, lat] = proj4('EPSG:2154', 'WGS84', [parseFloat(x), parseFloat(y)]);
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            return { latitude: lat.toFixed(6), longitude: lon.toFixed(6) };
        }
    } catch (e) {}
    return null;
}

/**
 * Parse WKT et extrait centroid
 */
function parseWKTAndGetCentroid(wkt) {
    if (!wkt || !wkt.includes('(')) return null;
    
    try {
        const coordsMatch = wkt.match(/[\d.]+\s+[\d.]+/g);
        if (!coordsMatch || coordsMatch.length === 0) return null;
        
        const coords = coordsMatch.map(pair => {
            const [x, y] = pair.trim().split(/\s+/).map(parseFloat);
            return { x, y };
        }).filter(c => !isNaN(c.x) && !isNaN(c.y));
        
        if (coords.length === 0) return null;
        
        const sumX = coords.reduce((sum, c) => sum + c.x, 0);
        const sumY = coords.reduce((sum, c) => sum + c.y, 0);
        
        return {
            x: sumX / coords.length,
            y: sumY / coords.length
        };
    } catch (e) {
        return null;
    }
}

/**
 * Charger un CSV dans une table temporaire (par lots)
 */
async function loadCSVToTemp(csvFile, tableName, processRow) {
    if (!fs.existsSync(csvFile)) {
        console.log(`⚠️  Fichier manquant : ${path.basename(csvFile)}`);
        return 0;
    }
    
    const fileStream = fs.createReadStream(csvFile);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    
    let headers = null;
    let lineNumber = 0;
    let batch = [];
    const BATCH_SIZE = 5000;
    let totalInserted = 0;
    
    const insertStmt = db.prepare(processRow.insertSQL);
    const insertBatch = db.transaction((rows) => {
        for (const row of rows) {
            try {
                insertStmt.run(row);
            } catch (e) {
                // Ignorer doublons
            }
        }
    });
    
    for await (const line of rl) {
        lineNumber++;
        
        if (lineNumber === 1) {
            headers = line.split(',').map(h => h.trim().replace(/"/g, ''));
            continue;
        }
        
        if (lineNumber % 100000 === 0) {
            process.stdout.write(`\r   📊 ${(lineNumber / 1000000).toFixed(1)}M lignes`);
        }
        
        const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
        const row = {};
        headers.forEach((header, i) => {
            row[header] = values[i] || null;
        });
        
        const processed = processRow.process(row);
        if (processed) {
            batch.push(processed);
            
            if (batch.length >= BATCH_SIZE) {
                insertBatch(batch);
                totalInserted += batch.length;
                batch = [];
            }
        }
    }
    
    // Derniers lots
    if (batch.length > 0) {
        insertBatch(batch);
        totalInserted += batch.length;
    }
    
    console.log(`\r   ✅ ${totalInserted.toLocaleString()} lignes insérées`);
    return totalInserted;
}

/**
 * MAIN
 */
(async () => {
    try {
        // ÉTAPE 2 : Charger batiment_groupe
        console.log('📂 ÉTAPE 2 : Chargement batiment_groupe.csv...');
        await loadCSVToTemp(
            path.join(BDNB_DIR, 'batiment_groupe.csv'),
            'temp_batiment',
            {
                insertSQL: `INSERT OR IGNORE INTO temp_batiment (batiment_groupe_id, latitude, longitude, code_departement) VALUES (?, ?, ?, ?)`,
                process: (row) => {
                    const id = row.batiment_groupe_id;
                    const wkt = row.geom_groupe;
                    const dept = row.code_departement_insee;
                    
                    if (!id || !wkt) return null;
                    
                    const centroid = parseWKTAndGetCentroid(wkt);
                    if (!centroid) return null;
                    
                    const gps = lambert93ToWGS84(centroid.x, centroid.y);
                    if (!gps) return null;
                    
                    return [id, gps.latitude, gps.longitude, dept];
                }
            }
        );
        console.log('');
        
        // ÉTAPE 3 : Charger DPE
        console.log('📂 ÉTAPE 3 : Chargement DPE...');
        await loadCSVToTemp(
            path.join(BDNB_DIR, 'batiment_groupe_dpe_representatif_logement.csv'),
            'temp_dpe',
            {
                insertSQL: `INSERT OR IGNORE INTO temp_dpe (batiment_groupe_id, classe_dpe) VALUES (?, ?)`,
                process: (row) => {
                    const id = row.batiment_groupe_id;
                    const dpe = row.classe_bilan_dpe; // Nom correct de la colonne
                    if (!id || !dpe || dpe === 'N' || dpe === '') return null;
                    return [id, dpe];
                }
            }
        );
        console.log('');
        
        // ÉTAPE 4 : Charger DVF
        console.log('📂 ÉTAPE 4 : Chargement DVF...');
        await loadCSVToTemp(
            path.join(BDNB_DIR, 'batiment_groupe_dvf_open_representatif.csv'),
            'temp_dvf',
            {
                insertSQL: `INSERT INTO temp_dvf VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                process: (row) => {
                    const id = row.batiment_groupe_id;
                    const valeur = parseFloat(row.valeur_fonciere);
                    const date = row.date_mutation;
                    const surfMaison = parseFloat(row.surface_bati_mutee_residencielle_individuelle) || null;
                    const surfAppart = parseFloat(row.surface_bati_mutee_residencielle_collective) || null;
                    const surfTerrain = parseFloat(row.surface_terrain_mutee) || null;
                    const nbPieces = parseInt(row.nb_piece_principale) || null;
                    
                    // Déterminer le type de bien
                    let type = 'inconnu';
                    const nbMaison = parseInt(row.nb_maison_mutee_mutation) || 0;
                    const nbAppart = parseInt(row.nb_appartement_mutee_mutation) || 0;
                    
                    if (nbMaison > 0) type = 'maison';
                    else if (nbAppart > 0) type = 'appartement';
                    else if (surfTerrain && surfTerrain > 0) type = 'terrain';
                    
                    if (!id || isNaN(valeur) || valeur <= 0) return null;
                    
                    return [id, valeur, date, surfMaison, surfAppart, surfTerrain, nbPieces, type];
                }
            }
        );
        console.log('');
        
        // ÉTAPES 5-7 : Charger relations et SITADEL
        console.log('📂 ÉTAPE 5-7 : Chargement relations et SITADEL...');
        
        await loadCSVToTemp(
            path.join(BDNB_DIR, 'rel_batiment_groupe_parcelle.csv'),
            'temp_rel_bat_parcelle',
            {
                insertSQL: `INSERT INTO temp_rel_bat_parcelle VALUES (?, ?)`,
                process: (row) => {
                    const batId = row.batiment_groupe_id;
                    const parcId = row.parcelle_id;
                    if (!batId || !parcId) return null;
                    return [batId, parcId];
                }
            }
        );
        
        await loadCSVToTemp(
            path.join(BDNB_DIR, 'rel_parcelle_sitadel.csv'),
            'temp_rel_parcelle_sitadel',
            {
                insertSQL: `INSERT INTO temp_rel_parcelle_sitadel VALUES (?, ?)`,
                process: (row) => {
                    const parcId = row.parcelle_id;
                    const sitId = row.type_numero_dau; // Correspond à l'ID de SITADEL
                    if (!parcId || !sitId) return null;
                    return [parcId, sitId];
                }
            }
        );
        
        await loadCSVToTemp(
            path.join(BDNB_DIR, 'sitadel.csv'),
            'temp_sitadel',
            {
                insertSQL: `INSERT OR IGNORE INTO temp_sitadel VALUES (?, ?, ?, ?, ?)`,
                process: (row) => {
                    const sitId = row.type_numero_dau; // ID unique du permis
                    const typeAnnexe = row.type_annexe || '';
                    const date = row.date_reelle_autorisation;
                    
                    // Détecter les annexes depuis type_annexe (si disponible)
                    const piscine = typeAnnexe.toLowerCase().includes('piscine') ? 1 : 0;
                    const garage = typeAnnexe.toLowerCase().includes('garage') ? 1 : 0;
                    const veranda = typeAnnexe.toLowerCase().includes('veranda') || typeAnnexe.toLowerCase().includes('véranda') ? 1 : 0;
                    
                    if (!sitId) return null;
                    return [sitId, piscine, garage, veranda, date];
                }
            }
        );
        console.log('');
        
        // ÉTAPE 8 : Jointure SQL et insertion finale
        console.log('📊 ÉTAPE 8 : Jointure et création table finale...');
        console.log('   ⏳ Traitement en cours (peut prendre plusieurs minutes)...');
        
        db.exec(`
            INSERT INTO dvf_avec_dpe_et_annexes (
                batiment_groupe_id,
                valeur_fonciere,
                date_mutation,
                surface_bati_maison,
                surface_bati_appartement,
                surface_terrain,
                nb_pieces,
                latitude,
                longitude,
                code_departement,
                classe_dpe,
                presence_piscine,
                presence_garage,
                presence_veranda,
                date_permis_annexes,
                type_bien,
                prix_m2_bati,
                prix_m2_terrain
            )
            SELECT 
                dvf.batiment_groupe_id,
                dvf.valeur_fonciere,
                dvf.date_mutation,
                dvf.surface_bati_maison,
                dvf.surface_bati_appartement,
                dvf.surface_terrain,
                dvf.nb_pieces,
                bat.latitude,
                bat.longitude,
                bat.code_departement,
                dpe.classe_dpe,
                COALESCE(sit.presence_piscine, 0),
                COALESCE(sit.presence_garage, 0),
                COALESCE(sit.presence_veranda, 0),
                sit.date_permis,
                dvf.type_bien,
                CASE 
                    WHEN dvf.surface_bati_maison > 0 THEN dvf.valeur_fonciere / dvf.surface_bati_maison
                    WHEN dvf.surface_bati_appartement > 0 THEN dvf.valeur_fonciere / dvf.surface_bati_appartement
                    ELSE NULL
                END,
                CASE 
                    WHEN dvf.surface_terrain > 0 THEN dvf.valeur_fonciere / dvf.surface_terrain
                    ELSE NULL
                END
            FROM temp_dvf dvf
            INNER JOIN temp_batiment bat ON dvf.batiment_groupe_id = bat.batiment_groupe_id
            LEFT JOIN temp_dpe dpe ON dvf.batiment_groupe_id = dpe.batiment_groupe_id
            LEFT JOIN temp_rel_bat_parcelle rbp ON dvf.batiment_groupe_id = rbp.batiment_groupe_id
            LEFT JOIN temp_rel_parcelle_sitadel rps ON rbp.id_parcelle = rps.id_parcelle
            LEFT JOIN temp_sitadel sit ON rps.sitadel_id = sit.sitadel_id
            WHERE bat.latitude IS NOT NULL
                AND bat.longitude IS NOT NULL
                AND dvf.valeur_fonciere > 0;
        `);
        
        const count = db.prepare('SELECT COUNT(*) as count FROM dvf_avec_dpe_et_annexes').get().count;
        
        console.log(`   ✅ ${count.toLocaleString()} transactions insérées\n`);
        
        // Statistiques
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT code_departement) as nb_depts,
                COUNT(CASE WHEN classe_dpe IS NOT NULL THEN 1 END) as avec_dpe,
                COUNT(CASE WHEN presence_piscine = 1 THEN 1 END) as avec_piscine,
                COUNT(CASE WHEN presence_garage = 1 THEN 1 END) as avec_garage,
                COUNT(CASE WHEN presence_veranda = 1 THEN 1 END) as avec_veranda
            FROM dvf_avec_dpe_et_annexes
        `).get();
        
        console.log('📊 Statistiques :');
        console.log(`   • Total transactions : ${stats.total.toLocaleString()}`);
        console.log(`   • Départements : ${stats.nb_depts}`);
        console.log(`   • Avec DPE : ${stats.avec_dpe.toLocaleString()} (${(stats.avec_dpe / stats.total * 100).toFixed(1)}%)`);
        console.log(`   • Avec piscine : ${stats.avec_piscine.toLocaleString()}`);
        console.log(`   • Avec garage : ${stats.avec_garage.toLocaleString()}`);
        console.log(`   • Avec véranda : ${stats.avec_veranda.toLocaleString()}`);
        console.log('');
        
        // Taille finale
        const dbStats = fs.statSync(DB_FILE);
        const sizeMB = (dbStats.size / 1024 / 1024).toFixed(1);
        console.log(`✅ Base créée : ${sizeMB} MB`);
        console.log(`📂 ${DB_FILE}\n`);
        
        db.close();
        
        console.log('🎉 === CRÉATION TERMINÉE ===');
        
    } catch (error) {
        console.error('\n❌ Erreur :', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();

