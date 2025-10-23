#!/usr/bin/env node

/**
 * Création base DVF + DPE + Annexes - VERSION ENRICHIE
 * Ajoute les colonnes d'orientation et de surface vitrage pour le curseur de lumière
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Database = require('better-sqlite3');
const proj4 = require('proj4');

// Définition Lambert 93
proj4.defs('EPSG:2154', '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const BDNB_DIR = process.argv[2] || path.join(__dirname, 'open_data_millesime_2024-10-a_dep40_csv', 'csv');
const DB_FILE = path.join(__dirname, 'database', 'dvf_avec_dpe_et_annexes_enhanced.db');

console.log('🏗️  === CRÉATION BASE DVF + DPE + ANNEXES (ENRICHIE) ===\n');
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

// Table finale enrichie
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
        nom_commune TEXT,
        classe_dpe TEXT,
        presence_piscine INTEGER DEFAULT 0,
        presence_garage INTEGER DEFAULT 0,
        presence_veranda INTEGER DEFAULT 0,
        date_permis_annexes TEXT,
        type_bien TEXT,
        prix_m2_bati REAL,
        prix_m2_terrain REAL,
        
        -- NOUVELLES COLONNES POUR ORIENTATION ET LUMIÈRE
        orientation_principale TEXT,           -- nord, sud, est, ouest, mixte
        pourcentage_vitrage REAL               -- % de vitrage par rapport à la surface
    );
    
    CREATE INDEX IF NOT EXISTS idx_coords ON dvf_avec_dpe_et_annexes(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_dept ON dvf_avec_dpe_et_annexes(code_departement);
    CREATE INDEX IF NOT EXISTS idx_type ON dvf_avec_dpe_et_annexes(type_bien);
    CREATE INDEX IF NOT EXISTS idx_dpe ON dvf_avec_dpe_et_annexes(classe_dpe);
    CREATE INDEX IF NOT EXISTS idx_orientation ON dvf_avec_dpe_et_annexes(orientation_principale);
`);

// Tables temporaires
db.exec(`
    CREATE TEMP TABLE temp_batiment (
        batiment_groupe_id TEXT PRIMARY KEY,
        latitude REAL,
        longitude REAL,
        code_departement TEXT,
        nom_commune TEXT
    );
    
    CREATE TEMP TABLE temp_dpe (
        batiment_groupe_id TEXT PRIMARY KEY,
        classe_dpe TEXT,
        orientation_principale TEXT,
        pourcentage_vitrage REAL
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
 * Calcule l'orientation principale basée sur les surfaces vitrées
 */
function calculateOrientation(
    surfaceNord, surfaceSud, surfaceEst, surfaceOuest, surfaceHorizontal
) {
    const surfaces = {
        nord: parseFloat(surfaceNord) || 0,
        sud: parseFloat(surfaceSud) || 0,
        est: parseFloat(surfaceEst) || 0,
        ouest: parseFloat(surfaceOuest) || 0,
        horizontal: parseFloat(surfaceHorizontal) || 0
    };
    
    const surfaceTotale = surfaces.nord + surfaces.sud + surfaces.est + surfaces.ouest + surfaces.horizontal;
    
    if (surfaceTotale === 0) {
        return 'inconnue';
    }
    
    // Déterminer l'orientation principale
    const ratios = {
        nord: surfaces.nord / surfaceTotale,
        sud: surfaces.sud / surfaceTotale,
        est: surfaces.est / surfaceTotale,
        ouest: surfaces.ouest / surfaceTotale,
        horizontal: surfaces.horizontal / surfaceTotale
    };
    
    let orientation = 'mixte';
    const maxRatio = Math.max(...Object.values(ratios));
    
    if (maxRatio > 0.4) {
        orientation = Object.keys(ratios).find(key => ratios[key] === maxRatio);
    }
    
    return orientation;
}

/**
 * Charger un CSV dans une table temporaire (par lots)
 */
