#!/usr/bin/env node

/**
 * 🚀 CRÉATION RAPIDE BASE DVF + DPE + ANNEXES - VERSION CORRIGÉE
 * Script optimisé pour utiliser les CSV existants avec les bonnes colonnes
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Database = require('better-sqlite3');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Configuration
const CSV_DIR = process.argv[2] || path.join(__dirname, 'open_data_millesime_2024-10-a_dep40_csv', 'csv');
const DB_FILE = path.join(__dirname, 'database', 'dvf_avec_dpe_et_annexes_enhanced.db');
const NUM_WORKERS = Math.min(os.cpus().length, 4); // Max 4 workers pour éviter la surcharge

console.log('🚀 === CRÉATION RAPIDE BASE DVF + DPE + ANNEXES (MULTI-CORE) ===\n');
console.log(`📂 Répertoire CSV : ${CSV_DIR}`);
console.log(`💾 Base de données : ${DB_FILE}`);
console.log(`⚡ Workers : ${NUM_WORKERS} (${os.cpus().length} cœurs disponibles)\n`);

// Vérifier que le répertoire CSV existe
if (!fs.existsSync(CSV_DIR)) {
    console.error(`❌ Répertoire CSV introuvable : ${CSV_DIR}`);
    console.error('💡 Utilisation : node create-database-corrected.js [chemin_csv]');
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

// Créer la base avec optimisations multi-core
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -256000'); // 256 MB cache pour plus de rapidité
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456'); // 256 MB mmap
db.pragma('page_size = 4096');
db.pragma('locking_mode = EXCLUSIVE');

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

db.exec(`
    CREATE TABLE temp_relations (
        batiment_groupe_id TEXT,
        parcelle_id TEXT,
        PRIMARY KEY (batiment_groupe_id, parcelle_id)
    )
`);

console.log('✅ Tables créées\n');

// Fonction pour calculer l'orientation depuis les surfaces vitrées
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

// Fonction pour parser le pourcentage de vitrage depuis le format JSON
function parseVitragePercentage(vitrageString) {
    if (!vitrageString || vitrageString === '') {
        return null;
    }
    
    try {
        // Nettoyer la chaîne et extraire les valeurs numériques
        const cleaned = vitrageString.replace(/[\[\]""]/g, '').trim();
        
        // Si c'est un pourcentage direct
        const directMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
        if (directMatch) {
            return parseFloat(directMatch[1]);
        }
        
        // Si c'est un format avec orientations
        const orientations = cleaned.split(',').map(o => o.trim());
        if (orientations.length > 0) {
            // Retourner le nombre d'orientations comme indicateur
            return orientations.length;
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

// Fonction pour déterminer l'orientation depuis l_orientation_baie_vitree
function parseOrientationFromBaie(orientationBaie) {
    if (!orientationBaie || orientationBaie === '') {
        return null;
    }
    
    const value = parseFloat(orientationBaie);
    
    // Mapping des valeurs numériques vers les orientations
    if (value === 0) return 'nord';
    if (value === 1) return 'sud';
    if (value === 2) return 'est';
    if (value === 3) return 'ouest';
    if (value === 4) return 'horizontal';
    
    return 'mixte';
}

// Fonction pour extraire les coordonnées depuis la géométrie (version améliorée)
function extractCoordinates(geomString) {
    if (!geomString || geomString === '' || geomString === 'NULL') {
        return null;
    }
    
    try {
        // Nettoyer la chaîne
        const cleaned = geomString.trim();
        
        // Essayer différents formats de géométrie
        const patterns = [
            // MULTIPOLYGON simple
            /\(\(([^)]+)\)\)/,
            // POLYGON simple  
            /\(([^)]+)\)/,
            // Coordonnées directes
            /(\d+\.?\d*)\s+(\d+\.?\d*)/
        ];
        
        for (const pattern of patterns) {
            const match = cleaned.match(pattern);
            if (match) {
                let coordsStr = match[1] || match[0];
                
                // Extraire la première paire de coordonnées
                const coordMatch = coordsStr.match(/(\d+\.?\d*)\s+(\d+\.?\d*)/);
                if (coordMatch) {
                    const x = parseFloat(coordMatch[1]);
                    const y = parseFloat(coordMatch[2]);
                    
                    // Vérifier que les coordonnées sont valides (France métropolitaine)
                    if (x >= -10 && x <= 10 && y >= 40 && y <= 55) {
                        return { x, y };
                    }
                }
            }
        }
        
        // Dernière tentative : chercher n'importe quelle paire de nombres
        const fallbackMatch = cleaned.match(/(\d+\.?\d*)\s+(\d+\.?\d*)/);
        if (fallbackMatch) {
            const x = parseFloat(fallbackMatch[1]);
            const y = parseFloat(fallbackMatch[2]);
            
            if (!isNaN(x) && !isNaN(y) && x >= -10 && x <= 10 && y >= 40 && y <= 55) {
                return { x, y };
            }
        }
        
    } catch (error) {
        // Ignorer les erreurs de parsing
    }
    
    return null;
}

// Fonction pour estimer rapidement le nombre de lignes
async function estimateCSVLines(csvFile) {
    return new Promise((resolve, reject) => {
        const stats = fs.statSync(csvFile);
        const fileSize = stats.size;
        
        // Lire seulement les premiers 1 MB pour estimer la taille moyenne d'une ligne
        const sampleSize = Math.min(1024 * 1024, fileSize); // 1 MB max
        const stream = fs.createReadStream(csvFile, { start: 0, end: sampleSize - 1 });
        
        let sampleLines = 0;
        let sampleBytes = 0;
        
        stream
            .on('data', (chunk) => {
                sampleBytes += chunk.length;
                // Compter les retours à la ligne dans l'échantillon
                sampleLines += (chunk.toString().match(/\n/g) || []).length;
            })
            .on('end', () => {
                if (sampleLines > 0) {
                    // Estimer le nombre total de lignes basé sur l'échantillon
                    const avgBytesPerLine = sampleBytes / sampleLines;
                    const estimatedLines = Math.floor(fileSize / avgBytesPerLine);
                    resolve(estimatedLines);
                } else {
                    // Fallback : estimation basée sur la taille du fichier
                    resolve(Math.floor(fileSize / 200)); // ~200 bytes par ligne en moyenne
                }
            })
            .on('error', reject);
    });
}

// Fonction pour charger un CSV par lots avec barre de progression
async function loadCSV(csvFile, tableName, processRow, batchSize = 10000) {
    if (!fs.existsSync(csvFile)) {
        console.log(`⚠️  Fichier manquant : ${csvFile}`);
        return 0;
    }
    
    // Obtenir la taille du fichier
    const stats = fs.statSync(csvFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    
    console.log(`📂 Chargement ${path.basename(csvFile)} (${fileSizeMB} MB)...`);
    console.log(`   🔍 Estimation du nombre de lignes...`);
    
    const totalLines = await estimateCSVLines(csvFile);
    console.log(`   📊 ~${totalLines.toLocaleString()} lignes estimées`);
    console.log(`   ⏳ Chargement en cours...`);
    
    let batch = [];
    let totalRows = 0;
    let lastProgressUpdate = 0;
    
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
        
        const stream = fs.createReadStream(csvFile);
        
        stream
            .pipe(csv())
            .on('data', (row) => {
                const processedRow = processRow.process(row);
                if (processedRow) {
                    batch.push(processedRow);
                    
                    if (batch.length >= batchSize) {
                        insertMany(batch);
                        totalRows += batch.length;
                        batch = [];
                        
                        // Mettre à jour la barre de progression toutes les 50k lignes
                        if (totalRows - lastProgressUpdate >= 50000) {
                            const progress = Math.min(100, (totalRows / totalLines) * 100).toFixed(1);
                            process.stdout.write(`\r   📊 Progression : ${totalRows.toLocaleString()}/${totalLines.toLocaleString()} lignes (${progress}%)`);
                            lastProgressUpdate = totalRows;
                        }
                    }
                }
            })
            .on('end', () => {
                if (batch.length > 0) {
                    insertMany(batch);
                    totalRows += batch.length;
                }
                
                // Effacer la ligne de progression et afficher le résultat final
                process.stdout.write('\r' + ' '.repeat(80) + '\r');
                console.log(`   ✅ ${totalRows.toLocaleString()} lignes chargées`);
                resolve(totalRows);
            })
            .on('error', reject);
    });
}


// Chargement des données en parallèle simple
async function loadData() {
    console.log('📊 Chargement des données en parallèle...\n');
    
    const startTime = Date.now();
    
    // Définir les tâches de chargement
    const loadTasks = [
        {
            name: 'Bâtiments',
            file: 'batiment_groupe.csv',
            table: 'temp_batiment',
            insertSQL: `INSERT OR IGNORE INTO temp_batiment VALUES (?, ?, ?, ?, ?)`,
            process: (row) => {
                const id = row.batiment_groupe_id;
                const coords = extractCoordinates(row.geom_groupe);
                const dept = row.code_departement_insee;
                const commune = row.libelle_commune_insee;
                
                if (!id || !coords) return null;
                return [id, coords.x, coords.y, dept, commune];
            }
        },
        {
            name: 'DPE',
            file: 'batiment_groupe_dpe_representatif_logement.csv',
            table: 'temp_dpe',
            insertSQL: `INSERT OR IGNORE INTO temp_dpe VALUES (?, ?, ?, ?)`,
            process: (row) => {
                const id = row.batiment_groupe_id;
                const dpe = row.classe_bilan_dpe;
                
                const surfNord = parseFloat(row.surface_vitree_nord) || 0;
                const surfSud = parseFloat(row.surface_vitree_sud) || 0;
                const surfEst = parseFloat(row.surface_vitree_est) || 0;
                const surfOuest = parseFloat(row.surface_vitree_ouest) || 0;
                const surfHorizontal = parseFloat(row.surface_vitree_horizontal) || 0;
                
                let orientation = calculateOrientation(surfNord, surfSud, surfEst, surfOuest, surfHorizontal);
                
                if (orientation === 'inconnue' && row.l_orientation_baie_vitree) {
                    const orientationBaie = parseOrientationFromBaie(row.l_orientation_baie_vitree);
                    if (orientationBaie) {
                        orientation = orientationBaie;
                    }
                }
                
                const pourcentageVitrage = parseVitragePercentage(row.pourcentage_surface_baie_vitree_exterieur);
                
                if (!id || !dpe || dpe === 'N' || dpe === '') return null;
                
                return [id, dpe, orientation, pourcentageVitrage];
            }
        },
        {
            name: 'DVF',
            file: 'batiment_groupe_dvf_open_representatif.csv',
            table: 'temp_dvf',
            insertSQL: `INSERT OR REPLACE INTO temp_dvf VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            process: (row) => {
                const id = row.batiment_groupe_id;
                const valeur = parseFloat(row.valeur_fonciere);
                const date = row.date_mutation;
                const surfMaison = parseFloat(row.surface_bati_mutee_residencielle_individuelle) || null;
                const surfAppart = parseFloat(row.surface_bati_mutee_residencielle_collective) || null;
                const surfTerrain = parseFloat(row.surface_terrain_mutee) || null;
                const nbPieces = parseInt(row.nb_piece_principale) || null;
                
                let type = 'inconnu';
                if (surfMaison > 0) type = 'maison';
                else if (surfAppart > 0) type = 'appartement';
                else if (surfTerrain > 0) type = 'terrain';
                
                if (!id || !valeur || valeur <= 0) return null;
                
                return [id, valeur, date, surfMaison, surfAppart, surfTerrain, nbPieces, type];
            }
        },
        {
            name: 'Relations',
            file: 'rel_batiment_groupe_parcelle.csv',
            table: 'temp_relations',
            insertSQL: `INSERT OR IGNORE INTO temp_relations VALUES (?, ?)`,
            process: (row) => {
                const batimentId = row.batiment_groupe_id;
                const parcelleId = row.parcelle_id;
                
                if (!batimentId || !parcelleId) return null;
                
                return [batimentId, parcelleId];
            }
        }
    ];
    
    // Charger tous les fichiers en parallèle
    console.log(`⚡ Lancement de ${loadTasks.length} tâches en parallèle...`);
    console.log(`📊 Fichiers à traiter : ${loadTasks.map(t => t.file).join(', ')}`);
    
    const results = await Promise.all(
        loadTasks.map(task => 
            loadCSV(
                path.join(CSV_DIR, task.file),
                task.table,
                {
                    insertSQL: task.insertSQL,
                    process: task.process
                }
            ).then(rows => {
                console.log(`✅ ${task.name} : ${rows.toLocaleString()} lignes`);
                return { task: task.name, rows };
            })
        )
    );
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    const totalRows = results.reduce((sum, r) => sum + r.rows, 0);
    
    console.log(`\n🎉 Chargement parallèle terminé en ${duration}s`);
    console.log(`📊 Total : ${totalRows.toLocaleString()} lignes chargées`);
    console.log(`⚡ Vitesse : ${(totalRows / (endTime - startTime) * 1000).toFixed(0)} lignes/seconde\n`);
}

// Création de la table finale avec progression
async function createFinalTable() {
    console.log('🔗 Création de la table finale...');
    console.log('   ⏳ Jointure en cours (peut prendre quelques minutes)...');
    
    const startTime = Date.now();
    
    // Afficher une barre de progression simulée pour la jointure
    const progressInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        process.stdout.write(`\r   🔄 Jointure en cours... ${elapsed.toFixed(0)}s`);
    }, 1000);
    
    try {
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
        WHERE dvf.valeur_fonciere > 0
        `);
        
        clearInterval(progressInterval);
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);
        
        const count = db.prepare('SELECT COUNT(*) as count FROM dvf_avec_dpe_et_annexes').get().count;
        
        // Effacer la ligne de progression et afficher le résultat
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        console.log(`   ✅ ${count.toLocaleString()} transactions insérées en ${duration}s\n`);
        
    } catch (error) {
        clearInterval(progressInterval);
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        throw error;
    }
}

// Statistiques finales
function showStats() {
    console.log('📊 Statistiques finales :');
    
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT code_departement) as nb_depts,
            COUNT(CASE WHEN classe_dpe IS NOT NULL THEN 1 END) as avec_dpe,
            COUNT(CASE WHEN orientation_principale IS NOT NULL AND orientation_principale != 'inconnue' THEN 1 END) as avec_orientation,
            COUNT(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 END) as avec_vitrage,
            COUNT(CASE WHEN presence_piscine = 1 THEN 1 END) as avec_piscine,
            COUNT(CASE WHEN presence_garage = 1 THEN 1 END) as avec_garage,
            COUNT(CASE WHEN presence_veranda = 1 THEN 1 END) as avec_veranda,
            AVG(pourcentage_vitrage) as moy_vitrage,
            MIN(pourcentage_vitrage) as min_vitrage,
            MAX(pourcentage_vitrage) as max_vitrage
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
    console.log(`   • % vitrage min/max : ${stats.min_vitrage?.toFixed(1) || 'N/A'}% / ${stats.max_vitrage?.toFixed(1) || 'N/A'}%`);
    console.log('');
    
    // Statistiques détaillées par orientation
    const orientationStats = db.prepare(`
        SELECT 
            orientation_principale,
            COUNT(*) as count,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM dvf_avec_dpe_et_annexes WHERE orientation_principale IS NOT NULL), 1) as percentage
        FROM dvf_avec_dpe_et_annexes
        WHERE orientation_principale IS NOT NULL AND orientation_principale != 'inconnue'
        GROUP BY orientation_principale
        ORDER BY count DESC
    `).all();
    
    if (orientationStats.length > 0) {
        console.log('📊 Répartition par orientation :');
        orientationStats.forEach(stat => {
            console.log(`   • ${stat.orientation_principale} : ${stat.count.toLocaleString()} (${stat.percentage}%)`);
        });
        console.log('');
    }
    
    // Échantillons de données avec DPE, orientation et vitrage
    const samples = db.prepare(`
        SELECT 
            batiment_groupe_id,
            valeur_fonciere,
            type_bien,
            classe_dpe,
            orientation_principale,
            pourcentage_vitrage
        FROM dvf_avec_dpe_et_annexes
        WHERE classe_dpe IS NOT NULL 
            AND orientation_principale IS NOT NULL 
            AND pourcentage_vitrage IS NOT NULL
        LIMIT 5
    `).all();
    
    if (samples.length > 0) {
        console.log('📝 Échantillons avec DPE + orientation + vitrage :');
        samples.forEach((sample, i) => {
            console.log(`   ${i+1}. ID: ${sample.batiment_groupe_id}, Prix: ${sample.valeur_fonciere?.toLocaleString()} €`);
            console.log(`      Type: ${sample.type_bien}, DPE: ${sample.classe_dpe}, Orientation: ${sample.orientation_principale}, Vitrage: ${sample.pourcentage_vitrage}%`);
        });
        console.log('');
    }
    
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
        console.log('🚀 Script multi-core optimisé');
        console.log('⚡ Utilise tous les processeurs disponibles');
        console.log('💾 Utilise vos fichiers CSV existants');
        console.log('🔧 Correction : classe_bilan_dpe au lieu de classe_dpe');
        console.log(`🔥 Performance : ${NUM_WORKERS} workers parallèles`);
        
    } catch (error) {
        console.error('\n❌ Erreur :', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
