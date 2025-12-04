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

let DB_FILE = path.join(__dirname, '..', 'database', 'terrains_batir.db');
const PARCELLES_DB_FILE = path.join(__dirname, '..', 'database', 'parcelles.db');
const LISTE_PA_FILE = path.join(__dirname, '..', 'Liste-des-permis-damenager.2025-10.csv');
// Plus de filtre département - France entière
const TOLERANCE_SURFACE = 0.10; // 10% (assouplissement pour meilleure couverture)

console.log('🏗️  === CRÉATION BASE TERRAINS À BÂTIR - VERSION 2 ===\n');

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

// Attacher la base de données des parcelles à la base principale
// Utiliser le chemin absolu pour éviter les problèmes de chemin relatif
const parcellesDbPath = path.resolve(PARCELLES_DB_FILE).replace(/\\/g, '/');
db.exec(`ATTACH DATABASE '${parcellesDbPath}' AS parcelles_db;`);
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
        code_postal TEXT,
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
            FROM dfi_lotissements;
            
            CREATE INDEX idx_dfi_idx_commune ON dfi_indexed(code_commune);
            CREATE INDEX idx_dfi_idx_meres ON dfi_indexed(parcelles_meres);
            CREATE INDEX idx_dfi_idx_filles ON dfi_indexed(parcelles_filles);
        `);
        console.log('✅ Table DFI indexée créée\n');
    }
}

// Fonction pour charger parcelle.csv dans une base de données dédiée
function chargerParcellesDansDB() {
    return new Promise((resolve) => {
        // S'assurer que le répertoire database existe
        const dbDir = path.dirname(PARCELLES_DB_FILE);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        // Ouvrir la base de données dédiée aux parcelles
        const dbParcelles = new Database(PARCELLES_DB_FILE);
        
        // Vérifier si la table parcelle existe déjà avec des données
        const tableExists = dbParcelles.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='parcelle'
        `).get();
        
        if (tableExists) {
            const count = dbParcelles.prepare('SELECT COUNT(*) as cnt FROM parcelle').get().cnt;
            if (count > 0) {
                console.log(`✅ Base parcelles.db déjà existante avec ${count.toLocaleString()} parcelles, conversion ignorée\n`);
                dbParcelles.close();
                resolve();
                return;
            }
        }
        
        const PARCELLE_FILE = path.join(__dirname, '..', 'bdnb_data', 'csv', 'parcelle.csv');
        
        if (!fs.existsSync(PARCELLE_FILE)) {
            if (tableExists) {
                console.log('⚠️  Fichier parcelle.csv non trouvé mais table parcelle existe (vide), conversion ignorée\n');
            } else {
                console.log('⚠️  Fichier parcelle.csv non trouvé, base parcelles.db non créée\n');
            }
            dbParcelles.close();
            resolve();
            return;
        }
        
        console.log('📂 Chargement de parcelle.csv dans la base de données dédiée (parcelles.db)...');
        
        // Créer la table parcelle
        dbParcelles.exec(`
            DROP TABLE IF EXISTS parcelle;
            CREATE TABLE parcelle (
                parcelle_id TEXT PRIMARY KEY,
                geom_parcelle TEXT,
                s_geom_parcelle REAL,
                code_departement_insee TEXT,
                code_commune_insee TEXT
            );
        `);
        
        const insertParcelle = dbParcelles.prepare(`
            INSERT INTO parcelle (parcelle_id, geom_parcelle, s_geom_parcelle, code_departement_insee, code_commune_insee)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        let countLoaded = 0;
        const insertTransaction = dbParcelles.transaction((rows) => {
            for (const row of rows) {
                try {
                    insertParcelle.run(
                        row.parcelle_id || row.id_parcelle,
                        row.geom_parcelle || null,
                        parseFloat(row.s_geom_parcelle || 0) || null,
                        row.code_departement_insee || null,
                        row.code_commune_insee || null
                    );
                    countLoaded++;
                } catch (err) {
                    // Ignorer les doublons
                }
            }
        });
        
        const batch = [];
        const BATCH_SIZE = 10000;
        
        fs.createReadStream(PARCELLE_FILE)
            .pipe(csv())
            .on('data', (row) => {
                batch.push(row);
                if (batch.length >= BATCH_SIZE) {
                    insertTransaction(batch.splice(0, BATCH_SIZE));
                }
            })
            .on('end', () => {
                if (batch.length > 0) {
                    insertTransaction(batch);
                }
                
                // Créer les index
                dbParcelles.exec(`
                    CREATE INDEX IF NOT EXISTS idx_parcelle_id ON parcelle(parcelle_id);
                    CREATE INDEX IF NOT EXISTS idx_parcelle_commune ON parcelle(code_commune_insee);
                `);
                
                console.log(`✅ ${countLoaded} parcelles chargées dans parcelles.db\n`);
                
                // Supprimer le fichier CSV après conversion réussie
                try {
                    fs.unlinkSync(PARCELLE_FILE);
                    console.log(`🗑️  Fichier parcelle.csv supprimé après conversion réussie\n`);
                } catch (deleteErr) {
                    console.log(`⚠️  Impossible de supprimer parcelle.csv: ${deleteErr.message}\n`);
                }
                
                dbParcelles.close();
                resolve();
            })
            .on('error', (err) => {
                console.log(`⚠️  Erreur lors du chargement de parcelle.csv: ${err.message}\n`);
                dbParcelles.close();
                resolve();
            });
    });
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
    // Format WKT: MULTIPOLYGON(((x1 y1, x2 y2, ...)), ((x3 y3, x4 y4, ...)), ...)
    // On extrait toutes les paires de coordonnées, peu importe la structure des polygones
    
    // Supprimer le préfixe MULTIPOLYGON
    let coordsStr = wkt.replace(/^MULTIPOLYGON\s*\(/i, '');
    if (!coordsStr) return null;
    
    // Extraire toutes les paires de nombres (coordonnées x y)
    // Pattern: nombre nombre (séparés par des espaces, potentiellement entre parenthèses)
    const coordPattern = /(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g;
    const points = [];
    let match;
    
    while ((match = coordPattern.exec(coordsStr)) !== null) {
        const x = parseFloat(match[1]);
        const y = parseFloat(match[2]);
        if (!isNaN(x) && !isNaN(y)) {
            points.push({ x, y });
        }
    }
    
    if (points.length === 0) return null;
    
    // Calculer le centroïde (moyenne des coordonnées de tous les polygones)
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
                const typeDau = row.TYPE_DAU || '';
                const numDau = row.NUM_DAU || '';
                
                // France entière - pas de filtre département
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
        // Vérifier si la table parcelle existe
        const tableExists = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='parcelle'
        `).get();
        
        if (!tableExists) {
            console.log('   ⚠️  Table parcelle non trouvée, enrichissement coordonnées ignoré\n');
            resolve();
            return;
        }
        
        console.log('   📂 Chargement des parcelles avec coordonnées depuis la base de données...');
        
        // Créer une map parcelle_id → {latitude, longitude} depuis la table
        const parcelleCoords = new Map();
        const parcelles = db.prepare(`
            SELECT parcelle_id, geom_parcelle 
            FROM parcelles_db.parcelle 
            WHERE geom_parcelle IS NOT NULL
        `).all();
        
        let countWithGeom = 0;
        for (const row of parcelles) {
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
                }
        
        console.log(`   ✅ ${parcelles.length} parcelles chargées, ${countWithGeom} avec géométrie\n`);
                
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
        console.log(`      - Directement depuis table parcelle: ${countUpdated - countViaFilles - countViaMere}`);
                console.log(`      - Via parcelles filles (mère → filles): ${countViaFilles}`);
                console.log(`      - Via parcelle mère (fille → mère): ${countViaMere}`);
                console.log(`   ${countNotFound} parcelles non trouvées\n`);
                
                resolve();
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
// Fonction pour vérifier si un fichier contient des guillemets
function fichierContientGuillemets(filePath) {
    try {
        const readline = require('readline');
        const stream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity
        });
        
        let ligneCount = 0;
        let contientGuillemets = false;
        
        return new Promise((resolve) => {
            rl.on('line', (line) => {
                ligneCount++;
                if (line.includes('"')) {
                    contientGuillemets = true;
                    rl.close();
                    stream.close();
                    resolve(true);
                    return;
                }
                // Vérifier seulement les 100 premières lignes pour être rapide
                if (ligneCount >= 100) {
                    rl.close();
                    stream.close();
                    resolve(false);
                    return;
                }
            });
            
            rl.on('close', () => {
                resolve(contientGuillemets);
            });
            
            rl.on('error', () => {
                resolve(false);
            });
        });
    } catch (err) {
        return Promise.resolve(false);
    }
}

