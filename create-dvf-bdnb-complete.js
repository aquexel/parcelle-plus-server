const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const csv = require('csv-parser');
const Database = require('better-sqlite3');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

console.log('🚀 === CRÉATION BASE DVF + BDNB COMPLÈTE (JOINTURES PAR ID) ===\n');

// Configuration
const YEARS = ['2025', '2024', '2023', '2022', '2021', '2020'];
const DEPARTMENTS = [
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
    '11', '12', '13', '14', '15', '16', '17', '18', '19', '2A', '2B',
    '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
    '31', '32', '33', '34', '35', '36', '37', '38', '39', '40',
    '41', '42', '43', '44', '45', '46', '47', '48', '49', '50',
    '51', '52', '53', '54', '55', '56', '57', '58', '59', '60',
    '61', '62', '63', '64', '65', '66', '67', '68', '69', '70',
    '71', '72', '73', '74', '75', '76', '77', '78', '79', '80',
    '81', '82', '83', '84', '85', '86', '87', '88', '89', '90',
    '91', '92', '93', '94', '95'
];

const DB_FILE = path.join(__dirname, 'database', 'dvf_bdnb_complete.db');
const DOWNLOAD_DIR = path.join(__dirname, 'dvf_downloads');
const DVF_DIR = process.argv[3] || path.join(__dirname, 'dvf_data');
const BDNB_DIR = process.argv[2] || path.join(__dirname, 'open_data_millesime_2024-10-a_dep40_csv', 'csv');

// Créer les dossiers
if (!fs.existsSync(path.dirname(DB_FILE))) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(DVF_DIR)) {
    fs.mkdirSync(DVF_DIR, { recursive: true });
}

// Créer la base de données
console.log('📊 Création de la base de données...');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -256000'); // 256 MB cache
db.pragma('temp_store = MEMORY');

// Table principale DVF + BDNB
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

// Tables temporaires BDNB
db.exec(`
    CREATE TABLE IF NOT EXISTS temp_bdnb_batiment (
        batiment_groupe_id TEXT PRIMARY KEY,
        code_commune_insee TEXT,
        libelle_commune_insee TEXT,
        longitude REAL,
        latitude REAL
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
            dpe_officiel INTEGER DEFAULT 1,
            PRIMARY KEY (batiment_groupe_id)
        )
    `);

db.exec(`
    CREATE TABLE IF NOT EXISTS temp_bdnb_relations (
        parcelle_id TEXT,
        batiment_groupe_id TEXT,
        PRIMARY KEY (parcelle_id, batiment_groupe_id)
    )
`);

// Index pour les performances
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dvf_coords ON dvf_bdnb_complete(longitude, latitude);
    CREATE INDEX IF NOT EXISTS idx_dvf_commune ON dvf_bdnb_complete(code_commune);
    CREATE INDEX IF NOT EXISTS idx_dvf_type ON dvf_bdnb_complete(type_local);
    CREATE INDEX IF NOT EXISTS idx_dvf_annee ON dvf_bdnb_complete(annee_source);
    CREATE INDEX IF NOT EXISTS idx_dvf_batiment_id ON dvf_bdnb_complete(batiment_groupe_id);
    CREATE INDEX IF NOT EXISTS idx_relations_parcelle ON temp_bdnb_relations(parcelle_id);
    CREATE INDEX IF NOT EXISTS idx_relations_batiment ON temp_bdnb_relations(batiment_groupe_id);
