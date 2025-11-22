#!/usr/bin/env node

/**
 * 🏗️ CRÉATION BASE TERRAINS À BÂTIR - VERSION 3 (OPTIMISÉE ESPACE DISQUE)
 * 
 * 🔥 OPTIMISATION RADICALE : Chargement DIRECT sans table intermédiaire
 * 
 * PROBLÈME :
 * - Ancienne méthode : DVF → dvf_temp_indexed (14 GB) → terrains_batir_temp (26 GB) = 40 GB
 * - Espace disque insuffisant sur Raspberry Pi (50 GB avec index)
 * 
 * SOLUTION :
 * - Nouvelle méthode : DVF → terrains_batir_temp directement (26 GB) = économie de 14 GB
 * - journal_mode=DELETE pendant indexation pour éviter WAL files
 * - Suppression de colonnes inutiles (latitude, longitude, nom_commune)
 * - prix_m2 calculé à la volée ou laissé NULL
 * 
 * Logique métier (identique à V2) :
 * 1. Charger PA depuis Liste-des-permis-damenager.2025-10.csv
 * 2. Pour chaque PA, identifier les parcelles FILLES via DFI (64.5% des PA ont des filles)
 * 3. ÉTAPE 1 - ACHAT LOTISSEUR (NON-VIABILISÉ) :
 *    - Chercher transactions DVF avec ≥2 parcelles filles du PA
 *    - Date : ±2 ans autour du PA
 *    - Surface : ±10% de la superficie du PA
 *    - Prendre la PREMIÈRE chronologiquement
 * 4. ÉTAPE 2 - LOTS VENDUS (VIABILISÉS) :
 *    - Toutes les autres transactions sur parcelles filles
 *    - SANS filtre de date, surface, ou nombre de parcelles
 * 5. Attribution type usage via PC depuis Liste autorisations
 *    - Filtres PC : NATURE_PROJET_COMPLETEE='1' (nouvelle construction)
 *                   DESTINATION_PRINCIPALE='1' (logements)
 *                   TYPE_PRINCIP_LOGTS_CREES IN ('1','2') (individuel)
 *                   NB_LGT_COL_CREES=0 (pas de collectif)
 * 6. FILTRE FINAL : Ne garder que les terrains viabilisés avec PC habitation INDIVIDUELLE
 *    - Supprime : sans PC nouvelle construction habitation individuelle
 *    - Supprime : bâti existant (surface_reelle_bati > 0)
 *    - Conserve : TOUS les achats lotisseurs (on ne sait pas l'usage ni le bâti avant)
 * 
 * Base finale : UNIQUEMENT habitation individuelle NOUVELLE construction (sans bâti existant)
 * Couverture estimée : 70-75% des PA avec parcelles filles
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Database = require('better-sqlite3');
const { execSync } = require('child_process');

// Helper pour afficher la taille de la DB
function getDbSizeMB(dbPath) {
    try {
        const stats = fs.statSync(dbPath);
        return Math.round(stats.size / 1024 / 1024);
    } catch (e) {
        return 0;
    }
}

let DB_FILE = path.join(__dirname, '..', 'database', 'terrains_batir_dept40.db');
const LISTE_PA_FILE = path.join(__dirname, '..', 'Liste-des-permis-damenager.2025-10.csv');
// FILTRE DÉPARTEMENT 40 (Landes) - ANALYSE UNIQUEMENT
const DEPARTEMENT_FILTRE = '40';
const TOLERANCE_SURFACE = 0.10; // 10% (assouplissement pour meilleure couverture)

console.log('🏗️  === CRÉATION BASE TERRAINS À BÂTIR - VERSION 3 - DÉPARTEMENT 40 ===\n');
console.log(`📌 FILTRE ACTIVÉ : Département ${DEPARTEMENT_FILTRE} (Landes) uniquement\n`);

// ===== DÉBUT DU SCRIPT =====

// Les fichiers DVF sont téléchargés par le script principal (create-terrains-batir-complet.js)
console.log('📊 Démarrage de la création de la base...\n');
demarrerCreationBase();

// Fonction pour vérifier l'espace disque disponible (en GB)
function verifierEspaceDisque(chemin) {
    try {
        // Utiliser df sur Linux/Mac
        const result = execSync(`df -BG "${chemin}" | tail -1 | awk '{print $4}'`, { encoding: 'utf8' }).trim();
        const espaceGB = parseFloat(result.replace('G', ''));
        return espaceGB;
    } catch (err) {
        // Si df échoue, essayer une autre méthode ou retourner null
        console.log('⚠️  Impossible de vérifier l\'espace disque, continuation...');
        return null;
    }
}

function creerTableFinale(db) {
    try {
        console.log('\n📊 ÉTAPE 7 : Création de la table finale simplifiée...');
        
        // ✅ Réactiver le WAL MAINTENANT (pour la table finale uniquement)
        console.log('   🔧 Réactivation du mode WAL pour la table finale...');
        db.pragma('journal_mode = WAL');
        
        db.exec(`
            CREATE TABLE terrains_batir (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                valeur_fonciere REAL,
                surface_totale REAL,
                surface_reelle_bati REAL,
                prix_m2 REAL,
                date_mutation TEXT,
                latitude REAL,
                longitude REAL,
                nom_commune TEXT,
                type_terrain TEXT,
                id_pa TEXT
            );
            
            CREATE INDEX IF NOT EXISTS idx_coords ON terrains_batir(latitude, longitude);
            CREATE INDEX IF NOT EXISTS idx_date ON terrains_batir(date_mutation);
            CREATE INDEX IF NOT EXISTS idx_type_terrain ON terrains_batir(type_terrain);
            CREATE INDEX IF NOT EXISTS idx_commune ON terrains_batir(nom_commune);
            CREATE INDEX IF NOT EXISTS idx_pa ON terrains_batir(id_pa);
        `);
        
        // Copier les données en AGRÉGEANT par mutation
        // FILTRE 1 : Ne garder QUE les transactions rattachées à un PA
        // FILTRE 2 : Exclure les transactions NON géolocalisées ⚠️
        // IMPORTANT : Une mutation = plusieurs parcelles → AGRÉGER !
        db.exec(`
            INSERT INTO terrains_batir (
                valeur_fonciere, surface_totale, surface_reelle_bati, prix_m2,
                date_mutation, latitude, longitude, nom_commune, type_terrain, id_pa
            )
            SELECT 
                MAX(valeur_fonciere) as valeur_fonciere,  -- Valeur UNIQUE (même pour toutes les parcelles)
                SUM(surface_totale) as surface_totale,    -- SOMME des surfaces
                SUM(surface_reelle_bati) as surface_reelle_bati,  -- SOMME du bâti
                MAX(valeur_fonciere) / SUM(surface_totale) as prix_m2,  -- Recalculer le prix/m²
                MIN(date_mutation) as date_mutation,      -- Date la plus ancienne
                AVG(latitude) as latitude,                 -- Moyenne des coordonnées GPS
                AVG(longitude) as longitude,               -- Moyenne des coordonnées GPS
                MAX(nom_commune) as nom_commune,
                CASE 
                    WHEN est_terrain_viabilise = 0 THEN 'NON_VIABILISE'
                    WHEN est_terrain_viabilise = 1 THEN 'VIABILISE'
                    ELSE NULL
                END as type_terrain,
                id_pa
            FROM terrains_batir_temp
            WHERE id_pa IS NOT NULL
            GROUP BY id_mutation, est_terrain_viabilise, id_pa;
        `);
        
        // Checkpoint après INSERT massif
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (checkpointErr) {
            // Ignorer
        }
        
        // Supprimer la table temporaire
        db.exec(`DROP TABLE terrains_batir_temp;`);
        
        // Checkpoint final pour nettoyer le WAL après toutes les opérations
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
            console.log('🧹 Checkpoint WAL final effectué\n');
        } catch (checkpointErr) {
            // Ignorer les erreurs de checkpoint
        }
        
        const finalStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN type_terrain = 'VIABILISE' THEN 1 ELSE 0 END) as viabilises,
                SUM(CASE WHEN type_terrain = 'NON_VIABILISE' THEN 1 ELSE 0 END) as non_viabilises,
                COUNT(DISTINCT id_pa) as nb_pa
            FROM terrains_batir
        `).get();
        
        console.log(`✅ Table finale créée :`);
        console.log(`   - Total : ${finalStats.total} transactions`);
        console.log(`   - VIABILISE : ${finalStats.viabilises}`);
        console.log(`   - NON_VIABILISE : ${finalStats.non_viabilises}`);
        console.log(`   - PA distincts : ${finalStats.nb_pa}\n`);
        
        console.log('✅ Base terrains_batir créée avec succès !\n');
        db.close();
        process.exit(0);
    } catch (err) {
        console.error('❌ Erreur lors de la création de la table finale:', err);
        db.close();
        process.exit(1);
    }
}

function demarrerCreationBase() {
// S'assurer que le répertoire database existe
const dbDir = path.dirname(DB_FILE);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Répertoire créé : ${dbDir}\n`);
}

// Vérifier l'espace disque disponible
const espaceDispo = verifierEspaceDisque(dbDir);
if (espaceDispo !== null) {
    console.log(`💾 Espace disque disponible : ${espaceDispo.toFixed(2)} GB\n`);
    if (espaceDispo < 5) {
        console.log('⚠️  ATTENTION : Moins de 5 GB d\'espace disponible !');
        console.log('   Le script peut échouer si l\'espace est insuffisant.\n');
    }
}

// Supprimer ancienne base (gérer les erreurs de verrouillage)
let dbExisteAvecDFI = false;
if (fs.existsSync(DB_FILE)) {
    // Vérifier si la base contient déjà la table DFI
    try {
        const dbTemp = new Database(DB_FILE);
        const tables = dbTemp.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='dfi_lotissements'
        `).all();
        dbTemp.close();
        if (tables.length > 0) {
            dbExisteAvecDFI = true;
            console.log('ℹ️  Base existante avec table DFI détectée, suppression uniquement de la table terrains_batir\n');
        } else {
            fs.unlinkSync(DB_FILE);
            console.log('🗑️  Ancienne base supprimée\n');
        }
    } catch (err) {
        if (err.code === 'EBUSY') {
            console.log('⚠️  Base verrouillée, création d\'une nouvelle version temporaire...\n');
            // Créer une version temporaire avec timestamp
            DB_FILE = DB_FILE.replace('.db', `_${Date.now()}.db`);
        } else {
            throw err;
        }
    }
}

// Nettoyer les fichiers WAL de l'ancienne base si elle existe
if (fs.existsSync(DB_FILE)) {
    const walFile = DB_FILE + '-wal';
    const shmFile = DB_FILE + '-shm';
    if (fs.existsSync(walFile)) {
        try {
            fs.unlinkSync(walFile);
            console.log('🧹 Fichier WAL nettoyé\n');
        } catch (err) {
            // Ignorer si le fichier est verrouillé
        }
    }
    if (fs.existsSync(shmFile)) {
        try {
            fs.unlinkSync(shmFile);
        } catch (err) {
            // Ignorer si le fichier est verrouillé
        }
    }
}

// Créer ou ouvrir la base
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // Optimisation pour performance
db.pragma('cache_size = -64000'); // 64 MB de cache
db.pragma('temp_store = MEMORY'); // Utiliser la RAM pour les tables temporaires (économie disque)

// 🔥 CRITIQUE : Changer le répertoire temporaire SQLite
// Par défaut, SQLite utilise /tmp qui fait seulement 3.8 GB (tmpfs)
// Les jointures massives créent des fichiers temporaires > 3.8 GB → SQLITE_FULL
// Solution : Utiliser le répertoire de la base qui a 33 GB disponibles
const tempDir = path.join(path.dirname(DB_FILE), 'sqlite_temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}
db.pragma(`temp_store_directory = '${tempDir}'`);

// Créer la structure de terrains_batir_temp (table temporaire pour le matching)
db.exec(`
    DROP TABLE IF EXISTS terrains_batir_temp;
    DROP TABLE IF EXISTS terrains_batir;
    CREATE TABLE terrains_batir_temp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_parcelle TEXT,
        id_mutation TEXT,
        valeur_fonciere REAL,
        surface_totale REAL,
        surface_reelle_bati REAL,
        prix_m2 REAL,
        date_mutation TEXT,
        latitude REAL,
        longitude REAL,
        code_departement TEXT,
        code_commune TEXT,
        nom_commune TEXT,
        section_cadastrale TEXT,
        est_terrain_viabilise INTEGER DEFAULT 0,
        id_pa TEXT,
        parcelle_suffixe TEXT
    );
    
    -- ⚡ OPTIMISATION : Index créés APRÈS la copie des données (pas sur table vide)
`);

// Créer la table DFI si elle n'existe pas
db.exec(`
    CREATE TABLE IF NOT EXISTS dfi_lotissements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_dfi TEXT NOT NULL,
        code_departement TEXT,
        code_commune TEXT,
        nature_dfi TEXT,
        date_validation TEXT,
        parcelles_meres TEXT,
        parcelles_filles TEXT,
        UNIQUE(id_dfi, code_departement, code_commune)
    );
    
    CREATE INDEX IF NOT EXISTS idx_dfi_commune ON dfi_lotissements(code_commune);
    CREATE INDEX IF NOT EXISTS idx_dfi_meres ON dfi_lotissements(parcelles_meres);
    CREATE INDEX IF NOT EXISTS idx_dfi_filles ON dfi_lotissements(parcelles_filles);
`);

if (!dbExisteAvecDFI) {
    console.log('⚠️  Table DFI créée mais vide. Lancez d\'abord: node charger-dfi-dans-db.js\n');
} else {
    // Vérifier que la table DFI contient des données
    const countDFI = db.prepare('SELECT COUNT(*) as nb FROM dfi_lotissements').get();
    if (countDFI.nb === 0) {
        console.log('⚠️  Table DFI vide. Lancez: node charger-dfi-dans-db.js\n');
    } else {
        console.log(`✅ Table DFI trouvée avec ${countDFI.nb} enregistrements`);
        
        // Créer une table DFI temporaire INDEXÉE par commune
        console.log('⚡ Création table DFI temporaire indexée par commune...');
        db.exec(`
            DROP TABLE IF EXISTS dfi_indexed;
            CREATE TEMP TABLE dfi_indexed AS
            SELECT 
                id_dfi,
                code_departement,
                code_commune,
                nature_dfi,
                date_validation,
                parcelles_meres,
                parcelles_filles
            FROM dfi_lotissements
            WHERE code_departement = '${DEPARTEMENT_FILTRE}';
            
            CREATE INDEX idx_dfi_idx_commune ON dfi_indexed(code_commune);
            CREATE INDEX idx_dfi_idx_meres ON dfi_indexed(parcelles_meres);
            CREATE INDEX idx_dfi_idx_filles ON dfi_indexed(parcelles_filles);
        `);
        console.log('✅ Table DFI indexée créée\n');
    }
}

console.log('✅ Table terrains_batir créée\n');

// Fonction pour extraire section cadastrale
function extraireSection(idParcelle) {
    if (!idParcelle) return null;
    // Format ancien (2014-2019, 2024-2025) : 5 chiffres + "000" + section (lettres) + numéro
    // Exemple: 01426000ZC0122
    let match = idParcelle.match(/\d{5}000([A-Z]+)\d+/);
    if (match) return match[1];
    
    // Format moderne (2020-2023) : 5 chiffres + 3 chiffres (préfixe) + section (2 caractères) + numéro
    // Exemple: 01426312ZC0122
    match = idParcelle.match(/\d{5}\d{3}([A-Z]{2})\d{4}/);
    if (match) return match[1];
    
    // Essayer aussi avec section de 1 caractère dans le format moderne
    match = idParcelle.match(/\d{5}\d{3}([A-Z])\d{4}/);
    if (match) return match[1];
    
    return null;
}

// Fonction pour normaliser parcelle
function normaliserParcelle(comm, section, numero) {
    if (!comm || !section || !numero) return null;
    // Supprimer le "p" à la fin du numéro s'il existe (parcelle provisoire, ex: "72p")
    const numeroClean = String(numero).replace(/p$/i, '').trim();
    const commPadded = String(comm).padStart(5, '0');
    const numPadded = String(numeroClean).padStart(4, '0');
    return `${commPadded}000${section}${numPadded}`;
}

// Fonction pour extraire le centroïde depuis une géométrie WKT MULTIPOLYGON
// Format: MULTIPOLYGON (((x1 y1, x2 y2, ...)))
// Les coordonnées sont en Lambert 93 (EPSG:2154)
function extraireCentroideLambert(wkt) {
    if (!wkt || typeof wkt !== 'string') return null;
    
    // Extraire toutes les coordonnées du MULTIPOLYGON
    const coordMatch = wkt.match(/\(\(\(([^)]+)\)\)/);
    if (!coordMatch) return null;
    
    const coordsStr = coordMatch[1];
    const points = coordsStr.split(',').map(p => {
        const parts = p.trim().split(/\s+/);
        if (parts.length >= 2) {
            return {
                x: parseFloat(parts[0]),
                y: parseFloat(parts[1])
            };
        }
        return null;
    }).filter(p => p !== null);
    
    if (points.length === 0) return null;
    
    // Calculer le centroïde (moyenne des coordonnées)
    const centroid = {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length
    };
    
    return centroid;
}

// Fonction pour convertir Lambert 93 vers WGS84 (latitude/longitude)
// Lambert 93: EPSG:2154, WGS84: EPSG:4326
// Formule approximative simplifiée pour la France métropolitaine
function lambert93ToWGS84(x, y) {
    // Formule de transformation Lambert 93 vers WGS84
    // Approximation valide pour la France
    const a = 6378137.0; // Demi-grand axe ellipsoïde WGS84
    const e = 0.081819191; // Première excentricité
    const n = 0.7256077650;
    const c = 11754255.426;
    const xs = 700000.0;
    const ys = 12655612.0499;
    const lon0 = 0.0523598776; // 3° en radians
    
    const xLambert = x - xs;
    const yLambert = y - ys;
    const r = Math.sqrt(xLambert * xLambert + yLambert * yLambert);
    const gamma = Math.atan(xLambert / -yLambert);
    const latIso = -1.0 / n * Math.log(Math.abs(r / c));
    
    let lat = latIso;
    for (let i = 0; i < 6; i++) {
        const eSinLat = e * Math.sin(lat);
        lat = latIso + eSinLat * Math.log((1 + Math.sin(lat)) / (1 - eSinLat)) / 2.0;
    }
    
    const lon = lon0 + gamma / n;
    
    return {
        latitude: lat * 180 / Math.PI,
        longitude: lon * 180 / Math.PI
    };
}

// Fonction pour attribuer le type d'usage (habitation/commercial) via les PC
function attribuerTypeUsage(db) {
    return new Promise((resolve, reject) => {
        // Ajouter la colonne type_usage si elle n'existe pas
        try {
            db.exec(`
                ALTER TABLE terrains_batir 
                ADD COLUMN type_usage TEXT DEFAULT NULL
            `);
            console.log('   ✅ Colonne type_usage ajoutée\n');
        } catch (err) {
            if (err.message.includes('duplicate column')) {
                // Colonne existe déjà, c'est bon
            } else {
                console.log(`   ⚠️  Erreur colonne type_usage: ${err.message}\n`);
            }
        }
        
        const LISTE_AUTORISATIONS_FILE = path.join(__dirname, '..', 'Liste-des-autorisations-durbanisme-creant-des-logements.2025-10.csv');
        
        if (!fs.existsSync(LISTE_AUTORISATIONS_FILE)) {
            console.log('   ⚠️  Fichier Liste autorisations non trouvé, attribution type ignorée\n');
            resolve();
            return;
        }
        
        console.log('   📂 Chargement des PC depuis Liste autorisations (nouvelle construction habitation individuelle)...');
        
        // Charger les PC avec leurs parcelles directement depuis le fichier Liste autorisations
        const pcParParcelle = new Map(); // parcelleDFI → PC info
        let countPC = 0;
        let countFiltres = 0;
        
        fs.createReadStream(LISTE_AUTORISATIONS_FILE)
            .pipe(csv({ separator: ';', skipLinesWithError: true }))
            .on('data', (row) => {
                const dept = row.DEP_CODE || row.DEP || '';
                const codeDept = dept.length >= 2 ? dept.substring(0, 2) : dept;
                const typeDau = row.TYPE_DAU || '';
                const numDau = row.NUM_DAU || '';
                
                // FILTRE DÉPARTEMENT 40 : Ne garder que les PC du département 40
                if (codeDept !== DEPARTEMENT_FILTRE) {
                    return; // Skip les PC d'autres départements
                }
                
                if (typeDau !== 'PC' || !numDau) return;
                
                // FILTRES POUR NOUVELLE CONSTRUCTION HABITATION INDIVIDUELLE
                const natureProjet = row.NATURE_PROJET_COMPLETEE || row.NATURE_PROJET_DECLAREE || '';
                const destination = row.DESTINATION_PRINCIPALE || '';
                const typePrincipal = row.TYPE_PRINCIP_LOGTS_CREES || '';
                const nbLogInd = parseInt(row.NB_LGT_IND_CREES || row.NB_LGT_INDIV_PURS || row.NB_LGT_INDIV_GROUPES || 0);
                const nbLogCol = parseInt(row.NB_LGT_COL_CREES || row.NB_LGT_COL_HORS_RES || 0);
                
                // Filtre 1 : Nouvelle construction UNIQUEMENT
                if (natureProjet !== '1') {
                    countFiltres++;
                    return;
                }
                
                // Filtre 2 : Destination LOGEMENTS (pas non résidentiel)
                if (destination !== '1') {
                    countFiltres++;
                    return;
                }
                
                // Filtre 3 : Type INDIVIDUEL (1 = un logement individuel, 2 = plusieurs logements individuels)
                // Exclure : 3 = collectif, 4 = résidence
                if (typePrincipal !== '1' && typePrincipal !== '2') {
                    countFiltres++;
                    return;
                }
                
                // Filtre 4 : Au moins 1 logement individuel créé ET pas de collectif
                if (nbLogInd === 0 || nbLogCol > 0) {
                    countFiltres++;
                    return;
                }
                
                // ✅ Ce PC est valide : Nouvelle construction d'habitation individuelle
                countPC++;
                
                // Extraire les parcelles associées à ce PC
                const commune = row.COMM || '';
                for (let i = 1; i <= 3; i++) {
                    const section = row[`SEC_CADASTRE${i}`] || '';
                    const numero = row[`NUM_CADASTRE${i}`] || '';
                    
                    if (section && numero) {
                        const numeroClean = numero.replace(/p$/i, '').trim();
                        const numeroInt = parseInt(numeroClean, 10);
                        const parcelleDFI = `${section}${numeroInt}`;
                        
                        // Stocker aussi le format complet pour correspondance
                        const numPadded = numeroClean.padStart(4, '0');
                        const parcelleId = `${commune}000${section}${numPadded}`;
                        
                        if (!pcParParcelle.has(parcelleDFI)) {
                            pcParParcelle.set(parcelleDFI, {
                                pcs: [],
                                fullId: parcelleId,
                                commune: commune
                            });
                        }
                        pcParParcelle.get(parcelleDFI).pcs.push(numDau);
                    }
                }
            })
            .on('end', () => {
                console.log(`   ✅ ${countPC} PC nouvelle construction habitation individuelle (${countFiltres} PC exclus par filtres)`);
                console.log(`   ✅ ${pcParParcelle.size} parcelles distinctes avec PC\n`);
                associerPC();
            })
            .on('error', reject);
        
        function associerPC() {
            console.log('   🔗 Association des PC aux parcelles filles viabilisées...');
            
            // Récupérer les parcelles filles viabilisées (lots vendus)
            const parcellesFillesViabilisees = db.prepare(`
                SELECT DISTINCT 
                    id_pa,
                    id_parcelle
                FROM terrains_batir_temp_temp
                WHERE id_pa IS NOT NULL AND est_terrain_viabilise = 1
            `).all();
            
            const updateStmt = db.prepare(`
                UPDATE terrains_batir
                SET type_usage = ?
                WHERE id_parcelle = ?
            `);
            
            let totalAssocies = 0;
            let habitationCount = 0;
            
            for (const parcelleFille of parcellesFillesViabilisees) {
                // Extraire format DFI depuis id_parcelle (ex: 40001000AM0168 → AM168)
                const match = parcelleFille.id_parcelle.match(/\d{5}000([A-Z]+)(\d+)/);
                if (!match) continue;
                
                const section = match[1];
                const numero = parseInt(match[2], 10);
                const parcelleDFI = `${section}${numero}`;
                
                // Chercher si cette parcelle a un PC nouvelle construction habitation individuelle
                const pcInfo = pcParParcelle.get(parcelleDFI);
                
                if (pcInfo && pcInfo.pcs.length > 0) {
                    // ✅ Cette parcelle fille a un PC nouvelle construction habitation individuelle
                    // Mettre à jour toutes les transactions pour cette parcelle
                    const transactions = db.prepare(`
                        SELECT DISTINCT id_parcelle
                        FROM terrains_batir_temp
                        WHERE id_parcelle = ? AND id_pa = ?
                    `).all(parcelleFille.id_parcelle, parcelleFille.id_pa);
                    
                    for (const tx of transactions) {
                        updateStmt.run('habitation', tx.id_parcelle);
                        totalAssocies++;
                        habitationCount++;
                    }
                }
            }
            
            console.log(`   ✅ ${totalAssocies} parcelles filles mises à jour avec type_usage`);
            console.log(`      - Habitation individuelle nouvelle construction : ${habitationCount}\n`);
            
            // Propager le type depuis les parcelles filles vers les parcelles mères du même PA
            console.log('   🔗 Propagation du type depuis parcelles filles vers parcelles mères...');
            
            const paAvecType = db.prepare(`
                SELECT DISTINCT 
                    id_pa,
                    type_usage
                FROM terrains_batir_temp
                WHERE id_pa IS NOT NULL 
                    AND est_terrain_viabilise = 1
                    AND type_usage IS NOT NULL
            `).all();
            
            const updateMeresStmt = db.prepare(`
                UPDATE terrains_batir
                SET type_usage = ?
                WHERE id_pa = ?
                    AND est_terrain_viabilise = 0
                    AND type_usage IS NULL
            `);
            
            let countMeresUpdated = 0;
            for (const pa of paAvecType) {
                const updated = updateMeresStmt.run(pa.type_usage, pa.id_pa);
                if (updated.changes > 0) {
                    countMeresUpdated += updated.changes;
                }
            }
            
            console.log(`   ✅ ${countMeresUpdated} transactions non-viabilisées mises à jour avec type depuis parcelles filles\n`);
            
            resolve();
        }
    });
}

// Fonction pour enrichir les coordonnées manquantes depuis les parcelles cadastrales
function enrichirCoordonnees(db) {
    return new Promise((resolve, reject) => {
        // BDNB France entière - fichier parcelle.csv dans bdnb_data/csv
        const PARCELLE_FILE = path.join(__dirname, '..', 'bdnb_data', 'csv', 'parcelle.csv');
        
        if (!fs.existsSync(PARCELLE_FILE)) {
            console.log('   ⚠️  Fichier parcelle.csv non trouvé, enrichissement coordonnées ignoré\n');
            resolve();
            return;
        }
        
        console.log('   📂 Chargement des parcelles avec coordonnées...');
        
        // Créer une map parcelle_id → {latitude, longitude}
        const parcelleCoords = new Map();
        let countLoaded = 0;
        let countWithGeom = 0;
        
        fs.createReadStream(PARCELLE_FILE)
            .pipe(csv())
            .on('data', (row) => {
                const parcelleId = row.parcelle_id;
                const geom = row.geom_parcelle;
                
                if (parcelleId && geom) {
                    const centroid = extraireCentroideLambert(geom);
                    if (centroid) {
                        const wgs84 = lambert93ToWGS84(centroid.x, centroid.y);
                        parcelleCoords.set(parcelleId, {
                            latitude: wgs84.latitude,
                            longitude: wgs84.longitude
                        });
                        countWithGeom++;
                    }
                }
                countLoaded++;
                
                if (countLoaded % 50000 === 0) {
                    process.stdout.write(`   ${countLoaded} parcelles chargées...\r`);
                }
            })
            .on('end', () => {
                console.log(`\n   ✅ ${countLoaded} parcelles chargées, ${countWithGeom} avec géométrie\n`);
                
                console.log('   🔗 Enrichissement des coordonnées manquantes...');
                
                // Récupérer les transactions sans coordonnées
                const transactionsSansCoords = db.prepare(`
                    SELECT DISTINCT id_parcelle
                    FROM terrains_batir_temp
                    WHERE (latitude IS NULL OR latitude = 0 OR longitude IS NULL OR longitude = 0)
                        AND id_parcelle IS NOT NULL
                `).all();
                
                console.log(`   ${transactionsSansCoords.length} transactions sans coordonnées trouvées`);
                
                const updateStmt = db.prepare(`
                    UPDATE terrains_batir_temp
                    SET latitude = ?, longitude = ?
                    WHERE id_parcelle = ?
                        AND (latitude IS NULL OR latitude = 0 OR longitude IS NULL OR longitude = 0)
                `);
                
                let countUpdated = 0;
                let countNotFound = 0;
                
                // Charger les relations DFI BIDIRECTIONNELLES
                console.log('   📂 Chargement des relations DFI (bidirectionnelles)...');
                const dfiMereVersFilles = new Map(); // parcelle_mere → [parcelles_filles]
                const dfiFilleVersMere = new Map(); // parcelle_fille → parcelle_mere
                
                try {
                    const lotissements = db.prepare(`
                        SELECT parcelles_meres, parcelles_filles
                        FROM dfi_lotissements
                        WHERE parcelles_meres IS NOT NULL AND parcelles_filles IS NOT NULL
                    `).all();
                    
                    lotissements.forEach(lot => {
                        const meres = (lot.parcelles_meres || '').split(/[\s,;]+/).filter(p => p.length >= 4);
                        const filles = (lot.parcelles_filles || '').split(/[\s,;]+/).filter(p => p.length >= 4);
                        
                        meres.forEach(mere => {
                            // Relation mère → filles
                            if (!dfiMereVersFilles.has(mere)) {
                                dfiMereVersFilles.set(mere, []);
                            }
                            filles.forEach(fille => {
                                if (!dfiMereVersFilles.get(mere).includes(fille)) {
                                    dfiMereVersFilles.get(mere).push(fille);
                                }
                                // Relation inverse fille → mère
                                dfiFilleVersMere.set(fille, mere);
                            });
                        });
                    });
                    console.log(`   ✅ ${dfiMereVersFilles.size} parcelles mères, ${dfiFilleVersMere.size} parcelles filles\n`);
                } catch (err) {
                    console.log(`   ⚠️  Erreur chargement DFI: ${err.message}\n`);
                }
                
                let countViaFilles = 0;
                let countViaMere = 0;
                
                for (const tx of transactionsSansCoords) {
                    let coords = parcelleCoords.get(tx.id_parcelle);
                    
                    if (!coords) {
                        // Extraire section et numéro de la parcelle (format: 400260000A0715 → A715)
                        const match = tx.id_parcelle.match(/\d{5}000([A-Z]+)(\d+)/);
                        if (match) {
                            const section = match[1];
                            const numero = String(parseInt(match[2], 10));
                            const parcelleFormat = `${section}${numero}`;
                            const codeCommune = tx.id_parcelle.substring(0, 5);
                            
                            // STRATÉGIE 1 : Si c'est une parcelle MÈRE, chercher via ses FILLES
                            const parcellesFilles = dfiMereVersFilles.get(parcelleFormat) || [];
                            if (parcellesFilles.length > 0) {
                                const coordsFilles = [];
                                
                                for (const filleDFI of parcellesFilles) {
                                    const matchFille = filleDFI.match(/^([A-Z]+)(\d+)$/);
                                    if (matchFille) {
                                        const sectionFille = matchFille[1];
                                        const numeroFille = matchFille[2].padStart(4, '0');
                                        const parcelleFilleId = `${codeCommune}000${sectionFille}${numeroFille}`;
                                        
                                        const coordFille = parcelleCoords.get(parcelleFilleId);
                                        if (coordFille && coordFille.latitude && coordFille.longitude) {
                                            coordsFilles.push(coordFille);
                                        }
                                    }
                                }
                                
                                // Calculer le centroïde moyen des parcelles filles
                                if (coordsFilles.length > 0) {
                                    const latMoyenne = coordsFilles.reduce((sum, c) => sum + c.latitude, 0) / coordsFilles.length;
                                    const lonMoyenne = coordsFilles.reduce((sum, c) => sum + c.longitude, 0) / coordsFilles.length;
                                    coords = {
                                        latitude: latMoyenne,
                                        longitude: lonMoyenne
                                    };
                                    countViaFilles++;
                                }
                            }
                            
                            // STRATÉGIE 2 : Si c'est une parcelle FILLE, chercher via sa MÈRE
                            if (!coords) {
                                const parcelleMere = dfiFilleVersMere.get(parcelleFormat);
                                if (parcelleMere) {
                                    const matchMere = parcelleMere.match(/^([A-Z]+)(\d+)$/);
                                    if (matchMere) {
                                        const sectionMere = matchMere[1];
                                        const numeroMere = matchMere[2].padStart(4, '0');
                                        const parcelleMereId = `${codeCommune}000${sectionMere}${numeroMere}`;
                                        
                                        const coordMere = parcelleCoords.get(parcelleMereId);
                                        if (coordMere && coordMere.latitude && coordMere.longitude) {
                                            coords = coordMere;
                                            countViaMere++;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    if (coords && coords.latitude && coords.longitude) {
                        updateStmt.run(coords.latitude, coords.longitude, tx.id_parcelle);
                        countUpdated++;
                    } else {
                        countNotFound++;
                    }
                    
                    if ((countUpdated + countNotFound) % 10000 === 0) {
                        process.stdout.write(`   ${countUpdated + countNotFound}/${transactionsSansCoords.length} vérifiées...\r`);
                    }
                }
                
                console.log(`\n   ✅ ${countUpdated} transactions enrichies avec coordonnées`);
                console.log(`      - Directement depuis parcelle.csv: ${countUpdated - countViaFilles - countViaMere}`);
                console.log(`      - Via parcelles filles (mère → filles): ${countViaFilles}`);
                console.log(`      - Via parcelle mère (fille → mère): ${countViaMere}`);
                console.log(`   ${countNotFound} parcelles non trouvées\n`);
                
                resolve();
            })
            .on('error', reject);
    });
}

// =====================================
// FONCTION : SCANNER DÉPARTEMENTS PA
// =====================================
/**
 * Scanne le fichier PA pour identifier les départements concernés
 * Retourne un Array de codes départements (ex: ["40", "33", "64"])
 */