function nettoyerGuillemetsDVF(filePath) {
    return new Promise((resolve, reject) => {
        console.log(`      🧹 Vérification des guillemets...`);
        
        fichierContientGuillemets(filePath).then((aNettoyer) => {
            if (!aNettoyer) {
                console.log(`      ✅ Fichier déjà nettoyé, pas de guillemets détectés`);
                resolve();
                return;
            }
            
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
                // Accepter tous les fichiers dvf_YYYY.csv (France entière)
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
            try {
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
                code_postal TEXT,
                section_cadastrale TEXT,
                parcelle_suffixe TEXT,
                nom_commune TEXT
            );
            `);
            
            // Créer l'index sur table VIDE (instantané)
            console.log(`      📊 Création index sur table vide...`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_temp_dept ON temp_csv_file(code_departement)`);
            } catch (tableErr) {
                console.error(`      ❌ Erreur lors de la création de la table temporaire: ${tableErr.message}`);
                // Continuer avec le fichier suivant
                traiterFichierSequentiel(index + 1);
                return;
            }
            const dbSizeAfterIndex = getDbSizeMB(DB_FILE);
            console.log(`      ✅ Index créé - Taille DB: ${dbSizeAfterIndex} MB`);
            
            // INSERT simple (INSERT OR IGNORE pour éviter erreur, mais on garde les doublons pour GROUP BY)
            const insertTempFile = db.prepare(`
                INSERT INTO temp_csv_file (
                    id_parcelle, id_mutation, code_departement,
                    valeur_fonciere, surface_totale, surface_reelle_bati,
                    date_mutation, latitude, longitude,
                    code_commune, code_postal, section_cadastrale, parcelle_suffixe, nom_commune
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    // Vérifier si les colonnes sont déjà normalisées
                    const allColumns = Object.keys(row);
                    const colonnesNormalisees = [
                        'id_mutation', 'date_mutation', 'valeur_fonciere', 'code_departement',
                        'code_commune', 'nom_commune', 'id_parcelle', 'section_cadastrale',
                        'surface_terrain', 'surface_reelle_bati', 'type_local'
                    ];
                    
                    // Vérifier si toutes les colonnes importantes sont déjà normalisées
                    const toutesNormalisees = colonnesNormalisees.every(col => 
                        allColumns.some(c => c.toLowerCase() === col.toLowerCase())
                    );
                    
                    if (toutesNormalisees) {
                        // Colonnes déjà normalisées, pas besoin de mapping
                        columnMapping = 'normalise';
                        // Essayer directement les noms normalisés
                        for (const name of possibleNames) {
                            if (row[name] !== undefined && row[name] !== '') {
                                return row[name];
                            }
                        }
                        return '';
                    }
                    
                    // Créer le mapping une seule fois lors de la première ligne de ce fichier
                    columnMapping = {};
                    
                    // Mapping des colonnes possibles
                    const columnMappings = {
                        'id_mutation': ['id_mutation', 'no_disposition', 'numero_disposition'],
                        'date_mutation': ['date_mutation'],
                        'valeur_fonciere': ['valeur_fonciere', 'valeur_fonciere_globale'],
                        'code_departement': ['code_departement', 'dep'],
                        'code_commune': ['code_commune', 'comm', 'code_commune_insee'],
                        'code_postal': ['code_postal', 'code_postal_commune', 'postal_code'],
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
                
                // Si colonnes déjà normalisées, utiliser directement
                if (columnMapping === 'normalise') {
                    for (const name of possibleNames) {
                        if (row[name] !== undefined && row[name] !== '') {
                            return row[name];
                        }
                    }
                    return '';
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
            
            // Compteur pour générer des IDs uniques pour les transactions sans id_mutation
            let transactionCounter = 0;
            
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
                            // Afficher le mapping créé ou indiquer que c'est déjà normalisé
                            if (columnMapping === 'normalise') {
                                console.log(`      ✅ Colonnes déjà normalisées, pas de mapping nécessaire`);
                            } else {
                            const mappedCols = Object.entries(columnMapping || {}).slice(0, 5);
                            console.log(`      🔍 Mapping colonnes (exemples): ${mappedCols.map(([k, v]) => `${k}->${v}`).join(', ')}...`);
                            }
                            console.log(`      🔍 Exemple première ligne: id_parcelle="${getColumnValue(row, ['id_parcelle'])}", valeur_fonciere="${getColumnValue(row, ['valeur_fonciere'])}", code_departement="${getColumnValue(row, ['code_departement'])}"`);
                        }
                    }
                    
                    // Format DVF uniformisé : tous les fichiers sont maintenant normalisés
                    // Colonnes en minuscules avec underscores (ex: "code_departement", "valeur_fonciere")
                    
                    // Utiliser la fonction helper pour mapper les colonnes
                    const codeDept = getColumnValue(row, ['code_departement']) || '';
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
                        // Créer un identifiant basé sur date + prix + commune + section
                        // Pour éviter les collisions entre transactions distinctes, on utilise aussi la première parcelle vue
                        // Mais on doit s'assurer que toutes les parcelles de la même transaction aient le même ID
                        // Solution : utiliser un hash basé sur date + prix + commune + section (sans numéro de parcelle)
                        const dateForId = dateMutation || '';
                        const prixForId = Math.round(valeurFonciere);
                        const dateNorm = dateForId.substring(0, 10); // yyyy-mm-dd
                        
                        if (!dateNorm || dateNorm.length < 10) {
                            transactionCounter++;
                            idMutation = `DVF_UNKNOWN_${transactionCounter}_${Date.now()}`;
                        } else {
                            // Utiliser code_commune + section (sans numéro de parcelle) pour que toutes les parcelles de la même transaction aient le même ID
                            // Si plusieurs transactions ont la même date/prix/commune/section, elles seront fusionnées (acceptable car très rare)
                            const codeCommuneForId = codeCommune || idParcelle.substring(0, 5) || '00000';
                            const sectionForId = (section || '').substring(0, 2).padStart(2, '0');
                            idMutation = `DVF_${dateNorm}_${prixForId}_${codeCommuneForId}_${sectionForId}`.replace(/[^A-Z0-9_-]/g, '');
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
                    
                    // Extraire le code postal depuis la DVF
                    const codePostal = getColumnValue(row, ['code_postal', 'code_postal_commune', 'postal_code']) || null;
                    
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
                            codePostal,  // Ajouter code_postal
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
                        code_postal TEXT,
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
                            MAX(code_postal) as code_postal,
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
                    
                    let apres = 0;
                    try {
                        apres = db.prepare('SELECT COUNT(*) as c FROM temp_agregated').get().c;
                    } catch (countErr) {
                        console.error(`      ❌ Erreur lors du comptage: ${countErr.message}`);
                        apres = 0;
                    }
                    const reduction = apres > 0 ? Math.round((1 - apres/avantAgreg) * 100) : 0;
                    const dbSizeAfterAgreg = getDbSizeMB(DB_FILE);
                    console.log(`      📉 Réduction: ${avantAgreg.toLocaleString()} → ${apres.toLocaleString()} lignes (${reduction}%)`);
                    console.log(`      🔍 DEBUG: Mémoire: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB, Taille DB: ${dbSizeAfterAgreg} MB`);
                    
                    // Fusionner dans terrains_batir_temp
                    console.log(`      ⬆️  Fusion dans terrains_batir_temp...`);
                    try {
    db.exec(`
        INSERT INTO terrains_batir_temp (
                        id_parcelle, id_mutation, valeur_fonciere, surface_totale, surface_reelle_bati,
                        date_mutation, latitude, longitude,
                        code_departement, code_commune, code_postal, section_cadastrale, parcelle_suffixe, nom_commune
        )
        SELECT 
                        id_parcelle, id_mutation, valeur_fonciere, surface_totale, surface_reelle_bati,
                        date_mutation, latitude, longitude,
                        code_departement, code_commune, code_postal, section_cadastrale, parcelle_suffixe, nom_commune
                    FROM temp_agregated;
                    `);
                    const dbSizeAfterFusion = getDbSizeMB(DB_FILE);
                    console.log(`      ✅ Fusion terminée - Taille DB: ${dbSizeAfterFusion} MB`);
                    } catch (fusionErr) {
                        console.error(`      ❌ Erreur lors de la fusion: ${fusionErr.message}`);
                        // Continuer avec le fichier suivant même en cas d'erreur
                        traiterFichierSequentiel(index + 1);
                        return;
                    }
                    console.log(`      🔍 DEBUG: Mémoire: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
                    
                    // Nettoyer les tables temporaires
                    // ⚠️ Pas de VACUUM : trop lourd avec base parcelles.db (12GB) attachée
                    console.log(`      🧹 Nettoyage des tables temporaires...`);
                    try {
                    db.exec(`DROP TABLE temp_csv_file`);
                    db.exec(`DROP TABLE temp_agregated`);
                    } catch (dropErr) {
                        console.log(`      ⚠️  Erreur lors de la suppression des tables temporaires: ${dropErr.message}`);
                    }
                    
                    try {
                    const total = db.prepare('SELECT COUNT(*) as c FROM terrains_batir_temp').get().c;
                    console.log(`      ✅ Total dans terrains_batir_temp: ${total.toLocaleString()} lignes\n`);
                    } catch (countErr) {
                        console.log(`      ⚠️  Erreur lors du comptage: ${countErr.message}`);
                    }
                    
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

// ÉTAPE 0 : Charger parcelle.csv dans la base de données dédiée
console.log('📊 ÉTAPE 0 : Chargement de parcelle.csv dans la base de données dédiée (parcelles.db)...\n');
chargerParcellesDansDB().then(() => {
// ÉTAPE 1 : Charger les DVF DIRECTEMENT dans terrains_batir_temp
// 🔥 OPTIMISATION RADICALE : Plus de table intermédiaire dvf_temp_indexed
// Économie : ~14 GB d'espace disque temporaire
console.log('📊 ÉTAPE 1 : Chargement DVF directement dans la table de travail...\n');
console.log('   🔥 Optimisation : Pas de table temporaire intermédiaire (économie ~14 GB)\n');

// Préparer l'insertion DIRECTE dans terrains_batir_temp
const insertDvfTemp = db.prepare(`
    INSERT INTO terrains_batir_temp (
        id_parcelle, id_mutation, valeur_fonciere, surface_totale, surface_reelle_bati,
        date_mutation, code_departement, code_commune, code_postal, section_cadastrale,
        parcelle_suffixe, nom_commune, prix_m2, est_terrain_viabilise, id_pa
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)
`);

chargerTousLesCSV(db, insertDvfTemp).then((totalInserted) => {
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
    
    // 🔍 TRACE: Afficher la transaction du 11/10/2019 Dax ~426000€ (après index pour performance)
    console.log('🔍 [TRACE] Recherche de la transaction cible (2019-10-11, Dax, ~426000€)...');
    const targetTransaction = db.prepare(`
        SELECT 
            id_parcelle, id_mutation, valeur_fonciere, surface_totale, surface_reelle_bati,
            date_mutation, code_departement, code_commune, code_postal, section_cadastrale,
            parcelle_suffixe, nom_commune
        FROM terrains_batir_temp
        WHERE date_mutation LIKE '2019-10-11%'
            AND valeur_fonciere > 400000 AND valeur_fonciere < 450000
            AND (nom_commune LIKE '%DAX%' OR code_commune = '40088')
        LIMIT 10
    `).all();
    
    if (targetTransaction.length > 0) {
        console.log(`\n🔍 [TRACE] ${targetTransaction.length} transaction(s) cible(s) trouvée(s) :`);
        targetTransaction.forEach((tx, idx) => {
            console.log(`\n   Transaction ${idx + 1}:`);
            console.log(`   → id_parcelle: ${tx.id_parcelle}`);
            console.log(`   → id_mutation: ${tx.id_mutation}`);
            console.log(`   → date_mutation: ${tx.date_mutation}`);
            console.log(`   → valeur_fonciere: ${tx.valeur_fonciere}`);
            console.log(`   → surface_totale: ${tx.surface_totale}`);
            console.log(`   → surface_reelle_bati: ${tx.surface_reelle_bati}`);
            console.log(`   → section_cadastrale: ${tx.section_cadastrale}`);
            console.log(`   → parcelle_suffixe: ${tx.parcelle_suffixe}`);
            console.log(`   → nom_commune: ${tx.nom_commune}`);
            console.log(`   → code_commune: ${tx.code_commune}`);
        });
    } else {
        console.log('   ⚠️  Aucune transaction cible trouvée dans terrains_batir_temp');
    }
    console.log('');

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
        surface_reelle_bati,
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
    SELECT DISTINCT
        id_mutation,
        SUM(surface_totale) as surface_totale_aggregee,
        SUM(surface_reelle_bati) as surface_reelle_bati_aggregee,
        MAX(valeur_fonciere) as valeur_totale,
        date_mutation,
        code_departement,
        MIN(nom_commune) as nom_commune,
        MIN(section_cadastrale) as section_cadastrale,
        code_commune
    FROM terrains_batir_deduplique
    GROUP BY id_mutation, code_commune, date_mutation, valeur_fonciere
    `);
    
    console.log('   → Création index sur mutations_aggregees...');
    db.exec(`
    CREATE INDEX idx_mutations_agg_id ON mutations_aggregees(id_mutation);
    CREATE INDEX idx_mutations_agg_date ON mutations_aggregees(date_mutation);
    CREATE INDEX idx_mutations_agg_valeur ON mutations_aggregees(valeur_totale) WHERE valeur_totale > 1;
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
            // France entière - pas de filtre département
            
            const numPA = row.NUM_PA;
            const dateAuth = row.DATE_REELLE_AUTORISATION;
            // Utiliser COMM (code INSEE) pour la jointure PA-DVF (comme dans la DVF)
            const codeInseePA = row.COMM || '';
            const comm = codeInseePA; // Utiliser le code INSEE pour la jointure
            const depCode = row.DEP_CODE || ''; // Code département du PA
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
            // Note: comm contient le code postal, on le garde tel quel pour l'instant
            // La conversion en code INSEE se fera plus tard via la table de correspondance
            const commNormalise = comm && comm.length < 5 ? comm.padStart(5, '0') : comm;
            
            paList.push({
                    numPA: numPA,
                    dateAuth: dateAuthFormatee,
                    comm: commNormalise,  // Code INSEE
                    depCode: depCode,  // Code département
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
                code_departement TEXT,
                section TEXT,
                parcelle_normalisee TEXT,
                superficie REAL,
                date_auth TEXT
            );
        `);
        
        // Insérer toutes les parcelles PA en masse
        const insertPA = db.prepare(`INSERT INTO pa_parcelles_temp VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertManyPA = db.transaction(() => {
            for (const pa of paList) {
                if (!pa.parcelles || pa.parcelles.length === 0) continue;
                
                // pa.comm est maintenant le code INSEE (COMM)
                const codeInseeDVF = String(pa.comm).padStart(5, '0');
                const codeCommuneDFI = codeInseeDVF.substring(codeInseeDVF.length - 3);
                
                for (const parcelle of pa.parcelles) {
                    const parcelleStr = String(parcelle).trim().toUpperCase();
                    // Extraire section + numéro : "40088000BL0056" → "BL0056" (avec padding à 4 chiffres)
                    const match = parcelleStr.match(/([A-Z]{1,2})(\d+p?)$/i);
                    if (match) {
                        const [, section, numero] = match;
                        const numeroClean = String(parseInt(numero.replace(/p$/i, ''), 10));
                        const numeroPadded = numeroClean.padStart(4, '0'); // Padding à 4 chiffres pour correspondre à DVF
                        const parcelleNormalisee = section + numeroPadded;
                        
                        for (const sect of pa.sections) {
                            insertPA.run(
                                pa.numPA,
                                codeCommuneDFI,
                                codeInseeDVF,  // Utiliser le code INSEE pour la jointure DVF
                                pa.depCode,  // Code département du PA
                                sect,
                                parcelleNormalisee,
                                pa.superficie,
                                pa.dateAuth
                            );
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
        
        // Enrichir les superficies individuelles depuis terrains_batir_temp
        // La superficie dans pa_parcelles_temp est actuellement la superficie totale du PA
        // On va la remplacer par la superficie individuelle de chaque parcelle depuis DVF
        console.log('⚡ Enrichissement des superficies individuelles depuis DVF...');
        const updateSuperficies = db.prepare(`
            UPDATE pa_parcelles_temp
            SET superficie = (
                SELECT AVG(t.surface_totale)
                FROM terrains_batir_temp t
                WHERE t.code_commune = pa_parcelles_temp.code_commune_dvf
                  AND t.section_cadastrale = pa_parcelles_temp.section
                  AND (t.parcelle_suffixe = ('000' || pa_parcelles_temp.parcelle_normalisee)
                       OR t.parcelle_suffixe = pa_parcelles_temp.parcelle_normalisee)
                LIMIT 1
            )
            WHERE EXISTS (
                SELECT 1
                FROM terrains_batir_temp t
                WHERE t.code_commune = pa_parcelles_temp.code_commune_dvf
                  AND t.section_cadastrale = pa_parcelles_temp.section
                  AND (t.parcelle_suffixe = ('000' || pa_parcelles_temp.parcelle_normalisee)
                       OR t.parcelle_suffixe = pa_parcelles_temp.parcelle_normalisee)
            )
        `);
        const nbSuperficiesUpdatees = updateSuperficies.run().changes;
        console.log(`✅ ${nbSuperficiesUpdatees} superficies individuelles enrichies depuis DVF\n`);
        
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
                surface_totale_aggregee REAL,
                code_commune TEXT,
                section TEXT,
                parcelle_normalisee TEXT
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
        // IMPORTANT: Utiliser le code postal pour la jointure PA-DVF
        // Le PA utilise ADR_CODPOS_TER (code postal) et la DVF a aussi le code postal dans code_postal
        const insertBatch = db.prepare(`
            INSERT INTO achats_lotisseurs_meres 
            SELECT DISTINCT
                p.num_pa,
                t.id_mutation,
                m.date_mutation,
                p.date_auth,
                p.superficie,
                m.surface_totale_aggregee,
                p.code_commune_dvf,
                p.section,
                p.parcelle_normalisee
            FROM pa_parcelles_temp p
            INNER JOIN terrains_batir_temp t ON 
                t.code_commune = p.code_commune_dvf
                AND t.section_cadastrale = p.section
                AND (t.parcelle_suffixe = ('000' || p.parcelle_normalisee) 
                     OR t.parcelle_suffixe = p.parcelle_normalisee)
            INNER JOIN mutations_aggregees m ON 
                m.id_mutation = t.id_mutation
                AND m.code_commune = t.code_commune
            WHERE p.code_commune_dvf = ?
              -- Fenêtre temporelle supprimée : association basée uniquement sur la correspondance parcellaire
              -- Filtre de surface avec tolérance de 30% : compare la superficie TOTALE du PA avec la surface agrégée de la mutation
              -- La superficie dans pa_parcelles_temp est la superficie totale du PA
              -- La surface_totale_aggregee est la somme de toutes les parcelles de la transaction
              -- On compare donc la superficie totale du PA avec la surface totale de la transaction (logique cohérente)
              AND (p.superficie IS NULL OR p.superficie = 0 OR m.surface_totale_aggregee BETWEEN p.superficie * 0.7 AND p.superficie * 1.3)
              -- NOTE: On n'exclut PAS les transactions avec surface bati pour les parcelles mères
              -- car elles peuvent avoir une petite surface bati (hangar, construction existante) et doivent être identifiées comme NON_VIABILISE
        `);
        
        let totalMatches = 0;
        for (let i = 0; i < communesAvecPA.length; i++) {
            const commune = communesAvecPA[i].code_commune_dvf;
            
            // LOG: Vérifier si la transaction cible est dans cette commune
            if (commune === '40088') {
                // Vérifier les parcelles du PA dans pa_parcelles_temp
                const paParcelles = db.prepare(`
                    SELECT * FROM pa_parcelles_temp
                    WHERE code_commune_dvf = '40088'
                      AND section = 'BL'
                      AND (parcelle_normalisee LIKE '%56' OR parcelle_normalisee LIKE '%60' OR parcelle_normalisee LIKE '%61')
                    LIMIT 10
                `).all();
                if (paParcelles.length > 0) {
                    console.log(`\n🔍 [TRACE] Parcelles PA trouvées dans pa_parcelles_temp pour commune 40088 section BL:`);
                    paParcelles.forEach((p, idx) => {
                        console.log(`   Parcelle PA ${idx + 1}:`);
                        console.log(`   → num_pa: ${p.num_pa}`);
                        console.log(`   → section: ${p.section}`);
                        console.log(`   → parcelle_normalisee: ${p.parcelle_normalisee}`);
                        console.log(`   → code_commune_dvf: ${p.code_commune_dvf}`);
                        console.log(`   → superficie: ${p.superficie}`);
                    });
                } else {
                    console.log(`\n⚠️ [TRACE] Aucune parcelle PA trouvée dans pa_parcelles_temp pour commune 40088 section BL`);
                }
                
                // Vérifier les parcelles DVF dans terrains_batir_temp
                const dvfParcelles = db.prepare(`
                    SELECT DISTINCT parcelle_suffixe, section_cadastrale, id_mutation
                    FROM terrains_batir_temp
                    WHERE code_commune = '40088'
                      AND date_mutation LIKE '2019-10-11%'
                      AND valeur_fonciere > 400000 AND valeur_fonciere < 450000
                `).all();
                if (dvfParcelles.length > 0) {
                    console.log(`\n🔍 [TRACE] Parcelles DVF trouvées dans terrains_batir_temp:`);
                    dvfParcelles.forEach((p, idx) => {
                        console.log(`   Parcelle DVF ${idx + 1}:`);
                        console.log(`   → parcelle_suffixe: ${p.parcelle_suffixe}`);
                        console.log(`   → section_cadastrale: ${p.section_cadastrale}`);
                        console.log(`   → id_mutation: ${p.id_mutation}`);
                    });
                }
                
                // Vérifier la jointure exacte SANS filtre de surface
                const jointureTestSansFiltre = db.prepare(`
                    SELECT 
                        p.num_pa,
                        p.section as pa_section,
                        p.parcelle_normalisee as pa_parcelle,
                        t.parcelle_suffixe as dvf_parcelle,
                        t.section_cadastrale as dvf_section,
                        m.date_mutation,
                        m.valeur_totale,
                        m.surface_totale_aggregee,
                        p.superficie as pa_superficie,
                        ('000' || p.parcelle_normalisee) as parcelle_avec_prefixe,
                        CASE 
                            WHEN t.parcelle_suffixe = ('000' || p.parcelle_normalisee) THEN 'Match avec 000'
                            WHEN t.parcelle_suffixe = p.parcelle_normalisee THEN 'Match sans 000'
                            ELSE 'Pas de match'
                        END as type_match,
                        CASE 
                            WHEN m.surface_totale_aggregee BETWEEN p.superficie * 0.7 AND p.superficie * 1.3 
                            THEN 'OUI' 
                            ELSE 'NON' 
                        END as passe_filtre_surface,
                        p.superficie * 0.7 as min_surface,
                        p.superficie * 1.3 as max_surface
                    FROM pa_parcelles_temp p
                    INNER JOIN terrains_batir_temp t ON 
                        t.code_commune = p.code_commune_dvf
                        AND t.section_cadastrale = p.section
                        AND (t.parcelle_suffixe = ('000' || p.parcelle_normalisee) 
                             OR t.parcelle_suffixe = p.parcelle_normalisee)
                    INNER JOIN mutations_aggregees m ON m.id_mutation = t.id_mutation
                    WHERE p.code_commune_dvf = ?
                      AND m.date_mutation LIKE '2019-10-11%'
                      AND m.valeur_totale > 400000 AND m.valeur_totale < 450000
                `).all(commune);
                if (jointureTestSansFiltre.length > 0) {
                    console.log(`\n🔍 [TRACE] Jointure PA-DVF réussie SANS filtre surface (${jointureTestSansFiltre.length} ligne(s)):`);
                    jointureTestSansFiltre.forEach((j, idx) => {
                        console.log(`   Jointure ${idx + 1}:`);
                        console.log(`   → num_pa: ${j.num_pa}`);
                        console.log(`   → PA section: ${j.pa_section}, parcelle: ${j.pa_parcelle}`);
                        console.log(`   → Parcelle avec préfixe: ${j.parcelle_avec_prefixe}`);
                        console.log(`   → DVF section: ${j.dvf_section}, parcelle: ${j.dvf_parcelle}`);
                        console.log(`   → Type match: ${j.type_match}`);
                        console.log(`   → PA superficie: ${j.pa_superficie}, DVF surface: ${j.surface_totale_aggregee}`);
                        console.log(`   → Passe filtre surface: ${j.passe_filtre_surface} (min: ${j.min_surface}, max: ${j.max_surface})`);
                        
                        // Test avec le filtre de surface pour voir pourquoi ça ne passe pas
                        if (j.passe_filtre_surface === 'NON' && j.pa_superficie) {
                            const ecart = Math.abs(j.surface_totale_aggregee - j.pa_superficie);
                            const pourcentage = ((j.surface_totale_aggregee / j.pa_superficie - 1) * 100).toFixed(1);
                            console.log(`   ⚠️  Surface ne correspond pas : PA=${j.pa_superficie}, DVF=${j.surface_totale_aggregee}, écart=${ecart}, pourcentage=${pourcentage}%`);
                        }
                    });
                } else {
                    console.log(`\n⚠️ [TRACE] Aucune jointure PA-DVF trouvée SANS filtre surface`);
                    
                    // Test manuel de la condition de parcelle
                    const testParcelle = db.prepare(`
                        SELECT 
                            p.parcelle_normalisee,
                            ('000' || p.parcelle_normalisee) as avec_prefixe,
                            t.parcelle_suffixe,
                            t.id_mutation,
                            CASE WHEN t.parcelle_suffixe = ('000' || p.parcelle_normalisee) THEN 'OUI' ELSE 'NON' END as match_avec_prefixe,
                            CASE WHEN t.parcelle_suffixe = p.parcelle_normalisee THEN 'OUI' ELSE 'NON' END as match_sans_prefixe
                        FROM pa_parcelles_temp p
                        CROSS JOIN terrains_batir_temp t
                        WHERE p.code_commune_dvf = '40088'
                          AND p.section = 'BL'
                          AND t.code_commune = '40088'
                          AND t.section_cadastrale = 'BL'
                          AND t.date_mutation LIKE '2019-10-11%'
                          AND (p.parcelle_normalisee LIKE '%56' OR p.parcelle_normalisee LIKE '%60' OR p.parcelle_normalisee LIKE '%61')
                        LIMIT 10
                    `).all();
                    if (testParcelle.length > 0) {
                        console.log(`\n🔍 [TRACE] Test manuel condition parcelle:`);
                        testParcelle.forEach((t, idx) => {
                            console.log(`   Test ${idx + 1}:`);
                            console.log(`   → PA parcelle_normalisee: "${t.parcelle_normalisee}"`);
                            console.log(`   → Avec préfixe: "${t.avec_prefixe}"`);
                            console.log(`   → DVF parcelle_suffixe: "${t.parcelle_suffixe}"`);
                            console.log(`   → DVF id_mutation: "${t.id_mutation}"`);
                            console.log(`   → Match avec préfixe: ${t.match_avec_prefixe}`);
                            console.log(`   → Match sans préfixe: ${t.match_sans_prefixe}`);
                        });
                    }
                    
                    // Test avec mutations_aggregees pour voir si le problème vient de là
                    const testAvecMutations = db.prepare(`
                        SELECT 
                            p.num_pa,
                            p.parcelle_normalisee,
                            t.parcelle_suffixe,
                            t.id_mutation,
                            m.id_mutation as m_id_mutation,
                            m.surface_totale_aggregee,
                            m.valeur_totale,
                            p.superficie,
                            CASE 
                                WHEN m.surface_totale_aggregee BETWEEN p.superficie * 0.7 AND p.superficie * 1.3 
                                THEN 'OUI' 
                                ELSE 'NON' 
                            END as match_surface
                        FROM pa_parcelles_temp p
                        INNER JOIN terrains_batir_temp t ON 
                            t.code_commune = p.code_commune_dvf
                            AND t.section_cadastrale = p.section
                            AND (t.parcelle_suffixe = ('000' || p.parcelle_normalisee) 
                                 OR t.parcelle_suffixe = p.parcelle_normalisee)
                        LEFT JOIN mutations_aggregees m ON m.id_mutation = t.id_mutation
                        WHERE p.code_commune_dvf = '40088'
                          AND p.section = 'BL'
                          AND t.date_mutation LIKE '2019-10-11%'
                          AND (p.parcelle_normalisee LIKE '%56' OR p.parcelle_normalisee LIKE '%60' OR p.parcelle_normalisee LIKE '%61')
                        LIMIT 10
                    `).all();
                    if (testAvecMutations.length > 0) {
                        console.log(`\n🔍 [TRACE] Test avec mutations_aggregees:`);
                        testAvecMutations.forEach((t, idx) => {
                            console.log(`   Test ${idx + 1}:`);
                            console.log(`   → num_pa: ${t.num_pa}`);
                            console.log(`   → PA parcelle: "${t.parcelle_normalisee}", superficie: ${t.superficie}`);
                            console.log(`   → DVF parcelle: "${t.parcelle_suffixe}", id_mutation: "${t.id_mutation}"`);
                            console.log(`   → Mutation id: ${t.m_id_mutation}, surface: ${t.surface_totale_aggregee}, valeur: ${t.valeur_totale}`);
                            console.log(`   → Match surface: ${t.match_surface}`);
                            if (t.superficie && t.surface_totale_aggregee) {
                                const min = t.superficie * 0.7;
                                const max = t.superficie * 1.3;
                                console.log(`   → Surface check: ${t.surface_totale_aggregee} BETWEEN ${min} AND ${max} = ${t.surface_totale_aggregee >= min && t.surface_totale_aggregee <= max}`);
                            }
                        });
                    } else {
                        console.log(`\n⚠️ [TRACE] Aucun résultat même avec LEFT JOIN sur mutations_aggregees`);
                        
                        // Vérifier si la mutation est dans mutations_aggregees
                        const checkMutation = db.prepare(`
                            SELECT * FROM mutations_aggregees
                            WHERE id_mutation = '000001'
                              AND date_mutation LIKE '2019-10-11%'
                        `).all();
                        if (checkMutation.length > 0) {
                            console.log(`\n🔍 [TRACE] Mutation trouvée dans mutations_aggregees:`);
                            checkMutation.forEach((m, idx) => {
                                console.log(`   Mutation ${idx + 1}:`);
                                console.log(`   → id_mutation: ${m.id_mutation}`);
                                console.log(`   → date_mutation: ${m.date_mutation}`);
                                console.log(`   → surface_totale_aggregee: ${m.surface_totale_aggregee}`);
                                console.log(`   → valeur_totale: ${m.valeur_totale}`);
                            });
                        } else {
                            console.log(`\n⚠️ [TRACE] Mutation 000001 du 2019-10-11 ABSENTE de mutations_aggregees !`);
                            
                            // Vérifier toutes les mutations du 2019-10-11
                            const allMutations = db.prepare(`
                                SELECT id_mutation, date_mutation, COUNT(*) as nb_parcelles
                                FROM terrains_batir_temp
                                WHERE code_commune = '40088'
                                  AND date_mutation LIKE '2019-10-11%'
                                  AND valeur_fonciere > 400000 AND valeur_fonciere < 450000
                                GROUP BY id_mutation, date_mutation
                            `).all();
                            console.log(`\n🔍 [TRACE] Mutations trouvées dans terrains_batir_temp pour cette date:`);
                            allMutations.forEach((m, idx) => {
                                console.log(`   Mutation ${idx + 1}: id_mutation=${m.id_mutation}, date=${m.date_mutation}, nb_parcelles=${m.nb_parcelles}`);
                            });
                        }
                    }
                }
            }
            
            const result = insertBatch.run(commune);
            totalMatches += result.changes;
            
            // LOG: Vérifier si la transaction cible a été associée
            if (commune === '40088') {
                const targetCheck = db.prepare(`
                    SELECT * FROM achats_lotisseurs_meres
                    WHERE code_commune = ?
                      AND date_mutation LIKE '2019-10-11%'
                      AND (surface_totale_aggregee > 20000 OR id_mutation = '000001')
                `).all(commune);
                if (targetCheck.length > 0) {
                    console.log(`\n🔍 [TRACE] Transaction cible associée dans achats_lotisseurs_meres (${targetCheck.length} ligne(s)):`);
                    targetCheck.forEach((tx, idx) => {
                        console.log(`   Transaction ${idx + 1}:`);
                        console.log(`   → num_pa: ${tx.num_pa}`);
                        console.log(`   → id_mutation: ${tx.id_mutation}`);
                        console.log(`   → date_mutation: ${tx.date_mutation}`);
                        console.log(`   → date_auth: ${tx.date_auth}`);
                        console.log(`   → superficie PA: ${tx.superficie}`);
                        console.log(`   → surface_totale_aggregee: ${tx.surface_totale_aggregee}`);
                        console.log(`   → section: ${tx.section}`);
                        console.log(`   → parcelle_normalisee: ${tx.parcelle_normalisee}`);
                    });
                } else if (result.changes > 0) {
                    console.log(`\n⚠️ [TRACE] Des insertions ont été faites (${result.changes}) mais la transaction cible n'est pas dans achats_lotisseurs_meres`);
                } else {
                    console.log(`\n⚠️ [TRACE] Aucune insertion pour la commune 40088 (${result.changes} changements)`);
                }
            }
            
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
        
        // NOUVEAU : Filtrer pour ne garder que le PA le plus récent (date_auth) en cas de correspondances multiples
        console.log('   → Filtrage : sélection du PA le plus récent par parcelle...');
        db.exec(`
            CREATE TEMP TABLE achats_lotisseurs_meres_filtered AS
            SELECT 
                a1.*
            FROM achats_lotisseurs_meres a1
            INNER JOIN (
                SELECT 
                    code_commune,
                    section,
                    parcelle_normalisee,
                    id_mutation,
                    MAX(date_auth) as max_date_auth
                FROM achats_lotisseurs_meres
                GROUP BY code_commune, section, parcelle_normalisee, id_mutation
            ) a2 ON a1.code_commune = a2.code_commune
                 AND a1.section = a2.section
                 AND a1.parcelle_normalisee = a2.parcelle_normalisee
                 AND a1.id_mutation = a2.id_mutation
                 AND a1.date_auth = a2.max_date_auth
        `);
        
        const nbAvantFiltre = db.prepare('SELECT COUNT(*) as cnt FROM achats_lotisseurs_meres').get().cnt;
        const nbApresFiltre = db.prepare('SELECT COUNT(*) as cnt FROM achats_lotisseurs_meres_filtered').get().cnt;
        console.log(`   → Filtrage terminé : ${nbAvantFiltre} → ${nbApresFiltre} associations (${nbAvantFiltre - nbApresFiltre} doublons supprimés)\n`);
        
        // LOG: Vérifier si la transaction cible est toujours là après filtrage
        const targetCheckFiltre = db.prepare(`
            SELECT * FROM achats_lotisseurs_meres_filtered
            WHERE code_commune = '40088'
              AND date_mutation LIKE '2019-10-11%'
              AND (surface_totale_aggregee > 20000 OR id_mutation = '000001')
        `).all();
        if (targetCheckFiltre.length > 0) {
            console.log(`\n🔍 [TRACE] Transaction cible dans achats_lotisseurs_meres après filtrage (${targetCheckFiltre.length} ligne(s)):`);
            targetCheckFiltre.forEach((tx, idx) => {
                console.log(`   Transaction ${idx + 1}:`);
                console.log(`   → num_pa: ${tx.num_pa}`);
                console.log(`   → id_mutation: ${tx.id_mutation}`);
                console.log(`   → date_auth: ${tx.date_auth}`);
            });
        } else {
            console.log(`\n⚠️ [TRACE] Transaction cible absente après filtrage`);
        }
        
        // Remplacer la table originale par la version filtrée
        db.exec(`
            DROP TABLE achats_lotisseurs_meres;
            ALTER TABLE achats_lotisseurs_meres_filtered RENAME TO achats_lotisseurs_meres;
        `);
        
        // Optimisation : Checkpoint avant calcul du rang pour libérer l'espace
        console.log('   → Libération de l\'espace disque...');
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        
        // Créer index AVANT le calcul du rang pour optimiser
        console.log('   → Création index pour optimiser le calcul du rang...');
        db.exec(`CREATE INDEX idx_achats_meres_pa_date ON achats_lotisseurs_meres(num_pa, date_mutation);`);
        
        // Optimisation : Augmenter temporairement le cache pour le tri
        const oldCacheSize = db.prepare('PRAGMA cache_size').get();
        db.pragma('cache_size = -128000'); // 128 MB temporairement
        
        // Approche optimisée : On n'a besoin que du rang 1, donc on peut éviter ROW_NUMBER()
        // en utilisant une jointure avec une table de premières dates (plus rapide qu'une sous-requête corrélée)
        console.log('   → Calcul du rang (première transaction par PA)...');
        console.log('   → Étape 1/2 : Identification des premières dates par PA...');
        db.exec(`
            CREATE TEMP TABLE premieres_dates_pa AS
            SELECT 
                num_pa,
                MIN(date_mutation) as premiere_date
            FROM achats_lotisseurs_meres
            GROUP BY num_pa
        `);
        
        console.log('   → Étape 2/2 : Sélection des premières transactions...');
        db.exec(`
            CREATE TEMP TABLE achats_lotisseurs_meres_ranked AS
            SELECT 
                a.num_pa,
                a.id_mutation,
                a.date_mutation,
                a.date_auth,
                a.superficie,
                a.surface_totale_aggregee,
                a.code_commune,
                a.section,
                a.parcelle_normalisee,
                1 as rang
            FROM achats_lotisseurs_meres a
            INNER JOIN premieres_dates_pa p ON a.num_pa = p.num_pa AND a.date_mutation = p.premiere_date
        `);
        
        // Nettoyer la table temporaire
        db.exec('DROP TABLE premieres_dates_pa;');
        
        // Restaurer le cache_size
        db.pragma(`cache_size = ${oldCacheSize.cache_size}`);
        
        // Remplacer l'ancienne table
        db.exec(`
            DROP TABLE achats_lotisseurs_meres;
            ALTER TABLE achats_lotisseurs_meres_ranked RENAME TO achats_lotisseurs_meres;
        `);
        
        // LOG: Vérifier si la transaction cible est dans achats_lotisseurs_meres après calcul du rang
        const targetCheckRang = db.prepare(`
            SELECT * FROM achats_lotisseurs_meres
            WHERE code_commune = '40088'
              AND date_mutation LIKE '2019-10-11%'
              AND (surface_totale_aggregee > 20000 OR id_mutation = '000001')
        `).all();
        if (targetCheckRang.length > 0) {
            console.log(`\n🔍 [TRACE] Transaction cible dans achats_lotisseurs_meres après calcul du rang (${targetCheckRang.length} ligne(s)):`);
            targetCheckRang.forEach((tx, idx) => {
                console.log(`   Transaction ${idx + 1}:`);
                console.log(`   → num_pa: ${tx.num_pa}`);
                console.log(`   → id_mutation: ${tx.id_mutation}`);
                console.log(`   → rang: ${tx.rang}`);
                console.log(`   → date_mutation: ${tx.date_mutation}`);
            });
        } else {
            console.log(`\n⚠️ [TRACE] Transaction cible absente après calcul du rang`);
        }
        
        // UPDATE pour les achats sur parcelles mères (prendre le premier chronologiquement)
        // Vérifier commune, section et parcelle pour éviter les associations incorrectes
        // LOG: Vérifier si la transaction cible est dans achats_lotisseurs_meres avant mise à jour
        const targetCheckBefore = db.prepare(`
            SELECT * FROM achats_lotisseurs_meres
            WHERE code_commune = '40088'
              AND date_mutation LIKE '2019-10-11%'
              AND (surface_totale_aggregee > 20000 OR id_mutation = '000001')
              AND rang = 1
        `).all();
        if (targetCheckBefore.length > 0) {
            console.log(`\n🔍 [TRACE] Transaction cible dans achats_lotisseurs_meres avant UPDATE (${targetCheckBefore.length} ligne(s)):`);
            targetCheckBefore.forEach((tx, idx) => {
                console.log(`   Transaction ${idx + 1}:`);
                console.log(`   → num_pa: ${tx.num_pa}`);
                console.log(`   → id_mutation: ${tx.id_mutation}`);
                console.log(`   → date_mutation: ${tx.date_mutation}`);
                console.log(`   → surface_totale_aggregee: ${tx.surface_totale_aggregee}`);
            });
        }
        
        const nbAchatsMeres = db.prepare(`
            UPDATE terrains_batir_temp
            SET est_terrain_viabilise = 0,
                id_pa = (
                    SELECT num_pa 
                    FROM achats_lotisseurs_meres a 
                    WHERE a.id_mutation = terrains_batir_temp.id_mutation
                      AND a.rang = 1
                      AND a.code_commune = terrains_batir_temp.code_commune
                      AND a.section = terrains_batir_temp.section_cadastrale
                      AND (terrains_batir_temp.parcelle_suffixe = ('000' || a.parcelle_normalisee)
                           OR terrains_batir_temp.parcelle_suffixe = a.parcelle_normalisee)
                    LIMIT 1
                )
            WHERE id_mutation IN (
                SELECT id_mutation FROM achats_lotisseurs_meres WHERE rang = 1
            )
              -- NOTE: On n'exclut PAS les transactions avec surface bati pour les parcelles mères
              -- car elles peuvent avoir une petite surface bati (hangar, construction existante) et doivent être identifiées comme NON_VIABILISE
        `).run().changes;
        
        // LOG: Vérifier si la transaction cible a été mise à jour
        const targetCheckAfter = db.prepare(`
            SELECT * FROM terrains_batir_temp
            WHERE code_commune = '40088'
              AND date_mutation LIKE '2019-10-11%'
              AND valeur_fonciere > 400000 AND valeur_fonciere < 450000
        `).all();
        if (targetCheckAfter.length > 0) {
            console.log(`\n🔍 [TRACE] Transaction cible après UPDATE terrains_batir_temp (parcelles mères) (${targetCheckAfter.length} ligne(s)):`);
            targetCheckAfter.forEach((tx, idx) => {
                console.log(`   Transaction ${idx + 1}:`);
                console.log(`   → id_parcelle: ${tx.id_parcelle}`);
                console.log(`   → id_mutation: ${tx.id_mutation}`);
                console.log(`   → id_pa: ${tx.id_pa}`);
                console.log(`   → est_terrain_viabilise: ${tx.est_terrain_viabilise}`);
                console.log(`   → valeur_fonciere: ${tx.valeur_fonciere}`);
                console.log(`   → surface_totale: ${tx.surface_totale}`);
                console.log(`   → surface_reelle_bati: ${tx.surface_reelle_bati}`);
                console.log(`   → section_cadastrale: ${tx.section_cadastrale}`);
                console.log(`   → parcelle_suffixe: ${tx.parcelle_suffixe}`);
            });
        }
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
                    const numeroPadded = numeroClean.padStart(4, '0'); // Padding à 4 chiffres pour correspondre à DVF
                    const parcelleNormalisee = section + numeroPadded;
                    
                    // Chercher dans DFI (utiliser aussi la version sans padding pour la recherche DFI)
                    const parcelleNormaliseeDFI = section + numeroClean; // Version sans padding pour DFI
                    for (const dfi of dfiData) {
                        if (dfi.code_commune !== codeCommuneDFI) continue;
                        
                        const meres = (dfi.parcelles_meres || '').split(/[;,\s]+/).map(p => p.trim()).filter(p => p);
                        const filles = (dfi.parcelles_filles || '').split(/[;,\s]+/).map(p => p.trim()).filter(p => p);
                        
                        // Si la parcelle PA est une parcelle mère dans ce DFI (chercher avec ou sans padding)
                        if (meres.includes(parcelleNormaliseeDFI) || meres.includes(parcelleNormalisee)) {
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
        
        // SOUS-ÉTAPE 4.3.5 : Enrichir les superficies depuis la table parcelle si nulles
        console.log('⚡ 4.3.5 - Enrichissement des superficies depuis la table parcelle...');
        
        return new Promise((resolve) => {
            try {
                // Vérifier si la table parcelle existe dans la base attachée
                const tableExists = db.prepare(`
                    SELECT name FROM parcelles_db.sqlite_master 
                    WHERE type='table' AND name='parcelle'
                `).get();
                
                if (!tableExists) {
                    console.log(`   ⚠️  Table parcelle non trouvée dans parcelles_db, enrichissement ignoré\n`);
                    resolve();
                    return;
                }
                        
                // Mettre à jour pa_filles_temp avec les superficies depuis la table parcelle
                        db.exec(`
                            UPDATE pa_filles_temp
                            SET superficie = COALESCE(
                                NULLIF(pa_filles_temp.superficie, 0),
                        (SELECT s_geom_parcelle FROM parcelles_db.parcelle p 
                         WHERE p.parcelle_id = (
                                     pa_filles_temp.code_commune_dvf || 
                                     pa_filles_temp.section || 
                                     pa_filles_temp.parcelle_fille_suffixe
                         )
                         AND p.s_geom_parcelle > 0)
                            )
                            WHERE superficie IS NULL OR superficie = 0;
                        `);
                        
                        const countEnrichies = db.prepare(`
                            SELECT COUNT(*) as cnt FROM pa_filles_temp 
                            WHERE superficie IS NOT NULL AND superficie > 0
                        `).get().cnt;
                        console.log(`   ✅ ${countEnrichies} parcelles avec superficie après enrichissement\n`);
                        resolve();
            } catch (err) {
                console.log(`   ⚠️  Erreur lors de l'enrichissement des superficies: ${err.message}\n`);
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
                nb_parcelles INTEGER,
                code_commune_dvf TEXT,
                section TEXT,
                parcelle_fille_suffixe TEXT
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
        // OPTIMISATION : Créer index sur id_pa pour accélérer le filtre t.id_pa IS NULL
        console.log('   → Création index pour optimiser la jointure...');
        db.exec(`CREATE INDEX IF NOT EXISTS idx_temp_pa_null ON terrains_batir_temp(code_commune, section_cadastrale, parcelle_suffixe) WHERE id_pa IS NULL;`);
        
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
                COUNT(DISTINCT t.id_parcelle) as nb_parcelles,
                pf.code_commune_dvf,
                pf.section,
                pf.parcelle_fille_suffixe
            FROM pa_filles_temp pf
            INNER JOIN terrains_batir_temp t ON 
                t.code_commune = pf.code_commune_dvf
                AND t.section_cadastrale = pf.section
                AND t.parcelle_suffixe = pf.parcelle_fille_suffixe
                AND t.id_pa IS NULL  -- Pas déjà attribué (déplacé dans JOIN pour utiliser l'index)
            INNER JOIN mutations_aggregees m ON m.id_mutation = t.id_mutation
            WHERE pf.code_commune_dvf = ?
              -- Fenêtre temporelle supprimée : association basée uniquement sur la correspondance parcellaire
              AND m.valeur_totale > 1  -- Prix > 1€
              -- Exclure les transactions avec surface bati (terrains déjà construits)
              AND (m.surface_reelle_bati_aggregee IS NULL OR m.surface_reelle_bati_aggregee = 0)
            GROUP BY pf.num_pa, t.id_mutation, m.date_mutation, pf.date_auth, pf.superficie, m.surface_totale_aggregee, m.valeur_totale, pf.code_commune_dvf, pf.section, pf.parcelle_fille_suffixe
            HAVING COUNT(DISTINCT t.id_parcelle) >= 1
               AND (pf.superficie IS NULL OR pf.superficie = 0 OR m.surface_totale_aggregee BETWEEN pf.superficie * 0.7 AND pf.superficie * 1.3)
        `);
        
        // OPTIMISATION : Sauvegarder la valeur originale du cache (utilisée pour les deux optimisations)
        const oldCacheSizeFilles = db.prepare('PRAGMA cache_size').get();
        
        // Augmenter temporairement le cache pour accélérer les jointures
        db.pragma('cache_size = -64000'); // 64 MB temporairement
        
        let totalFillesMatches = 0;
        for (let i = 0; i < communesAvecFillesPA.length; i++) {
            const commune = communesAvecFillesPA[i].code_commune_dvf;
            const result = insertFillesBatch.run(commune);
            totalFillesMatches += result.changes;
            
            // LOG: Vérifier si la transaction cible a été associée dans achats_lotisseurs_filles
            if (commune === '40088' && result.changes > 0) {
                const targetCheckFilles = db.prepare(`
                    SELECT * FROM achats_lotisseurs_filles
                    WHERE code_commune_dvf = ?
                      AND date_mutation LIKE '2019-10-11%'
                      AND valeur_totale > 400000 AND valeur_totale < 450000
                `).all(commune);
                if (targetCheckFilles.length > 0) {
                    console.log(`\n🔍 [TRACE] Transaction cible associée dans achats_lotisseurs_filles (${targetCheckFilles.length} ligne(s)):`);
                    targetCheckFilles.forEach((tx, idx) => {
                        console.log(`   Transaction ${idx + 1}:`);
                        console.log(`   → num_pa: ${tx.num_pa}`);
                        console.log(`   → id_mutation: ${tx.id_mutation}`);
                        console.log(`   → date_mutation: ${tx.date_mutation}`);
                        console.log(`   → date_auth: ${tx.date_auth}`);
                        console.log(`   → valeur_totale: ${tx.valeur_totale}`);
                        console.log(`   → surface_totale_aggregee: ${tx.surface_totale_aggregee}`);
                        console.log(`   → nb_parcelles: ${tx.nb_parcelles}`);
                        console.log(`   → section: ${tx.section}`);
                        console.log(`   → parcelle_fille_suffixe: ${tx.parcelle_fille_suffixe}`);
                    });
                }
            }
            
            // CHECKPOINT moins fréquent pour améliorer les performances
            if ((i + 1) % 200 === 0) {
                db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
            }
            
            if ((i + 1) % 100 === 0 || i === communesAvecFillesPA.length - 1) {
                console.log(`   → ${i + 1}/${communesAvecFillesPA.length} communes traitées (${totalFillesMatches} matches trouvés)`);
            }
        }
        
        // Restaurer le cache_size original
        db.pragma(`cache_size = ${oldCacheSizeFilles.cache_size}`);
        
        // Supprimer l'index temporaire pour libérer de l'espace
        db.exec('DROP INDEX IF EXISTS idx_temp_pa_null;');
        
        console.log(`   → Jointure terminée : ${totalFillesMatches} associations PA-filles-DVF\n`);
        
        // NOUVEAU : Filtrer pour ne garder que le PA le plus récent (date_auth) en cas de correspondances multiples
        console.log('   → Filtrage : sélection du PA le plus récent par parcelle fille...');
        db.exec(`
            CREATE TEMP TABLE achats_lotisseurs_filles_filtered AS
            SELECT 
                a1.*
            FROM achats_lotisseurs_filles a1
            INNER JOIN (
                SELECT 
                    code_commune_dvf,
                    section,
                    parcelle_fille_suffixe,
                    id_mutation,
                    MAX(date_auth) as max_date_auth
                FROM achats_lotisseurs_filles
                GROUP BY code_commune_dvf, section, parcelle_fille_suffixe, id_mutation
            ) a2 ON a1.code_commune_dvf = a2.code_commune_dvf
                 AND a1.section = a2.section
                 AND a1.parcelle_fille_suffixe = a2.parcelle_fille_suffixe
                 AND a1.id_mutation = a2.id_mutation
                 AND a1.date_auth = a2.max_date_auth
        `);
        
        const nbAvantFiltreFilles = db.prepare('SELECT COUNT(*) as cnt FROM achats_lotisseurs_filles').get().cnt;
        const nbApresFiltreFilles = db.prepare('SELECT COUNT(*) as cnt FROM achats_lotisseurs_filles_filtered').get().cnt;
        console.log(`   → Filtrage terminé : ${nbAvantFiltreFilles} → ${nbApresFiltreFilles} associations (${nbAvantFiltreFilles - nbApresFiltreFilles} doublons supprimés)\n`);
        
        // Remplacer la table originale par la version filtrée
        db.exec(`
            DROP TABLE achats_lotisseurs_filles;
            ALTER TABLE achats_lotisseurs_filles_filtered RENAME TO achats_lotisseurs_filles;
        `);
        
        // Optimisation : Checkpoint avant calcul du rang pour libérer l'espace
        console.log('   → Libération de l\'espace disque...');
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        
        // Créer index AVANT le calcul du rang pour optimiser
        console.log('   → Création index pour optimiser le calcul du rang...');
        db.exec(`CREATE INDEX idx_achats_filles_pa_date ON achats_lotisseurs_filles(num_pa, date_mutation, nb_parcelles);`);
        
        // Optimisation : Augmenter temporairement le cache pour le tri (réutilise oldCacheSizeFilles sauvegardé plus haut)
        db.pragma('cache_size = -128000'); // 128 MB temporairement
        
        // Approche optimisée : On n'a besoin que du rang 1, donc on peut éviter ROW_NUMBER()
        // en utilisant une jointure avec une table de premières transactions (plus rapide)
        // Note: ORDER BY était date_mutation ASC, nb_parcelles DESC
        console.log('   → Calcul du rang (première transaction par PA)...');
        console.log('   → Étape 1/2 : Identification des premières dates par PA...');
        db.exec(`
            CREATE TEMP TABLE premieres_dates_filles AS
            SELECT 
                num_pa,
                MIN(date_mutation) as premiere_date
            FROM achats_lotisseurs_filles
            GROUP BY num_pa
        `);
        
        console.log('   → Étape 2/3 : Identification du max parcelles pour chaque PA/première date...');
        db.exec(`
            CREATE TEMP TABLE max_parcelles_premiere_date AS
            SELECT 
                a.num_pa,
                a.date_mutation,
                MAX(a.nb_parcelles) as max_parcelles
            FROM achats_lotisseurs_filles a
            INNER JOIN premieres_dates_filles p ON a.num_pa = p.num_pa AND a.date_mutation = p.premiere_date
            GROUP BY a.num_pa, a.date_mutation
        `);
        
        console.log('   → Étape 3/3 : Sélection des premières transactions...');
        db.exec(`
            CREATE TEMP TABLE achats_lotisseurs_filles_ranked AS
            SELECT 
                a.num_pa,
                a.id_mutation,
                a.date_mutation,
                a.date_auth,
                a.superficie,
                a.surface_totale_aggregee,
                a.valeur_totale,
                a.nb_parcelles,
                a.code_commune_dvf,
                a.section,
                a.parcelle_fille_suffixe,
                1 as rang
            FROM achats_lotisseurs_filles a
            INNER JOIN premieres_dates_filles p ON a.num_pa = p.num_pa AND a.date_mutation = p.premiere_date
            INNER JOIN max_parcelles_premiere_date m ON 
                a.num_pa = m.num_pa 
                AND a.date_mutation = m.date_mutation
                AND a.nb_parcelles = m.max_parcelles
        `);
        
        // Nettoyer les tables temporaires
        db.exec('DROP TABLE premieres_dates_filles;');
        db.exec('DROP TABLE max_parcelles_premiere_date;');
        
        // Restaurer le cache_size
        db.pragma(`cache_size = ${oldCacheSizeFilles.cache_size}`);
        
        // Remplacer l'ancienne table
        db.exec(`
            DROP TABLE achats_lotisseurs_filles;
            ALTER TABLE achats_lotisseurs_filles_ranked RENAME TO achats_lotisseurs_filles;
        `);
        
        // LOG: Vérifier si la transaction cible est dans achats_lotisseurs_filles avant UPDATE
        const targetCheckFillesBefore = db.prepare(`
            SELECT * FROM achats_lotisseurs_filles
            WHERE code_commune_dvf = '40088'
              AND date_mutation LIKE '2019-10-11%'
              AND valeur_totale > 400000 AND valeur_totale < 450000
              AND rang = 1
        `).all();
        if (targetCheckFillesBefore.length > 0) {
            console.log(`\n🔍 [TRACE] Transaction cible dans achats_lotisseurs_filles avant UPDATE (${targetCheckFillesBefore.length} ligne(s)):`);
            targetCheckFillesBefore.forEach((tx, idx) => {
                console.log(`   Transaction ${idx + 1}:`);
                console.log(`   → num_pa: ${tx.num_pa}`);
                console.log(`   → id_mutation: ${tx.id_mutation}`);
                console.log(`   → valeur_totale: ${tx.valeur_totale}`);
            });
        }
        
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
              -- Exclure les transactions avec surface bati
              AND (surface_reelle_bati IS NULL OR surface_reelle_bati = 0)
        `).run().changes;
        
        // LOG: Vérifier si la transaction cible a été mise à jour (parcelles filles)
        const targetCheckFillesAfter = db.prepare(`
            SELECT * FROM terrains_batir_temp
            WHERE code_commune = '40088'
              AND date_mutation LIKE '2019-10-11%'
              AND valeur_fonciere > 400000 AND valeur_fonciere < 450000
              AND id_pa IS NOT NULL
        `).all();
        if (targetCheckFillesAfter.length > 0) {
            console.log(`\n🔍 [TRACE] Transaction cible après UPDATE terrains_batir_temp (parcelles filles) (${targetCheckFillesAfter.length} ligne(s)):`);
            targetCheckFillesAfter.forEach((tx, idx) => {
                console.log(`   Transaction ${idx + 1}:`);
                console.log(`   → id_parcelle: ${tx.id_parcelle}`);
                console.log(`   → id_mutation: ${tx.id_mutation}`);
                console.log(`   → id_pa: ${tx.id_pa}`);
                console.log(`   → est_terrain_viabilise: ${tx.est_terrain_viabilise}`);
                console.log(`   → valeur_fonciere: ${tx.valeur_fonciere}`);
                console.log(`   → surface_totale: ${tx.surface_totale}`);
                console.log(`   → surface_reelle_bati: ${tx.surface_reelle_bati}`);
            });
        }
        
        console.log(`✅ ${nbAchatsFilles} achats lotisseurs sur parcelles filles\n`);
        
        // SOUS-ÉTAPE 4.5 : Lots vendus (viabilisés) - toutes les autres transactions sur parcelles filles
        console.log('⚡ 4.5 - Association lots vendus (viabilisés)...');
        
        // Approche ultra-optimisée : créer une table de correspondance avec clé composite
        // puis utiliser cette table pour UPDATE directement
        db.exec(`
            -- Créer une table de correspondance parcelle -> PA avec clé composite indexée
            -- IMPORTANT : Prendre le PA le plus récent (date_auth) en cas de correspondances multiples
            DROP TABLE IF EXISTS parcelle_pa_map;
            CREATE TEMP TABLE parcelle_pa_map (
                code_commune TEXT,
                section TEXT,
                parcelle_suffixe TEXT,
                num_pa TEXT,
                PRIMARY KEY (code_commune, section, parcelle_suffixe)
            );
            
            -- Filtrer pour ne garder que le PA le plus récent par parcelle
            INSERT OR IGNORE INTO parcelle_pa_map (code_commune, section, parcelle_suffixe, num_pa)
            SELECT 
                pf1.code_commune_dvf,
                pf1.section,
                pf1.parcelle_fille_suffixe,
                pf1.num_pa
            FROM pa_filles_temp pf1
            INNER JOIN (
                SELECT 
                    code_commune_dvf,
                    section,
                    parcelle_fille_suffixe,
                    MAX(date_auth) as max_date_auth
                FROM pa_filles_temp
                GROUP BY code_commune_dvf, section, parcelle_fille_suffixe
            ) pf2 ON pf1.code_commune_dvf = pf2.code_commune_dvf
                 AND pf1.section = pf2.section
                 AND pf1.parcelle_fille_suffixe = pf2.parcelle_fille_suffixe
                 AND pf1.date_auth = pf2.max_date_auth;
        `);
        
        // LOG: Vérifier si la transaction cible est dans parcelle_pa_map avant UPDATE (lots vendus)
        const targetCheckLotsBefore = db.prepare(`
            SELECT * FROM parcelle_pa_map
            WHERE code_commune = '40088'
        `).all();
        if (targetCheckLotsBefore.length > 0) {
            // Vérifier si les parcelles de la transaction cible sont dans parcelle_pa_map
            const targetParcelles = db.prepare(`
                SELECT DISTINCT parcelle_suffixe, section_cadastrale
                FROM terrains_batir_temp
                WHERE code_commune = '40088'
                  AND date_mutation LIKE '2019-10-11%'
                  AND valeur_fonciere > 400000 AND valeur_fonciere < 450000
            `).all();
            if (targetParcelles.length > 0) {
                console.log(`\n🔍 [TRACE] Parcelles de la transaction cible dans parcelle_pa_map avant UPDATE (lots vendus):`);
                targetParcelles.forEach((parc, idx) => {
                    const paMap = db.prepare(`
                        SELECT * FROM parcelle_pa_map
                        WHERE code_commune = '40088'
                          AND section = ?
                          AND parcelle_suffixe = ?
                    `).get(parc.section_cadastrale, parc.parcelle_suffixe);
                    if (paMap) {
                        console.log(`   Parcelle ${idx + 1} (${parc.section_cadastrale}/${parc.parcelle_suffixe}):`);
                        console.log(`   → num_pa: ${paMap.num_pa}`);
                    }
                });
            }
        }
        
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
              -- Exclure les transactions avec surface bati (terrains déjà construits)
              AND (surface_reelle_bati IS NULL OR surface_reelle_bati = 0)
        `).run().changes;
        
        // LOG: Vérifier si la transaction cible a été mise à jour (lots vendus)
        const targetCheckLotsAfter = db.prepare(`
            SELECT * FROM terrains_batir_temp
            WHERE code_commune = '40088'
              AND date_mutation LIKE '2019-10-11%'
              AND valeur_fonciere > 400000 AND valeur_fonciere < 450000
              AND est_terrain_viabilise = 1
        `).all();
        if (targetCheckLotsAfter.length > 0) {
            console.log(`\n🔍 [TRACE] Transaction cible après UPDATE terrains_batir_temp (lots vendus) (${targetCheckLotsAfter.length} ligne(s)):`);
            targetCheckLotsAfter.forEach((tx, idx) => {
                console.log(`   Transaction ${idx + 1}:`);
                console.log(`   → id_parcelle: ${tx.id_parcelle}`);
                console.log(`   → id_mutation: ${tx.id_mutation}`);
                console.log(`   → id_pa: ${tx.id_pa}`);
                console.log(`   → est_terrain_viabilise: ${tx.est_terrain_viabilise}`);
                console.log(`   → valeur_fonciere: ${tx.valeur_fonciere}`);
                console.log(`   → section_cadastrale: ${tx.section_cadastrale}`);
                console.log(`   → parcelle_suffixe: ${tx.parcelle_suffixe}`);
            });
        }
        
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
        
        // FIN ÉTAPE 4 - Passer directement aux statistiques
        });
    }).catch(err => {
        console.error('❌ Erreur lors du chargement des données:', err);
        db.close();
        process.exit(1);
    });
    
    console.log('📊 ÉTAPE 6 : Enrichissement des coordonnées depuis les parcelles cadastrales...');
    enrichirCoordonnees(db).then(() => {
        // ÉTAPE 7 : Créer la table finale simplifiée
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
              -- Exclure les transactions avec surface bati (terrains déjà construits)
              AND (surface_reelle_bati IS NULL OR surface_reelle_bati = 0)
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
        // ⚠️ Pas de VACUUM : trop lourd avec base parcelles.db (12GB) attachée
        // SQLite gère bien l'espace inutilisé sans VACUUM
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
    }).catch(err => {
        console.error('❌ Erreur lors de l\'enrichissement des coordonnées:', err);
        db.close();
        process.exit(1);
    });
});
}).catch(err => {
    console.error('❌ Erreur:', err);
    process.exit(1);
});
} // Fin de demarrerCreationBase()
