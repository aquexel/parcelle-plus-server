/**
 * Script pour créer une base de référence des bâtiments avec DPE
 * 
 * Stratégie simplifiée :
 * 1. Lire batiment_groupe.csv (coordonnées GPS)
 * 2. Lire batiment_groupe_dpe_representatif_logement.csv (DPE)
 * 3. Créer table batiments_avec_dpe (jointure par batiment_groupe_id)
 * 
 * Utilisation ultérieure :
 * - L'API cherchera les transactions DVF dans un rayon
 * - Pour chaque transaction, trouvera le bâtiment BDNB le plus proche via GPS
 * - Récupérera le DPE pour ajuster le prix
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const DB_PATH = path.join(__dirname, 'database', 'dpe_bdnb.db');
const BDNB_PATH = process.argv[2] || path.join(__dirname, 'bdnb_data');

console.log('🚀 === CRÉATION BASE BÂTIMENTS AVEC DPE ===');
console.log(`📂 Base de données : ${DB_PATH}`);
console.log(`📂 Données BDNB : ${BDNB_PATH}\n`);

// Vérifier que le dossier existe
if (!fs.existsSync(BDNB_PATH)) {
    console.error(`❌ Erreur : Le dossier ${BDNB_PATH} n'existe pas`);
    console.log(`\n💡 Usage: node create_batiments_dpe_db.js [chemin_bdnb]`);
    console.log(`   Exemple: node create_batiments_dpe_db.js /opt/parcelle-plus/bdnb_data`);
    process.exit(1);
}

// Ouvrir/créer la base de données
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Erreur ouverture base de données:', err);
        process.exit(1);
    }
    console.log('✅ Base de données ouverte');
});

// Fonction pour trouver un fichier CSV (gère les sous-dossiers)
function findCSVFile(basePath, filename) {
    let filePath = path.join(basePath, filename);
    if (fs.existsSync(filePath)) return filePath;
    
    // Chercher dans les sous-dossiers
    const items = fs.readdirSync(basePath);
    for (const item of items) {
        const itemPath = path.join(basePath, item);
        if (fs.statSync(itemPath).isDirectory()) {
            filePath = path.join(itemPath, filename);
            if (fs.existsSync(filePath)) return filePath;
        }
    }
    
    throw new Error(`Fichier ${filename} non trouvé dans ${basePath}`);
}

// Fonction pour lire un fichier CSV ligne par ligne (optimisée mémoire)
async function processCSVInChunks(filePath, callback, chunkSize = 10000) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let headers = null;
    let chunk = [];
    let lineCount = 0;
    let processedCount = 0;

    for await (const line of rl) {
        if (!headers) {
            // Première ligne = headers
            headers = line.split(',').map(h => h.replace(/"/g, '').trim());
            continue;
        }

        // Parser la ligne
        const values = parseCsvLine(line);
        if (values.length !== headers.length) {
            continue; // Skip malformed lines
        }

        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index];
        });
        
        chunk.push(row);
        lineCount++;

        // Traiter par chunks
        if (chunk.length >= chunkSize) {
            await callback(chunk, headers);
            processedCount += chunk.length;
            console.log(`   📊 ${processedCount.toLocaleString()} lignes traitées...`);
            chunk = [];
        }
    }

    // Traiter le dernier chunk
    if (chunk.length > 0) {
        await callback(chunk, headers);
        processedCount += chunk.length;
    }

    console.log(`✅ Total traité : ${processedCount.toLocaleString()} lignes`);
    return processedCount;
}

// Parser une ligne CSV en gérant les guillemets et virgules
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    
    return result.map(v => v.replace(/^"|"$/g, ''));
}

// Fonction principale
async function createBatimentsDB() {
    try {
        // ÉTAPE 1 : Trouver les fichiers CSV
        console.log('\n📂 ÉTAPE 1 : Recherche des fichiers CSV...');
        const batimentFile = findCSVFile(BDNB_PATH, 'batiment_groupe.csv');
        const dpeFile = findCSVFile(BDNB_PATH, 'batiment_groupe_dpe_representatif_logement.csv');
        console.log(`✅ Fichier bâtiments : ${batimentFile}`);
        console.log(`✅ Fichier DPE : ${dpeFile}`);

        // ÉTAPE 2 : Créer la table
        console.log('\n📊 ÉTAPE 2 : Création de la table batiments_avec_dpe...');
        await new Promise((resolve, reject) => {
            db.run(`DROP TABLE IF EXISTS batiments_avec_dpe`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE batiments_avec_dpe (
                    batiment_groupe_id TEXT PRIMARY KEY,
                    latitude REAL,
                    longitude REAL,
                    classe_dpe TEXT,
                    classe_ges TEXT,
                    surface_habitable REAL,
                    annee_construction INTEGER,
                    conso_energie REAL,
                    emission_ges REAL,
                    type_batiment TEXT,
                    nb_logements INTEGER,
                    code_departement TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Table créée');

        // ÉTAPE 3 : Indexer les DPE en mémoire
        console.log('\n📂 ÉTAPE 3 : Indexation des DPE...');
        const dpeMap = new Map();
        let dpeCount = 0;
        
        await processCSVInChunks(dpeFile, async (chunk, headers) => {
            chunk.forEach(row => {
                if (row.batiment_groupe_id && row.classe_bilan_dpe) {
                    dpeMap.set(row.batiment_groupe_id, {
                        classe_dpe: row.classe_bilan_dpe,
                        classe_ges: row.classe_emission_ges,
                        surface_habitable: parseFloat(row.surface_habitable_logement) || null,
                        annee_construction: parseInt(row.annee_construction_dpe) || null,
                        conso_energie: parseFloat(row.conso_5_usages_ep_m2) || null,
                        emission_ges: parseFloat(row.emission_ges_5_usages_m2) || null,
                        type_batiment: row.type_batiment_dpe
                    });
                    dpeCount++;
                }
            });
        });
        
        console.log(`✅ ${dpeCount.toLocaleString()} DPE indexés en mémoire`);

        // ÉTAPE 4 : Traiter les bâtiments et les insérer
        console.log('\n💾 ÉTAPE 4 : Traitement et insertion des bâtiments...');
        
        const insertStmt = db.prepare(`
            INSERT INTO batiments_avec_dpe (
                batiment_groupe_id, latitude, longitude,
                classe_dpe, classe_ges, surface_habitable,
                annee_construction, conso_energie, emission_ges,
                type_batiment, nb_logements, code_departement
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let insertedCount = 0;
        let withDPE = 0;

        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await processCSVInChunks(batimentFile, async (chunk, headers) => {
            chunk.forEach(row => {
                const id = row.batiment_groupe_id;
                const lat = parseFloat(row.latitude);
                const lng = parseFloat(row.longitude);
                
                if (!id || !lat || !lng) return;
                
                const dpe = dpeMap.get(id);
                
                // N'insérer que les bâtiments avec DPE ET coordonnées valides
                if (dpe && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    insertStmt.run(
                        id, lat, lng,
                        dpe.classe_dpe, dpe.classe_ges, dpe.surface_habitable,
                        dpe.annee_construction, dpe.conso_energie, dpe.emission_ges,
                        dpe.type_batiment,
                        parseInt(row.nb_log) || null,
                        row.code_departement_insee || null
                    );
                    insertedCount++;
                    withDPE++;
                }
            });
        });

        insertStmt.finalize();

        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        console.log(`✅ ${insertedCount.toLocaleString()} bâtiments insérés (tous avec DPE)`);

        // ÉTAPE 5 : Créer les index spatiaux
        console.log('\n🔍 ÉTAPE 5 : Création des index...');
        await new Promise((resolve, reject) => {
            db.run('CREATE INDEX idx_lat_lng ON batiments_avec_dpe(latitude, longitude)', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        await new Promise((resolve, reject) => {
            db.run('CREATE INDEX idx_dpe ON batiments_avec_dpe(classe_dpe)', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        await new Promise((resolve, reject) => {
            db.run('CREATE INDEX idx_dept ON batiments_avec_dpe(code_departement)', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Index créés');

        // ÉTAPE 6 : Statistiques finales
        console.log('\n📊 ÉTAPE 6 : Statistiques...');
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(DISTINCT classe_dpe) as nb_classes_dpe,
                    COUNT(DISTINCT code_departement) as nb_departements
                FROM batiments_avec_dpe
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        console.log(`\n╔══════════════════════════════════════════╗`);
        console.log(`║  ✅ BASE CRÉÉE AVEC SUCCÈS               ║`);
        console.log(`╚══════════════════════════════════════════╝`);
        console.log(`📊 Total bâtiments avec DPE : ${stats.total.toLocaleString()}`);
        console.log(`🏷️  Classes DPE distinctes : ${stats.nb_classes_dpe}`);
        console.log(`📍 Départements couverts : ${stats.nb_departements}`);
        console.log(`💾 Base de données : ${DB_PATH}`);
        console.log(``);

        db.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Erreur:', error);
        db.close();
        process.exit(1);
    }
}

// Lancer le script
createBatimentsDB();