async function scannerDepartementsPA() {
    console.log('🔍 PHASE 0 : Scanner les départements présents dans le fichier PA...\n');
    
    const departementsSet = new Set();
    
    // Détecter le séparateur du fichier PA
    const separateurPA = detecterSeparateur(LISTE_PA_FILE);
    console.log(`   🔍 Séparateur PA détecté: "${separateurPA}"`);
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(LISTE_PA_FILE)
            .pipe(csv({ separator: separateurPA, skipLinesWithError: true }))
            .on('data', (row) => {
                const comm = row.COMM;
                if (comm && comm.length >= 2) {
                    // Extraire le code département (2 premiers caractères)
                    const dept = comm.substring(0, 2);
                    departementsSet.add(dept);
                }
            })
            .on('end', () => {
                const departements = Array.from(departementsSet).sort();
                console.log(`\n   ✅ ${departements.length} département(s) identifié(s) : ${departements.join(', ')}`);
                console.log(`   💾 Espace disque économisé : ~${Math.round(45 * (1 - departements.length / 100))} GB\n`);
                resolve(departements);
            })
            .on('error', (err) => {
                reject(err);
            });
    });
}

// Fonction pour détecter automatiquement le séparateur d'un fichier CSV
function detecterSeparateur(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
        fs.closeSync(fd);
        
        // Gérer le BOM UTF-8 si présent (EF BB BF)
        let startOffset = 0;
        if (bytesRead >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
            startOffset = 3;
        }
        
        const firstLine = buffer.toString('utf8', startOffset, bytesRead).split('\n')[0];

        if (!firstLine || firstLine.trim().length === 0) {
            return ',';
        }
        
        // Vérifier si la première ligne contient des guillemets (CSV avec guillemets)
        const hasQuotes = firstLine.includes('"');
        
        const countPipe = (firstLine.match(/\|/g) || []).length;
        const countComma = (firstLine.match(/,/g) || []).length;
        const countSemicolon = (firstLine.match(/;/g) || []).length;
        
        // Si on a beaucoup de virgules mais que tout est dans une seule "colonne", c'est peut-être un problème
        // Vérifier si la ligne contient vraiment plusieurs colonnes séparées
        const partsComma = firstLine.split(',');
        const partsSemicolon = firstLine.split(';');
        const partsPipe = firstLine.split('|');
        
        // Si on a des guillemets et beaucoup de virgules, mais peu de colonnes réelles, c'est peut-être mal formaté
        if (hasQuotes && countComma > 20 && partsComma.length < 5) {
            // Probablement un problème de format, essayer quand même la virgule
            return ',';
        }
        
        if (countComma > countPipe && countComma > countSemicolon && countComma > 5 && partsComma.length > 5) {
            return ',';
        }
        if (countPipe > countComma && countPipe > countSemicolon && countPipe > 5 && partsPipe.length > 5) {
            return '|';
        }
        if (countSemicolon > countComma && countSemicolon > countPipe && countSemicolon > 5 && partsSemicolon.length > 5) {
            return ';';
        }
        
        // Fallback : utiliser celui qui donne le plus de colonnes
        if (partsComma.length > partsSemicolon.length && partsComma.length > partsPipe.length) {
            return ',';
        }
        if (partsPipe.length > partsComma.length && partsPipe.length > partsSemicolon.length) {
        return '|';
        }
        if (partsSemicolon.length > partsComma.length && partsSemicolon.length > partsPipe.length) {
            return ';';
        }
        
        return ','; // Default to comma for normalized files
    } catch (err) {
        console.log(`   ⚠️  Erreur détection séparateur, utilisation par défaut: ,`);
        return ',';
    }
}

