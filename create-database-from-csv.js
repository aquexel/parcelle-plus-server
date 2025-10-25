#!/usr/bin/env node

/**
 * 🚀 CRÉATION RAPIDE BASE DVF + DPE + ANNEXES
 * Script optimisé pour utiliser les CSV existants
 * Version simplifiée et rapide
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Database = require('better-sqlite3');

// Configuration
const CSV_DIR = process.argv[2] || path.join(__dirname, 'bdnb_data', 'csv');
const DB_FILE = path.join(__dirname, 'database', 'dvf_avec_dpe_et_annexes_enhanced.db');

console.log('🚀 === CRÉATION RAPIDE BASE DVF + DPE + ANNEXES ===\n');
console.log(`📂 Répertoire CSV : ${CSV_DIR}`);
console.log(`💾 Base de données : ${DB_FILE}\n`);

// Vérifier que le répertoire CSV existe
if (!fs.existsSync(CSV_DIR)) {
    console.error(`❌ Répertoire CSV introuvable : ${CSV_DIR}`);
    console.error('💡 Utilisation : node create-database-from-csv.js [chemin_csv]');
    process.exit(1);
}

// Vérifier les fichiers CSV nécessaires
const requiredFiles = [
    'batiment_groupe.csv',
    'batiment_groupe_dpe_representatif_logement.csv',
    'batiment_groupe_dvf_open_representatif.csv',
    'rel_batiment_groupe_parcelle.csv',
    'parcelle.csv'
];

console.log('🔍 Vérification des fichiers CSV :');
let allFilesPresent = true;
requiredFiles.forEach(file => {
    const filePath = path.join(CSV_DIR, file);
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
        console.log(`   ✅ ${file} (${sizeMB} MB)`);
    } else {
        console.log(`   ❌ ${file} - MANQUANT`);
        allFilesPresent = false;
    }
});

if (!allFilesPresent) {
    console.error('\n❌ Tous les fichiers CSV ne sont pas présents');
    process.exit(1);
}

console.log('');

// Supprimer ancienne base
if (fs.existsSync(DB_FILE)) {
    console.log('🗑️  Suppression ancienne base...');
    fs.unlinkSync(DB_FILE);
}

// Créer la base
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -128000'); // 128 MB cache pour plus de rapidité

console.log('📊 Création des tables...');

// Table finale
db.exec(`
    CREATE TABLE dvf_avec_dpe_et_annexes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        orientation_principale TEXT,
        pourcentage_vitrage REAL
    )
`);

// Tables temporaires
db.exec(`
    CREATE TABLE temp_batiment (
        batiment_groupe_id TEXT PRIMARY KEY,
        latitude REAL,
        longitude REAL,
        code_departement TEXT,
        nom_commune TEXT
    )
`);

db.exec(`
    CREATE TABLE temp_dpe (
        batiment_groupe_id TEXT PRIMARY KEY,
        classe_dpe TEXT,
        orientation_principale TEXT,
        pourcentage_vitrage REAL
    )
`);

db.exec(`
    CREATE TABLE temp_dvf (
        batiment_groupe_id TEXT PRIMARY KEY,
        valeur_fonciere REAL,
        date_mutation TEXT,
        surface_bati_maison REAL,
        surface_bati_appartement REAL,
        surface_terrain REAL,
        nb_pieces INTEGER,
        type_bien TEXT
    )
`);

console.log('✅ Tables créées\n');

// Fonction pour calculer l'orientation
function calculateOrientation(surfaceNord, surfaceSud, surfaceEst, surfaceOuest, surfaceHorizontal) {
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

// Fonction pour charger un CSV par lots
async function loadCSV(csvFile, tableName, processRow, batchSize = 10000) {
    if (!fs.existsSync(csvFile)) {
        console.log(`⚠️  Fichier manquant : ${csvFile}`);
        return 0;
    }
    
    console.log(`📂 Chargement ${path.basename(csvFile)}...`);
    
    let batch = [];
    let totalRows = 0;
    
    return new Promise((resolve, reject) => {
        const insertStmt = db.prepare(processRow.insertSQL);
        const insertMany = db.transaction((rows) => {
            for (const row of rows) {
                try {
                    insertStmt.run(row);
                } catch (error) {
                    // Ignorer les erreurs de contrainte (doublons, etc.)
                }
            }
        });
        
        fs.createReadStream(csvFile)
            .pipe(csv())
            .on('data', (row) => {
                const processedRow = processRow.process(row);
                if (processedRow) {
                    batch.push(processedRow);
                    
                    if (batch.length >= batchSize) {
                        insertMany(batch);
                        totalRows += batch.length;
                        batch = [];
                    }
                }
            })
            .on('end', () => {
                if (batch.length > 0) {
                    insertMany(batch);
                    totalRows += batch.length;
                }
                console.log(`   ✅ ${totalRows.toLocaleString()} lignes chargées`);
                resolve(totalRows);
            })
            .on('error', reject);
    });
}

// Chargement des données
async function loadData() {
    console.log('📊 Chargement des données...\n');
    
    // 1. Charger les bâtiments
    await loadCSV(
        path.join(CSV_DIR, 'batiment_groupe.csv'),
        'temp_batiment',
        {
            insertSQL: `INSERT OR IGNORE INTO temp_batiment VALUES (?, ?, ?, ?, ?)`,
            process: (row) => {
                const id = row.batiment_groupe_id;
                const lat = parseFloat(row.latitude);
                const lon = parseFloat(row.longitude);
                const dept = row.code_departement;
                const commune = row.nom_commune;
                
                if (!id || !lat || !lon) return null;
                return [id, lat, lon, dept, commune];
            }
        }
    );
    
    // 2. Charger les DPE
    await loadCSV(
        path.join(CSV_DIR, 'batiment_groupe_dpe_representatif_logement.csv'),
        'temp_dpe',
        {
            insertSQL: `INSERT OR IGNORE INTO temp_dpe VALUES (?, ?, ?, ?)`,
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
    
    // 3. Charger les DVF
    await loadCSV(
        path.join(CSV_DIR, 'batiment_groupe_dvf_open_representatif.csv'),
        'temp_dvf',
        {
            insertSQL: `INSERT OR REPLACE INTO temp_dvf VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
                if (surfMaison > 0) type = 'maison';
                else if (surfAppart > 0) type = 'appartement';
                else if (surfTerrain > 0) type = 'terrain';
                
                if (!id || !valeur || valeur <= 0) return null;
                
                return [id, valeur, date, surfMaison, surfAppart, surfTerrain, nbPieces, type];
            }
        }
    );
    
    console.log('');
}

// Création de la table finale
async function createFinalTable() {
    console.log('🔗 Création de la table finale...');
    console.log('   ⏳ Jointure en cours (peut prendre quelques minutes)...');
    
    const startTime = Date.now();
    
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
            0 as presence_piscine,
            0 as presence_garage,
            0 as presence_veranda,
            dvf.type_bien,
            CASE 
                WHEN dvf.surface_bati_maison > 0 THEN dvf.valeur_fonciere / dvf.surface_bati_maison
                WHEN dvf.surface_bati_appartement > 0 THEN dvf.valeur_fonciere / dvf.surface_bati_appartement
                ELSE NULL
            END as prix_m2_bati,
            CASE 
                WHEN dvf.surface_terrain > 0 THEN dvf.valeur_fonciere / dvf.surface_terrain
                ELSE NULL
            END as prix_m2_terrain,
            dpe.orientation_principale,
            dpe.pourcentage_vitrage
        FROM temp_dvf dvf
        INNER JOIN temp_batiment bat ON dvf.batiment_groupe_id = bat.batiment_groupe_id
        LEFT JOIN temp_dpe dpe ON dvf.batiment_groupe_id = dpe.batiment_groupe_id
        WHERE bat.latitude IS NOT NULL
            AND bat.longitude IS NOT NULL
            AND dvf.valeur_fonciere > 0
    `);
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    const count = db.prepare('SELECT COUNT(*) as count FROM dvf_avec_dpe_et_annexes').get().count;
    console.log(`   ✅ ${count.toLocaleString()} transactions insérées en ${duration}s\n`);
}

// Statistiques finales
function showStats() {
    console.log('📊 Statistiques finales :');
    
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT code_departement) as nb_depts,
            COUNT(CASE WHEN classe_dpe IS NOT NULL THEN 1 END) as avec_dpe,
            COUNT(CASE WHEN orientation_principale IS NOT NULL THEN 1 END) as avec_orientation,
            COUNT(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 END) as avec_vitrage,
            COUNT(CASE WHEN presence_piscine = 1 THEN 1 END) as avec_piscine,
            COUNT(CASE WHEN presence_garage = 1 THEN 1 END) as avec_garage,
            COUNT(CASE WHEN presence_veranda = 1 THEN 1 END) as avec_veranda,
            AVG(pourcentage_vitrage) as moy_vitrage
        FROM dvf_avec_dpe_et_annexes
    `).get();
    
    console.log(`   • Total transactions : ${stats.total.toLocaleString()}`);
    console.log(`   • Départements : ${stats.nb_depts}`);
    console.log(`   • Avec DPE : ${stats.avec_dpe.toLocaleString()} (${(stats.avec_dpe / stats.total * 100).toFixed(1)}%)`);
    console.log(`   • Avec orientation : ${stats.avec_orientation.toLocaleString()} (${(stats.avec_orientation / stats.total * 100).toFixed(1)}%)`);
    console.log(`   • Avec % vitrage : ${stats.avec_vitrage.toLocaleString()} (${(stats.avec_vitrage / stats.total * 100).toFixed(1)}%)`);
    console.log(`   • Avec piscine : ${stats.avec_piscine.toLocaleString()}`);
    console.log(`   • Avec garage : ${stats.avec_garage.toLocaleString()}`);
    console.log(`   • Avec véranda : ${stats.avec_veranda.toLocaleString()}`);
    console.log(`   • % vitrage moyen : ${stats.moy_vitrage?.toFixed(1) || 'N/A'}%`);
    console.log('');
    
    // Taille finale
    const dbStats = fs.statSync(DB_FILE);
    const sizeMB = (dbStats.size / 1024 / 1024).toFixed(1);
    console.log(`✅ Base créée : ${sizeMB} MB`);
    console.log(`📂 ${DB_FILE}\n`);
}

// Fonction principale
async function main() {
    try {
        await loadData();
        await createFinalTable();
        showStats();
        
        db.close();
        
        console.log('🎉 === CRÉATION TERMINÉE AVEC SUCCÈS ===');
        console.log('🚀 Script optimisé pour la rapidité');
        console.log('💾 Utilise vos fichiers CSV existants');
        
    } catch (error) {
        console.error('\n❌ Erreur :', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();


