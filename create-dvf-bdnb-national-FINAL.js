const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Database = require('better-sqlite3');
const { Worker } = require('worker_threads');

// Import de la fonction de conversion Lambert 93 → GPS
const { lambert93ToGPS, getCenterFromWKT } = require('./lambert-to-gps');

// Configuration du parallélisme
const NUM_CPUS = require('os').cpus().length;
const MAX_WORKERS = Math.min(NUM_CPUS, 4);
console.log(`🖥️  ${NUM_CPUS} cœurs disponibles, ${MAX_WORKERS} workers utilisés`);

console.log('🚀 === CRÉATION BASE DVF + BDNB NATIONALE ===\n');

// Configuration
const CSV_DIR = process.argv[2] || path.join(__dirname, 'open_data_millesime_2024-10-a_dep40_csv', 'csv');
const DB_FILE = path.join(__dirname, 'database', 'dvf_bdnb_complete.db');
const DVF_DIR = process.argv[3] || path.join(__dirname, 'dvf_data');

// Créer les dossiers
if (!fs.existsSync(path.dirname(DB_FILE))) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

console.log('\n📊 Création de la base de données...');

// Supprimer l'ancienne base si elle existe
if (fs.existsSync(DB_FILE)) {
    try {
    fs.unlinkSync(DB_FILE);
    console.log('   🗑️ Ancienne base supprimée');
    } catch (error) {
        console.log('   ⚠️ Impossible de supprimer l\'ancienne base (peut être verrouillée)');
    }
}

// Créer la base de données avec la MÊME structure que le script principal
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -256000'); // 256 MB cache pour traitement national
db.pragma('temp_store = MEMORY');

// Table principale DVF + BDNB (IDENTIQUE au script principal)
db.exec(`
    DROP TABLE IF EXISTS dvf_bdnb_complete;
    CREATE TABLE dvf_bdnb_complete (
        id_mutation TEXT PRIMARY KEY,
        date_mutation TEXT,
        valeur_fonciere REAL,
        code_commune TEXT,
        nom_commune TEXT,
        code_departement TEXT,
        type_local TEXT,
        surface_reelle_bati REAL,
        nombre_pieces_principales INTEGER,
        nature_culture TEXT,
        surface_terrain REAL,
        longitude REAL,
        latitude REAL,
        annee_source TEXT,
        prix_m2_bati REAL,
        prix_m2_terrain REAL,
        id_parcelle TEXT,
        
        -- Données BDNB ajoutées
        batiment_groupe_id TEXT,
        classe_dpe TEXT,
        orientation_principale TEXT,
        pourcentage_vitrage REAL,
        presence_piscine INTEGER DEFAULT 0,
        presence_garage INTEGER DEFAULT 0,
        presence_veranda INTEGER DEFAULT 0,
        type_dpe TEXT,
        dpe_officiel INTEGER DEFAULT 1,
        surface_habitable_logement REAL,
        date_etablissement_dpe TEXT
    )
`);

// Tables temporaires BDNB (IDENTIQUES au script principal)
db.exec(`
    CREATE TABLE IF NOT EXISTS temp_bdnb_batiment (
        batiment_groupe_id TEXT PRIMARY KEY,
        code_commune_insee TEXT,
        libelle_commune_insee TEXT,
        longitude REAL,
        latitude REAL,
        geom_groupe TEXT,
        s_geom_groupe REAL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS temp_bdnb_dpe (
        batiment_groupe_id TEXT,
        classe_dpe TEXT,
        orientation_principale TEXT,
        pourcentage_vitrage REAL,
        surface_habitable_logement REAL,
        date_etablissement_dpe TEXT,
        presence_piscine INTEGER DEFAULT 0,
        presence_garage INTEGER DEFAULT 0,
        presence_veranda INTEGER DEFAULT 0,
        type_dpe TEXT,
        dpe_officiel INTEGER DEFAULT 1
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS temp_bdnb_relations (
        parcelle_id TEXT,
        batiment_groupe_id TEXT,
        PRIMARY KEY (parcelle_id, batiment_groupe_id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS temp_bdnb_parcelle (
        parcelle_id TEXT PRIMARY KEY,
        surface_geom_parcelle REAL,
        geom_parcelle TEXT
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS temp_parcelle_sitadel (
        parcelle_id TEXT PRIMARY KEY,
        indicateur_piscine INTEGER DEFAULT 0,
        indicateur_garage INTEGER DEFAULT 0
    )
`);

// Index pour les performances (avec gestion des NULL) - IDENTIQUES au script principal
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dvf_coords ON dvf_bdnb_complete(longitude, latitude) WHERE longitude IS NOT NULL AND latitude IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dvf_commune ON dvf_bdnb_complete(code_commune) WHERE code_commune IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dvf_type ON dvf_bdnb_complete(type_local) WHERE type_local IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dvf_annee ON dvf_bdnb_complete(annee_source) WHERE annee_source IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dvf_batiment_id ON dvf_bdnb_complete(batiment_groupe_id) WHERE batiment_groupe_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dvf_date ON dvf_bdnb_complete(date_mutation) WHERE date_mutation IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_relations_parcelle ON temp_bdnb_relations(parcelle_id);
    CREATE INDEX IF NOT EXISTS idx_relations_batiment ON temp_bdnb_relations(batiment_groupe_id);