`);

console.log('✅ Base de données créée\n');

// Fonction pour télécharger un fichier DVF
function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);
        
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }
            
            const gunzip = zlib.createGunzip();
            response.pipe(gunzip).pipe(file);
            
            file.on('finish', () => {
                file.close();
                resolve();
            });
            
            file.on('error', reject);
            gunzip.on('error', reject);
            
        }).on('error', reject);
    });
}

// Fonction pour décompresser un fichier GZIP
async function decompressGzipFile(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const input = fs.createReadStream(inputPath);
        const output = fs.createWriteStream(outputPath);
        
        input.pipe(zlib.createGunzip())
            .pipe(output)
            .on('finish', () => {
                console.log(`   📦 Fichier décompressé : ${path.basename(outputPath)}`);
                resolve();
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

// Fonction pour traiter un fichier CSV DVF (avec décompression automatique)
async function processDVFFile(filePath, year, department) {
    return new Promise(async (resolve, reject) => {
        try {
            // Les fichiers DVF sont déjà décompressés par le script shell
            // Pas besoin de décompression ici
            
            const transactions = [];
            let lineCount = 0;
            let rejectedCount = 0;
            let rejectedReasons = {};
            
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => {
                lineCount++;
                
                // Vérifications essentielles (moins strictes)
                const idMutation = row.id_mutation?.trim() || row['Id mutation']?.trim() || row.ID_MUTATION?.trim();
                const valeurFonciere = parseFloat(row.valeur_fonciere) || parseFloat(row['Valeur fonciere']) || parseFloat(row.VALEUR_FONCIERE);
                const longitude = parseFloat(row.longitude) || parseFloat(row.Longitude) || parseFloat(row.LONGITUDE) || null;
                const latitude = parseFloat(row.latitude) || parseFloat(row.Latitude) || parseFloat(row.LATITUDE) || null;
                const idParcelle = row.id_parcelle?.trim() || row['Id parcelle']?.trim() || row.ID_PARCELLE?.trim();
                
                // Accepter les transactions même sans coordonnées GPS
                if (!idMutation || valeurFonciere <= 0) {
                    rejectedCount++;
                    const reason = !idMutation ? 'no_id' : 'no_value';
                    rejectedReasons[reason] = (rejectedReasons[reason] || 0) + 1;
                    return;
                }
                
                // Calculer les prix au m²
                const surfaceBati = parseFloat(row.surface_reelle_bati) || parseFloat(row['Surface reelle bati']) || parseFloat(row.SURFACE_REELLE_BATI) || 0;
                const surfaceTerrain = parseFloat(row.surface_terrain) || parseFloat(row['Surface terrain']) || parseFloat(row.SURFACE_TERRAIN) || 0;
                const prixM2Bati = surfaceBati > 0 ? valeurFonciere / surfaceBati : null;
                const prixM2Terrain = surfaceTerrain > 0 ? valeurFonciere / surfaceTerrain : null;
                
                transactions.push({
                    id_mutation: idMutation,
                    date_mutation: row.date_mutation?.trim() || row['Date mutation']?.trim() || row.DATE_MUTATION?.trim(),
                    valeur_fonciere: valeurFonciere,
                    code_commune: row.code_commune?.trim() || row['Code commune']?.trim() || row.CODE_COMMUNE?.trim(),
                    nom_commune: row.nom_commune?.trim() || row['Nom commune']?.trim() || row.NOM_COMMUNE?.trim(),
                    code_departement: row.code_departement?.trim() || row['Code departement']?.trim() || row.CODE_DEPARTEMENT?.trim(),
                    type_local: row.type_local?.trim() || row['Type local']?.trim() || row.TYPE_LOCAL?.trim(),
                    surface_reelle_bati: surfaceBati || null,
                    nombre_pieces_principales: parseInt(row.nombre_pieces_principales) || parseInt(row['Nombre pieces principales']) || parseInt(row.NOMBRE_PIECES_PRINCIPALES) || null,
                    nature_culture: row.nature_culture?.trim() || row['Nature culture']?.trim() || row.NATURE_CULTURE?.trim(),
                    surface_terrain: surfaceTerrain || null,
                    longitude: longitude,
                    latitude: latitude,
                    annee_source: year,
                    prix_m2_bati: prixM2Bati,
                    prix_m2_terrain: prixM2Terrain,
                    id_parcelle: idParcelle, // Ajouté pour la jointure
                    batiment_groupe_id: null, // Sera rempli par la jointure BDNB
                    classe_dpe: null,
                    orientation_principale: null,
                    pourcentage_vitrage: null
                });
                
                // Insérer par batch de 1000
                if (transactions.length >= 1000) {
                    insertDVFBatch(transactions);
                    transactions.length = 0;
                }
            })
            .on('end', () => {
                // Insérer les dernières transactions
                if (transactions.length > 0) {
                    insertDVFBatch(transactions);
                }
                
                console.log(`   📊 ${lineCount.toLocaleString()} lignes lues`);
                console.log(`   ✅ ${(lineCount - rejectedCount).toLocaleString()} transactions acceptées`);
                console.log(`   ❌ ${rejectedCount.toLocaleString()} transactions rejetées`);
                if (rejectedCount > 0) {
                    console.log(`   📋 Raisons: ${JSON.stringify(rejectedReasons)}`);
                }
                
                resolve(lineCount - rejectedCount);
            })
            .on('error', reject);
        } catch (error) {
            reject(error);
        }
    });
}

// Fonction pour insérer un batch DVF
function insertDVFBatch(transactions) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO dvf_bdnb_complete VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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

// Fonction pour charger les données BDNB
async function loadBDNBData() {
    console.log('📊 Chargement des données BDNB...\n');
    
    // Charger les relations parcelle → bâtiment
    console.log('📂 Chargement rel_batiment_groupe_parcelle.csv...');
    await loadCSV(
        path.join(BDNB_DIR, 'rel_batiment_groupe_parcelle.csv'),
        'temp_bdnb_relations',
        {
            insertSQL: `INSERT OR IGNORE INTO temp_bdnb_relations VALUES (?, ?)`,
            process: (row) => {
                const parcelleId = row.parcelle_id?.trim();
                const batimentId = row.batiment_groupe_id?.trim();
                
                if (!parcelleId || !batimentId) return null;
                return [parcelleId, batimentId];
            }
        }
    );
    
    // Charger les bâtiments BDNB
    console.log('📂 Chargement batiment_groupe.csv...');
    await loadCSV(
        path.join(BDNB_DIR, 'batiment_groupe.csv'),
        'temp_bdnb_batiment',
        {
            insertSQL: `INSERT OR IGNORE INTO temp_bdnb_batiment VALUES (?, ?, ?, ?, ?)`,
            process: (row) => {
                const id = row.batiment_groupe_id?.trim();
                const commune = row.code_commune_insee?.trim();
                const nomCommune = row.libelle_commune_insee?.trim();
                const longitude = parseFloat(row.longitude) || null;
                const latitude = parseFloat(row.latitude) || null;
                
                if (!id) return null;
                return [id, commune, nomCommune, longitude, latitude];
            }
        }
    );
    
    // Charger les DPE BDNB
    console.log('📂 Chargement batiment_groupe_dpe_representatif_logement.csv...');
    await loadCSV(
        path.join(BDNB_DIR, 'batiment_groupe_dpe_representatif_logement.csv'),
        'temp_bdnb_dpe',
        {
            insertSQL: `INSERT OR IGNORE INTO temp_bdnb_dpe VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            process: (row) => {
                const id = row.batiment_groupe_id?.trim();
                const dpe = row.classe_bilan_dpe?.trim();
                
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
                
                // Récupérer la surface habitable du logement pour la jointure intelligente
                const surfaceHabitableLogement = parseFloat(row.surface_habitable_logement) || null;
                
                // Récupérer la date d'établissement du DPE pour la chronologie
                const dateEtablissementDpe = row.date_etablissement_dpe?.trim() || null;
                
                // Récupérer les données piscine/garage/véranda
                const presencePiscine = parseInt(row.presence_piscine) || 0;
                const presenceGarage = parseInt(row.presence_garage) || 0;
                const presenceVeranda = parseInt(row.presence_veranda) || 0;
                
                // Vérifier le type de DPE (inclure tous les DPE mais distinguer officiels/non officiels)
                const typeDpe = row.type_dpe?.trim();
                
                // Déterminer si le DPE est officiel
                const isDpeOfficiel = typeDpe === 'DPE' || 
                                    !typeDpe; // Si pas de type spécifié, considérer comme officiel
                
                if (!id || !dpe || dpe === 'N' || dpe === '') return null;
                
                return [id, dpe, orientation, pourcentageVitrage, surfaceHabitableLogement, dateEtablissementDpe, presencePiscine, presenceGarage, presenceVeranda, typeDpe, isDpeOfficiel ? 1 : 0];
            }
        }
    );
}

