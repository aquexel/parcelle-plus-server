/**
 * Script pour enrichir la base DVF avec les données DPE de la BDNB
 * 
 * Stratégie :
 * 1. Lire toutes les transactions DVF de la base locale
 * 2. Lire les données BDNB (DVF + DPE) du CSV
 * 3. Faire une jointure pour enrichir les transactions avec le DPE
 * 4. Créer une nouvelle table dvf_avec_dpe
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const DB_PATH = path.join(__dirname, 'database', 'dpe_bdnb.db'); // ⭐ Base séparée
const BDNB_PATH = process.argv[2] || path.join(__dirname, 'data', 'bdnb_csv'); // Chemin CSV en argument
const DEPARTMENT_CODE = process.argv[3] || '40';

console.log('🚀 === ENRICHISSEMENT DVF AVEC DPE BDNB ===');
console.log(`📂 Base de données DPE : ${DB_PATH}`);
console.log(`📂 Données BDNB : ${BDNB_PATH}`);
console.log(`📍 Département : ${DEPARTMENT_CODE}\n`);

// Vérifier que le dossier CSV existe
if (!fs.existsSync(BDNB_PATH)) {
    console.error(`❌ Erreur : Le dossier ${BDNB_PATH} n'existe pas`);
    console.log(`\n💡 Usage: node enrich_dvf_with_dpe.js [chemin_csv] [code_departement]`);
    console.log(`   Exemple: node enrich_dvf_with_dpe.js /opt/parcelle-plus/data/bdnb_csv 40`);
    process.exit(1);
}

// Ouvrir la base de données
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Erreur ouverture base de données:', err);
        process.exit(1);
    }
    console.log('✅ Base de données ouverte');
});

// Fonction pour lire un fichier CSV ligne par ligne
async function readCSV(filePath) {
    const rows = [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let headers = null;
    let lineCount = 0;

    for await (const line of rl) {
        if (!headers) {
            headers = line.split(',').map(h => h.replace(/"/g, ''));
            continue;
        }

        const values = line.split(',');
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] ? values[index].replace(/"/g, '') : null;
        });
        rows.push(row);
        
        lineCount++;
        if (lineCount % 10000 === 0) {
            console.log(`   📊 ${lineCount} lignes lues...`);
        }
    }

    return { headers, rows };
}

// Fonction principale
async function enrichDVF() {
    try {
        // ÉTAPE 1 : Création de la base DPE
        console.log('\n📊 ÉTAPE 1 : Initialisation de la base DPE...');
        console.log(`✅ Base DPE séparée : dpe_bdnb.db`);

        // ÉTAPE 2 : Lire les données des bâtiments (coordonnées GPS)
        console.log('\n📂 ÉTAPE 2 : Lecture des bâtiments (coordonnées GPS)...');
        let batimentFilePath = path.join(BDNB_PATH, 'batiment_groupe.csv');
        if (!fs.existsSync(batimentFilePath)) {
            // Chercher dans un sous-dossier potentiel
            const subdirs = fs.readdirSync(BDNB_PATH).filter(f => fs.statSync(path.join(BDNB_PATH, f)).isDirectory());
            if (subdirs.length > 0) {
                batimentFilePath = path.join(BDNB_PATH, subdirs[0], 'batiment_groupe.csv');
            }
        }
        console.log(`   📄 Fichier: ${batimentFilePath}`);
        const bdnbBatiments = await readCSV(batimentFilePath);
        console.log(`✅ Bâtiments chargés : ${bdnbBatiments.rows.length}`);

        // ÉTAPE 3 : Lire les DPE des bâtiments
        console.log('\n📂 ÉTAPE 3 : Lecture des DPE des bâtiments...');
        let dpeFilePath = path.join(BDNB_PATH, 'batiment_groupe_dpe_representatif_logement.csv');
        if (!fs.existsSync(dpeFilePath)) {
            const subdirs = fs.readdirSync(BDNB_PATH).filter(f => fs.statSync(path.join(BDNB_PATH, f)).isDirectory());
            if (subdirs.length > 0) {
                dpeFilePath = path.join(BDNB_PATH, subdirs[0], 'batiment_groupe_dpe_representatif_logement.csv');
            }
        }
        console.log(`   📄 Fichier: ${dpeFilePath}`);
        const bdnbDPE = await readCSV(dpeFilePath);
        console.log(`✅ DPE disponibles : ${bdnbDPE.rows.length}`);

        // ÉTAPE 5 : Créer un index des DPE par batiment_groupe_id
        console.log('\n🔗 ÉTAPE 5 : Indexation des DPE par bâtiment...');
        const dpeByBatiment = new Map();
        bdnbDPE.rows.forEach(row => {
            dpeByBatiment.set(row.batiment_groupe_id, {
                classe_dpe: row.classe_bilan_dpe,
                classe_ges: row.classe_emission_ges,
                surface_habitable: parseFloat(row.surface_habitable_logement) || null,
                annee_construction: parseInt(row.annee_construction_dpe) || null,
                conso_energie: parseFloat(row.conso_5_usages_ep_m2) || null,
                emission_ges: parseFloat(row.emission_ges_5_usages_m2) || null,
                type_batiment: row.type_batiment_dpe
            });
        });
        console.log(`✅ ${dpeByBatiment.size} DPE indexés`);

        // ÉTAPE 6 : Créer un index des adresses par batiment_groupe_id
        console.log('\n🔗 ÉTAPE 6 : Indexation des adresses par bâtiment...');
        const adresseByBatiment = new Map();
        bdnbAdresses.rows.forEach(row => {
            adresseByBatiment.set(row.batiment_groupe_id, {
                adresse: row.libelle_adr_principale_ban,
                cle_interop: row.cle_interop_adr_principale_ban
            });
        });
        console.log(`✅ ${adresseByBatiment.size} adresses indexées`);

        // ÉTAPE 7 : Enrichir les transactions BDNB avec DPE
        console.log('\n🔗 ÉTAPE 7 : Enrichissement des transactions BDNB avec DPE...');
        const transactionsEnrichies = [];
        let nbAvecDPE = 0;
        
        bdnbDVF.rows.forEach((txn, index) => {
            const batimentId = txn.batiment_groupe_id;
            const dpe = dpeByBatiment.get(batimentId);
            const adresse = adresseByBatiment.get(batimentId);
            
            if (dpe) nbAvecDPE++;
            
            transactionsEnrichies.push({
                batiment_groupe_id: batimentId,
                id_opendata: txn.id_opendata,
                valeur_fonciere: parseFloat(txn.valeur_fonciere) || null,
                date_mutation: txn.date_mutation,
                surface_bati_maison: parseFloat(txn.surface_bati_mutee_residencielle_individuelle) || 0,
                surface_bati_appartement: parseFloat(txn.surface_bati_mutee_residencielle_collective) || 0,
                surface_terrain: parseFloat(txn.surface_terrain_mutee) || 0,
                nb_pieces: parseInt(txn.nb_piece_principale) || null,
                prix_m2_local: parseFloat(txn.prix_m2_local) || null,
                prix_m2_terrain: parseFloat(txn.prix_m2_terrain) || null,
                nb_maisons: parseInt(txn.nb_maison_mutee_mutation) || 0,
                nb_appartements: parseInt(txn.nb_appartement_mutee_mutation) || 0,
                // Données DPE
                classe_dpe: dpe?.classe_dpe || null,
                classe_ges: dpe?.classe_ges || null,
                surface_habitable_dpe: dpe?.surface_habitable || null,
                annee_construction: dpe?.annee_construction || null,
                conso_energie: dpe?.conso_energie || null,
                emission_ges: dpe?.emission_ges || null,
                type_batiment_dpe: dpe?.type_batiment || null,
                // Adresse
                adresse: adresse?.adresse || null,
                cle_interop_ban: adresse?.cle_interop || null
            });
            
            if ((index + 1) % 10000 === 0) {
                console.log(`   ✅ ${index + 1}/${bdnbDVF.rows.length} transactions enrichies (${nbAvecDPE} avec DPE)`);
            }
        });
        
        console.log(`✅ ${transactionsEnrichies.length} transactions enrichies au total`);
        console.log(`   📊 ${nbAvecDPE} transactions avec DPE (${((nbAvecDPE/transactionsEnrichies.length)*100).toFixed(1)}%)`);

        // ÉTAPE 8 : Créer la table dvf_avec_dpe
        console.log('\n📊 ÉTAPE 8 : Création de la table dvf_avec_dpe...');
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
                    source TEXT DEFAULT 'BDNB',
                    valeur_fonciere REAL,
                    date_mutation TEXT,
                    surface_bati_maison REAL,
                    surface_bati_appartement REAL,
                    surface_terrain REAL,
                    nb_pieces INTEGER,
                    prix_m2_local REAL,
                    prix_m2_terrain REAL,
                    nb_maisons INTEGER,
                    nb_appartements INTEGER,
                    classe_dpe TEXT,
                    classe_ges TEXT,
                    surface_habitable_dpe REAL,
                    annee_construction INTEGER,
                    conso_energie REAL,
                    emission_ges REAL,
                    type_batiment_dpe TEXT,
                    adresse TEXT,
                    cle_interop_ban TEXT,
                    latitude REAL,
                    longitude REAL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Table créée');

        // ÉTAPE 9 : Insérer les transactions enrichies
        console.log('\n💾 ÉTAPE 9 : Insertion des transactions enrichies...');
        const insertStmt = db.prepare(`
            INSERT INTO dvf_avec_dpe (
                batiment_groupe_id, id_opendata, valeur_fonciere, date_mutation,
                surface_bati_maison, surface_bati_appartement, surface_terrain,
                nb_pieces, prix_m2_local, prix_m2_terrain,
                nb_maisons, nb_appartements,
                classe_dpe, classe_ges, surface_habitable_dpe,
                annee_construction, conso_energie, emission_ges,
                type_batiment_dpe, adresse, cle_interop_ban
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        await new Promise((resolve, reject) => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        let inserted = 0;
        for (const txn of transactionsEnrichies) {
            await new Promise((resolve, reject) => {
                insertStmt.run([
                    txn.batiment_groupe_id, txn.id_opendata, txn.valeur_fonciere, txn.date_mutation,
                    txn.surface_bati_maison, txn.surface_bati_appartement, txn.surface_terrain,
                    txn.nb_pieces, txn.prix_m2_local, txn.prix_m2_terrain,
                    txn.nb_maisons, txn.nb_appartements,
                    txn.classe_dpe, txn.classe_ges, txn.surface_habitable_dpe,
                    txn.annee_construction, txn.conso_energie, txn.emission_ges,
                    txn.type_batiment_dpe, txn.adresse, txn.cle_interop_ban
                ], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            inserted++;
            if (inserted % 5000 === 0) {
                console.log(`   💾 ${inserted}/${transactionsEnrichies.length} transactions insérées...`);
            }
        }

        await new Promise((resolve, reject) => {
            db.run('COMMIT', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        insertStmt.finalize();
        console.log(`✅ ${inserted} transactions insérées`);

        // ÉTAPE 10 : Créer des index
        console.log('\n🔍 ÉTAPE 10 : Création des index...');
        await new Promise((resolve, reject) => {
            db.run(`CREATE INDEX idx_dvf_dpe_classe ON dvf_avec_dpe(classe_dpe)`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        await new Promise((resolve, reject) => {
            db.run(`CREATE INDEX idx_dvf_dpe_date ON dvf_avec_dpe(date_mutation)`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('✅ Index créés');

        // STATISTIQUES FINALES
        console.log('\n📊 === STATISTIQUES FINALES ===');
        
        const stats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) as avec_dpe,
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

        console.log(`✅ Total transactions : ${stats.total}`);
        console.log(`✅ Avec DPE : ${stats.avec_dpe} (${((stats.avec_dpe/stats.total)*100).toFixed(1)}%)`);
        console.log(`\n📊 Distribution DPE :`);
        console.log(`   🟢 Classe A : ${stats.dpe_a}`);
        console.log(`   🟢 Classe B : ${stats.dpe_b}`);
        console.log(`   🟡 Classe C : ${stats.dpe_c}`);
        console.log(`   🟡 Classe D : ${stats.dpe_d}`);
        console.log(`   🟠 Classe E : ${stats.dpe_e}`);
        console.log(`   🔴 Classe F : ${stats.dpe_f}`);
        console.log(`   🔴 Classe G : ${stats.dpe_g}`);

        console.log('\n✅ === ENRICHISSEMENT TERMINÉ ===');

    } catch (error) {
        console.error('❌ Erreur:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

// Lancer le script
enrichDVF().catch(err => {
    console.error('❌ Erreur fatale:', err);
    process.exit(1);
});