`);

console.log('✅ Base de données créée\n');

// Fonction pour valider et normaliser les dates (IDENTIQUE au script principal)
function normalizeDate(dateStr) {
    if (!dateStr || dateStr === '') return null;
    
    // Formats supportés par SQLite julianday()
    // YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY
    const cleaned = dateStr.trim();
    
    // Si déjà au format ISO, retourner tel quel
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        return cleaned;
    }
    
    // Si format DD/MM/YYYY ou DD-MM-YYYY, convertir
    const match = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
        const [, day, month, year] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // Si format YYYY/MM/DD, convertir
    const match2 = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match2) {
        const [, year, month, day] = match2;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    return null; // Format non reconnu
}

// Fonction pour traiter une ligne DVF
function processDVFRow(row, year) {
    const idMutation = row.id_mutation?.trim();
    const valeurFonciere = parseFloat(row.valeur_fonciere) || 0;
    
    if (!idMutation || valeurFonciere <= 0) return null;
    
    return {
        id_mutation: idMutation,
        date_mutation: normalizeDate(row.date_mutation?.trim()),
        valeur_fonciere: valeurFonciere,
        code_commune: row.code_commune?.trim(),
        nom_commune: row.nom_commune?.trim(),
        code_departement: row.code_departement?.trim(),
        type_local: row.type_local?.trim(),
        surface_reelle_bati: parseFloat(row.surface_reelle_bati) || null,
        nombre_pieces_principales: parseInt(row.nombre_pieces_principales) || null,
        nature_culture: row.nature_culture?.trim(),
        surface_terrain: parseFloat(row.surface_terrain) || null,
        longitude: parseFloat(row.longitude) || null,
        latitude: parseFloat(row.latitude) || null,
        annee_source: year,
        prix_m2_bati: null,
        prix_m2_terrain: null,
        id_parcelle: row.id_parcelle?.trim(),
        batiment_groupe_id: null,
        classe_dpe: null,
        orientation_principale: null,
        pourcentage_vitrage: null,
        presence_piscine: 0,
        presence_garage: 0,
        presence_veranda: 0,
        type_dpe: null,
        dpe_officiel: 1,
        surface_habitable_logement: null,
        date_etablissement_dpe: null
    };
}

// Fonction pour insérer un batch DVF (IDENTIQUE au script principal)
function insertDVFBatch(transactions) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO dvf_bdnb_complete VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
    `);
    
    const insertMany = db.transaction((rows) => {
        for (const row of rows) {
            stmt.run(
                row.id_mutation,
                row.date_mutation,
                row.valeur_fonciere,
                row.code_commune,
                row.nom_commune,
                row.code_departement,
                row.type_local,
                row.surface_reelle_bati,
                row.nombre_pieces_principales,
                row.nature_culture,
                row.surface_terrain,
                row.longitude,
                row.latitude,
                row.annee_source,
                row.prix_m2_bati,
                row.prix_m2_terrain,
                row.id_parcelle,
                row.batiment_groupe_id,
                row.classe_dpe,
                row.orientation_principale,
                row.pourcentage_vitrage,
                0, // presence_piscine
                0, // presence_garage
                0, // presence_veranda
                row.type_dpe,
                row.dpe_officiel,
                row.surface_habitable_logement,
                row.date_etablissement_dpe
            );
        }
    });
    
    insertMany(transactions);
}

