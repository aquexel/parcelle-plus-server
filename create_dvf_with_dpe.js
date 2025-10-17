/**
 * Script pour créer une base DVF enrichie avec DPE et géolocalisation
 * 
 * Champs finaux :
 * - DPE (A-G)
 * - Localisation (lat, lng)
 * - Prix de vente
 * - Surface bâti + jardin
 * - Date de mutation
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { wktLambert93ToWGS84 } = require('./convert_lambert_to_wgs84');

// Configuration
const DB_PATH = path.join(__dirname, 'database', 'dpe_bdnb.db');
const BDNB_PATH = process.argv[2] || path.join(__dirname, 'bdnb_data');

console.log('🚀 === CRÉATION BASE DVF + DPE ===');
console.log(`📂 Base de données : ${DB_PATH}`);
console.log(`📂 Données BDNB : ${BDNB_PATH}\n`);

// Vérifier que le dossier existe
if (!fs.existsSync(BDNB_PATH)) {
    console.error(`❌ Erreur : Le dossier ${BDNB_PATH} n'existe pas`);
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

// Trouver un fichier CSV (gère les sous-dossiers)
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

// Parser une ligne CSV
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

// Lire CSV avec indexation par ID
async function indexCSVById(filePath, idField) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let headers = null;
    const index = new Map();
    let lineCount = 0;

    for await (const line of rl) {
        if (!headers) {
            headers = parseCsvLine(line);
            continue;
        }

        const values = parseCsvLine(line);
        if (values.length !== headers.length) continue;

        const row = {};
        headers.forEach((header, idx) => {
            row[header] = values[idx];
        });

        const id = row[idField];
        if (id) {
            index.set(id, row);
            lineCount++;
            
            if (lineCount % 50000 === 0) {
                console.log(`   📊 ${lineCount.toLocaleString()} lignes indexées...`);
            }
        }
    }

    console.log(`✅ ${lineCount.toLocaleString()} lignes indexées`);
    return { headers, index };
}

// Fonction principale
async function createDVFWithDPE() {
    try {
        // ÉTAPE 1 : Trouver les fichiers CSV
        console.log('\n📂 ÉTAPE 1 : Recherche des fichiers CSV...');
        const dvfFile = findCSVFile(BDNB_PATH, 'batiment_groupe_dvf_open_representatif.csv');
        const dpeFile = findCSVFile(BDNB_PATH, 'batiment_groupe_dpe_representatif_logement.csv');
        const geometryFile = findCSVFile(BDNB_PATH, 'batiment_groupe.csv');
        console.log(`✅ DVF : ${dvfFile}`);
        console.log(`✅ DPE : ${dpeFile}`);
        console.log(`✅ Géométrie : ${geometryFile}`);

        // ÉTAPE 2 : Indexer les DPE
        console.log('\n📂 ÉTAPE 2 : Indexation des DPE...');
        const dpeData = await indexCSVById(dpeFile, 'batiment_groupe_id');

        // ÉTAPE 3 : Indexer les géométries
        console.log('\n📂 ÉTAPE 3 : Indexation des géométries...');
        const geomData = await indexCSVById(geometryFile, 'batiment_groupe_id');

        // ÉTAPE 4 : Créer la table
        console.log('\n📊 ÉTAPE 4 : Création de la table dvf_avec_dpe...');
        await new Promise((resolve, reject) => {
            db.run(`DROP TABLE IF EXISTS dvf_avec_dpe`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE dvf_avec_dpe (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batiment_groupe_id TEXT,
                    id_opendata TEXT,
                    
                    -- Prix DVF
                    valeur_fonciere REAL,
                    date_mutation TEXT,
                    
                    -- Surfaces
                    surface_bati_maison REAL,
                    surface_bati_appartement REAL,
                    surface_terrain REAL,
                    surface_totale REAL,
                    nb_pieces INTEGER,
                    
                    -- Localisation
                    latitude REAL,
                    longitude REAL,
                    code_departement TEXT,
                    
                    -- DPE
                    classe_dpe TEXT,
                    classe_ges TEXT,
                    conso_energie REAL,
                    
                    -- Compléments
                    type_bien TEXT,
                    prix_m2_bati REAL,
                    prix_m2_terrain REAL,
                    
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    -- Index spatiaux (ajout ultérieur)
                    UNIQUE(id_opendata)
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Table créée');

        // ÉTAPE 5 : Traiter les transactions DVF et enrichir
        console.log('\n💾 ÉTAPE 5 : Traitement des transactions DVF...');
        
        const fileStream = fs.createReadStream(dvfFile);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let headers = null;
        let inserted = 0;
        let withDPE = 0;
        let withCoords = 0;
        let skipped = 0;

        const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO dvf_avec_dpe (
                batiment_groupe_id, id_opendata,
                valeur_fonciere, date_mutation,
                surface_bati_maison, surface_bati_appartement, surface_terrain, surface_totale,
                nb_pieces, latitude, longitude, code_departement,
                classe_dpe, classe_ges, conso_energie,
                type_bien, prix_m2_bati, prix_m2_terrain
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        for await (const line of rl) {
            if (!headers) {
                headers = parseCsvLine(line);
                continue;
            }

            const values = parseCsvLine(line);
            if (values.length !== headers.length) continue;

            const dvf = {};
            headers.forEach((header, idx) => {
                dvf[header] = values[idx];
            });

            const batimentId = dvf.batiment_groupe_id;
            if (!batimentId) continue;

            // Enrichir avec DPE
            const dpe = dpeData.index.get(batimentId);
            
            // Enrichir avec géométrie + conversion WGS84
            const geom = geomData.index.get(batimentId);
            let coords = null;
            if (geom && geom.geom_groupe) {
                coords = wktLambert93ToWGS84(geom.geom_groupe);
            }

            // Calculer surfaces et type de bien
            const surfaceMaison = parseFloat(dvf.surface_bati_mutee_residencielle_individuelle) || 0;
            const surfaceAppart = parseFloat(dvf.surface_bati_mutee_residencielle_collective) || 0;
            const surfaceTerrain = parseFloat(dvf.surface_terrain_mutee) || 0;
            const surfaceTotale = surfaceMaison + surfaceAppart + surfaceTerrain;

            const nbMaisons = parseInt(dvf.nb_maison_mutee_mutation) || 0;
            const nbApparts = parseInt(dvf.nb_appartement_mutee_mutation) || 0;
            
            let typeBien = null;
            if (nbMaisons > 0) typeBien = 'maison';
            else if (nbApparts > 0) typeBien = 'appartement';
            else if (surfaceTerrain > 0) typeBien = 'terrain';

            // Insérer seulement si on a un minimum de données
            const valeurFonciere = parseFloat(dvf.valeur_fonciere);
            if (valeurFonciere > 0 && dvf.date_mutation && surfaceTotale > 0) {
                insertStmt.run([
                    batimentId,
                    dvf.id_opendata,
                    valeurFonciere,
                    dvf.date_mutation,
                    surfaceMaison,
                    surfaceAppart,
                    surfaceTerrain,
                    surfaceTotale,
                    parseInt(dvf.nb_piece_principale) || null,
                    coords?.lat || null,
                    coords?.lng || null,
                    dvf.code_departement_insee,
                    dpe?.classe_bilan_dpe || null,
                    dpe?.classe_emission_ges || null,
                    parseFloat(dpe?.conso_5_usages_ep_m2) || null,
                    typeBien,
                    parseFloat(dvf.prix_m2_local) || null,
                    parseFloat(dvf.prix_m2_terrain) || null
                ]);
                
                inserted++;
                if (dpe?.classe_bilan_dpe) withDPE++;
                if (coords) withCoords++;
                
                if (inserted % 5000 === 0) {
                    console.log(`   💾 ${inserted.toLocaleString()} transactions insérées (${withDPE} avec DPE, ${withCoords} avec GPS)...`);
                }
            } else {
                skipped++;
            }
        }

        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        insertStmt.finalize();
        
        console.log(`✅ ${inserted.toLocaleString()} transactions insérées`);
        console.log(`   📍 ${withCoords.toLocaleString()} avec coordonnées GPS`);
        console.log(`   🏷️  ${withDPE.toLocaleString()} avec DPE`);
        console.log(`   ⚠️  ${skipped.toLocaleString()} ignorées (données incomplètes)`);

        // ÉTAPE 6 : Créer des index
        console.log('\n🔍 ÉTAPE 6 : Création des index...');
        await new Promise((resolve, reject) => {
            db.run('CREATE INDEX idx_dvf_lat_lng ON dvf_avec_dpe(latitude, longitude)', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        await new Promise((resolve, reject) => {
            db.run('CREATE INDEX idx_dvf_dpe ON dvf_avec_dpe(classe_dpe)', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        await new Promise((resolve, reject) => {
            db.run('CREATE INDEX idx_dvf_date ON dvf_avec_dpe(date_mutation)', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        await new Promise((resolve, reject) => {
            db.run('CREATE INDEX idx_dvf_type ON dvf_avec_dpe(type_bien)', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Index créés');

        // ÉTAPE 7 : Statistiques
        console.log('\n📊 ÉTAPE 7 : Statistiques...');
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(classe_dpe) as avec_dpe,
                    COUNT(latitude) as avec_coords,
                    SUM(CASE WHEN classe_dpe = 'A' THEN 1 ELSE 0 END) as dpe_a,
                    SUM(CASE WHEN classe_dpe = 'B' THEN 1 ELSE 0 END) as dpe_b,
                    SUM(CASE WHEN classe_dpe = 'C' THEN 1 ELSE 0 END) as dpe_c,
                    SUM(CASE WHEN classe_dpe = 'D' THEN 1 ELSE 0 END) as dpe_d,
                    SUM(CASE WHEN classe_dpe = 'E' THEN 1 ELSE 0 END) as dpe_e,
                    SUM(CASE WHEN classe_dpe = 'F' THEN 1 ELSE 0 END) as dpe_f,
                    SUM(CASE WHEN classe_dpe = 'G' THEN 1 ELSE 0 END) as dpe_g
                FROM dvf_avec_dpe
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        console.log(`\n╔══════════════════════════════════════════╗`);
        console.log(`║  ✅ BASE CRÉÉE AVEC SUCCÈS               ║`);
        console.log(`╚══════════════════════════════════════════╝`);
        console.log(`📊 Total transactions : ${stats.total.toLocaleString()}`);
        console.log(`📍 Avec coordonnées GPS : ${stats.avec_coords.toLocaleString()} (${((stats.avec_coords/stats.total)*100).toFixed(1)}%)`);
        console.log(`🏷️  Avec DPE : ${stats.avec_dpe.toLocaleString()} (${((stats.avec_dpe/stats.total)*100).toFixed(1)}%)`);
        console.log(`\n📊 Distribution DPE :`);
        console.log(`   🟢 A : ${stats.dpe_a}`);
        console.log(`   🟢 B : ${stats.dpe_b}`);
        console.log(`   🟡 C : ${stats.dpe_c}`);
        console.log(`   🟡 D : ${stats.dpe_d}`);
        console.log(`   🟠 E : ${stats.dpe_e}`);
        console.log(`   🔴 F : ${stats.dpe_f}`);
        console.log(`   🔴 G : ${stats.dpe_g}`);
        console.log(`\n💾 Base de données : ${DB_PATH}`);
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
createDVFWithDPE();