// Fonction pour détecter le séparateur du fichier PA (peut être ; ou ,)
function detecterSeparateurPA(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
        fs.closeSync(fd);
        const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0];

        if (!firstLine || firstLine.trim().length === 0) {
            return ';';
        }
        const countSemicolon = (firstLine.match(/;/g) || []).length;
        const countComma = (firstLine.match(/,/g) || []).length;
        
        // Les fichiers PA utilisent généralement le point-virgule
        if (countSemicolon > countComma && countSemicolon > 5) {
            return ';';
        }
        if (countComma > countSemicolon && countComma > 5) {
            return ',';
        }
        return ';'; // Default to semicolon for PA files
    } catch (err) {
        console.log(`   ⚠️  Erreur détection séparateur PA, utilisation par défaut: ;`);
        return ';';
    }
}

// 🧹 Fonction simple : enlever tous les " du fichier
function nettoyerGuillemetsDVF(filePath) {
    return new Promise((resolve, reject) => {
        console.log(`      🧹 Nettoyage des guillemets...`);
        
        const readline = require('readline');
        const tempFile = filePath + '.tmp';
        const writeStream = fs.createWriteStream(tempFile);
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });
        
        let count = 0;
        
        rl.on('line', (line) => {
            // Remplacer " par rien
            const cleanedLine = line.replace(/"/g, '');
            writeStream.write(cleanedLine + '\n');
            count++;
        });
        
        rl.on('close', () => {
            writeStream.end();
            
            writeStream.on('finish', () => {
                // Remplacer l'original
                fs.unlinkSync(filePath);
                fs.renameSync(tempFile, filePath);
                
                console.log(`      ✅ ${count.toLocaleString()} lignes nettoyées`);
                resolve();
            });
            
            writeStream.on('error', reject);
        });
        
        rl.on('error', reject);
    });
}