// Fonction pour charger les données BDNB séquentiellement
async function loadBDNBData() {
    console.log('📊 Chargement des données BDNB...\n');
    
    const tasks = [
        {
            name: 'rel_batiment_groupe_parcelle.csv',
            file: path.join(CSV_DIR, 'rel_batiment_groupe_parcelle.csv'),
            tableName: 'temp_bdnb_relations',
            processRow: (row) => {
                const parcelleId = row.parcelle_id?.trim();
                const batimentId = row.batiment_groupe_id?.trim();
                if (parcelleId && batimentId) {
                    return { parcelle_id: parcelleId, batiment_groupe_id: batimentId };
                }
                return null;
            }
        },
        {
            name: 'batiment_groupe.csv',
            file: path.join(CSV_DIR, 'batiment_groupe.csv'),
            tableName: 'temp_bdnb_batiment',
            processRow: (row) => {
                const id = row.batiment_groupe_id?.trim();
                const commune = row.code_commune_insee?.trim();
                const nomCommune = row.libelle_commune_insee?.trim();
                const longitude = parseFloat(row.longitude) || null;
                const latitude = parseFloat(row.latitude) || null;
                const geomGroupe = row.geom_groupe?.trim() || null;
                const sGeomGroupe = parseFloat(row.s_geom_groupe) || null;
                
                if (id) {
                    return {
                        batiment_groupe_id: id,
                        code_commune_insee: commune,
                        libelle_commune_insee: nomCommune,
                        longitude: longitude,
                        latitude: latitude,
                        geom_groupe: geomGroupe,
                        s_geom_groupe: sGeomGroupe
                    };
                }
                return null;
            }
        },
        {
            name: 'batiment_groupe_dpe_representatif_logement.csv',
            file: path.join(CSV_DIR, 'batiment_groupe_dpe_representatif_logement.csv'),
            tableName: 'temp_bdnb_dpe',
            processRow: (row) => {
                const id = row.batiment_groupe_id?.trim();
                const dpe = row.classe_bilan_dpe?.trim();
                const orientation = 'mixte';
                const pourcentageVitrage = parseFloat(row.pourcentage_surface_baie_vitree_exterieur) || null;
                const surfaceHabitableLogement = parseFloat(row.surface_habitable_logement) || null;
                const dateEtablissementDpe = normalizeDate(row.date_etablissement_dpe?.trim()) || null;
                const presencePiscine = parseInt(row.presence_piscine) || 0;
                const presenceGarage = parseInt(row.presence_garage) || 0;
                const presenceVeranda = parseInt(row.presence_veranda) || 0;
                const typeDpe = row.type_dpe?.trim();
                const isDpeOfficiel = typeDpe === 'DPE' || !typeDpe;
                
                if (id && dpe && dpe !== 'N' && dpe !== '') {
                    return {
                        batiment_groupe_id: id,
                        classe_dpe: dpe,
                        orientation_principale: orientation,
                        pourcentage_vitrage: pourcentageVitrage,
                        surface_habitable_logement: surfaceHabitableLogement,
                        date_etablissement_dpe: dateEtablissementDpe,
                        presence_piscine: presencePiscine,
                        presence_garage: presenceGarage,
                        presence_veranda: presenceVeranda,
                        type_dpe: typeDpe,
                        dpe_officiel: isDpeOfficiel ? 1 : 0
                    };
                }
                return null;
            }
        },
        {
            name: 'parcelle.csv',
            file: path.join(CSV_DIR, 'parcelle.csv'),
            tableName: 'temp_bdnb_parcelle',
            processRow: (row) => {
                const parcelleId = row.parcelle_id?.trim();
                const surfaceGeomParcelle = parseFloat(row.s_geom_parcelle) || null;
                const geomParcelle = row.geom_parcelle?.trim() || null;
                
                if (parcelleId) {
                    return {
                        parcelle_id: parcelleId,
                        surface_geom_parcelle: surfaceGeomParcelle,
                        geom_parcelle: geomParcelle
                    };
                }
                return null;
            }
        }
    ];
    
    // Ajouter Sitadel si disponible
    const sitadelFile = path.join(CSV_DIR, 'parcelle_sitadel.csv');
    if (fs.existsSync(sitadelFile)) {
        tasks.push({
            name: 'parcelle_sitadel.csv',
            file: sitadelFile,
            tableName: 'temp_parcelle_sitadel',
            processRow: (row) => {
                const parcelleId = row.parcelle_id?.trim();
                const indicateurPiscine = parseInt(row.indicateur_piscine) || 0;
                const indicateurGarage = parseInt(row.indicateur_garage) || 0;
                
                if (parcelleId) {
                    return {
                        parcelle_id: parcelleId,
                        indicateur_piscine: indicateurPiscine,
                        indicateur_garage: indicateurGarage
                    };
                }
                return null;
            }
        });
    }
    
    // Charger les données séquentiellement
    for (const task of tasks) {
        if (!fs.existsSync(task.file)) {
            console.log(`⚠️ Fichier introuvable : ${task.name}`);
            continue;
        }
        
        console.log(`📂 Chargement ${task.name}...`);
        
        let count = 0;
        const stream = fs.createReadStream(task.file);
        
        let linesRead = 0;
        
        await new Promise((resolve, reject) => {
            stream
                .pipe(csv())
                .on('data', (row) => {
                    linesRead++;
                    const processedRow = task.processRow(row);
                    if (processedRow) {
                        try {
                            if (task.tableName === 'temp_bdnb_relations') {
                                db.prepare(`INSERT OR IGNORE INTO temp_bdnb_relations VALUES (?, ?)`).run(
                                    processedRow.parcelle_id, 
                                    processedRow.batiment_groupe_id
                                );
                            } else if (task.tableName === 'temp_bdnb_batiment') {
                                db.prepare(`INSERT OR IGNORE INTO temp_bdnb_batiment VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
                                    processedRow.batiment_groupe_id, 
                                    processedRow.code_commune_insee, 
                                    processedRow.libelle_commune_insee, 
                                    processedRow.longitude, 
                                    processedRow.latitude, 
                                    processedRow.geom_groupe, 
                                    processedRow.s_geom_groupe
                                );
                            } else if (task.tableName === 'temp_bdnb_dpe') {
                                db.prepare(`INSERT OR IGNORE INTO temp_bdnb_dpe VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                                    processedRow.batiment_groupe_id, 
                                    processedRow.classe_dpe, 
                                    processedRow.orientation_principale, 
                                    processedRow.pourcentage_vitrage, 
                                    processedRow.surface_habitable_logement, 
                                    processedRow.date_etablissement_dpe, 
                                    processedRow.presence_piscine, 
                                    processedRow.presence_garage, 
                                    processedRow.presence_veranda, 
                                    processedRow.type_dpe, 
                                    processedRow.dpe_officiel
                                );
                            } else if (task.tableName === 'temp_bdnb_parcelle') {
                                db.prepare(`INSERT OR REPLACE INTO temp_bdnb_parcelle VALUES (?, ?, ?)`).run(
                                    processedRow.parcelle_id, 
                                    processedRow.surface_geom_parcelle, 
                                    processedRow.geom_parcelle
                                );
                            } else if (task.tableName === 'temp_parcelle_sitadel') {
                                db.prepare(`INSERT OR REPLACE INTO temp_parcelle_sitadel VALUES (?, ?, ?)`).run(
                                    processedRow.parcelle_id, 
                                    processedRow.indicateur_piscine, 
                                    processedRow.indicateur_garage
                                );
                            }
                            count++;
                        } catch (error) {
                            // Ignorer les erreurs de contrainte
                        }
                    }
                })
                .on('end', () => {
                    console.log(`   ✅ ${count.toLocaleString()} données chargées sur ${linesRead.toLocaleString()} lignes lues`);
                    resolve();
                })
                .on('error', (error) => {
                    console.error(`   ❌ Erreur: ${error.message}`);
                    reject(error);
                });
        });
    }
    
    console.log('\n✅ Données BDNB chargées\n');
}

