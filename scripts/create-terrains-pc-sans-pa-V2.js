/**
 * Script pour créer une base de données des terrains à bâtir issus de PC (Permis de Construire)
 * SANS PA (Permis d'Aménager) - VERSION SOURCE DVF BRUTE
 * 
 * LOGIQUE :
 * 1. Charger les PC habitation individuelle :
 *    a) Nouvelle construction (nature_projet = 1)
 *    b) Rénovation/Réhabilitation (nature_projet = 2) avec surface habitable avant ET après
 * 2. Pour chaque PC, identifier via DFI :
 *    - Si PC sur parcelle MÈRE → Récupérer les parcelles FILLES
 *    - Si PC sur parcelle FILLE → Utiliser cette parcelle
 * 3. Chercher les transactions DVF dans les FICHIERS BRUTS
 * 4. FILTRES DVF :
 *    - Type local = "Maison" (habitation individuelle)
 *    - Pour nature_projet = 1 : terrain nu ou avec maison
 *    - Pour nature_projet = 2 : maison avec bâti (rénovation)
 * 5. Enrichir avec coordonnées depuis parcelle.csv
 * 6. Créer base terrains_pc_sans_pa.db
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const { spawn } = require('child_process');

const DB_FILE = path.join(__dirname, '..', 'database', 'terrains_pc_sans_pa.db');
const DB_SOURCE = path.join(__dirname, '..', 'database', 'terrains_batir.db');
const DVF_DIR = path.join(__dirname, '..', 'dvf_data');
// BDNB France entière - fichier parcelle.csv dans bdnb_data/csv
const PARCELLE_FILE = path.join(__dirname, '..', 'bdnb_data', 'csv', 'parcelle.csv');
const LISTE_AUTORISATIONS_FILE = path.join(__dirname, '..', '..', 'Liste-des-autorisations-durbanisme-creant-des-logements.2025-10.csv');
// Plus de filtre département - France entière

// =======================
// FONCTIONS DE GÉOLOCALISATION
// =======================

// Fonction pour extraire le centroïde d'une géométrie Lambert 93
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
function lambert93ToWGS84(x, y) {
    // Formule de transformation Lambert 93 vers WGS84
    const a = 6378137.0;
    const e = 0.081819191;
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

// Fonction pour enrichir les coordonnées depuis le fichier parcelle.csv
function enrichirCoordonnees(db) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(PARCELLE_FILE)) {
            console.log('   ⚠️  Fichier parcelle.csv non trouvé, enrichissement coordonnées ignoré\n');
            resolve();
            return;
        }
        
        console.log('   📂 Chargement des parcelles avec coordonnées...');
        
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
                
                console.log('   🔗 Enrichissement des coordonnées...');
                
                const transactionsSansCoords = db.prepare(`
                    SELECT DISTINCT id_parcelle
                    FROM terrains_pc_sans_pa_temp
                    WHERE (latitude IS NULL OR latitude = 0 OR longitude IS NULL OR longitude = 0)
                        AND id_parcelle IS NOT NULL
                `).all();
                
                console.log(`   ${transactionsSansCoords.length} transactions sans coordonnées trouvées`);
                
                const updateStmt = db.prepare(`
                    UPDATE terrains_pc_sans_pa_temp
                    SET latitude = ?, longitude = ?
                    WHERE id_parcelle = ?
                        AND (latitude IS NULL OR latitude = 0 OR longitude IS NULL OR longitude = 0)
                `);
                
                let countUpdated = 0;
                let countViaMere = 0;
                let countNotFound = 0;
                
                for (const tx of transactionsSansCoords) {
                    // Essayer d'abord avec l'id_parcelle direct
                    let coords = parcelleCoords.get(tx.id_parcelle);
                    
                    if (!coords) {
                        // Si pas trouvé, essayer avec la parcelle_mere
                        const txDetails = db.prepare(`
                            SELECT parcelle_mere 
                            FROM terrains_pc_sans_pa_temp 
                            WHERE id_parcelle = ? AND parcelle_mere IS NOT NULL
                            LIMIT 1
                        `).get(tx.id_parcelle);
                        
                        if (txDetails && txDetails.parcelle_mere) {
                            // La parcelle_mere est au format "BL56", il faut la convertir en id_parcelle
                            // Format attendu : 40088000BL0056
                            const codeCommune = tx.id_parcelle.substring(0, 5);
                            const match = txDetails.parcelle_mere.match(/^([A-Z]+)(\d+)$/);
                            if (match) {
                                const [, section, numero] = match;
                                const numeroPad = numero.padStart(4, '0');
                                const parcelleIdMere = `${codeCommune}000${section}${numeroPad}`;
                                coords = parcelleCoords.get(parcelleIdMere);
                                if (coords) countViaMere++;
                            }
                        }
                    }
                    
                    if (coords && coords.latitude && coords.longitude) {
                        updateStmt.run(coords.latitude, coords.longitude, tx.id_parcelle);
                        countUpdated++;
                    } else {
                        countNotFound++;
                    }
                }
                
                console.log(`   ✅ ${countUpdated} transactions enrichies`);
                if (countViaMere > 0) {
                    console.log(`      → ${countViaMere} via parcelle mère`);
                }
                if (countNotFound > 0) {
                    console.log(`   ⚠️  ${countNotFound} transactions sans coordonnées trouvées dans le cadastre\n`);
                } else {
                    console.log('');
                }
                
                resolve();
            })
            .on('error', (err) => {
                console.log(`   ⚠️  Erreur lors du chargement: ${err.message}\n`);
                resolve();
            });
    });
}

console.log('🏗️  CRÉATION BASE DE DONNÉES : Terrains PC sans PA (SOURCE DVF BRUTE)\n');
console.log('═'.repeat(60));
console.log('');

// Supprimer l'ancienne base si elle existe
if (fs.existsSync(DB_FILE)) {
    try {
        fs.unlinkSync(DB_FILE);
        console.log('🗑️  Ancienne base supprimée\n');
    } catch (err) {
        if (err.code === 'EBUSY') {
            console.log('⚠️  Base de données verrouillée, tentative de fermeture...\n');
            // Attendre un peu et réessayer
            setTimeout(() => {
                try {
                    fs.unlinkSync(DB_FILE);
                    console.log('🗑️  Ancienne base supprimée\n');
                } catch (err2) {
                    console.log(`⚠️  Impossible de supprimer la base: ${err2.message}\n`);
                    console.log('   → Continuons avec la base existante...\n');
                }
            }, 1000);
        } else {
            console.log(`⚠️  Erreur lors de la suppression: ${err.message}\n`);
            console.log('   → Continuons avec la base existante...\n');
        }
    }
}

// Créer la nouvelle base
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

// Ouvrir la base source pour DFI uniquement
const dbSource = new Database(DB_SOURCE, { readonly: true });

// Créer la structure
console.log('📊 Création de la structure...\n');

db.exec(`
    DROP TABLE IF EXISTS terrains_pc_sans_pa_temp;
    CREATE TABLE terrains_pc_sans_pa_temp (
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
        nom_commune TEXT,
        section_cadastrale TEXT,
        num_pc TEXT,
        date_pc TEXT,
        type_parcelle TEXT,
        type_projet TEXT,
        id_dfi TEXT,
        parcelle_mere TEXT,
        type_local TEXT,
        adresse_nom_voie TEXT,
        adresse_numero TEXT
    );
    
    CREATE INDEX idx_temp_parcelle ON terrains_pc_sans_pa_temp(id_parcelle);
    CREATE INDEX idx_temp_mutation ON terrains_pc_sans_pa_temp(id_mutation);
    CREATE INDEX idx_temp_parcelle_mutation ON terrains_pc_sans_pa_temp(id_parcelle, id_mutation);
    CREATE INDEX idx_temp_pc ON terrains_pc_sans_pa_temp(num_pc);
    CREATE INDEX idx_temp_commune ON terrains_pc_sans_pa_temp(nom_commune);
    CREATE INDEX idx_temp_date ON terrains_pc_sans_pa_temp(date_mutation);
    CREATE INDEX idx_temp_type ON terrains_pc_sans_pa_temp(type_parcelle);
    CREATE INDEX idx_temp_type_projet ON terrains_pc_sans_pa_temp(type_projet);
`);

console.log('✅ Structure créée\n');

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

// ÉTAPE 1 : Charger les PC
console.log('📂 ÉTAPE 1 : Chargement des PC habitation individuelle (construction + rénovation)...\n');

const pcParcelles = new Map();

const chargementPC = new Promise((resolve, reject) => {
    fs.createReadStream(LISTE_AUTORISATIONS_FILE)
        .pipe(csv({ separator: ';', skipLinesWithError: true }))
        .on('data', (row) => {
            const dept = row.DEP_CODE || row.DEP || '';
            const typeDau = row.TYPE_DAU || '';
            
            if (typeDau !== 'PC') return;
            
            const natureProjetDeclaree = row.NATURE_PROJET_DECLAREE || '';
            const natureProjetCompletee = row.NATURE_PROJET_COMPLETEE || '';
            const destination = row.DESTINATION_PRINCIPALE || '';
            const typePrincipal = row.TYPE_PRINCIP_LOGTS_CREES || '';
            const nbLogInd = parseInt(row.NB_LGT_IND_CREES || row.NB_LGT_INDIV_PURS || row.NB_LGT_INDIV_GROUPES || 0);
            const nbLogCol = parseInt(row.NB_LGT_COL_CREES || row.NB_LGT_COL_HORS_RES || 0);
            
            // Filtres communs
            if (destination !== '1') return; // Habitation uniquement
            if (typePrincipal !== '1' && typePrincipal !== '2') return; // Individuel pur ou groupé
            if (nbLogInd === 0 || nbLogCol > 0) return; // Au moins 1 log individuel, pas de collectif
            
            // Accepter deux types de projets :
            // 1. Nouvelle construction (nature_projet = 1)
            // 2. Rénovation/Réhabilitation (nature_projet = 2) avec surface habitable avant ET après
            let typeProjet = 'NOUVELLE_CONSTRUCTION';
            
            if (natureProjetDeclaree === '1' || natureProjetCompletee === '1') {
                typeProjet = 'NOUVELLE_CONSTRUCTION';
            } else if (natureProjetDeclaree === '2' || natureProjetCompletee === '2') {
                // Pour les rénovations, vérifier qu'il y a une surface habitable avant ET après
                const surfAvant = parseFloat(row.SURF_HAB_AVANT || 0);
                const surfCreee = parseFloat(row.SURF_HAB_CREEE || 0);
                const surfTransfo = parseFloat(row.SURF_HAB_ISSUE_TRANSFO || 0);
                
                if (surfAvant <= 0 || (surfCreee <= 0 && surfTransfo <= 0)) {
                    return; // Pas de bâti avant ou pas de surface après travaux
                }
                
                typeProjet = 'RENOVATION';
            } else {
                return; // Ni construction ni rénovation
            }
            
            const commune = row.COMM || '';
            const numDau = row.NUM_DAU || '';
            const dateAuth = row.DATE_REELLE_AUTORISATION || '';
            const surfaceTerrain = parseFloat(row.SUPERFICIE_TERRAIN || row.SURFACE_TERRAIN || row.SURF_TERRAIN || 0);
            
            // Extraire le code département et la commune
            // Format attendu : commune peut être 3 chiffres (code INSEE commune) ou 5 chiffres (dept + commune)
            let codeDept = dept || '';
            let codeCommune = commune || '';
            
            if (commune && commune.length >= 5) {
                // Si commune est au format 5 chiffres (ex: "40001"), extraire dept et commune
                codeDept = commune.substring(0, 2);
                codeCommune = commune.substring(2, 5);
            } else if (commune && commune.length === 3) {
                // Si commune est au format 3 chiffres, utiliser DEP_CODE ou DEP pour le département
                codeDept = dept || '';
                codeCommune = commune;
            } else {
                // Format non reconnu, essayer d'extraire depuis commune
                codeDept = dept || '';
                codeCommune = commune || '';
            }
            
            codeDept = codeDept.padStart(2, '0');
            codeCommune = codeCommune.padStart(3, '0');
            
            // Code INSEE complet (5 chiffres) pour construction id_parcelle
            const codeINSEE = `${codeDept}${codeCommune}`;
            
            for (let i = 1; i <= 3; i++) {
                const section = row[`SEC_CADASTRE${i}`] || '';
                const numero = row[`NUM_CADASTRE${i}`] || '';
                
                if (section && numero) {
                    const numeroClean = numero.replace(/p$/i, '').trim();
                    const numeroInt = parseInt(numeroClean, 10);
                    const numPadded = numeroClean.padStart(4, '0');
                    
                    // Garder la section telle quelle (peut être 1 ou 2 caractères)
                    let sectionNorm = section.toUpperCase().trim();
                    if (sectionNorm.length > 2) {
                        sectionNorm = sectionNorm.substring(0, 2);
                    }
                    
                    // Créer plusieurs variantes de l'id_parcelle pour la recherche dans DVF
                    // Format standard DVF : codeINSEE(5) + prefixe(3) + section(2) + numero(4) = 14 caractères
                    // Variante 1 : section paddée à 2 caractères (format standard)
                    let sectionPadded = sectionNorm.padStart(2, '0');
                    const parcelleId1 = `${codeINSEE}000${sectionPadded}${numPadded}`; // 14 caractères
                    // Variante 2 : section sans padding (si 1 caractère) - format non-standard mais possible
                    const parcelleId2 = sectionNorm.length === 1 
                        ? `${codeINSEE}000${sectionNorm}${numPadded}` // 13 caractères
                        : null;
                    
                    const parcelleDFI = `${section}${numeroInt}`;
                    
                    // Stocker toutes les variantes dans la map de recherche
                    const pcInfo = {
                        numDau,
                        dateAuth,
                        commune,
                        parcelleDFI,
                        surfaceTerrain,
                        typeProjet,
                        sectionOriginale: sectionNorm
                    };
                    
                    if (!pcParcelles.has(parcelleId1)) {
                        pcParcelles.set(parcelleId1, []);
                    }
                    pcParcelles.get(parcelleId1).push(pcInfo);
                    
                    // Ajouter aussi la variante sans padding si elle existe
                    if (parcelleId2 && parcelleId2 !== parcelleId1) {
                        if (!pcParcelles.has(parcelleId2)) {
                            pcParcelles.set(parcelleId2, []);
                        }
                        pcParcelles.get(parcelleId2).push(pcInfo);
                    }
                }
            }
        })
        .on('end', resolve)
        .on('error', reject);
});

chargementPC.then(() => {
    console.log(`✅ ${pcParcelles.size} parcelles PC chargées`);
    // Debug : afficher quelques exemples de parcelles PC
    if (pcParcelles.size > 0) {
        const exemples = Array.from(pcParcelles.keys()).slice(0, 5);
        console.log(`   Exemples de parcelles PC: ${exemples.join(', ')}\n`);
    } else {
        console.log(`   ⚠️  Aucune parcelle PC trouvée !\n`);
    }
    
    // ÉTAPE 2 : Identifier les parcelles via DFI
    console.log('📂 ÉTAPE 2 : Identification des parcelles via DFI...\n');
    
    let pcMeres = 0;
    let pcFilles = 0;
    let pcSansDFI = 0;
    const parcellesRecherche = new Map();
    
    for (const [parcellePC, pcs] of pcParcelles.entries()) {
        const pc = pcs[0];
        const codeCommuneDFI = pc.commune.slice(-3);
        const pattern = pc.parcelleDFI;
        
        // S'assurer que pc.sectionOriginale est disponible
        if (!pc.sectionOriginale && parcellePC.length >= 14) {
            const sectionPadded = parcellePC.substring(8, 10);
            pc.sectionOriginale = sectionPadded.replace(/^0+/, '') || sectionPadded;
        }
        
        // Extraire le code département depuis parcellePC (2 premiers caractères)
        const codeDeptPC = parcellePC.substring(0, 2);
        
        const dfiMeres = dbSource.prepare(`
            SELECT id_dfi, parcelles_filles, parcelles_meres
            FROM dfi_lotissements
            WHERE code_commune = ?
              AND code_departement = ?
              AND (
                  parcelles_meres = ?
                  OR parcelles_meres LIKE ?
                  OR parcelles_meres LIKE ?
                  OR parcelles_meres LIKE ?
              )
        `).all(codeCommuneDFI, codeDeptPC, pattern, `${pattern};%`, `%;${pattern};%`, `%;${pattern}`);
        
        if (dfiMeres.length > 0) {
            pcMeres++;
            
            // AJOUT : Chercher AUSSI sur la parcelle mère elle-même
            parcellesRecherche.set(parcellePC, {
                type: 'MERE',
                pc: pc,
                parcellePC: parcellePC,
                parcelleMere: null,
                parcelleDFI: pattern,
                idDFI: dfiMeres[0].id_dfi
            });
            
            // Chercher sur les parcelles filles
            for (const dfi of dfiMeres) {
                if (dfi.parcelles_filles) {
                    const filles = dfi.parcelles_filles.split(';').filter(p => p && p.trim()).map(p => p.trim());
                    for (const fille of filles) {
                        const match = fille.match(/^([A-Z]+)(\d+)$/);
                        if (match) {
                            const section = match[1];
                            const numero = match[2];
                            const numPadded = numero.padStart(4, '0');
                            const communePadded = codeCommuneDFI.padStart(3, '0'); // Utiliser codeCommuneDFI (3 derniers chiffres)
                            // Utiliser le code département extrait de parcellePC au lieu de hardcoder '40'
                            const parcelleFille = `${codeDeptPC}${communePadded}000${section}${numPadded}`;
                            
                            parcellesRecherche.set(parcelleFille, {
                                type: 'FILLE',
                                pc: pc,
                                parcellePC: parcellePC,
                                parcelleMere: pattern,
                                parcelleDFI: fille,
                                idDFI: dfi.id_dfi
                            });
                        }
                    }
                }
            }
        } else {
            // Extraire le code département depuis parcellePC (2 premiers caractères)
            const codeDeptPC = parcellePC.substring(0, 2);
            
            const dfiFilles = dbSource.prepare(`
                SELECT id_dfi, parcelles_meres, parcelles_filles
                FROM dfi_lotissements
                WHERE code_commune = ?
                  AND code_departement = ?
                  AND (
                      parcelles_filles = ?
                      OR parcelles_filles LIKE ?
                      OR parcelles_filles LIKE ?
                      OR parcelles_filles LIKE ?
                  )
            `).all(codeCommuneDFI, codeDeptPC, pattern, `${pattern};%`, `%;${pattern};%`, `%;${pattern}`);
            
            if (dfiFilles.length > 0) {
                pcFilles++;
                parcellesRecherche.set(parcellePC, {
                    type: 'PC_SUR_FILLE',
                    pc: pc,
                    parcellePC: parcellePC,
                    parcelleMere: dfiFilles[0].parcelles_meres,
                    parcelleDFI: pattern,
                    idDFI: dfiFilles[0].id_dfi
                });
            } else {
                pcSansDFI++;
                parcellesRecherche.set(parcellePC, {
                    type: 'PC_SANS_DFI',
                    pc: pc,
                    parcellePC: parcellePC,
                    parcelleMere: null,
                    parcelleDFI: pattern,
                    idDFI: null
                });
            }
        }
    }
    
    console.log(`   ✅ ${pcMeres} PC sur parcelles MÈRES`);
    console.log(`   ✅ ${pcFilles} PC sur parcelles FILLES`);
    console.log(`   ✅ ${pcSansDFI} PC sans DFI`);
    console.log(`   → Total : ${parcellesRecherche.size} parcelles à chercher\n`);
    
    // Créer un index secondaire comme dans le script PA
    // Utiliser code_commune (5 chiffres), section (originale), et parcelle_suffixe (9 caractères)
    // Format identique au script create-terrains-batir-V3.js
    const parcellesParCommuneSectionSuffixe = new Map();
    let countIndexed = 0;
    let countSkipped = 0;
    
    // Fonction pour extraire section cadastrale (identique au script PA)
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
    
    for (const [idParcelle, info] of parcellesRecherche.entries()) {
        if (idParcelle.length < 13) {
            countSkipped++;
            continue;
        }
        
        // Format identique au script PA :
        // code_commune = les 5 premiers caractères (dept + commune)
        // parcelle_suffixe = prefixe(3) + section_originale(1-2) + numero(4) = 8-9 caractères
        // section_cadastrale = section originale extraite (non-paddée)
        const codeCommune = idParcelle.substring(0, 5); // 5 chiffres : dept + commune
        
        if (idParcelle.length < 13) {
            countSkipped++;
            continue;
        }
        
        // Extraire la section originale AVANT de construire le suffixe
        let sectionOriginale = null;
        if (info && info.pc && info.pc.sectionOriginale) {
            sectionOriginale = info.pc.sectionOriginale;
        } else {
            // Utiliser la fonction extraireSection comme dans le script PA
            sectionOriginale = extraireSection(idParcelle);
            if (!sectionOriginale) {
                // Fallback: extraire depuis id_parcelle
                if (idParcelle.length === 14) {
                    const sectionPadded = idParcelle.substring(8, 10);
                    sectionOriginale = sectionPadded.replace(/^0+/, '') || sectionPadded;
                } else if (idParcelle.length === 13) {
                    sectionOriginale = idParcelle.substring(8, 9);
                }
            }
        }
        
        if (!sectionOriginale) {
            countSkipped++;
            continue;
        }
        
        // Construire parcelle_suffixe avec la section originale (comme dans le script PA)
        // Format : prefixe(3) + section_originale(1-2) + numero(4)
        // IMPORTANT : utiliser section originale (non-paddée) dans le suffixe
        let parcelleSuffixe = null;
        if (idParcelle.length === 14) {
            // Format standard : extraire prefixe, numero, et reconstruire avec section originale
            const prefixe = idParcelle.substring(5, 8);
            const numero = idParcelle.substring(10, 14);
            // Reconstruire avec section originale (comme dans script PA)
            parcelleSuffixe = `${prefixe}${sectionOriginale}${numero}`;
        } else if (idParcelle.length === 13) {
            // Format avec section 1 caractère
            const prefixe = idParcelle.substring(5, 8);
            const numero = idParcelle.substring(9, 13);
            parcelleSuffixe = `${prefixe}${sectionOriginale}${numero}`;
        } else {
            countSkipped++;
            continue;
        }
        
        // Clé composite : code_commune + section_originale + parcelle_suffixe
        const cle = `${codeCommune}|${sectionOriginale}|${parcelleSuffixe}`;
        
        // Debug: afficher quelques exemples
        if (countIndexed < 10) {
            console.log(`   Debug index [${countIndexed}]: idParcelle=${idParcelle}, codeCommune=${codeCommune}, section=${sectionOriginale}, suffixe=${parcelleSuffixe}`);
        }
        
        countIndexed++;
        
        if (!parcellesParCommuneSectionSuffixe.has(cle)) {
            parcellesParCommuneSectionSuffixe.set(cle, []);
        }
        parcellesParCommuneSectionSuffixe.get(cle).push({ 
            idParcelle, 
            info,
            codeCommune: codeCommune,
            sectionOriginale: sectionOriginale,
            parcelleSuffixe: parcelleSuffixe
        });
    }
    
    console.log(`   📊 Index secondaire créé : ${parcellesParCommuneSectionSuffixe.size} clés (commune|section|suffixe)`);
    console.log(`   → ${countIndexed} parcelles indexées, ${countSkipped} ignorées (format non reconnu)\n`);
    
    // ÉTAPE 3 : Chercher dans les fichiers DVF bruts
    console.log('📂 ÉTAPE 3 : Lecture des fichiers DVF bruts...\n');
    
    const dvfFiles = fs.readdirSync(DVF_DIR).filter(f => 
        f.startsWith('dvf_') && f.endsWith('.csv')
    ).sort();
    
    console.log(`   ${dvfFiles.length} fichiers DVF trouvés\n`);
    
    let transactionsTrouvees = 0;
    let transactionsRejeteesSurface = 0;
    const transactionsMap = new Map(); // id_mutation → transaction
    
    const insertStmt = db.prepare(`
        INSERT INTO terrains_pc_sans_pa_temp (
            id_parcelle, id_mutation, valeur_fonciere, surface_totale, surface_reelle_bati,
            prix_m2, date_mutation, latitude, longitude, code_departement, nom_commune, section_cadastrale,
            num_pc, date_pc, type_parcelle, type_projet, id_dfi, parcelle_mere, type_local,
            adresse_nom_voie, adresse_numero
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Fonction pour détecter automatiquement le séparateur d'un fichier CSV
    // Tous les fichiers DVF sont maintenant normalisés avec des virgules
    function detecterSeparateur(filePath) {
        try {
            // Lire seulement la première ligne (plus rapide et suffisant)
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(8192); // Lire les 8 premiers KB
            const bytesRead = fs.readSync(fd, buffer, 0, 8192, 0);
            fs.closeSync(fd);
            const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0];
            
            if (!firstLine || firstLine.trim().length === 0) {
                return ','; // Par défaut virgule pour fichiers normalisés
            }
            
            // Compter les pipes et virgules dans la première ligne
            const countPipe = (firstLine.match(/\|/g) || []).length;
            const countComma = (firstLine.match(/,/g) || []).length;
            
            // Les fichiers normalisés utilisent des virgules
            // Si beaucoup de virgules, c'est probablement le séparateur
            if (countComma > countPipe && countComma > 5) {
                return ',';
            }
            // Si beaucoup de pipes, c'est l'ancien format
            if (countPipe > countComma && countPipe > 5) {
                return '|';
            }
            // Par défaut, utiliser la virgule (fichiers normalisés)
            return ',';
        } catch (err) {
            // En cas d'erreur, utiliser la virgule (fichiers normalisés)
            return ',';
        }
    }
    
    const processFile = (fileName) => {
        return new Promise((resolve, reject) => {
            const filePath = path.join(DVF_DIR, fileName);
            let count = 0;
            let totalRows = 0;
            let idParcelleExemples = new Set();
            
            // Détecter automatiquement le séparateur en analysant la première ligne
            const separator = detecterSeparateur(filePath);
            console.log(`   🔍 Séparateur détecté pour ${fileName}: "${separator}"`);
            
            fs.createReadStream(filePath)
                .pipe(csv({ separator, skipLinesWithError: true }))
                .on('data', (row) => {
                    // Format DVF uniformisé : tous les fichiers sont maintenant normalisés
                    // Colonnes en minuscules avec underscores (ex: "code_departement", "valeur_fonciere")
                    
                    totalRows++;
                    
                    // Reconstruire id_parcelle avec section corrigée
                    let idParcelle = row.id_parcelle || '';
                    
                    if (!idParcelle) {
                        // Construire depuis les colonnes normalisées
                        const dept = (row.code_departement || '').trim().padStart(2, '0');
                        const comm = (row.code_commune || '').trim().padStart(3, '0');
                        const prefixeSectionRaw = (row.prefixe_section || row.prefixe_de_section || '').trim();
                        const prefixeSection = prefixeSectionRaw ? prefixeSectionRaw.padStart(3, '0') : '000';
                        const sectionRaw = (row.section || '').trim();
                        const noPlan = (row.numero_plan || row.no_plan || '').trim().padStart(4, '0');
                        
                        if (dept && dept.length === 2 && comm && comm.length === 3 && sectionRaw && noPlan && noPlan.length === 4) {
                            // Normaliser la section (1-2 caractères, peut être alphanumérique)
                            let sectionNorm = sectionRaw.toUpperCase();
                            if (sectionNorm.length === 1) {
                                sectionNorm = '0' + sectionNorm;
                            } else if (sectionNorm.length === 0) {
                                return; // Skip si pas de section
                            }
                            // S'assurer que la section fait 2 caractères
                            sectionNorm = sectionNorm.padStart(2, '0').substring(0, 2);
                            idParcelle = dept + comm + prefixeSection + sectionNorm + noPlan;
                        }
                    }
                    
                    // France entière - pas de filtre département
                    if (!idParcelle) return;
                    
                    // Collecter quelques exemples d'id_parcelle pour debug
                    if (idParcelleExemples.size < 5) {
                        idParcelleExemples.add(idParcelle);
                    }
                    
                    // Recherche flexible : essayer d'abord l'id_parcelle exact, puis par commune+numéro
                    let found = false;
                    let info = null;
                    let debugTentatives = [];
                    
                    // Extraire la section originale DVF depuis row.section (avant normalisation)
                    const sectionRawDVF = (row.section || '').trim().toUpperCase();
                    
                    // Format identique au script PA : utiliser code_commune, section, et parcelle_suffixe
                    if (idParcelle.length >= 14) {
                        // Format id_parcelle DVF : dept(2) + comm(3) + prefixe(3) + section(2) + numero(4) = 14
                        const codeCommune = idParcelle.substring(0, 5); // 5 chiffres : dept + commune
                        
                        // Extraire la section originale DVF (comme dans le script PA)
                        let sectionDVFOriginale = sectionRawDVF;
                        
                        // Si pas de section dans row.section, utiliser extraireSection
                        if (!sectionDVFOriginale) {
                            // Fonction extraireSection (identique au script PA)
                            let match = idParcelle.match(/\d{5}000([A-Z]+)\d+/);
                            if (match) {
                                sectionDVFOriginale = match[1];
                            } else {
                                match = idParcelle.match(/\d{5}\d{3}([A-Z]{2})\d{4}/);
                                if (match) {
                                    sectionDVFOriginale = match[1];
                                } else {
                                    match = idParcelle.match(/\d{5}\d{3}([A-Z])\d{4}/);
                                    if (match) {
                                        sectionDVFOriginale = match[1];
                                    }
                                }
                            }
                        }
                        
                        if (!sectionDVFOriginale) {
                            // Fallback: extraire depuis id_parcelle
                            const sectionPadded = idParcelle.substring(8, 10);
                            sectionDVFOriginale = sectionPadded.replace(/^0+/, '') || sectionPadded;
                        }
                        
                        // Construire parcelle_suffixe avec la section originale (comme dans le script PA)
                        // Format : prefixe(3) + section_originale(1-2) + numero(4)
                        // IMPORTANT : id_parcelle contient toujours la section paddée à 2 caractères
                        // Format id_parcelle : dept(2) + comm(3) + prefixe(3) + section_padded(2) + numero(4) = 14
                        const prefixe = idParcelle.substring(5, 8);
                        // Le numéro est toujours aux 4 derniers caractères (positions 10-14)
                        const numero = idParcelle.substring(10, 14);
                        // Reconstruire le suffixe avec la section originale (non-paddée)
                        const parcelleSuffixe = `${prefixe}${sectionDVFOriginale}${numero}`;
                        
                        // Clé composite : code_commune + section_originale + parcelle_suffixe (identique au script PA)
                        const cle = `${codeCommune}|${sectionDVFOriginale}|${parcelleSuffixe}`;
                        debugTentatives.push(`Recherche: codeCommune=${codeCommune}, section=${sectionDVFOriginale}, suffixe=${parcelleSuffixe}`);
                        
                        // Recherche exacte avec la clé composite
                        if (parcellesParCommuneSectionSuffixe.has(cle)) {
                            const matches = parcellesParCommuneSectionSuffixe.get(cle);
                            if (matches && matches.length > 0) {
                                info = matches[0].info;
                                found = true;
                                debugTentatives.push(`  ✓ Match trouvé !`);
                            }
                        } else {
                            debugTentatives.push(`  Pas de match pour ${cle}`);
                            
                            // Essayer aussi avec préfixe '000' si différent
                            const prefixe = parcelleSuffixe.substring(0, 3);
                            if (prefixe !== '000') {
                                const suffixeAvec000 = '000' + parcelleSuffixe.substring(3);
                                const cleVariante = `${codeCommune}|${sectionDVFOriginale}|${suffixeAvec000}`;
                                debugTentatives.push(`  Essai variante avec préfixe 000: ${cleVariante}`);
                                
                                if (parcellesParCommuneSectionSuffixe.has(cleVariante)) {
                                    const matches = parcellesParCommuneSectionSuffixe.get(cleVariante);
                                    if (matches && matches.length > 0) {
                                        info = matches[0].info;
                                        found = true;
                                        debugTentatives.push(`  ✓ Match trouvé avec variante !`);
                                    }
                                }
                            }
                        }
                    }
                    
                    // Si pas trouvé, essayer recherche exacte par id_parcelle
                    if (!found) {
                        debugTentatives.push(`Recherche exacte: ${idParcelle}`);
                        if (parcellesRecherche.has(idParcelle)) {
                            info = parcellesRecherche.get(idParcelle);
                            found = true;
                            debugTentatives.push(`  ✓ Match exact trouvé !`);
                        }
                    }
                    
                    // Debug : afficher les tentatives pour les premières lignes
                    if (totalRows <= 20 && !found) {
                        console.log(`   🔍 Debug ligne ${totalRows}: idParcelle=${idParcelle}, sectionRawDVF="${sectionRawDVF}"`);
                        if (idParcelle.length >= 14) {
                            const codeCommune = idParcelle.substring(0, 5);
                            const parcelleSuffixe = idParcelle.substring(5);
                            let sectionDVF = sectionRawDVF || extraireSection(idParcelle) || parcelleSuffixe.substring(3, 5).replace(/^0+/, '');
                            const cle = `${codeCommune}|${sectionDVF}|${parcelleSuffixe}`;
                            console.log(`      → cle: ${cle}`);
                            console.log(`      → Dans index: ${parcellesParCommuneSectionSuffixe.has(cle)}`);
                        }
                        debugTentatives.forEach(t => console.log(`      ${t}`));
                    }
                    
                    if (found && info) {
                        // Format normalisé : utiliser uniquement les colonnes normalisées
                        const valeurFonciereStr = row.valeur_fonciere || '0';
                        const valeur = parseFloat(valeurFonciereStr.toString().replace(/\s/g, '').replace(',', '.'));
                        const surfaceTerrain = parseFloat(row.surface_terrain || 0);
                        const surfaceBati = parseFloat(row.surface_reelle_bati || 0);
                        const typeLocal = row.type_local || '';
                        let dateMutation = row.date_mutation || '';
                        let idMutation = row.id_mutation || row.no_disposition || '';
                        const commune = row.nom_commune || row.commune || '';
                        const voie = row.adresse_nom_voie || row.voie || '';
                        const numeroVoie = row.adresse_numero || row.no_voie || '';
                        
                        // Extraire le code département depuis id_parcelle ou les colonnes CSV
                        const codeDept = idParcelle ? idParcelle.substring(0, 2) : (row.code_departement || '');
                        
                        // Coordonnées GPS depuis la DVF (peuvent ne pas exister)
                        const latitude = parseFloat(row.lat || row.latitude || 0) || null;
                        const longitude = parseFloat(row.lon || row.longitude || 0) || null;
                        
                        // Normaliser la date (format JJ/MM/AAAA → AAAA-MM-JJ)
                        if (dateMutation && dateMutation.includes('/')) {
                            const parts = dateMutation.split('/');
                            if (parts.length === 3) {
                                dateMutation = `${parts[2]}-${parts[1]}-${parts[0]}`;
                            }
                        }
                        
                        // Si pas d'id_mutation, créer un basé sur date + prix + commune
                        if (!idMutation) {
                            const dateNorm = dateMutation.substring(0, 10);
                            const prixForId = Math.round(valeur);
                            const codeCommune = idParcelle.substring(0, 5);
                            
                            if (dateNorm && dateNorm.length === 10) {
                                idMutation = `DVF_${dateNorm}_${prixForId}_${codeCommune}`.replace(/[^A-Z0-9_-]/g, '');
                            } else {
                                idMutation = `DVF_UNKNOWN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                            }
                        }
                        
                        // Filtres selon le type de projet :
                        // - Pour NOUVELLE_CONSTRUCTION : Type local = "Maison" ou vide
                        // - Pour RENOVATION : Type local = "Maison" ou VIDE (accepter sans surface_reelle_bati car DVF peut ne pas l'avoir)
                        // - Exclure : Appartement, Dépendance, Local industriel/commercial
                        
                        if (info.pc.typeProjet === 'NOUVELLE_CONSTRUCTION') {
                            // Construction neuve : accepter "Maison" ou vide uniquement
                            if (typeLocal !== 'Maison' && typeLocal !== '') return;
                        } else if (info.pc.typeProjet === 'RENOVATION') {
                            // Rénovation : accepter "Maison" ou VIDE (DVF peut ne pas avoir le type local)
                            // Rejeter : Appartement, Dépendance, Local industriel, etc.
                            if (typeLocal && typeLocal !== 'Maison') {
                                return; // Rejeter si type local renseigné et différent de "Maison"
                            }
                            // Si typeLocal est vide, on accepte (transaction sans type local dans DVF)
                        }
                        
                        // Valider les données
                        if (!valeur || valeur <= 1 || !surfaceTerrain || surfaceTerrain <= 0) return; // Exclure transactions à 1€ (symboliques)
                        
                        // Contrôle de surface avec tolérance de 10%
                        if (info.pc.surfaceTerrain && info.pc.surfaceTerrain > 0) {
                            const tolerance = 0.10; // 10%
                            const surfaceMin = info.pc.surfaceTerrain * (1 - tolerance);
                            const surfaceMax = info.pc.surfaceTerrain * (1 + tolerance);
                            
                            if (surfaceTerrain < surfaceMin || surfaceTerrain > surfaceMax) {
                                // Surface DVF hors tolérance par rapport au PC
                                transactionsRejeteesSurface++;
                                return;
                            }
                        }
                        
                        count++;
                        transactionsTrouvees++;
                        
                        const prixM2 = surfaceTerrain > 0 ? valeur / surfaceTerrain : 0;
                        const sectionCad = extraireSection(idParcelle);
                        
                        insertStmt.run(
                            idParcelle,
                            idMutation,
                            valeur,
                            surfaceTerrain,
                            surfaceBati,
                            prixM2,
                            dateMutation,
                            latitude,
                            longitude,
                            codeDept,
                            commune,
                            sectionCad,
                            info.pc.numDau,
                            info.pc.dateAuth,
                            info.type,
                            info.pc.typeProjet, // Ajouter le type de projet
                            info.idDFI,
                            info.parcelleMere,
                            typeLocal,
                            voie,
                            numeroVoie
                        );
                    }
                })
                .on('end', () => {
                    if (count > 0) {
                        console.log(`   ✅ ${fileName}: ${count} transactions (${totalRows} lignes lues)`);
                    } else {
                        console.log(`   ⚪ ${fileName}: 0 transaction (${totalRows} lignes lues)`);
                        if (idParcelleExemples.size > 0) {
                            console.log(`      🔍 Exemples d'id_parcelle DVF: ${Array.from(idParcelleExemples).slice(0, 3).join(', ')}`);
                        }
                    }
                    resolve();
                })
                .on('error', reject);
        });
    };
    
    (async () => {
        for (const file of dvfFiles) {
            await processFile(file);
        }
        
        console.log(`\n   ✅ Total: ${transactionsTrouvees} transactions ajoutées`);
        console.log(`   ⚠️  ${transactionsRejeteesSurface} transactions rejetées (surface hors tolérance 10%)\n`);
        
        // ÉTAPE 3.5 : Corriger les id_parcelle (sections sur 1 caractère → 2 caractères)
        console.log('🔧 ÉTAPE 3.5 : Correction des id_parcelle (padding sections)...\n');
        
        // Vérifier si la table existe avant de la corriger
        const tableExists = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='terrains_pc_sans_pa_temp'
        `).get();
        
        if (!tableExists) {
            console.log('   ⚠️  Table terrains_pc_sans_pa_temp n\'existe pas, étape ignorée\n');
        } else {
            const toCorrect = db.prepare(`
                SELECT DISTINCT id_parcelle 
                FROM terrains_pc_sans_pa_temp 
                WHERE LENGTH(id_parcelle) = 13
            `).all();
            
            if (toCorrect.length > 0) {
                console.log(`   📊 ${toCorrect.length} id_parcelle à corriger (13 → 14 caractères)\n`);
                
                const updateIdStmt = db.prepare(`
                    UPDATE terrains_pc_sans_pa_temp 
                    SET id_parcelle = ? 
                    WHERE id_parcelle = ?
                `);
                
                for (const row of toCorrect) {
                    const oldId = row.id_parcelle;
                    // Format: 40108000B1941 (13 chars) → 401080000B1941 (14 chars)
                    // Insérer "0" avant la section (position 8)
                    const newId = oldId.substring(0, 8) + '0' + oldId.substring(8);
                    updateIdStmt.run(newId, oldId);
                }
                
                console.log(`   ✅ ${toCorrect.length} id_parcelle corrigés\n`);
            } else {
                console.log(`   ✅ Tous les id_parcelle sont déjà au bon format\n`);
            }
        }
        
        // ÉTAPE 3.6 : Enrichir les coordonnées GPS
        console.log('📍 ÉTAPE 3.6 : Enrichissement des coordonnées GPS...\n');
        await enrichirCoordonnees(db);
        
        // ÉTAPE 4 : Créer vues agrégées par mutation
        console.log('📊 ÉTAPE 4 : Création des vues agrégées par mutation...\n');
        console.log('   Méthode d\'agrégation :');
        console.log('   - 2020+ : par id_mutation (identifiant unique DVF)');
        console.log('   - 2014-2019 : par date + prix + commune (id_mutation créé artificiellement)\n');
        
        // Vue dédupliquée : si une parcelle apparaît plusieurs fois dans la même mutation, prendre MAX() des valeurs
        db.exec(`
            DROP VIEW IF EXISTS terrains_pc_deduplique;
            CREATE VIEW terrains_pc_deduplique AS
            SELECT 
                id_parcelle,
                id_mutation,
                MAX(valeur_fonciere) as valeur_fonciere,
                MAX(surface_totale) as surface_totale,
                MAX(surface_reelle_bati) as surface_reelle_bati,
                MIN(date_mutation) as date_mutation,
                code_departement,
                MAX(nom_commune) as nom_commune,
                MAX(section_cadastrale) as section_cadastrale,
                MAX(num_pc) as num_pc,
                MAX(date_pc) as date_pc,
                MAX(type_parcelle) as type_parcelle,
                MAX(type_projet) as type_projet,
                MAX(id_dfi) as id_dfi,
                MAX(parcelle_mere) as parcelle_mere,
                MAX(type_local) as type_local,
                MAX(adresse_nom_voie) as adresse_nom_voie,
                MAX(adresse_numero) as adresse_numero,
                SUBSTR(id_parcelle, 1, 5) as code_commune
            FROM terrains_pc_sans_pa_temp
            WHERE id_parcelle IS NOT NULL AND id_mutation IS NOT NULL
            GROUP BY id_parcelle, id_mutation, code_departement
        `);
        
        // Vue agrégée finale : grouper les parcelles d'une même mutation
        db.exec(`
            DROP VIEW IF EXISTS mutations_pc_aggregees;
            CREATE VIEW mutations_pc_aggregees AS
            SELECT 
                id_mutation,
                SUM(surface_totale) as surface_totale_aggregee,
                SUM(surface_reelle_bati) as surface_batie_aggregee,
                COUNT(DISTINCT id_parcelle) as nb_parcelles,
                MAX(valeur_fonciere) as valeur_fonciere,
                MIN(date_mutation) as date_mutation,
                code_departement,
                MAX(nom_commune) as nom_commune,
                MAX(section_cadastrale) as section_cadastrale,
                MAX(num_pc) as num_pc,
                MAX(date_pc) as date_pc,
                MAX(type_parcelle) as type_parcelle,
                MAX(type_projet) as type_projet,
                MAX(adresse_nom_voie) as adresse_nom_voie,
                GROUP_CONCAT(id_parcelle, ';') as parcelles,
                ROUND(MAX(valeur_fonciere) / SUM(surface_totale), 2) as prix_m2_agrege
            FROM terrains_pc_deduplique
            GROUP BY id_mutation, code_departement
            HAVING surface_totale_aggregee > 0
        `);
        
        console.log('   ✅ Vues agrégées créées\n');
        
        // ÉTAPE 5 : Statistiques finales
        console.log('═'.repeat(60));
        console.log('📊 STATISTIQUES FINALES\n');
        
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT num_pc) as pc_distincts,
                COUNT(DISTINCT nom_commune) as communes,
                SUM(CASE WHEN type_parcelle = 'FILLE' THEN 1 ELSE 0 END) as filles,
                SUM(CASE WHEN type_parcelle = 'PC_SUR_FILLE' THEN 1 ELSE 0 END) as pc_sur_filles,
                SUM(CASE WHEN type_parcelle = 'PC_SANS_DFI' THEN 1 ELSE 0 END) as sans_dfi,
                SUM(CASE WHEN type_projet = 'NOUVELLE_CONSTRUCTION' THEN 1 ELSE 0 END) as constructions,
                SUM(CASE WHEN type_projet = 'RENOVATION' THEN 1 ELSE 0 END) as renovations,
                ROUND(AVG(valeur_fonciere), 2) as prix_moyen,
                ROUND(AVG(surface_totale), 2) as surface_moyenne,
                ROUND(AVG(prix_m2), 2) as prix_m2_moyen
            FROM terrains_pc_sans_pa_temp
        `).get();
        
        console.log(`   Total terrains : ${stats.total}`);
        console.log(`   PC distincts : ${stats.pc_distincts}`);
        console.log(`   Communes : ${stats.communes}`);
        console.log('');
        console.log('   Répartition par type de parcelle :');
        console.log(`   - Filles de PC sur mère : ${stats.filles || 0}`);
        console.log(`   - PC sur filles : ${stats.pc_sur_filles || 0}`);
        console.log(`   - PC sans DFI : ${stats.sans_dfi || 0}`);
        console.log('');
        console.log('   Répartition par type de projet :');
        console.log(`   - Nouvelle construction : ${stats.constructions || 0}`);
        console.log(`   - Rénovation/Réhabilitation : ${stats.renovations || 0}`);
        console.log('');
        
        if (stats.total > 0) {
            console.log(`   Prix moyen : ${stats.prix_moyen?.toLocaleString('fr-FR') || 0}€`);
            console.log(`   Surface moyenne : ${stats.surface_moyenne || 0}m²`);
            console.log(`   Prix/m² moyen : ${stats.prix_m2_moyen || 0}€/m²`);
            console.log('');
            
            // Statistiques sur les mutations agrégées
            const statsAggregees = db.prepare(`
                SELECT 
                    COUNT(*) as total_mutations,
                    SUM(nb_parcelles) as total_parcelles,
                    ROUND(AVG(nb_parcelles), 2) as parcelles_par_mutation,
                    ROUND(AVG(valeur_fonciere), 2) as prix_moyen,
                    ROUND(AVG(surface_totale_aggregee), 2) as surface_moyenne,
                    ROUND(AVG(prix_m2_agrege), 2) as prix_m2_moyen
                FROM mutations_pc_aggregees
            `).get();
            
            const pcDistinctsAggregees = db.prepare(`
                SELECT COUNT(DISTINCT num_pc) as pc_distincts
                FROM mutations_pc_aggregees
            `).get();
            
            console.log('📊 MUTATIONS AGRÉGÉES :\n');
            console.log(`   Total mutations : ${statsAggregees.total_mutations}`);
            console.log(`   PC distincts : ${pcDistinctsAggregees.pc_distincts}`);
            console.log(`   Total parcelles : ${statsAggregees.total_parcelles}`);
            console.log(`   Parcelles par mutation : ${statsAggregees.parcelles_par_mutation}`);
            console.log(`   Prix moyen : ${statsAggregees.prix_moyen?.toLocaleString('fr-FR') || 0}€`);
            console.log(`   Surface moyenne : ${statsAggregees.surface_moyenne || 0}m²`);
            console.log(`   Prix/m² moyen : ${statsAggregees.prix_m2_moyen || 0}€/m²`);
            console.log('');
            
            const exemples = db.prepare(`
                SELECT *
                FROM mutations_pc_aggregees
                ORDER BY date_mutation DESC
                LIMIT 10
            `).all();
            
            console.log('📋 EXEMPLES MUTATIONS AGRÉGÉES (10 plus récentes) :\n');
            exemples.forEach((t, i) => {
                console.log(`${i+1}. ${t.nom_commune} - ${t.nb_parcelles} parcelle(s)`);
                console.log(`   Type: ${t.type_parcelle} / ${t.type_projet || 'N/A'}`);
                console.log(`   PC: ${t.num_pc} (${t.date_pc || 'N/A'})`);
                console.log(`   Parcelles: ${t.parcelles}`);
                console.log(`   Transaction: ${t.valeur_fonciere?.toLocaleString('fr-FR') || 0}€ - ${t.date_mutation}`);
                console.log(`   Surface totale: ${Math.round(t.surface_totale_aggregee)}m² (${Math.round(t.prix_m2_agrege)}€/m²)`);
                console.log('');
            });
        }
        
        // ÉTAPE FINALE : Créer la table finale simplifiée
        console.log('═'.repeat(60));
        console.log('\n📊 Création de la table finale simplifiée...\n');
        
        db.exec(`
            CREATE TABLE terrains_pc_sans_pa (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                valeur_fonciere REAL,
                surface_totale REAL,
                surface_reelle_bati REAL,
                prix_m2 REAL,
                date_mutation TEXT,
                latitude REAL,
                longitude REAL,
                nom_commune TEXT,
                type_terrain TEXT
            );
            
            CREATE INDEX idx_coords ON terrains_pc_sans_pa(latitude, longitude);
            CREATE INDEX idx_date ON terrains_pc_sans_pa(date_mutation);
            CREATE INDEX idx_type_terrain ON terrains_pc_sans_pa(type_terrain);
            CREATE INDEX idx_commune ON terrains_pc_sans_pa(nom_commune);
        `);
        
        // Copier les données en convertissant type_projet en type_terrain
        // NOUVELLE_CONSTRUCTION → VIABILISE
        // RENOVATION → RENOVATION
        // FILTRE : Exclure les transactions NON géolocalisées ⚠️
        db.exec(`
            INSERT INTO terrains_pc_sans_pa (
                valeur_fonciere, surface_totale, surface_reelle_bati, prix_m2,
                date_mutation, latitude, longitude, nom_commune, type_terrain
            )
            SELECT 
                valeur_fonciere, 
                surface_totale, 
                surface_reelle_bati, 
                prix_m2,
                date_mutation, 
                latitude, 
                longitude, 
                nom_commune,
                CASE 
                    WHEN type_projet = 'NOUVELLE_CONSTRUCTION' THEN 'VIABILISE'
                    WHEN type_projet = 'RENOVATION' THEN 'RENOVATION'
                    ELSE NULL
                END as type_terrain
            FROM terrains_pc_sans_pa_temp
            WHERE latitude IS NOT NULL 
              AND longitude IS NOT NULL
              AND latitude != 0 
              AND longitude != 0;
        `);
        
        // Supprimer la table temporaire
        db.exec(`DROP TABLE terrains_pc_sans_pa_temp;`);
        
        const finalStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN type_terrain = 'VIABILISE' THEN 1 ELSE 0 END) as viabilises,
                SUM(CASE WHEN type_terrain = 'RENOVATION' THEN 1 ELSE 0 END) as renovations
            FROM terrains_pc_sans_pa
        `).get();
        
        console.log(`✅ Table finale créée :`);
        console.log(`   - Total : ${finalStats.total} transactions`);
        console.log(`   - VIABILISE (nouvelle construction) : ${finalStats.viabilises}`);
        console.log(`   - RENOVATION : ${finalStats.renovations}\n`);
        
        console.log('═'.repeat(60));
        console.log(`\n✅ Base de données créée : ${DB_FILE}\n`);
        
        dbSource.close();
        db.close();
    })();
    
}).catch(err => {
    console.error('❌ Erreur:', err);
    if (dbSource) dbSource.close();
    if (db) db.close();
    process.exit(1);
});