// Fonction pour charger tous les CSV depuis dvf_data/
// departementFiltre: code département à charger (ex: "40"), ou null pour tous
function chargerTousLesCSV(db, insertStmt, departementFiltre = null) {
    return new Promise((resolve, reject) => {
        const dvfDir = path.join(__dirname, '..', 'dvf_data');
        if (!fs.existsSync(dvfDir)) {
            console.log('   ❌ Dossier dvf_data non trouvé !\n');
            reject(new Error('Dossier dvf_data non trouvé'));
            return;
        }
        
        const fichiers = fs.readdirSync(dvfDir)
            .filter(f => {
                // FILTRE DÉPARTEMENT 40 : Accepter les fichiers DVF complets (dvf_YYYY.csv)
                // Le filtrage par département se fera lors de l'insertion via code_departement
                return f.startsWith('dvf_') && f.endsWith('.csv');
            })
            .map(f => {
                // Extraire l'année du nom de fichier (format: dvf_2014.csv)
                const year = parseInt(f.match(/dvf_(\d{4})/)?.[1] || '0');
                
                return {
                    path: path.join(dvfDir, f),
                    name: f,
                    isGz: false,
                    year: year
                };
            })
            .filter(f => f.year >= 2014 && f.year <= 2025) // 2014-2025
            .sort((a, b) => a.year - b.year); // Trier par année croissante
        
        if (fichiers.length === 0) {
            console.log('   ❌ Aucun fichier CSV trouvé (2014-2025)\n');
            reject(new Error('Aucun fichier CSV trouvé'));
            return;
        }
        
        console.log(`   📂 ${fichiers.length} fichier(s) CSV trouvé(s)\n`);
        
        let totalInserted = 0;
        
        // Traiter les fichiers SÉQUENTIELLEMENT (un par un) pour éviter les blocages
        async function traiterFichierSequentiel(index) {
            if (index >= fichiers.length) {
                resolve(totalInserted);
                return;
            }
            
            const { path: filePath, name, year } = fichiers[index];
            console.log(`   📄 Traitement ${index + 1}/${fichiers.length} : ${name} (${year})...`);
            
            // 🧹 Nettoyer les guillemets (DVF 2021+)
            try {
                await nettoyerGuillemetsDVF(filePath);
            } catch (err) {
                console.error(`      ❌ Erreur nettoyage guillemets: ${err.message}`);
            }
            
            console.log(`      🔍 DEBUG: Mémoire au démarrage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
            
            // 🔥 NOUVELLE SOLUTION OOM : Utiliser le DISQUE, pas la RAM
            // PROBLÈME IDENTIFIÉ:
            // - CREATE TEMP TABLE = stockage RAM → OOM sur 4.6M lignes
            // - CREATE INDEX sur 4.6M lignes = trop lourd
            // 
            // SOLUTION:
            // 1. Table NORMALE sur disque (pas TEMP)
            // 2. Créer INDEX sur table VIDE (rapide)
            // 3. Insérer avec index déjà en place
            // 4. Surveiller taille DB
            db.exec(`
            DROP TABLE IF EXISTS temp_csv_file;
            CREATE TABLE temp_csv_file (
                id_parcelle TEXT,
                id_mutation TEXT,
                code_departement TEXT,
                valeur_fonciere REAL,
                surface_totale REAL,
                surface_reelle_bati REAL,
                date_mutation TEXT,
                latitude REAL,
                longitude REAL,
                code_commune TEXT,
                section_cadastrale TEXT,
                parcelle_suffixe TEXT,
                nom_commune TEXT
            );
            `);
            
            // Créer l'index sur table VIDE (instantané)
            console.log(`      📊 Création index sur table vide...`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_temp_dept ON temp_csv_file(code_departement)`);
            const dbSizeAfterIndex = getDbSizeMB(DB_FILE);
            console.log(`      ✅ Index créé - Taille DB: ${dbSizeAfterIndex} MB`);
            
            // INSERT simple (INSERT OR IGNORE pour éviter erreur, mais on garde les doublons pour GROUP BY)
            const insertTempFile = db.prepare(`
                INSERT INTO temp_csv_file (
                    id_parcelle, id_mutation, code_departement,
                    valeur_fonciere, surface_totale, surface_reelle_bati,
                    date_mutation, latitude, longitude,
                    code_commune, section_cadastrale, parcelle_suffixe, nom_commune
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            // Batch transaction pour performance (comme script DPE)
            let batch = [];
            const BATCH_SIZE = 5000;
            const insertBatch = db.transaction((rows) => {
                for (const row of rows) {
                    try {
                        insertTempFile.run(...row);
                    } catch (e) {
                        // Ignorer erreurs
                    }
                }
            });
            
            // Réinitialiser le mapping des colonnes pour ce fichier
            let columnMapping = null;
            
            let count = 0;
            let totalRows = 0;
            let lastLog = Date.now();
            let skippedNoSection = 0;
            let skippedConstructionFailed = 0;
            let skippedNoIdParcelle = 0;
            let skippedValeurFonciereZero = 0;
            let skippedNoSectionExtracted = 0;
            let firstRowColumns = null;
            let firstRowData = null;
            
            // Fonction helper pour mapper les colonnes avec des noms alternatifs
            function getColumnValue(row, possibleNames) {
                if (!columnMapping) {
                    // Créer le mapping une seule fois lors de la première ligne de ce fichier
                    columnMapping = {};
                    const allColumns = Object.keys(row);
                    
                    // Mapping des colonnes possibles
                    const columnMappings = {
                        'id_mutation': ['id_mutation', 'no_disposition', 'numero_disposition'],
                        'date_mutation': ['date_mutation'],
                        'valeur_fonciere': ['valeur_fonciere', 'valeur_fonciere_globale'],
                        'code_departement': ['code_departement', 'dep'],
                        'code_commune': ['code_commune', 'comm', 'code_commune_insee'],
                        'nom_commune': ['nom_commune', 'commune'],
                        'id_parcelle': ['id_parcelle', 'identifiant_local', 'parcelle'],
                        'section': ['section', 'section_cadastrale'],
                        'numero_plan': ['numero_plan', 'no_plan', 'plan'],
                        'surface_terrain': ['surface_terrain', 'surface_terrain_total'],
                        'surface_reelle_bati': ['surface_reelle_bati', 'surface_bati'],
                        'type_local': ['type_local', 'type_local_dvf']
                    };
                    
                    // Créer le mapping inverse (nom fichier -> nom normalisé)
                    for (const [normalizedName, possibleNames] of Object.entries(columnMappings)) {
                        for (const possibleName of possibleNames) {
                            const found = allColumns.find(col => 
                                col.toLowerCase() === possibleName.toLowerCase() ||
                                col.toLowerCase().includes(possibleName.toLowerCase())
                            );
                            if (found) {
                                columnMapping[normalizedName] = found;
                                break;
                            }
                        }
                    }
                }
                
                // Retourner la valeur en utilisant le mapping
                for (const name of possibleNames) {
                    const mappedName = columnMapping[name];
                    if (mappedName && row[mappedName] !== undefined && row[mappedName] !== '') {
                        return row[mappedName];
                    }
                    // Essayer aussi directement
                    if (row[name] !== undefined && row[name] !== '') {
                        return row[name];
                    }
                }
                return '';
            }
            
            // 📝 Note : Les fichiers DVF sont maintenant pré-nettoyés par create-terrains-batir-complet.js
            // (enlève les guillemets des DVF 2021+)
            
            const separateurDVF = detecterSeparateur(filePath);
            console.log(`\n      🔧 Séparateur détecté: "${separateurDVF}"\n`);
            
            fs.createReadStream(filePath)
                .pipe(csv({ separator: separateurDVF, skipLinesWithError: true }))
                .on('data', (row) => {
                    totalRows++;
                    
                    // Afficher les colonnes de la première ligne pour debug
                    if (totalRows === 1 && !firstRowColumns) {
                        firstRowColumns = Object.keys(row);
                        firstRowData = row;
                        console.log(`      📋 Colonnes détectées (${firstRowColumns.length}): ${firstRowColumns.slice(0, 15).join(', ')}...`);
                        
                        // Créer le mapping des colonnes
                        getColumnValue(row, ['id_mutation']); // Initialiser le mapping
                        
                        // Vérifier si le parsing est correct
                        if (firstRowColumns.length === 1) {
                            const firstColName = firstRowColumns[0];
                            const firstColValue = row[firstColName];
                            console.log(`      ⚠️  PROBLÈME : Une seule colonne détectée !`);
                            console.log(`      ⚠️  Nom colonne: "${firstColName.substring(0, 100)}"`);
                            console.log(`      ⚠️  Valeur (100 premiers caractères): "${(firstColValue || '').substring(0, 100)}"`);
                            if (firstColValue && firstColValue.includes(',')) {
                                const manualParts = firstColValue.split(',');
                                console.log(`      💡 Si séparateur = ",", on aurait ${manualParts.length} colonnes`);
                            }
                        } else {
                            // Afficher le mapping créé
                            const mappedCols = Object.entries(columnMapping || {}).slice(0, 5);
                            console.log(`      🔍 Mapping colonnes (exemples): ${mappedCols.map(([k, v]) => `${k}->${v}`).join(', ')}...`);
                            console.log(`      🔍 Exemple première ligne: id_parcelle="${getColumnValue(row, ['id_parcelle'])}", valeur_fonciere="${getColumnValue(row, ['valeur_fonciere'])}", code_departement="${getColumnValue(row, ['code_departement'])}"`);
                        }
                    }
                    
                    // Format DVF uniformisé : tous les fichiers sont maintenant normalisés
                    // Colonnes en minuscules avec underscores (ex: "code_departement", "valeur_fonciere")
                    
                    // Utiliser la fonction helper pour mapper les colonnes
                    const codeDept = getColumnValue(row, ['code_departement']) || '';
                    
                    // FILTRE DÉPARTEMENT 40 : Ne traiter que les lignes du département 40
                    if (departementFiltre && codeDept !== departementFiltre) {
                        return; // Skip les lignes d'autres départements
                    }
                    
                    const valeurFonciereStr = getColumnValue(row, ['valeur_fonciere']) || '0';
                    const surfaceTerrain = parseFloat(getColumnValue(row, ['surface_terrain']) || 0);
                    const surfaceBati = parseFloat(getColumnValue(row, ['surface_reelle_bati']) || 0);
                    const typeLocal = getColumnValue(row, ['type_local']) || '';
                    const dateMutationRaw = getColumnValue(row, ['date_mutation']) || '';
                    const idMutationRaw = getColumnValue(row, ['id_mutation']) || '';
                    
                    // Construire id_parcelle si elle n'existe pas
                    let idParcelle = getColumnValue(row, ['id_parcelle']) || '';
                    if (!idParcelle) {
                        // Construire depuis les colonnes normalisées
                        const deptRaw = (getColumnValue(row, ['code_departement']) || '').trim();
                        const commRaw = (getColumnValue(row, ['code_commune']) || '').trim();
                        const prefixeSectionRaw = (getColumnValue(row, ['prefixe_section', 'prefixe_de_section']) || '').trim();
                        const sectionRaw = (getColumnValue(row, ['section']) || '').trim();
                        const noPlanRaw = (getColumnValue(row, ['numero_plan', 'no_plan']) || '').trim();
                        
                        // Vérifier que toutes les valeurs nécessaires sont présentes AVANT le padding
                        if (deptRaw && deptRaw.length >= 1 && commRaw && commRaw.length >= 1 && sectionRaw && noPlanRaw && noPlanRaw.length >= 1) {
                            const dept = deptRaw.padStart(2, '0');
                            const comm = commRaw.padStart(3, '0');
                        const prefixeSection = prefixeSectionRaw ? prefixeSectionRaw.padStart(3, '0') : '000';
                            const noPlan = noPlanRaw.padStart(4, '0');
                        
                            if (dept.length === 2 && comm.length === 3 && noPlan.length === 4) {
                            // Normaliser la section (1-2 caractères, peut être alphanumérique)
                            let sectionNorm = sectionRaw.toUpperCase();
                            if (sectionNorm.length === 1) {
                                sectionNorm = '0' + sectionNorm;
                            } else if (sectionNorm.length === 0) {
                                    skippedNoSection++;
                                return; // Skip si pas de section
                            }
                            // S'assurer que la section fait 2 caractères
                            sectionNorm = sectionNorm.padStart(2, '0').substring(0, 2);
                            idParcelle = dept + comm + prefixeSection + sectionNorm + noPlan;
                            } else {
                                skippedConstructionFailed++;
                                return;
                            }
                        } else {
                            skippedConstructionFailed++;
                            return;
                        }
                    }
                    
                    if (!idParcelle || idParcelle.length < 10) {
                        skippedNoIdParcelle++;
                        return;
                    }
                    
                    // Filtre département si spécifié
                    if (departementFiltre && codeDept !== departementFiltre) {
                        return; // Skip si pas le bon département
                    }
                    
                    // Parser valeur foncière (format français avec virgule)
                    const valeurFonciere = parseFloat(valeurFonciereStr.toString().replace(/\s/g, '').replace(',', '.'));
                    
                    if (valeurFonciere <= 0) {
                        skippedValeurFonciereZero++;
                        return;
                    }
                    
                    const section = extraireSection(idParcelle);
                    if (!section) {
                        skippedNoSectionExtracted++;
                        return; // Skip si on ne peut pas extraire la section
                    }
                    
                    const prixM2 = surfaceTerrain > 0 ? valeurFonciere / surfaceTerrain : 0;
                    
                    // Date mutation (format unifié : dd/mm/yyyy)
                    let dateMutation = dateMutationRaw;
                    if (dateMutation && dateMutation.includes('/')) {
                        const parts = dateMutation.split('/');
                        if (parts.length === 3) {
                            dateMutation = `${parts[2]}-${parts[1]}-${parts[0]}`; // yyyy-mm-dd
                        }
                    }
                    
                    // ID mutation
                    let idMutation = idMutationRaw || '';
                    if (!idMutation) {
                        // Créer un identifiant basé sur date + prix + section cadastrale
                        const dateForId = dateMutation || '';
                        const prixForId = Math.round(valeurFonciere);
                        const sectionForId = section || '';
                        const dateNorm = dateForId.substring(0, 10); // yyyy-mm-dd
                        
                        if (!dateNorm || dateNorm.length < 10) {
                            idMutation = `DVF_UNKNOWN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        } else {
                            const parcellePrefix = idParcelle.substring(0, 12);
                            idMutation = `DVF_${dateNorm}_${prixForId}_${sectionForId}_${parcellePrefix}`.replace(/[^A-Z0-9_-]/g, '');
                        }
                    }
                    
                    // Adresse (format normalisé)
                    const adresseNomVoie = (row.adresse_nom_voie || row.voie || '').trim();
                    const adresseNumero = (row.adresse_numero || row.no_voie || '').trim();
                    const adresseSuffixe = (row.adresse_suffixe || row.btq || '').trim();
                    const nomCommune = getColumnValue(row, ['nom_commune', 'commune']) || '';
                    
                    // Coordonnées GPS depuis la DVF (colonnes lat/lon ou latitude/longitude)
                    const latitude = parseFloat(row.lat || row.latitude || 0) || null;
                    const longitude = parseFloat(row.lon || row.longitude || 0) || null;
                    
                    // Précalculer le suffixe parcelle et code commune (optimisation)
                    const parcelleSuffixe = idParcelle.length >= 6 ? idParcelle.substring(5) : null;
                    const codeCommune = idParcelle.length >= 5 ? idParcelle.substring(0, 5) : null;
                    
                    // DEBUG: Afficher les 3 premières lignes pour vérifier code_departement
                    if (count < 3) {
                        console.log(`\n      🔍 DEBUG ligne ${count + 1}: codeDept="${codeDept}", idParcelle="${idParcelle}", valeurFonciere="${valeurFonciere}"`);
                    }
                    
                    try {
                        // Ajouter au batch (comme script DPE)
                        batch.push([
                            idParcelle,
                            idMutation,
                            codeDept,
                            valeurFonciere,
                            surfaceTerrain,
                            surfaceBati,
                            dateMutation,
                            latitude,
                            longitude,
                            codeCommune,
                            section,
                            parcelleSuffixe,
                            nomCommune || null  // Ajouter nom_commune (peut être vide)
                        ]);
                        count++;
                        
                        // Insérer par batch de 5000 (comme script DPE)
                        if (batch.length >= BATCH_SIZE) {
                            insertBatch(batch);
                            batch = [];
                        }
                        
                        // Log de progression toutes les 10 secondes
                        if (Date.now() - lastLog > 10000) {
                            console.log(`      → ${count} lignes traitées...`);
                            lastLog = Date.now();
                        }
                    } catch (err) {
                        // Ignorer les doublons ou erreurs
                    }
                })
                .on('end', () => {
                    console.log(`      📊 Statistiques pour ${name}:`);
                    console.log(`         - Lignes lues: ${totalRows}`);
                    console.log(`         - Transactions insérées: ${count}`);
                    console.log(`         - Ignorées (pas de section): ${skippedNoSection}`);
                    console.log(`         - Ignorées (construction id_parcelle échouée): ${skippedConstructionFailed}`);
                    console.log(`         - Ignorées (pas d'id_parcelle valide): ${skippedNoIdParcelle}`);
                    console.log(`         - Ignorées (valeur foncière <= 0): ${skippedValeurFonciereZero}`);
                    console.log(`         - Ignorées (section non extraite): ${skippedNoSectionExtracted}`);
                    console.log(`      ✅ ${count} transactions insérées depuis ${name}`);
                    totalInserted += count;
                    
                    // Insérer le dernier batch (comme script DPE)
                    if (batch.length > 0) {
                        insertBatch(batch);
                        batch = [];
                    }
                    
                    const avantAgreg = db.prepare('SELECT COUNT(*) as c FROM temp_csv_file').get().c;
                    const dbSizeAfterInsert = getDbSizeMB(DB_FILE);
                    console.log(`      ⚡ Agrégation de ${avantAgreg.toLocaleString()} lignes par département...`);
                    console.log(`      🔍 DEBUG: Mémoire: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB, Taille DB: ${dbSizeAfterInsert} MB`);
                    
                    // DEBUG: Afficher les départements uniques présents
                    const deptsPresents = db.prepare(`
                        SELECT code_departement, COUNT(*) as nb 
                        FROM temp_csv_file 
                        WHERE code_departement IS NOT NULL 
                        GROUP BY code_departement 
                        ORDER BY code_departement
                        LIMIT 10
                    `).all();
                    console.log(`      🔍 DEBUG: Premiers départements présents:`, deptsPresents.map(d => `${d.code_departement}(${d.nb})`).join(', '));
                    
                    // DEBUG: Vérifier une ligne exemple
                    const exempleRow = db.prepare('SELECT * FROM temp_csv_file LIMIT 1').get();
                    console.log(`      🔍 DEBUG: Exemple ligne - code_dept="${exempleRow?.code_departement}", id_parcelle="${exempleRow?.id_parcelle}"`);
                    
                    // Liste fixe des départements (éviter SELECT DISTINCT qui cause OOM)
                    const tousLesDepartements = [
                        '01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19',
                        '21','22','23','24','25','26','27','28','29','2A','2B','30','31','32','33','34','35','36','37','38','39',
                        '40','41','42','43','44','45','46','47','48','49','50','51','52','53','54','55','56','57','58','59',
                        '60','61','62','63','64','65','66','67','68','69','70','71','72','73','74','75','76','77','78','79',
                        '80','81','82','83','84','85','86','87','88','89','90','91','92','93','94','95',
                        '971','972','973','974','976'
                    ];
                    
                    // Créer table agrégée vide (table NORMALE, pas TEMP = sur DISQUE)
                    db.exec(`
                    DROP TABLE IF EXISTS temp_agregated;
                    CREATE TABLE temp_agregated (
                        id_parcelle TEXT,
                        id_mutation TEXT,
                        valeur_fonciere REAL,
                        surface_totale REAL,
                        surface_reelle_bati REAL,
                        date_mutation TEXT,
                        latitude REAL,
                        longitude REAL,
                        code_departement TEXT,
                        code_commune TEXT,
                        section_cadastrale TEXT,
                        parcelle_suffixe TEXT,
                        nom_commune TEXT
                    );
                    `);

                    // Agréger département par département (101 petits GROUP BY au lieu d'1 énorme)
                    const insertAgrege = db.prepare(`
                        INSERT INTO temp_agregated
                        SELECT 
                            id_parcelle,
                            id_mutation,
                            MAX(valeur_fonciere) as valeur_fonciere,
                            MAX(surface_totale) as surface_totale,
                            MAX(surface_reelle_bati) as surface_reelle_bati,
                            MIN(date_mutation) as date_mutation,
                            AVG(latitude) as latitude,
                            AVG(longitude) as longitude,
                            code_departement,
                            MAX(code_commune) as code_commune,
                            MAX(section_cadastrale) as section_cadastrale,
                            MAX(parcelle_suffixe) as parcelle_suffixe,
                            MAX(nom_commune) as nom_commune
                        FROM temp_csv_file
                        WHERE id_parcelle IS NOT NULL
                          AND code_departement = ?
                        GROUP BY id_parcelle, id_mutation, code_departement
                    `);
                    
                    let deptIdx = 0;
                    for (const dept of tousLesDepartements) {
                        deptIdx++;
                        if (deptIdx % 10 === 0 || deptIdx === tousLesDepartements.length) {
                            const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                            process.stdout.write(`\r      → Agrégation: ${deptIdx}/${tousLesDepartements.length} depts (Mem: ${memMB} MB)...`);
                        }
                        try {
                            // Compter combien de lignes existent pour ce département
                            const countAvant = db.prepare('SELECT COUNT(*) as c FROM temp_csv_file WHERE code_departement = ?').get(dept);
                            
                            const result = insertAgrege.run(dept);
                            
                            if (deptIdx <= 5 || (result.changes > 0 && deptIdx <= 15)) {
                                console.log(`\n      🔍 DEBUG: Dept ${dept} → ${countAvant.c} lignes source → ${result.changes} lignes agrégées`);
                            }
                        } catch (error) {
                            console.error(`\n      ❌ ERREUR au département ${dept} (${deptIdx}/${tousLesDepartements.length}):`, error.message);
                            throw error;
                        }
                    }
                    console.log('');
                    
                    const apres = db.prepare('SELECT COUNT(*) as c FROM temp_agregated').get().c;
                    const reduction = Math.round((1 - apres/avantAgreg) * 100);
                    const dbSizeAfterAgreg = getDbSizeMB(DB_FILE);
                    console.log(`      📉 Réduction: ${avantAgreg.toLocaleString()} → ${apres.toLocaleString()} lignes (${reduction}%)`);
                    console.log(`      🔍 DEBUG: Mémoire: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB, Taille DB: ${dbSizeAfterAgreg} MB`);
                    
                    // Fusionner dans terrains_batir_temp
                    console.log(`      ⬆️  Fusion dans terrains_batir_temp...`);
    db.exec(`
        INSERT INTO terrains_batir_temp (
                        id_parcelle, id_mutation, valeur_fonciere, surface_totale, surface_reelle_bati,
                        date_mutation, latitude, longitude,
                        code_departement, code_commune, section_cadastrale, parcelle_suffixe, nom_commune
        )
        SELECT 
                        id_parcelle, id_mutation, valeur_fonciere, surface_totale, surface_reelle_bati,
                        date_mutation, latitude, longitude,
                        code_departement, code_commune, section_cadastrale, parcelle_suffixe, nom_commune
                    FROM temp_agregated;
                    `);
                    const dbSizeAfterFusion = getDbSizeMB(DB_FILE);
                    console.log(`      ✅ Fusion terminée - Taille DB: ${dbSizeAfterFusion} MB`);
                    console.log(`      🔍 DEBUG: Mémoire: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
                    
                    // Nettoyer et RÉCUPÉRER l'espace disque
                    console.log(`      🧹 Nettoyage des tables temporaires...`);
                    db.exec(`DROP TABLE temp_csv_file`);
                    db.exec(`DROP TABLE temp_agregated`);
                    const dbSizeBeforeVacuum = getDbSizeMB(DB_FILE);
                    console.log(`      🔄 VACUUM pour récupérer l'espace disque... (DB: ${dbSizeBeforeVacuum} MB)`);
                    db.exec(`VACUUM`);
                    const dbSizeAfterVacuum = getDbSizeMB(DB_FILE);
                    const espaceLibereMB = dbSizeBeforeVacuum - dbSizeAfterVacuum;
                    console.log(`      ✅ VACUUM terminé - Taille DB: ${dbSizeAfterVacuum} MB (${espaceLibereMB} MB libérés)`);
                    
                    const total = db.prepare('SELECT COUNT(*) as c FROM terrains_batir_temp').get().c;
                    console.log(`      ✅ Total dans terrains_batir_temp: ${total.toLocaleString()} lignes\n`);
                    
                    // Passer au fichier suivant
                    traiterFichierSequentiel(index + 1);
                })
                .on('error', (err) => {
                    console.error(`      ❌ Erreur sur ${name}: ${err.message}\n`);
                    // Continuer quand même avec le fichier suivant
                    traiterFichierSequentiel(index + 1);
                });
        }
        
        // Démarrer le traitement séquentiel avec le premier fichier
        traiterFichierSequentiel(0);
    });
}