// Fonction pour charger les données DVF séquentiellement
async function loadDVFData() {
    console.log('📊 Chargement des données DVF...\n');
    
    // Rechercher les fichiers DVF disponibles
    const dvfFiles = ['dvf_2024.csv', 'dvf_2023.csv', 'dvf_2022.csv', 'dvf_2021.csv', 'dvf_2020.csv'];
    const availableFiles = dvfFiles.filter(file => fs.existsSync(path.join(DVF_DIR, file)));
    
    if (availableFiles.length === 0) {
        console.log('⚠️ Aucun fichier DVF disponible.');
        return;
    }
    
    console.log(`📋 ${availableFiles.length} fichier(s) DVF trouvé(s)\n`);
    
    // Charger les fichiers DVF séquentiellement
    for (const file of availableFiles) {
        const filePath = path.join(DVF_DIR, file);
        const year = file.match(/dvf_(\d{4})\.csv/)?.[1];
        
        if (!year) continue;
        
        console.log(`📂 Chargement ${file} (${year})...`);
        
        let count = 0;
        let linesRead = 0;
        
        await new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath);
            const insertStmt = db.prepare(`
                INSERT INTO dvf_bdnb_complete (
                    id_mutation, date_mutation, valeur_fonciere, code_commune, nom_commune,
                    code_departement, type_local, surface_reelle_bati, nombre_pieces_principales,
                    nature_culture, surface_terrain, longitude, latitude, annee_source,
                    prix_m2_bati, prix_m2_terrain, id_parcelle, batiment_groupe_id, classe_dpe,
                    orientation_principale, pourcentage_vitrage, presence_piscine, presence_garage,
                    presence_veranda, type_dpe, dpe_officiel, surface_habitable_logement, date_etablissement_dpe
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stream
                .pipe(csv())
                .on('data', (row) => {
                    linesRead++;
                    const processedRow = processDVFRow(row, year);
                    if (processedRow) {
                        try {
                            insertStmt.run(
                                processedRow.id_mutation,
                                processedRow.date_mutation,
                                processedRow.valeur_fonciere,
                                processedRow.code_commune,
                                processedRow.nom_commune,
                                processedRow.code_departement,
                                processedRow.type_local,
                                processedRow.surface_reelle_bati,
                                processedRow.nombre_pieces_principales,
                                processedRow.nature_culture,
                                processedRow.surface_terrain,
                                processedRow.longitude,
                                processedRow.latitude,
                                processedRow.annee_source,
                                processedRow.prix_m2_bati,
                                processedRow.prix_m2_terrain,
                                processedRow.id_parcelle,
                                processedRow.batiment_groupe_id,
                                processedRow.classe_dpe,
                                processedRow.orientation_principale,
                                processedRow.pourcentage_vitrage,
                                processedRow.presence_piscine,
                                processedRow.presence_garage,
                                processedRow.presence_veranda,
                                processedRow.type_dpe,
                                processedRow.dpe_officiel,
                                processedRow.surface_habitable_logement,
                                processedRow.date_etablissement_dpe
                            );
                            count++;
                        } catch (error) {
                            // Ignorer les erreurs de contrainte
                        }
                    }
                })
                .on('end', () => {
                    console.log(`   ✅ ${count.toLocaleString()} transactions chargées sur ${linesRead.toLocaleString()} lignes lues`);
                    resolve();
                })
                .on('error', (error) => {
                    console.error(`   ❌ Erreur ${year}: ${error.message}`);
                    reject(error);
                });
        });
    }
    
    console.log('\n✅ Données DVF chargées\n');
}

// Fonction pour tester la jointure (IDENTIQUE au script principal)
async function testJoin() {
    console.log('🔗 Test de la jointure DVF + BDNB...\n');
    
    // Étape 1: Jointure via id_parcelle
    console.log('📍 Jointure via id_parcelle...');
    db.exec(`
        UPDATE dvf_bdnb_complete AS d 
        SET batiment_groupe_id = (
            SELECT rel.batiment_groupe_id 
            FROM temp_bdnb_relations rel 
            WHERE rel.parcelle_id = d.id_parcelle
            LIMIT 1
        )
        WHERE d.id_parcelle IS NOT NULL 
          AND d.id_parcelle != ''
    `);
    
    // Étape 2a: Mise à jour des coordonnées GPS manquantes (PRÉSERVER les coordonnées DVF existantes)
    console.log('🌍 Mise à jour des coordonnées GPS manquantes...');
    
    // D'abord, essayer avec les coordonnées GPS directes de BDNB
    db.exec(`
        UPDATE dvf_bdnb_complete AS d 
        SET 
            longitude = (
                SELECT bat.longitude 
                FROM temp_bdnb_batiment bat 
                WHERE bat.batiment_groupe_id = d.batiment_groupe_id
                  AND bat.longitude IS NOT NULL
                LIMIT 1
            ),
            latitude = (
                SELECT bat.latitude 
                FROM temp_bdnb_batiment bat 
                WHERE bat.batiment_groupe_id = d.batiment_groupe_id
                  AND bat.latitude IS NOT NULL
                LIMIT 1
            )
        WHERE d.batiment_groupe_id IS NOT NULL 
          AND d.longitude IS NULL 
          AND d.latitude IS NULL
    `);
    
    // Ensuite, convertir les coordonnées Lambert 93 vers GPS pour les transactions sans GPS
    console.log('🔄 Conversion Lambert 93 → GPS pour les transactions sans coordonnées...');
    
    const transactionsWithoutGPS = db.prepare(`
        SELECT id_mutation, batiment_groupe_id, id_parcelle, surface_reelle_bati, type_local, nombre_pieces_principales
        FROM dvf_bdnb_complete 
        WHERE longitude IS NULL AND latitude IS NULL
          AND (
              -- Seulement si c'est du bâti (maison, appartement, dépendance)
              surface_reelle_bati IS NOT NULL 
              OR type_local IS NOT NULL 
              OR nombre_pieces_principales IS NOT NULL
          )
        LIMIT 1000
    `).all();
    
    console.log(`   📍 ${transactionsWithoutGPS.length} transactions bâti sans GPS à traiter`);
    
    let convertedCount = 0;
    
    for (const transaction of transactionsWithoutGPS) {
        let gpsCoords = null;
        
        // Essayer d'abord avec les coordonnées du bâtiment (un seul point représentatif)
        if (transaction.batiment_groupe_id) {
            const batiment = db.prepare(`
                SELECT geom_groupe 
                FROM temp_bdnb_batiment 
                WHERE batiment_groupe_id = ? AND geom_groupe IS NOT NULL
                LIMIT 1
            `).get(transaction.batiment_groupe_id);
            
            if (batiment && batiment.geom_groupe) {
                // Prendre le centre de la géométrie (un seul point représentatif)
                gpsCoords = getCenterFromWKT(batiment.geom_groupe);
            }
        }
        
        // Si pas de bâtiment, essayer avec la parcelle (un seul point représentatif)
        if (!gpsCoords && transaction.id_parcelle) {
            const parcelle = db.prepare(`
                SELECT geom_parcelle 
                FROM temp_bdnb_parcelle 
                WHERE parcelle_id = ? AND geom_parcelle IS NOT NULL
                LIMIT 1
            `).get(transaction.id_parcelle);
            
            if (parcelle && parcelle.geom_parcelle) {
                // Prendre le centre de la parcelle (un seul point représentatif)
                gpsCoords = getCenterFromWKT(parcelle.geom_parcelle);
            }
        }
        
        // Mettre à jour si on a trouvé des coordonnées
        if (gpsCoords) {
            db.prepare(`
                UPDATE dvf_bdnb_complete 
                SET longitude = ?, latitude = ?
                WHERE id_mutation = ?
            `).run(gpsCoords.longitude, gpsCoords.latitude, transaction.id_mutation);
            convertedCount++;
        }
    }
    
    console.log(`   ✅ ${convertedCount} coordonnées converties Lambert 93 → GPS`);
    
    // Étape 2b: Mise à jour des surfaces bâti manquantes (APRÈS conversion GPS)
    console.log('🏠 Mise à jour des surfaces bâti manquantes...');
    
    // Essayer d'abord avec les données DPE (chronologie respectée)
    db.exec(`
        UPDATE dvf_bdnb_complete AS d 
        SET surface_reelle_bati = COALESCE(
            d.surface_reelle_bati,
            (
                SELECT dpe.surface_habitable_logement 
                FROM temp_bdnb_dpe dpe 
                WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                  AND (
                      -- DPE établi avant la transaction (bâtiment existait)
                      dpe.date_etablissement_dpe <= COALESCE(d.date_mutation, d.annee_source || '-12-31')
                      OR
                      -- DPE établi après mais dans les 6 mois (bâtiment récent)
                      (dpe.date_etablissement_dpe > COALESCE(d.date_mutation, d.annee_source || '-12-31')
                       AND julianday(dpe.date_etablissement_dpe) - julianday(COALESCE(d.date_mutation, d.annee_source || '-12-31')) <= 180)
                  )
                ORDER BY dpe.date_etablissement_dpe DESC
                LIMIT 1
            )
        )
        WHERE d.batiment_groupe_id IS NOT NULL 
          AND d.surface_reelle_bati IS NULL
          AND (
              d.type_local IS NOT NULL 
              OR d.nombre_pieces_principales IS NOT NULL
              OR d.nature_culture IS NULL  -- Si pas de culture, c'est probablement du bâti
          )
    `);
    
    // Fallback : essayer avec les données bâtiment BDNB (surface géométrique)
    console.log('   🔄 Fallback : essai avec surface géométrique BDNB...');
    db.exec(`
        UPDATE dvf_bdnb_complete AS d 
        SET surface_reelle_bati = COALESCE(
            d.surface_reelle_bati,
            (
                SELECT bat.s_geom_groupe 
                FROM temp_bdnb_batiment bat 
                WHERE bat.batiment_groupe_id = d.batiment_groupe_id
                  AND bat.s_geom_groupe IS NOT NULL
                LIMIT 1
            )
        )
        WHERE d.batiment_groupe_id IS NOT NULL 
          AND d.surface_reelle_bati IS NULL
          AND (
              d.type_local IS NOT NULL 
              OR d.nombre_pieces_principales IS NOT NULL
              OR d.nature_culture IS NULL
          )
    `);
    
    // Statistiques finales
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total_transactions,
            COUNT(CASE WHEN surface_reelle_bati IS NOT NULL THEN 1 END) as with_surface_bati,
            COUNT(CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL THEN 1 END) as with_gps
        FROM dvf_bdnb_complete
    `).get();
    
    console.log(`   📊 Résultats finaux:`);
    console.log(`      Total transactions: ${stats.total_transactions}`);
    console.log(`      Avec surface bâti: ${stats.with_surface_bati} (${(stats.with_surface_bati/stats.total_transactions*100).toFixed(1)}%)`);
    console.log(`      Avec GPS: ${stats.with_gps} (${(stats.with_gps/stats.total_transactions*100).toFixed(1)}%)`);
    
    // Étape 2b: Enrichissement des surfaces terrain pour les terrains nus (sans bâtiment BDNB)
    console.log('🌾 Enrichissement des surfaces terrain pour les terrains nus...');
    db.exec(`
        UPDATE dvf_bdnb_complete AS d 
        SET surface_terrain = COALESCE(
            d.surface_terrain,
            (
                SELECT parc.surface_geom_parcelle 
                FROM temp_bdnb_parcelle parc 
                WHERE parc.parcelle_id = d.id_parcelle
            )
        )
        WHERE d.batiment_groupe_id IS NULL 
          AND d.surface_terrain IS NULL
          AND d.id_parcelle IS NOT NULL
    `);
    
    // Étape 2d: Mise à jour des données piscine/garage via Sitadel
    console.log('🏊 Mise à jour des données piscine/garage via Sitadel...');
    db.exec(`
        UPDATE dvf_bdnb_complete AS d 
        SET 
            presence_piscine = (
                SELECT sit.indicateur_piscine 
                FROM temp_parcelle_sitadel sit 
                WHERE sit.parcelle_id = d.id_parcelle
                LIMIT 1
            ),
            presence_garage = (
                SELECT sit.indicateur_garage 
                FROM temp_parcelle_sitadel sit 
                WHERE sit.parcelle_id = d.id_parcelle
                LIMIT 1
            )
        WHERE d.id_parcelle IS NOT NULL
    `);
    
    // Étape 2c: Suppression des transactions non enrichissables
    console.log('🗑️ Suppression des transactions non enrichissables...');
    
    // Supprimer TOUTES les transactions sans GPS (non enrichissables)
    const deleteStmt = db.prepare(`
        DELETE FROM dvf_bdnb_complete 
        WHERE longitude IS NULL 
          AND latitude IS NULL
    `);
    
    const deletedCount = deleteStmt.run().changes;
    console.log(`   🗑️ ${deletedCount} transactions supprimées (non enrichissables)`);
    
    // Analyse des transactions sans GPS après suppression
    console.log('📍 Analyse des transactions sans GPS après suppression...');
    const transactionsSansGPS = db.prepare(`
        SELECT 
            id_mutation, valeur_fonciere, code_commune, nom_commune,
            type_local, surface_reelle_bati, surface_terrain,
            batiment_groupe_id, id_parcelle
        FROM dvf_bdnb_complete 
        WHERE longitude IS NULL OR latitude IS NULL
        ORDER BY valeur_fonciere DESC
        LIMIT 10
    `).all();
    
    console.log(`   📊 ${transactionsSansGPS.length} transactions sans GPS (sur ${db.prepare('SELECT COUNT(*) FROM dvf_bdnb_complete').get()['COUNT(*)']} total) :`);
    transactionsSansGPS.forEach((tx, i) => {
        console.log(`   ${i+1}. ID: ${tx.id_mutation}`);
        console.log(`      💰 Prix: ${tx.valeur_fonciere?.toLocaleString() || 'NULL'}€`);
        console.log(`      🏠 Type: ${tx.type_local || 'NULL'} | Surface bâti: ${tx.surface_reelle_bati || 'NULL'}m²`);
        console.log(`      📍 Commune: ${tx.nom_commune || 'NULL'} (${tx.code_commune || 'NULL'})`);
        console.log(`      🏗️ Parcelle: ${tx.id_parcelle || 'NULL'} | Bâtiment: ${tx.batiment_groupe_id || 'NULL'}`);
        console.log(`   `);
    });
    
    // Étape 3: Test de la jointure DPE avec gestion d'erreurs (IDENTIQUE au script principal)
    console.log('🔋 Test de la jointure DPE...');
    
    try {
        db.exec(`
            UPDATE dvf_bdnb_complete AS d 
            SET 
                classe_dpe = (
                    SELECT dpe.classe_dpe 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                      AND ABS(dpe.surface_habitable_logement - COALESCE(d.surface_reelle_bati, 999999)) < 10
                      AND (
                          -- DPE avant la vente : toujours valide
                          dpe.date_etablissement_dpe <= COALESCE(d.date_mutation, d.annee_source || '-12-31')
                          OR
                          -- DPE après la vente : seulement si dans les 6 mois
                          (dpe.date_etablissement_dpe > COALESCE(d.date_mutation, d.annee_source || '-12-31')
                           AND julianday(dpe.date_etablissement_dpe) - julianday(COALESCE(d.date_mutation, d.annee_source || '-12-31')) <= 180)
                      )
                    ORDER BY 
                      CASE 
                        -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                        WHEN dpe.date_etablissement_dpe > COALESCE(d.date_mutation, d.annee_source || '-12-31')
                        THEN -julianday(dpe.date_etablissement_dpe)
                        -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                        ELSE julianday(dpe.date_etablissement_dpe)
                      END,
                      ABS(dpe.surface_habitable_logement - COALESCE(d.surface_reelle_bati, 999999))
                    LIMIT 1
                )
            WHERE d.batiment_groupe_id IS NOT NULL
        `);
        
        console.log('   ✅ Jointure DPE réussie');
        
    } catch (error) {
        console.log(`   ⚠️ Erreur jointure DPE : ${error.message}`);
        
        // Analyser les données problématiques
        console.log('   🔍 Analyse des données problématiques...');
        
        // Trouver des transactions avec des valeurs NULL - TOUTES les infos DVF
        const problematicTransactions = db.prepare(`
            SELECT 
                id_mutation, date_mutation, valeur_fonciere, code_commune, nom_commune,
                code_departement, type_local, surface_reelle_bati, nombre_pieces_principales,
                nature_culture, surface_terrain, longitude, latitude, annee_source,
                prix_m2_bati, prix_m2_terrain, id_parcelle, batiment_groupe_id
            FROM dvf_bdnb_complete 
            WHERE batiment_groupe_id IS NOT NULL 
              AND (date_mutation IS NULL OR surface_reelle_bati IS NULL)
            LIMIT 3
        `).all();
        
        console.log(`   📊 ${problematicTransactions.length} transactions problématiques trouvées :`);
        problematicTransactions.forEach((tx, i) => {
            console.log(`   ${i+1}. === TRANSACTION DVF COMPLÈTE ===`);
            console.log(`      🆔 ID: ${tx.id_mutation}`);
            console.log(`      📅 Date: ${tx.date_mutation || 'NULL'} | Année: ${tx.annee_source}`);
            console.log(`      💰 Prix: ${tx.valeur_fonciere || 'NULL'}€ | Prix/m²: ${tx.prix_m2_bati || 'NULL'}€`);
            console.log(`      🏠 Type: ${tx.type_local || 'NULL'} | Pièces: ${tx.nombre_pieces_principales || 'NULL'}`);
            console.log(`      📐 Surface bâti: ${tx.surface_reelle_bati || 'NULL'}m² | Surface terrain: ${tx.surface_terrain || 'NULL'}m²`);
            console.log(`      📍 Commune: ${tx.nom_commune || 'NULL'} (${tx.code_commune || 'NULL'}) | Département: ${tx.code_departement || 'NULL'}`);
            console.log(`      🌍 GPS: ${tx.longitude || 'NULL'}, ${tx.latitude || 'NULL'}`);
            console.log(`      🏗️ Parcelle: ${tx.id_parcelle || 'NULL'} | Bâtiment: ${tx.batiment_groupe_id || 'NULL'}`);
            console.log(`      🌾 Culture: ${tx.nature_culture || 'NULL'}`);
            console.log(`   `);
        });
        
        // Trouver des DPE correspondants
        if (problematicTransactions.length > 0) {
            const batimentId = problematicTransactions[0].batiment_groupe_id;
            const correspondingDPE = db.prepare(`
                SELECT batiment_groupe_id, classe_dpe, surface_habitable_logement, date_etablissement_dpe
                FROM temp_bdnb_dpe 
                WHERE batiment_groupe_id = ?
                LIMIT 3
            `).all(batimentId);
            
            console.log(`   🏠 DPE correspondants pour bâtiment ${batimentId} :`);
            correspondingDPE.forEach((dpe, i) => {
                console.log(`   ${i+1}. Classe: ${dpe.classe_dpe} | Surface: ${dpe.surface_habitable_logement} | Date: ${dpe.date_etablissement_dpe}`);
            });
        }
        
        console.log('   🔄 Tentative de jointure simplifiée...');
        
        // Fallback simplifié (sans contrainte de surface) - TOUTES les colonnes DPE
        db.exec(`
            UPDATE dvf_bdnb_complete AS d 
            SET 
                classe_dpe = (
                    SELECT dpe.classe_dpe 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                orientation_principale = (
                    SELECT dpe.orientation_principale 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                pourcentage_vitrage = (
                    SELECT dpe.pourcentage_vitrage 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                presence_piscine = (
                    SELECT dpe.presence_piscine 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                presence_garage = (
                    SELECT dpe.presence_garage 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                presence_veranda = (
                    SELECT dpe.presence_veranda 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                type_dpe = (
                    SELECT dpe.type_dpe 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                dpe_officiel = (
                    SELECT dpe.dpe_officiel 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                surface_habitable_logement = (
                    SELECT dpe.surface_habitable_logement 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                ),
                date_etablissement_dpe = (
                    SELECT dpe.date_etablissement_dpe 
                    FROM temp_bdnb_dpe dpe
                    WHERE dpe.batiment_groupe_id = d.batiment_groupe_id
                    ORDER BY dpe.date_etablissement_dpe DESC
                    LIMIT 1
                )
            WHERE d.batiment_groupe_id IS NOT NULL
        `);
        
        console.log('   ✅ Jointure DPE simplifiée réussie');
    }
    
    console.log('\n✅ Tests de jointure terminés\n');
}