// Fonction pour charger un CSV
async function loadCSV(csvFile, tableName, processRow, batchSize = 10000) {
    if (!fs.existsSync(csvFile)) {
        console.log(`⚠️  Fichier manquant : ${csvFile}`);
        return 0;
    }
    
    const stats = fs.statSync(csvFile);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    
    console.log(`📂 Chargement ${path.basename(csvFile)} (${fileSizeMB} MB)...`);
    
    let batch = [];
    let totalRows = 0;
    
    return new Promise((resolve, reject) => {
        const insertStmt = db.prepare(processRow.insertSQL);
        const insertMany = db.transaction((rows) => {
            for (const row of rows) {
                try {
                    insertStmt.run(row);
                } catch (error) {
                    // Ignorer les erreurs de contrainte
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

// Fonction pour fusionner DVF + BDNB par identifiants
async function mergeDVFWithBDNB() {
    console.log('🔗 Fusion DVF + BDNB par identifiants...');
    console.log('   ⏳ Jointure en cours (peut prendre quelques minutes)...');
    
    const startTime = Date.now();
    
    // Étape 1: Mettre à jour via id_parcelle (jointure précise)
    console.log('   📍 Jointure via id_parcelle...');
    db.exec(`
        UPDATE dvf_bdnb_complete 
        SET batiment_groupe_id = (
            SELECT rel.batiment_groupe_id 
            FROM temp_bdnb_relations rel 
            WHERE rel.parcelle_id = dvf_bdnb_complete.id_parcelle
            LIMIT 1
        )
        WHERE id_parcelle IS NOT NULL 
          AND id_parcelle != ''
    `);
    
    // Étape 1.5: Mettre à jour les coordonnées GPS via batiment_groupe_id (seulement si manquantes)
    console.log('   🌍 Mise à jour des coordonnées GPS manquantes via BDNB...');
    db.exec(`
        UPDATE dvf_bdnb_complete 
        SET 
            longitude = (
                SELECT bat.longitude 
                FROM temp_bdnb_batiment bat 
                WHERE bat.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND bat.longitude IS NOT NULL
                LIMIT 1
            ),
            latitude = (
                SELECT bat.latitude 
                FROM temp_bdnb_batiment bat 
                WHERE bat.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND bat.latitude IS NOT NULL
                LIMIT 1
            )
        WHERE batiment_groupe_id IS NOT NULL 
          AND longitude IS NULL 
          AND latitude IS NULL
    `);
    
    // Étape 2: Mettre à jour les données DPE via batiment_groupe_id
    // Note: Un bâtiment peut avoir plusieurs DPE (un par logement)
    // On utilise une jointure intelligente par surface + chronologie des ventes
    console.log('   🔋 Mise à jour des données DPE (jointure intelligente + chronologie)...');
    db.exec(`
        UPDATE dvf_bdnb_complete 
        SET 
            classe_dpe = (
                SELECT dpe.classe_dpe 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            orientation_principale = (
                SELECT dpe.orientation_principale 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            pourcentage_vitrage = (
                SELECT dpe.pourcentage_vitrage 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            presence_piscine = (
                SELECT dpe.presence_piscine 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            presence_garage = (
                SELECT dpe.presence_garage 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            presence_veranda = (
                SELECT dpe.presence_veranda 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            )
        WHERE batiment_groupe_id IS NOT NULL
    `);
    
    // Étape 3: Fallback via code_commune pour les transactions sans id_parcelle
    console.log('   🏘️ Fallback via code_commune...');
    db.exec(`
        UPDATE dvf_bdnb_complete 
        SET batiment_groupe_id = (
            SELECT bat.batiment_groupe_id 
            FROM temp_bdnb_batiment bat 
            WHERE bat.code_commune_insee = dvf_bdnb_complete.code_commune
            LIMIT 1
        )
        WHERE batiment_groupe_id IS NULL
    `);
    
    // Étape 4: Mettre à jour les données DPE pour le fallback
    // Note: Même logique que l'étape 2 - jointure intelligente par surface
    console.log('   🔋 Mise à jour des données DPE (fallback avec jointure intelligente)...');
    db.exec(`
        UPDATE dvf_bdnb_complete 
        SET 
            classe_dpe = (
                SELECT dpe.classe_dpe 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            orientation_principale = (
                SELECT dpe.orientation_principale 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            pourcentage_vitrage = (
                SELECT dpe.pourcentage_vitrage 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            presence_piscine = (
                SELECT dpe.presence_piscine 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            presence_garage = (
                SELECT dpe.presence_garage 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            ),
            presence_veranda = (
                SELECT dpe.presence_veranda 
                FROM temp_bdnb_dpe dpe
                WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
                  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
                  AND (
                      -- DPE avant la vente : toujours valide
                      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
                      OR
                      -- DPE après la vente : seulement si dans les 6 mois
                      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
                  )
                ORDER BY 
                  CASE 
                    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
                    THEN dpe.date_etablissement_dpe DESC
                    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                    ELSE dpe.date_etablissement_dpe ASC
                  END,
                  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
                LIMIT 1
            )
        WHERE batiment_groupe_id IS NOT NULL 
          AND classe_dpe IS NULL
    `);
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`   ✅ Fusion terminée en ${duration}s\n`);
}

// Fonctions utilitaires (copiées du script précédent)
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

function parseVitragePercentage(vitrageString) {
    if (!vitrageString || vitrageString === '') {
        return null;
    }
    
    try {
        const cleaned = vitrageString.replace(/[\[\]""]/g, '').trim();
        const directMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
        if (directMatch) {
            return parseFloat(directMatch[1]);
        }
        
        const orientations = cleaned.split(',').map(o => o.trim());
        if (orientations.length > 0) {
            return orientations.length;
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

function parseOrientationFromBaie(orientationBaie) {
    if (!orientationBaie || orientationBaie === '') {
        return null;
    }
    
    const value = parseFloat(orientationBaie);
    
    if (value === 0) return 'nord';
    if (value === 1) return 'sud';
    if (value === 2) return 'est';
    if (value === 3) return 'ouest';
    if (value === 4) return 'horizontal';
    
    return 'mixte';
}

// Fonction principale
async function createCompleteDatabase() {
    const startTime = Date.now();
    let totalFiles = 0;
    let totalTransactions = 0;
    
    console.log(`📂 Traitement de ${YEARS.length} fichiers DVF déjà téléchargés\n`);
    
    // Étape 1: Traiter les fichiers DVF déjà téléchargés par le script shell
    console.log(`📂 Traitement des fichiers DVF dans : ${DVF_DIR}\n`);
    
    for (const year of YEARS) {
        console.log(`📅 === ANNÉE ${year} ===`);
        
        // Utiliser le fichier déjà téléchargé par le script shell
        const fileName = `dvf_${year}.csv`;
        const filePath = path.join(DVF_DIR, fileName);
        
        try {
            if (fs.existsSync(filePath)) {
                console.log(`📥 Traitement fichier ${year}...`);
                
                const count = await processDVFFile(filePath, year, 'ALL');
                totalTransactions += count;
                totalFiles++;
                
                console.log(`   ✅ ${count.toLocaleString()} transactions traitées`);
                console.log('');
            } else {
                console.log(`   ⚠️ Fichier ${fileName} non trouvé`);
                console.log('');
            }
            
        } catch (error) {
            console.log(`   ⚠️ ${year}: ${error.message}`);
            console.log('');
        }
    }
    
    // Étape 2: Charger les données BDNB
    await loadBDNBData();
    
    // Étape 3: Fusionner DVF + BDNB
    await mergeDVFWithBDNB();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    // Statistiques finales
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT code_departement) as nb_depts,
            COUNT(DISTINCT code_commune) as nb_communes,
            COUNT(CASE WHEN type_local = 'Maison' THEN 1 END) as maisons,
            COUNT(CASE WHEN type_local = 'Appartement' THEN 1 END) as appartements,
            COUNT(CASE WHEN nature_culture = 'terrains a bâtir' THEN 1 END) as terrains_batir,
            COUNT(CASE WHEN batiment_groupe_id IS NOT NULL THEN 1 END) as avec_batiment_id,
            COUNT(CASE WHEN classe_dpe IS NOT NULL THEN 1 END) as avec_dpe,
            COUNT(CASE WHEN dpe_officiel = 1 THEN 1 END) as dpe_officiels,
            COUNT(CASE WHEN dpe_officiel = 0 THEN 1 END) as dpe_non_officiels,
            COUNT(CASE WHEN orientation_principale IS NOT NULL THEN 1 END) as avec_orientation,
            COUNT(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 END) as avec_vitrage,
            COUNT(CASE WHEN presence_piscine = 1 THEN 1 END) as avec_piscine,
            COUNT(CASE WHEN presence_garage = 1 THEN 1 END) as avec_garage,
            COUNT(CASE WHEN presence_veranda = 1 THEN 1 END) as avec_veranda,
            AVG(valeur_fonciere) as prix_moyen,
            MIN(date_mutation) as date_min,
            MAX(date_mutation) as date_max
        FROM dvf_bdnb_complete
    `).get();
    
    console.log('🎉 === BASE COMPLÈTE CRÉÉE ===');
    console.log(`⏱️ Durée : ${duration}s`);
    console.log(`📁 Fichiers DVF traités : ${totalFiles}`);
    console.log(`📊 Total transactions : ${stats.total.toLocaleString()}`);
    console.log(`🏛️ Départements : ${stats.nb_depts}`);
    console.log(`🏘️ Communes : ${stats.nb_communes.toLocaleString()}`);
    console.log(`🏠 Maisons : ${stats.maisons.toLocaleString()}`);
    console.log(`🏢 Appartements : ${stats.appartements.toLocaleString()}`);
    console.log(`🏞️ Terrains à bâtir : ${stats.terrains_batir.toLocaleString()}`);
    console.log(`🔗 Avec batiment_groupe_id : ${stats.avec_batiment_id.toLocaleString()} (${(stats.avec_batiment_id / stats.total * 100).toFixed(1)}%)`);
    console.log(`🔋 Avec DPE : ${stats.avec_dpe.toLocaleString()} (${(stats.avec_dpe / stats.total * 100).toFixed(1)}%)`);
    console.log(`   ✅ DPE Officiels : ${stats.dpe_officiels.toLocaleString()} (${(stats.dpe_officiels / stats.total * 100).toFixed(1)}%)`);
    console.log(`   ⚠️ DPE Non Officiels : ${stats.dpe_non_officiels.toLocaleString()} (${(stats.dpe_non_officiels / stats.total * 100).toFixed(1)}%)`);
    console.log(`🧭 Avec orientation : ${stats.avec_orientation.toLocaleString()} (${(stats.avec_orientation / stats.total * 100).toFixed(1)}%)`);
    console.log(`🪟 Avec vitrage : ${stats.avec_vitrage.toLocaleString()} (${(stats.avec_vitrage / stats.total * 100).toFixed(1)}%)`);
    console.log(`🏊 Avec piscine : ${stats.avec_piscine.toLocaleString()} (${(stats.avec_piscine / stats.total * 100).toFixed(1)}%)`);
    console.log(`🚗 Avec garage : ${stats.avec_garage.toLocaleString()} (${(stats.avec_garage / stats.total * 100).toFixed(1)}%)`);
    console.log(`🏠 Avec véranda : ${stats.avec_veranda.toLocaleString()} (${(stats.avec_veranda / stats.total * 100).toFixed(1)}%)`);
    console.log(`💰 Prix moyen : ${stats.prix_moyen?.toLocaleString()} €`);
    console.log(`📅 Période : ${stats.date_min} → ${stats.date_max}`);
    
    const dbStats = fs.statSync(DB_FILE);
    const sizeMB = (dbStats.size / 1024 / 1024).toFixed(1);
    console.log(`💾 Base créée : ${sizeMB} MB`);
    console.log(`📂 ${DB_FILE}\n`);
    
    db.close();
}

// Lancer la création
createCompleteDatabase().catch(console.error);