// ÉTAPE 1 : Charger les DVF DIRECTEMENT dans terrains_batir_temp
// 🔥 OPTIMISATION RADICALE : Plus de table intermédiaire dvf_temp_indexed
// Économie : ~14 GB d'espace disque temporaire
console.log('📊 ÉTAPE 1 : Chargement DVF directement dans la table de travail...\n');
console.log('   🔥 Optimisation : Pas de table temporaire intermédiaire (économie ~14 GB)\n');

// Préparer l'insertion DIRECTE dans terrains_batir_temp
const insertDvfTemp = db.prepare(`
    INSERT INTO terrains_batir_temp (
        id_parcelle, id_mutation, valeur_fonciere, surface_totale, surface_reelle_bati,
        date_mutation, code_departement, code_commune, section_cadastrale,
        parcelle_suffixe, nom_commune, prix_m2, est_terrain_viabilise, id_pa
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)
`);

chargerTousLesCSV(db, insertDvfTemp, DEPARTEMENT_FILTRE).then((totalInserted) => {
    console.log(`✅ ${totalInserted.toLocaleString()} transactions DVF chargées dans terrains_batir_temp\n`);
    
    // ⚡ Données déjà dans terrains_batir_temp, on passe directement à l'indexation
    // Désactiver temporairement le WAL pendant la création des index pour éviter les fichiers WAL trop gros
    console.log('   🔧 Désactivation temporaire du WAL pour la création des index...');
    db.pragma('journal_mode = DELETE');
    
    // ÉTAPE 2 : Créer les index sur terrains_batir_temp
    // ⚠️ CRITIQUE : Garder journal_mode=DELETE pendant TOUTE la création des index
    // Sinon les fichiers WAL temporaires dépassent l'espace disque disponible
    console.log('⚡ ÉTAPE 2 : Création des index sur terrains_batir_temp...');
    console.log('   (5 index essentiels sur ~36M lignes, durée estimée : 6-12 min)');
    console.log('   ⚠️  Mode journal_mode=DELETE maintenu pour économiser l\'espace\n');
    
    const indexesTBT = [
        { name: 'idx_temp_departement', sql: 'CREATE INDEX idx_temp_departement ON terrains_batir_temp(code_departement)', desc: 'Filtre département (GROUP BY optimisé)' },
        { name: 'idx_temp_commune_section', sql: 'CREATE INDEX idx_temp_commune_section ON terrains_batir_temp(code_commune, section_cadastrale)', desc: 'Jointures parcelles mères' },
        { name: 'idx_temp_commune_section_suffixe', sql: 'CREATE INDEX idx_temp_commune_section_suffixe ON terrains_batir_temp(code_commune, section_cadastrale, parcelle_suffixe)', desc: 'Jointures parcelles filles' },
        { name: 'idx_temp_mutation', sql: 'CREATE INDEX idx_temp_mutation ON terrains_batir_temp(id_mutation)', desc: 'Agrégations par mutation' },
        { name: 'idx_temp_pa', sql: 'CREATE INDEX idx_temp_pa ON terrains_batir_temp(id_pa)', desc: 'Filtrage PA' }
    ];
    
    for (let i = 0; i < indexesTBT.length; i++) {
        const idx = indexesTBT[i];
        try {
            process.stdout.write(`   → ${i + 1}/${indexesTBT.length}: ${idx.name} (${idx.desc})...`);
            db.exec(idx.sql);
            process.stdout.write(` ✅\n`);
            
            // CHECKPOINT après chaque index pour libérer de l'espace
            if (i < indexesTBT.length - 1) {
                db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
            }
        } catch (err) {
            if (err.code === 'SQLITE_FULL') {
                console.error(`\n\n❌ Erreur : Espace disque insuffisant lors de la création de l'index ${idx.name} !`);
                console.error(`   La base fait actuellement ~26 GB + ${i} index créés.`);
                console.error(`   Tentez de libérer plus d'espace disque et relancez le script.\n`);
            }
            throw err;
        }
    }
    
    console.log('✅ Index créés sur terrains_batir_temp');
    console.log('   ⚠️  Mode journal_mode=DELETE maintenu pour tout le traitement PA/DVF\n');

    // ÉTAPE 3 : Créer vue agrégée par id_mutation
    // ✅ Déduplication déjà faite après chaque fichier CSV (voir ÉTAPE 1)
    // On a maintenant ~4-6M lignes au lieu de 36M
    console.log('📊 ÉTAPE 3 : Création vue agrégée par mutation...');
    console.log('   ℹ️  Déduplication déjà effectuée pendant le chargement CSV\n');
    
    // Matérialiser terrains_batir_deduplique (simple copie puisque déjà dédupliqué)
    console.log('   → Copie des données dédupliquées...');
    db.exec(`DROP VIEW IF EXISTS terrains_batir_deduplique`);
    db.exec(`DROP TABLE IF EXISTS terrains_batir_deduplique`);
    
    db.exec(`
    CREATE TEMP TABLE terrains_batir_deduplique AS
    SELECT 
        id_parcelle,
        id_mutation,
        valeur_fonciere,
        surface_totale,
        date_mutation,
        code_departement,
        nom_commune,
        section_cadastrale,
        code_commune
    FROM terrains_batir_temp
    WHERE id_parcelle IS NOT NULL
    `);
    
    console.log('   → Agrégation des mutations (beaucoup plus rapide maintenant)...');
    db.exec(`DROP VIEW IF EXISTS mutations_aggregees`);
    db.exec(`DROP TABLE IF EXISTS mutations_aggregees`);
    
    // Maintenant avec seulement ~4-6M lignes, l'agrégation est rapide
    db.exec(`
    CREATE TEMP TABLE mutations_aggregees AS
    SELECT 
        id_mutation,
        SUM(surface_totale) as surface_totale_aggregee,
        MAX(valeur_fonciere) as valeur_totale,
        MIN(date_mutation) as date_mutation,
        code_departement,
        MIN(nom_commune) as nom_commune,
        MIN(section_cadastrale) as section_cadastrale,
        MIN(code_commune) as code_commune
    FROM terrains_batir_deduplique
    GROUP BY id_mutation, code_departement
    `);
    
    console.log('   → Création index sur mutations_aggregees...');
    db.exec(`
    CREATE INDEX idx_mutations_agg_id ON mutations_aggregees(id_mutation);
    CREATE INDEX idx_mutations_agg_date ON mutations_aggregees(date_mutation);
    `);
    
    console.log('✅ Tables agrégées créées avec index\n');

    // ÉTAPE 4 : Charger les PA
    console.log('📊 ÉTAPE 4 : Chargement de la liste des PA...');
    
    // Vérifier que le fichier existe
    if (!fs.existsSync(LISTE_PA_FILE)) {
        console.log(`   ❌ Fichier PA non trouvé : ${LISTE_PA_FILE}\n`);
        console.log(`   💡 Vérifiez que le fichier a été téléchargé par le script complet.\n`);
        throw new Error(`Fichier PA non trouvé : ${LISTE_PA_FILE}`);
    }
    
    // Détecter le séparateur
    const separateurPA = detecterSeparateurPA(LISTE_PA_FILE);
    console.log(`   🔍 Séparateur détecté: "${separateurPA}"`);
    
    // Afficher les premières lignes pour debug
    const fileSize = fs.statSync(LISTE_PA_FILE).size;
    console.log(`   📏 Taille du fichier: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    
    const paList = [];
    let ligneCount = 0;
    let skippedNoNumPA = 0;
    let skippedNoDate = 0;
    let skippedNoSections = 0;
    let firstRowColumns = null;
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(LISTE_PA_FILE)
        .pipe(csv({ separator: separateurPA, skipLinesWithError: true }))
        .on('data', (row) => {
            ligneCount++;
            
            // Afficher les colonnes de la première ligne pour debug
            if (ligneCount === 1 && !firstRowColumns) {
                firstRowColumns = Object.keys(row);
                console.log(`   📋 Colonnes détectées (${firstRowColumns.length}): ${firstRowColumns.slice(0, 10).join(', ')}...`);
                // Afficher aussi un exemple de valeurs pour debug
                console.log(`   🔍 Exemple première ligne: NUM_PA="${row.NUM_PA}", DATE_REELLE_AUTORISATION="${row.DATE_REELLE_AUTORISATION}", COMM="${row.COMM}"`);
            }
            
            // Utiliser directement la première ligne comme en-tête (comme le script PC)
            // FILTRE DÉPARTEMENT 40 : Extraire le code département depuis le code commune
            const comm = row.COMM || '';
            const codeDept = comm.length >= 2 ? comm.substring(0, 2) : '';
            
            // Ne garder que les PA du département 40
            if (codeDept !== DEPARTEMENT_FILTRE) {
                return; // Skip les PA d'autres départements
            }
            
            const numPA = row.NUM_PA;
            const dateAuth = row.DATE_REELLE_AUTORISATION;
            const superficie = parseFloat(row.SUPERFICIE_TERRAIN || 0);
            const lieuDit = (row.ADR_LIEUDIT_TER || '').trim().toUpperCase();
            const adresseVoie = (row.ADR_LIBVOIE_TER || '').trim().toUpperCase();
            
            // Combiner lieu-dit et adresse pour la recherche
            const adresseCombinée = [lieuDit, adresseVoie].filter(a => a && a.length > 0).join(' ');
            
            if (!numPA) {
                skippedNoNumPA++;
                return;
            }
            if (!dateAuth) {
                skippedNoDate++;
                return;
            }
            
            // Extraire sections et parcelles
            const sections = new Set();
            const parcelles = [];
            
            const sec1 = row.SEC_CADASTRE1?.trim();
            const num1 = row.NUM_CADASTRE1?.trim();
            const sec2 = row.SEC_CADASTRE2?.trim();
            const num2 = row.NUM_CADASTRE2?.trim();
            const sec3 = row.SEC_CADASTRE3?.trim();
            const num3 = row.NUM_CADASTRE3?.trim();
            
            // Accepter les numéros avec ou sans "p" à la fin (ex: "72" ou "72p")
            if (sec1 && num1 && /^[A-Z]{1,3}$/.test(sec1) && /^\d+p?$/i.test(num1)) {
                sections.add(sec1);
                const parcelleId = normaliserParcelle(comm, sec1, num1);
                if (parcelleId) parcelles.push(parcelleId);
            }
            if (sec2 && num2 && /^[A-Z]{1,3}$/.test(sec2) && /^\d+p?$/i.test(num2)) {
                sections.add(sec2);
                const parcelleId = normaliserParcelle(comm, sec2, num2);
                if (parcelleId) parcelles.push(parcelleId);
            }
            if (sec3 && num3 && /^[A-Z]{1,3}$/.test(sec3) && /^\d+p?$/i.test(num3)) {
                sections.add(sec3);
                const parcelleId = normaliserParcelle(comm, sec3, num3);
                if (parcelleId) parcelles.push(parcelleId);
            }
            
            if (sections.size === 0) {
                skippedNoSections++;
                return;
            }
            
            if (sections.size > 0) {
                // Convertir date de "01/04/2022" vers "2022-04-01"
            let dateAuthFormatee = dateAuth;
            if (dateAuth && dateAuth.includes('/')) {
                const parts = dateAuth.split('/');
                if (parts.length === 3) {
                    dateAuthFormatee = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
            }
            
            // Normaliser le code commune (ajouter padding si nécessaire)
            const commNormalise = comm && comm.length < 5 ? comm.padStart(5, '0') : comm;
            
            paList.push({
                    numPA: numPA,
                    dateAuth: dateAuthFormatee,
                    comm: commNormalise,
                    superficie: superficie,
                    sections: Array.from(sections),
                    parcelles: parcelles,
                    lieuDit: lieuDit,
                    adresseVoie: adresseVoie,
                    adresseCombinée: adresseCombinée
                });
            }
        })
        .on('end', resolve)
        .on('error', reject);
    }).then(() => {
        console.log(`✅ ${paList.length} PA chargés\n`);
        
        // OPTIMISATION 5 : BATCH PROCESSING - Regrouper les PA par commune/section
        console.log('⚡ Optimisation : Regroupement des PA par commune/section...');
        const paByCommuneSection = new Map();
        for (const pa of paList) {
            for (const section of pa.sections) {
                const key = `${pa.comm}_${section}`;
                if (!paByCommuneSection.has(key)) {
                    paByCommuneSection.set(key, []);
                }
                paByCommuneSection.get(key).push(pa);
            }
        }
        console.log(`✅ ${paByCommuneSection.size} groupes commune/section créés\n`);
        
        // ========== ÉTAPE 4 : VERSION 3 - OPTIMISATION SQL RADICALE ==========
        // Au lieu de boucler sur chaque PA → on fait TOUT en SQL massivement
        // Gain estimé : ~10-30x plus rapide (de 2-5 minutes à 10-20 secondes)
        console.log('📊 ÉTAPE 5 : Association PA-DVF par SQL massif (V3)...\n');
        
        // SOUS-ÉTAPE 4.1 : Créer table temporaire des parcelles PA
        console.log('⚡ 4.1 - Explosion des parcelles PA...');
        db.exec(`
            DROP TABLE IF EXISTS pa_parcelles_temp;
            CREATE TEMP TABLE pa_parcelles_temp (
                num_pa TEXT,
                code_commune_dfi TEXT,
                code_commune_dvf TEXT,
                section TEXT,
                parcelle_normalisee TEXT,
                superficie REAL,
                date_auth TEXT
            );
        `);
        
        // Insérer toutes les parcelles PA en masse
        const insertPA = db.prepare(`INSERT INTO pa_parcelles_temp VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const insertManyPA = db.transaction(() => {
            for (const pa of paList) {
                if (!pa.parcelles || pa.parcelles.length === 0) continue;
                
                const codeCommuneDVF = String(pa.comm).padStart(5, '0');
                const codeCommuneDFI = codeCommuneDVF.substring(codeCommuneDVF.length - 3);
                
                for (const parcelle of pa.parcelles) {
                    const parcelleStr = String(parcelle).trim().toUpperCase();
                    // Extraire section + numéro : "40088000BL0056" → "BL0056" (avec padding)
                    // Format: codeCommune(5) + "000" + section(1-3) + numero(4)
                    const match = parcelleStr.match(/^\d{5}000([A-Z]{1,3})(\d{4})$/);
                    if (match) {
                        const [, section, numero] = match;
                        // Garder le numéro avec padding (4 chiffres)
                        const parcelleNormalisee = section + numero;
                        
                        for (const sect of pa.sections) {
                            insertPA.run(
                                pa.numPA,
                                codeCommuneDFI,
                                codeCommuneDVF,
                                sect,
                                parcelleNormalisee,
                                pa.superficie,
                                pa.dateAuth
                            );
                        }
                    } else {
                        // Format alternatif : essayer avec section de 1-2 caractères
                        const matchAlt = parcelleStr.match(/^\d{5}000([A-Z]{1,2})(\d+)$/);
                        if (matchAlt) {
                            const [, section, numero] = matchAlt;
                            // Padding du numéro sur 4 chiffres
                            const numeroPad = numero.padStart(4, '0');
                            const parcelleNormalisee = section + numeroPad;
                            
                            for (const sect of pa.sections) {
                                insertPA.run(
                                    pa.numPA,
                                    codeCommuneDFI,
                                    codeCommuneDVF,
                                    sect,
                                    parcelleNormalisee,
                                    pa.superficie,
                                    pa.dateAuth
                                );
                            }
                        }
                    }
                }
            }
        });
        insertManyPA();
        const nbPA = db.prepare(`SELECT COUNT(DISTINCT num_pa) as nb FROM pa_parcelles_temp`).get().nb;
        console.log(`✅ ${nbPA} PA avec parcelles explosées`);
        
        // Créer les index APRÈS insertion (beaucoup plus efficace)
        console.log('⚡ Création des index sur pa_parcelles_temp...');
        db.exec(`
            CREATE INDEX idx_pa_parcelles_commune ON pa_parcelles_temp(code_commune_dfi, parcelle_normalisee);
            CREATE INDEX idx_pa_parcelles_section ON pa_parcelles_temp(code_commune_dvf, section);
        `);
        console.log(`✅ Index créés\n`);
        
        // SOUS-ÉTAPE 4.2 : Chercher parcelles mères dans DVF (ACHAT AVANT DIVISION)
        console.log('⚡ 4.2 - Recherche achats lotisseurs sur parcelles mères...');
        
        // OPTIMISATION RADICALE : Traiter par BATCH de COMMUNES pour éviter jointure massive
        // Créer la table vide
        db.exec(`
            DROP TABLE IF EXISTS achats_lotisseurs_meres;
            CREATE TEMP TABLE achats_lotisseurs_meres (
                num_pa TEXT,
                id_mutation TEXT,
                date_mutation TEXT,
                date_auth TEXT,
                superficie REAL,
                surface_totale_aggregee REAL
            );
        `);
        
        // Récupérer la liste des communes avec PA
        const communesAvecPA = db.prepare(`
            SELECT DISTINCT code_commune_dvf 
            FROM pa_parcelles_temp 
            ORDER BY code_commune_dvf
        `).all();
        
        console.log(`   → Traitement par batch de ${communesAvecPA.length} communes avec PA...`);
        
        // Traiter commune par commune (évite jointure 87k PA × 36M DVF en une fois)
        const insertBatch = db.prepare(`
            INSERT INTO achats_lotisseurs_meres 
            SELECT DISTINCT
                p.num_pa,
                t.id_mutation,
                m.date_mutation,
                p.date_auth,
                p.superficie,
                m.surface_totale_aggregee
            FROM pa_parcelles_temp p
            INNER JOIN terrains_batir_temp t ON 
                t.code_commune = p.code_commune_dvf
                AND t.section_cadastrale = p.section
                AND t.parcelle_suffixe = ('000' || p.parcelle_normalisee)
            INNER JOIN mutations_aggregees m ON m.id_mutation = t.id_mutation
            WHERE p.code_commune_dvf = ?
              -- Fenêtre temporelle supprimée : association basée uniquement sur la correspondance parcellaire
        `);
        
        let totalMatches = 0;
        for (let i = 0; i < communesAvecPA.length; i++) {
            const commune = communesAvecPA[i].code_commune_dvf;
            const result = insertBatch.run(commune);
            totalMatches += result.changes;
            
            // CHECKPOINT régulier pour libérer l'espace disque temporaire
            // SQLite accumule des fichiers temporaires même avec journal_mode=DELETE
            if ((i + 1) % 50 === 0) {
                db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
            }
            
            if ((i + 1) % 100 === 0 || i === communesAvecPA.length - 1) {
                console.log(`   → ${i + 1}/${communesAvecPA.length} communes traitées (${totalMatches} matches trouvés)`);
            }
        }
        
        console.log(`   → Jointure terminée : ${totalMatches} associations PA-DVF\n`);
        
        // Créer index AVANT le ROW_NUMBER() OVER pour éviter tri massif en mémoire
        console.log('   → Création index pour optimiser le calcul du rang...');
        db.exec(`CREATE INDEX idx_achats_meres_pa_date ON achats_lotisseurs_meres(num_pa, date_mutation);`);
        
        // Ajouter le rang (sur une table réduite) - l'index va accélérer le PARTITION BY + ORDER BY
        console.log('   → Calcul du rang (première transaction par PA)...');
        db.exec(`
            CREATE TEMP TABLE achats_lotisseurs_meres_ranked AS
            SELECT 
                num_pa,
                id_mutation,
                date_mutation,
                date_auth,
                superficie,
                surface_totale_aggregee,
                ROW_NUMBER() OVER (
                    PARTITION BY num_pa 
                    ORDER BY date_mutation ASC
                ) as rang
            FROM achats_lotisseurs_meres
        `);
        
        // Remplacer l'ancienne table
        db.exec(`
            DROP TABLE achats_lotisseurs_meres;
            ALTER TABLE achats_lotisseurs_meres_ranked RENAME TO achats_lotisseurs_meres;
        `);
        
        // UPDATE pour les achats sur parcelles mères (prendre le premier chronologiquement)
        const nbAchatsMeres = db.prepare(`
            UPDATE terrains_batir_temp
            SET est_terrain_viabilise = 0,
                id_pa = (
                    SELECT num_pa 
                    FROM achats_lotisseurs_meres a 
                    WHERE a.id_mutation = terrains_batir_temp.id_mutation
                      AND a.rang = 1
                    LIMIT 1
                )
            WHERE id_mutation IN (
                SELECT id_mutation FROM achats_lotisseurs_meres WHERE rang = 1
            )
        `).run().changes;
        console.log(`✅ ${nbAchatsMeres} transactions mères trouvées\n`);
        
        // SOUS-ÉTAPE 4.3 : Associer PA → DFI → Parcelles filles (pour PA sans transaction mère)
        console.log('⚡ 4.3 - Association PA → DFI → Parcelles filles...');
        
        // Fonction JavaScript pour exploser les parcelles filles (DFI utilise ";" comme séparateur)
        // On va charger les DFI et créer une table d'association
        db.exec(`
            DROP TABLE IF EXISTS pa_filles_temp;
            CREATE TEMP TABLE pa_filles_temp (
                num_pa TEXT,
                code_commune_dvf TEXT,
                section TEXT,
                parcelle_fille TEXT,
                parcelle_fille_suffixe TEXT,
                superficie REAL,
                date_auth TEXT
            );
        `);
        
        console.log('   📂 Chargement relations DFI...');
        const dfiData = db.prepare(`
            SELECT code_commune, parcelles_meres, parcelles_filles
            FROM dfi_indexed
            WHERE parcelles_meres IS NOT NULL AND parcelles_filles IS NOT NULL
        `).all();
        
        const insertFille = db.prepare(`INSERT INTO pa_filles_temp VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const insertFillesTransaction = db.transaction(() => {
            let countAssociations = 0;
            for (const pa of paList) {
                // Vérifier si ce PA a déjà une transaction mère
                const aMere = db.prepare(`
                    SELECT 1 FROM achats_lotisseurs_meres WHERE num_pa = ? AND rang = 1
                `).get(pa.numPA);
                
                if (aMere) continue; // Skip si déjà traité sur parcelle mère
                
                const codeCommuneDVF = String(pa.comm).padStart(5, '0');
                const codeCommuneDFI = codeCommuneDVF.substring(codeCommuneDVF.length - 3);
                
                // Pour chaque parcelle du PA
                for (const parcelle of pa.parcelles || []) {
                    const parcelleStr = String(parcelle).trim().toUpperCase();
                    const match = parcelleStr.match(/([A-Z]{1,2})(\d+p?)$/i);
                    if (!match) continue;
                    
                    const [, section, numero] = match;
                    const numeroClean = String(parseInt(numero.replace(/p$/i, ''), 10));
                    const parcelleNormalisee = section + numeroClean;
                    
                    // Chercher dans DFI
                    for (const dfi of dfiData) {
                        if (dfi.code_commune !== codeCommuneDFI) continue;
                        
                        const meres = (dfi.parcelles_meres || '').split(/[;,\s]+/).map(p => p.trim()).filter(p => p);
                        const filles = (dfi.parcelles_filles || '').split(/[;,\s]+/).map(p => p.trim()).filter(p => p);
                        
                        // Si la parcelle PA est une parcelle mère dans ce DFI
                        if (meres.includes(parcelleNormalisee)) {
                            // Ajouter toutes les parcelles filles
                            for (const fille of filles) {
                                const matchFille = fille.match(/^([A-Z]+)(\d+)$/);
                                if (matchFille) {
                                    const [, sectionFille, numeroFille] = matchFille;
                                    const numeroPad = numeroFille.padStart(4, '0');
                                    const parcelleSuffixe = `000${sectionFille}${numeroPad}`;
                                    
                                    insertFille.run(
                                        pa.numPA,
                                        codeCommuneDVF,
                                        sectionFille,
                                        fille,
                                        parcelleSuffixe,
                                        pa.superficie,
                                        pa.dateAuth
                                    );
                                    countAssociations++;
                                }
                            }
                        }
                    }
                }
            }
            console.log(`   ✅ ${countAssociations} associations PA → filles créées`);
        });
        insertFillesTransaction();
        
        // Créer des index sur pa_filles_temp pour accélérer les jointures
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_pa_filles_commune_section_suffixe 
            ON pa_filles_temp(code_commune_dvf, section, parcelle_fille_suffixe);
        `);
        console.log(`✅ Parcelles filles associées\n`);
        
        // SOUS-ÉTAPE 4.3.5 : Enrichir les superficies depuis parcelle.csv si nulles
        console.log('⚡ 4.3.5 - Enrichissement des superficies depuis parcelle.csv...');
        const PARCELLE_FILE = path.join(__dirname, '..', 'bdnb_data', 'csv', 'parcelle.csv');
        
        return new Promise((resolve) => {
            if (fs.existsSync(PARCELLE_FILE)) {
                // Créer une table temporaire avec les superficies depuis parcelle.csv
                // ⚡ OPTIMISATION : PRIMARY KEY créée APRÈS insertion
                db.exec(`
                    DROP TABLE IF EXISTS parcelle_superficies;
                    CREATE TEMP TABLE parcelle_superficies (
                        id_parcelle TEXT,
                        superficie REAL
                    );
                `);
                
                const insertSuperficie = db.prepare(`INSERT INTO parcelle_superficies VALUES (?, ?)`);
                let countSuperficies = 0;
                
                fs.createReadStream(PARCELLE_FILE)
                    .pipe(csv())
                    .on('data', (row) => {
                        const idParcelle = row.parcelle_id || row.id_parcelle;
                        const superficie = parseFloat(row.superficie || row.surface || row.surface_terrain || 0);
                        if (idParcelle && superficie > 0) {
                            insertSuperficie.run(idParcelle, superficie);
                            countSuperficies++;
                        }
                    })
                    .on('end', () => {
                        console.log(`   ✅ ${countSuperficies} superficies chargées depuis parcelle.csv`);
                        
                        // Créer l'index APRÈS insertion
                        db.exec(`CREATE UNIQUE INDEX idx_parcelle_superficies ON parcelle_superficies(id_parcelle);`);
                        
                        // Mettre à jour pa_filles_temp avec les superficies enrichies
                        db.exec(`
                            UPDATE pa_filles_temp
                            SET superficie = COALESCE(
                                NULLIF(pa_filles_temp.superficie, 0),
                                (SELECT superficie FROM parcelle_superficies ps 
                                 WHERE ps.id_parcelle = (
                                     pa_filles_temp.code_commune_dvf || 
                                     pa_filles_temp.section || 
                                     pa_filles_temp.parcelle_fille_suffixe
                                 ))
                            )
                            WHERE superficie IS NULL OR superficie = 0;
                        `);
                        
                        const countEnrichies = db.prepare(`
                            SELECT COUNT(*) as cnt FROM pa_filles_temp 
                            WHERE superficie IS NOT NULL AND superficie > 0
                        `).get().cnt;
                        console.log(`   ✅ ${countEnrichies} parcelles avec superficie après enrichissement\n`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.log(`   ⚠️  Erreur lecture parcelle.csv: ${err.message}\n`);
                        resolve();
                    });
            } else {
                console.log(`   ⚠️  Fichier parcelle.csv non trouvé (${PARCELLE_FILE}), enrichissement ignoré\n`);
                resolve();
            }
        }).then(() => {
        // SOUS-ÉTAPE 4.4 : Trouver achats lotisseurs sur parcelles filles
        // Filtres : ≥1 parcelle, tolérance surface ±10%, prix > 1€
        console.log('⚡ 4.4 - Recherche achats lotisseurs sur parcelles filles...');
        
        // OPTIMISATION RADICALE : Traiter par BATCH de COMMUNES pour éviter jointure massive
        // Créer la table vide
        db.exec(`
            DROP TABLE IF EXISTS achats_lotisseurs_filles;
            CREATE TEMP TABLE achats_lotisseurs_filles (
                num_pa TEXT,
                id_mutation TEXT,
                date_mutation TEXT,
                date_auth TEXT,
                superficie REAL,
                surface_totale_aggregee REAL,
                valeur_totale REAL,
                nb_parcelles INTEGER
            );
        `);
        
        // Récupérer la liste des communes avec PA filles
        const communesAvecFillesPA = db.prepare(`
            SELECT DISTINCT code_commune_dvf 
            FROM pa_filles_temp 
            ORDER BY code_commune_dvf
        `).all();
        
        console.log(`   → Traitement par batch de ${communesAvecFillesPA.length} communes avec PA filles...`);
        
        // Traiter commune par commune
        const insertFillesBatch = db.prepare(`
            INSERT INTO achats_lotisseurs_filles 
            SELECT 
                pf.num_pa,
                t.id_mutation,
                m.date_mutation,
                pf.date_auth,
                pf.superficie,
                m.surface_totale_aggregee,
                m.valeur_totale,
                COUNT(DISTINCT t.id_parcelle) as nb_parcelles
            FROM pa_filles_temp pf
            INNER JOIN terrains_batir_temp t ON 
                t.code_commune = pf.code_commune_dvf
                AND t.section_cadastrale = pf.section
                AND t.parcelle_suffixe = pf.parcelle_fille_suffixe
            INNER JOIN mutations_aggregees m ON m.id_mutation = t.id_mutation
            WHERE pf.code_commune_dvf = ?
              -- Fenêtre temporelle supprimée : association basée uniquement sur la correspondance parcellaire
              AND t.id_pa IS NULL  -- Pas déjà attribué
              AND m.valeur_totale > 1  -- Prix > 1€
            GROUP BY pf.num_pa, t.id_mutation, m.date_mutation, pf.date_auth, pf.superficie, m.surface_totale_aggregee, m.valeur_totale
            HAVING COUNT(DISTINCT t.id_parcelle) >= 1
               AND (pf.superficie IS NULL OR pf.superficie = 0 OR m.surface_totale_aggregee BETWEEN pf.superficie * 0.7 AND pf.superficie * 1.3)
        `);
        
        let totalFillesMatches = 0;
        for (let i = 0; i < communesAvecFillesPA.length; i++) {
            const commune = communesAvecFillesPA[i].code_commune_dvf;
            const result = insertFillesBatch.run(commune);
            totalFillesMatches += result.changes;
            
            // CHECKPOINT régulier pour libérer l'espace disque temporaire
            if ((i + 1) % 50 === 0) {
                db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
            }
            
            if ((i + 1) % 100 === 0 || i === communesAvecFillesPA.length - 1) {
                console.log(`   → ${i + 1}/${communesAvecFillesPA.length} communes traitées (${totalFillesMatches} matches trouvés)`);
            }
        }
        
        console.log(`   → Jointure terminée : ${totalFillesMatches} associations PA-filles-DVF\n`);
        
        // Créer index AVANT le ROW_NUMBER() OVER pour optimiser
        console.log('   → Création index pour optimiser le calcul du rang...');
        db.exec(`CREATE INDEX idx_achats_filles_pa_date ON achats_lotisseurs_filles(num_pa, date_mutation, nb_parcelles);`);
        
        // Ajouter le rang (sur une table réduite)
        console.log('   → Calcul du rang (première transaction par PA)...');
        db.exec(`
            CREATE TEMP TABLE achats_lotisseurs_filles_ranked AS
            SELECT 
                num_pa,
                id_mutation,
                date_mutation,
                date_auth,
                superficie,
                surface_totale_aggregee,
                valeur_totale,
                nb_parcelles,
                ROW_NUMBER() OVER (
                    PARTITION BY num_pa 
                    ORDER BY date_mutation ASC, nb_parcelles DESC
                ) as rang
            FROM achats_lotisseurs_filles
        `);
        
        // Remplacer l'ancienne table
        db.exec(`
            DROP TABLE achats_lotisseurs_filles;
            ALTER TABLE achats_lotisseurs_filles_ranked RENAME TO achats_lotisseurs_filles;
        `);
        
        const nbAchatsFilles = db.prepare(`
            UPDATE terrains_batir_temp
            SET est_terrain_viabilise = 0,
                id_pa = (
                    SELECT num_pa 
                    FROM achats_lotisseurs_filles a 
                    WHERE a.id_mutation = terrains_batir_temp.id_mutation
                      AND a.rang = 1
                    LIMIT 1
                )
            WHERE id_pa IS NULL
              AND id_mutation IN (
                  SELECT id_mutation FROM achats_lotisseurs_filles WHERE rang = 1
              )
        `).run().changes;
        console.log(`✅ ${nbAchatsFilles} achats lotisseurs sur parcelles filles\n`);
        
        // SOUS-ÉTAPE 4.5 : Lots vendus (viabilisés) - toutes les autres transactions sur parcelles filles
        console.log('⚡ 4.5 - Association lots vendus (viabilisés)...');
        
        // Approche ultra-optimisée : créer une table de correspondance avec clé composite
        // puis utiliser cette table pour UPDATE directement
        db.exec(`
            -- Créer une table de correspondance parcelle -> PA avec clé composite indexée
            DROP TABLE IF EXISTS parcelle_pa_map;
            CREATE TEMP TABLE parcelle_pa_map (
                code_commune TEXT,
                section TEXT,
                parcelle_suffixe TEXT,
                num_pa TEXT,
                PRIMARY KEY (code_commune, section, parcelle_suffixe)
            );
            
            INSERT OR IGNORE INTO parcelle_pa_map (code_commune, section, parcelle_suffixe, num_pa)
            SELECT DISTINCT code_commune_dvf, section, parcelle_fille_suffixe, num_pa
            FROM pa_filles_temp;
        `);
        
        // UPDATE direct avec la table de correspondance (beaucoup plus rapide)
        const nbLotsVendus = db.prepare(`
            UPDATE terrains_batir_temp
            SET est_terrain_viabilise = 1,
                id_pa = (
                    SELECT num_pa 
                    FROM parcelle_pa_map p
                    WHERE p.code_commune = terrains_batir_temp.code_commune
                      AND p.section = terrains_batir_temp.section_cadastrale
                      AND p.parcelle_suffixe = terrains_batir_temp.parcelle_suffixe
                    LIMIT 1
                )
            WHERE id_pa IS NULL
              AND EXISTS (
                  SELECT 1 
                  FROM parcelle_pa_map p
                  WHERE p.code_commune = terrains_batir_temp.code_commune
                    AND p.section = terrains_batir_temp.section_cadastrale
                    AND p.parcelle_suffixe = terrains_batir_temp.parcelle_suffixe
              )
        `).run().changes;
        
        // Checkpoint après UPDATE massif
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (checkpointErr) {
            // Ignorer
        }
        console.log(`✅ ${nbLotsVendus} lots vendus associés\n`);
        
        // Statistiques
        const nbPAassocies = db.prepare(`
            SELECT COUNT(DISTINCT id_pa) as nb FROM terrains_batir_temp WHERE id_pa IS NOT NULL
        `).get().nb;
        
        console.log(`✅ ÉTAPE 4 TERMINÉE :`);
        console.log(`   - ${nbPAassocies} PA associés à des transactions`);
        console.log(`   - ${nbAchatsMeres + nbAchatsFilles} achats lotisseurs (non-viabilisés)`);
        console.log(`   - ${nbLotsVendus} lots vendus (viabilisés)\n`);
        
        // FIN ÉTAPE 4 - Passer à l'enrichissement des coordonnées
        console.log('📊 ÉTAPE 6 : Enrichissement des coordonnées depuis les parcelles cadastrales...');
        enrichirCoordonnees(db).then(() => {
            // ÉTAPE 7 : Créer la table finale simplifiée
            creerTableFinale(db);
        }).catch((err) => {
            console.error('⚠️  Erreur lors de l\'enrichissement des coordonnées:', err.message);
            console.log('   → Continuation avec création de la table finale...\n');
            // Continuer même en cas d'erreur
            creerTableFinale(db);
        });
    });
    }); // Fin du .then() de la ligne 1825 (après chargement PA)
}).catch(err => {
    console.error('❌ Erreur lors de l\'exécution du script:', err);
    db.close();
    process.exit(1);
});
} // Fin de demarrerCreationBase()