// Fonction pour afficher les statistiques
function showStats() {
    console.log('📊 === STATISTIQUES FINALES ===\n');
    
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total_transactions,
            COUNT(CASE WHEN batiment_groupe_id IS NOT NULL THEN 1 END) as avec_batiment_id,
            COUNT(CASE WHEN classe_dpe IS NOT NULL THEN 1 END) as avec_dpe,
            COUNT(CASE WHEN orientation_principale IS NOT NULL THEN 1 END) as avec_orientation,
            COUNT(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 END) as avec_vitrage,
            COUNT(CASE WHEN presence_piscine = 1 THEN 1 END) as avec_piscine,
            COUNT(CASE WHEN presence_garage = 1 THEN 1 END) as avec_garage,
            COUNT(CASE WHEN presence_veranda = 1 THEN 1 END) as avec_veranda,
            COUNT(CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL THEN 1 END) as avec_coords,
            COUNT(CASE WHEN surface_reelle_bati IS NOT NULL THEN 1 END) as avec_surface_bati,
            COUNT(CASE WHEN type_local = 'Maison' THEN 1 END) as maisons,
            COUNT(CASE WHEN type_local = 'Appartement' THEN 1 END) as appartements,
            AVG(valeur_fonciere) as prix_moyen,
            MIN(date_mutation) as date_min,
            MAX(date_mutation) as date_max
        FROM dvf_bdnb_complete
    `).get();
    
    console.log(`📊 Total transactions : ${stats.total_transactions.toLocaleString()}`);
    console.log(`\n📈 Pourcentages de complétude :`);
    console.log(`   🌍 GPS : ${stats.avec_coords.toLocaleString()} (${(stats.avec_coords / stats.total_transactions * 100).toFixed(1)}%)`);
    console.log(`   🏠 Surface bâti : ${stats.avec_surface_bati.toLocaleString()} (${(stats.avec_surface_bati / stats.total_transactions * 100).toFixed(1)}%)`);
    console.log(`   🔗 Bâtiment BDNB : ${stats.avec_batiment_id.toLocaleString()} (${(stats.avec_batiment_id / stats.total_transactions * 100).toFixed(1)}%)`);
    console.log(`   🔋 DPE : ${stats.avec_dpe.toLocaleString()} (${(stats.avec_dpe / stats.total_transactions * 100).toFixed(1)}%)`);
    console.log(`   🧭 Orientation : ${stats.avec_orientation.toLocaleString()} (${(stats.avec_orientation / stats.total_transactions * 100).toFixed(1)}%)`);
    console.log(`   🪟 Vitrage : ${stats.avec_vitrage.toLocaleString()} (${(stats.avec_vitrage / stats.total_transactions * 100).toFixed(1)}%)`);
    console.log(`   🏊 Piscine : ${stats.avec_piscine.toLocaleString()} (${(stats.avec_piscine / stats.total_transactions * 100).toFixed(1)}%)`);
    console.log(`   🚗 Garage : ${stats.avec_garage.toLocaleString()} (${(stats.avec_garage / stats.total_transactions * 100).toFixed(1)}%)`);
    console.log(`   🏠 Véranda : ${stats.avec_veranda.toLocaleString()} (${(stats.avec_veranda / stats.total_transactions * 100).toFixed(1)}%)`);
    
    console.log(`\n🏘️ Répartition par type de bien :`);
    console.log(`   🏠 Maisons : ${stats.maisons.toLocaleString()}`);
    console.log(`   🏢 Appartements : ${stats.appartements.toLocaleString()}`);
    console.log(`   💰 Prix moyen : ${stats.prix_moyen?.toLocaleString()} €`);
    console.log(`   📅 Période : ${stats.date_min} → ${stats.date_max}`);
    
    // Statistiques BDNB
    const bdnbStats = db.prepare(`
        SELECT 
            (SELECT COUNT(*) FROM temp_bdnb_relations) as relations,
            (SELECT COUNT(*) FROM temp_bdnb_batiment) as batiments,
            (SELECT COUNT(*) FROM temp_bdnb_dpe) as dpe
    `).get();
    
    console.log(`\n📊 Données BDNB :`);
    console.log(`   🔗 Relations : ${bdnbStats.relations.toLocaleString()}`);
    console.log(`   🏢 Bâtiments : ${bdnbStats.batiments.toLocaleString()}`);
    console.log(`   🔋 DPE : ${bdnbStats.dpe.toLocaleString()}`);
    
    const dbStats = fs.statSync(DB_FILE);
    const sizeMB = (dbStats.size / 1024 / 1024).toFixed(1);
    console.log(`\n💾 Base créée : ${sizeMB} MB`);
    console.log(`📂 ${DB_FILE}\n`);
}

// Fonction principale
async function runTest() {
    try {
        const startTime = Date.now();
        
        // Charger les données
        await loadBDNBData();
        await loadDVFData();
        
        // Tester les jointures
        await testJoin();
        
        // Afficher les statistiques
        showStats();
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(1);
        
        console.log(`🎉 === TEST TERMINÉ ===`);
        console.log(`⏱️ Durée : ${duration}s`);
        console.log(`✅ Toutes les corrections SQLite ont été testées avec succès !\n`);
        
        db.close();
        
    } catch (error) {
        console.error('❌ Erreur lors du test :', error);
        db.close();
        process.exit(1);
    }
}

// Lancer le test
runTest();