async function loadCSVToTemp(csvFile, tableName, processRow) {
    if (!fs.existsSync(csvFile)) {
        console.log(`⚠️  Fichier manquant : ${path.basename(csvFile)}`);
        return 0;
    }
    
    return new Promise((resolve, reject) => {
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
        
        fs.createReadStream(csvFile)
            .pipe(csv())
            .on('data', (row) => {
                lineNumber++;
                
                if (lineNumber % 100000 === 0) {
                    process.stdout.write(`\r   📊 ${(lineNumber / 1000000).toFixed(1)}M lignes`);
                }
                
                const processed = processRow.process(row);
                if (processed) {
                    batch.push(processed);
                    
                    if (batch.length >= BATCH_SIZE) {
                        insertBatch(batch);
                        totalInserted += batch.length;
                        batch = [];
                    }
                }
            })
            .on('end', () => {
                // Derniers lots
                if (batch.length > 0) {
                    insertBatch(batch);
                    totalInserted += batch.length;
                }
                
                console.log(`\r   ✅ ${totalInserted.toLocaleString()} lignes insérées`);
                resolve(totalInserted);
            })
            .on('error', reject);
    });
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
                insertSQL: `INSERT OR IGNORE INTO temp_batiment (batiment_groupe_id, latitude, longitude, code_departement, nom_commune) VALUES (?, ?, ?, ?, ?)`,
                process: (row) => {
                    const id = row.batiment_groupe_id;
                    const wkt = row.geom_groupe;
                    const dept = row.code_departement_insee;
                    const commune = row.libelle_commune_insee || '';
                    
                    if (!id || !wkt) return null;
                    
                    const centroid = parseWKTAndGetCentroid(wkt);
                    if (!centroid) return null;
                    
                    const gps = lambert93ToWGS84(centroid.x, centroid.y);
                    if (!gps) return null;
                    
                    return [id, gps.latitude, gps.longitude, dept, commune];
                }
            }
        );
        console.log('');
        
        // ÉTAPE 3 : Charger DPE simplifié
        console.log('📂 ÉTAPE 3 : Chargement DPE simplifié...');
        await loadCSVToTemp(
            path.join(BDNB_DIR, 'batiment_groupe_dpe_representatif_logement.csv'),
            'temp_dpe',
            {
                insertSQL: `INSERT OR IGNORE INTO temp_dpe (
                    batiment_groupe_id, classe_dpe, orientation_principale, pourcentage_vitrage
                ) VALUES (?, ?, ?, ?)`,
                process: (row) => {
                    const id = row.batiment_groupe_id;
                    const dpe = row.classe_dpe;
                    const surfNord = parseFloat(row.surface_vitree_nord) || 0;
                    const surfSud = parseFloat(row.surface_vitree_sud) || 0;
                    const surfEst = parseFloat(row.surface_vitree_est) || 0;
                    const surfOuest = parseFloat(row.surface_vitree_ouest) || 0;
                    const surfHorizontal = parseFloat(row.surface_vitree_horizontal) || 0;
                    const pourcentageVitrage = parseFloat(row.pourcentage_surface_baie_vitree_exterieur) || null;
                    
                    const orientation = calculateOrientation(surfNord, surfSud, surfEst, surfOuest, surfHorizontal);
                    
                    if (!id || !dpe || dpe === 'N' || dpe === '') return null;
                    
                    return [id, dpe, orientation, pourcentageVitrage];
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
                    const sitId = row.type_numero_dau;
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
                    const sitId = row.type_numero_dau;
                    const typeAnnexe = row.type_annexe || '';
                    const date = row.date_reelle_autorisation;
                    
                    const piscine = typeAnnexe.toLowerCase().includes('piscine') ? 1 : 0;
                    const garage = typeAnnexe.toLowerCase().includes('garage') ? 1 : 0;
                    const veranda = typeAnnexe.toLowerCase().includes('veranda') || typeAnnexe.toLowerCase().includes('véranda') ? 1 : 0;
                    
                    if (!sitId) return null;
                    return [sitId, piscine, garage, veranda, date];
                }
            }
        );
        console.log('');
        
        // ÉTAPE 8 : Jointure SQL et insertion finale simplifiée
        console.log('📊 ÉTAPE 8 : Jointure et création table finale simplifiée...');
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
                nom_commune,
                classe_dpe,
                presence_piscine,
                presence_garage,
                presence_veranda,
                date_permis_annexes,
                type_bien,
                prix_m2_bati,
                prix_m2_terrain,
                orientation_principale,
                pourcentage_vitrage
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
                bat.nom_commune,
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
                END,
                dpe.orientation_principale,
                dpe.pourcentage_vitrage
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
        
        // Statistiques enrichies
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT code_departement) as nb_depts,
                COUNT(CASE WHEN classe_dpe IS NOT NULL THEN 1 END) as avec_dpe,
                COUNT(CASE WHEN presence_piscine = 1 THEN 1 END) as avec_piscine,
                COUNT(CASE WHEN presence_garage = 1 THEN 1 END) as avec_garage,
                COUNT(CASE WHEN presence_veranda = 1 THEN 1 END) as avec_veranda,
                COUNT(CASE WHEN orientation_principale = 'sud' THEN 1 END) as orientation_sud,
                COUNT(CASE WHEN orientation_principale IS NOT NULL THEN 1 END) as avec_orientation,
                COUNT(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 END) as avec_vitrage,
                AVG(pourcentage_vitrage) as moy_vitrage
            FROM dvf_avec_dpe_et_annexes
        `).get();
        
        console.log('📊 Statistiques simplifiées :');
        console.log(`   • Total transactions : ${stats.total.toLocaleString()}`);
        console.log(`   • Départements : ${stats.nb_depts}`);
        console.log(`   • Avec DPE : ${stats.avec_dpe.toLocaleString()} (${(stats.avec_dpe / stats.total * 100).toFixed(1)}%)`);
        console.log(`   • Avec orientation : ${stats.avec_orientation.toLocaleString()} (${(stats.avec_orientation / stats.total * 100).toFixed(1)}%)`);
        console.log(`   • Avec % vitrage : ${stats.avec_vitrage.toLocaleString()} (${(stats.avec_vitrage / stats.total * 100).toFixed(1)}%)`);
        console.log(`   • Orientation sud : ${stats.orientation_sud.toLocaleString()}`);
        console.log(`   • Avec piscine : ${stats.avec_piscine.toLocaleString()}`);
        console.log(`   • Avec garage : ${stats.avec_garage.toLocaleString()}`);
        console.log(`   • Avec véranda : ${stats.avec_veranda.toLocaleString()}`);
        console.log(`   • % vitrage moyen : ${stats.moy_vitrage?.toFixed(1) || 'N/A'}%`);
        console.log('');
        
        // Taille finale
        const dbStats = fs.statSync(DB_FILE);
        const sizeMB = (dbStats.size / 1024 / 1024).toFixed(1);
        console.log(`✅ Base enrichie créée : ${sizeMB} MB`);
        console.log(`📂 ${DB_FILE}\n`);
        
        db.close();
        
        console.log('🎉 === CRÉATION SIMPLIFIÉE TERMINÉE ===');
        console.log('🌅 Nouvelles colonnes ajoutées :');
        console.log('   • orientation_principale (nord/sud/est/ouest/mixte)');
        console.log('   • pourcentage_vitrage (% de vitrage par rapport à la surface)');
        
    } catch (error) {
        console.error('\n❌ Erreur :', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
