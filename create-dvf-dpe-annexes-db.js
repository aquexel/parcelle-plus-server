#!/usr/bin/env node

/**
 * 🏗️ CRÉATION BASE DE DONNÉES DVF + DPE + ANNEXES
 * 
 * Crée une base SQLite avec :
 * - Transactions DVF (prix, surfaces, dates)
 * - DPE des bâtiments
 * - Annexes SITADEL (piscine, garage, véranda, abri)
 * - Coordonnées GPS (conversion Lambert 93 → WGS84)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');
const proj4 = require('proj4');

// Configuration Lambert 93 → WGS84
proj4.defs([
    ['EPSG:2154', '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs'],
    ['EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs']
]);

// Chemins
const BDNB_DIR = process.argv[2] || path.join(__dirname, 'bdnb_data', 'csv');
const DB_PATH = path.join(__dirname, 'database', 'dvf_avec_dpe_et_annexes.db');

console.log('🏗️  === CRÉATION BASE DVF + DPE + ANNEXES ===\n');

// Vérifier que le dossier BDNB existe
if (!fs.existsSync(BDNB_DIR)) {
    console.error(`❌ Erreur: Dossier BDNB introuvable: ${BDNB_DIR}`);
    process.exit(1);
}

// Créer le dossier database si nécessaire
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Supprimer l'ancienne base si elle existe
if (fs.existsSync(DB_PATH)) {
    console.log('🗑️  Suppression de l\'ancienne base...');
    fs.unlinkSync(DB_PATH);
}

console.log(`📂 Répertoire BDNB : ${BDNB_DIR}`);
console.log(`💾 Base de données : ${DB_PATH}\n`);

// Ouvrir la base SQLite
const db = new Database(DB_PATH);

// Créer la table
console.log('📊 ÉTAPE 1 : Création de la table...');
db.exec(`
    CREATE TABLE IF NOT EXISTS dvf_avec_dpe_et_annexes (
        id_mutation TEXT PRIMARY KEY,
        id_parcelle TEXT,
        batiment_groupe_id TEXT,
        
        -- Prix & Date
        valeur_fonciere REAL,
        date_mutation TEXT,
        
        -- Surfaces
        surface_bati_maison REAL,
        surface_bati_appartement REAL,
        surface_terrain REAL,
        nb_pieces INTEGER,
        
        -- Localisation
        latitude REAL,
        longitude REAL,
        code_departement TEXT,
        
        -- DPE
        classe_dpe TEXT,
        
        -- Annexes (booléens 0/1)
        presence_piscine INTEGER DEFAULT 0,
        presence_garage INTEGER DEFAULT 0,
        presence_veranda INTEGER DEFAULT 0,
        date_permis_annexes TEXT,
        
        -- Calculés
        type_bien TEXT,
        prix_m2_bati REAL,
        prix_m2_terrain REAL
    );
    
    CREATE INDEX IF NOT EXISTS idx_geo ON dvf_avec_dpe_et_annexes(latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_dept ON dvf_avec_dpe_et_annexes(code_departement);
    CREATE INDEX IF NOT EXISTS idx_type ON dvf_avec_dpe_et_annexes(type_bien);
    CREATE INDEX IF NOT EXISTS idx_date ON dvf_avec_dpe_et_annexes(date_mutation);
    CREATE INDEX IF NOT EXISTS idx_dpe ON dvf_avec_dpe_et_annexes(classe_dpe);
`);
console.log('✅ Table créée\n');

/**
 * Parse WKT MULTIPOLYGON et calcule le centroïde
 */
function parseWKTAndGetCentroid(wkt) {
    if (!wkt || !wkt.startsWith('MULTIPOLYGON')) return null;
    
    try {
        // Extraire les coordonnées : MULTIPOLYGON (((x1 y1, x2 y2, ...)))
        const coordsMatch = wkt.match(/\(\(\(([\d\s.,]+)\)\)\)/);
        if (!coordsMatch) return null;
        
        const coordsStr = coordsMatch[1];
        const points = coordsStr.split(',').map(pair => {
            const [x, y] = pair.trim().split(/\s+/).map(Number);
            return { x, y };
        });
        
        if (points.length === 0) return null;
        
        // Calculer le centroïde
        const sumX = points.reduce((sum, p) => sum + p.x, 0);
        const sumY = points.reduce((sum, p) => sum + p.y, 0);
        
        return {
            x: sumX / points.length,
            y: sumY / points.length
        };
    } catch (error) {
        return null;
    }
}

/**
 * Convertit Lambert 93 → WGS84
 */
function lambert93ToWGS84(x, y) {
    try {
        const [lon, lat] = proj4('EPSG:2154', 'EPSG:4326', [x, y]);
        return { latitude: lat, longitude: lon };
    } catch (error) {
        return null;
    }
}

/**
 * Parse une ligne CSV en respectant les guillemets
 */
function parseCSVLine(line) {
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
    
    return result;
}

/**
 * Lit un fichier CSV ligne par ligne
 */
async function readCSV(filePath, onLine, skipHeader = true) {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: fileStream });
        
        let lineNumber = 0;
        let header = null;
        
        rl.on('line', (line) => {
            lineNumber++;
            
            if (skipHeader && lineNumber === 1) {
                header = parseCSVLine(line);
                return;
            }
            
            const values = parseCSVLine(line);
            const row = {};
            
            if (header) {
                header.forEach((col, i) => {
                    row[col] = values[i] || null;
                });
            } else {
                values.forEach((val, i) => {
                    row[i] = val;
                });
            }
            
            onLine(row, lineNumber - 1);
        });
        
        rl.on('close', () => resolve(lineNumber));
        rl.on('error', reject);
    });
}

/**
 * MAIN
 */
(async () => {
    try {
        // ÉTAPE 2 : Indexer les bâtiments (géométrie + batiment_groupe_id)
        console.log('📂 ÉTAPE 2 : Lecture batiment_groupe.csv...');
        const batimentGroupe = new Map();
        
        const batimentFile = path.join(BDNB_DIR, 'batiment_groupe.csv');
        if (!fs.existsSync(batimentFile)) {
            throw new Error(`Fichier manquant : ${batimentFile}`);
        }
        
        await readCSV(batimentFile, (row) => {
            const id = row.batiment_groupe_id;
            const wkt = row.geom_groupe;
            const dept = row.code_departement_insee;
            
            if (id && wkt) {
                const centroid = parseWKTAndGetCentroid(wkt);
                if (centroid) {
                    const gps = lambert93ToWGS84(centroid.x, centroid.y);
                    if (gps) {
                        batimentGroupe.set(id, {
                            latitude: gps.latitude,
                            longitude: gps.longitude,
                            code_departement: dept
                        });
                    }
                }
            }
        });
        
        console.log(`✅ ${batimentGroupe.size} bâtiments indexés\n`);
        
        // ÉTAPE 3 : Indexer les DPE
        console.log('📂 ÉTAPE 3 : Lecture batiment_groupe_dpe_representatif_logement.csv...');
        const dpeData = new Map();
        
        const dpeFile = path.join(BDNB_DIR, 'batiment_groupe_dpe_representatif_logement.csv');
        if (!fs.existsSync(dpeFile)) {
            throw new Error(`Fichier manquant : ${dpeFile}`);
        }
        
        await readCSV(dpeFile, (row) => {
            const id = row.batiment_groupe_id;
            if (id) {
                dpeData.set(id, {
                    classe_dpe: row.classe_bilan_dpe || null,
                    nb_pieces: parseInt(row.nombre_niveau_logement) || null
                });
            }
        });
        
        console.log(`✅ ${dpeData.size} DPE indexés\n`);
        
        // ÉTAPE 4 : Indexer batiment_groupe → parcelle
        console.log('📂 ÉTAPE 4 : Lecture rel_batiment_groupe_parcelle.csv...');
        const batiment2Parcelle = new Map();
        
        const relBatParcelleFile = path.join(BDNB_DIR, 'rel_batiment_groupe_parcelle.csv');
        if (fs.existsSync(relBatParcelleFile)) {
            await readCSV(relBatParcelleFile, (row) => {
                const batimentId = row.batiment_groupe_id;
                const parcelleId = row.parcelle_id;
                
                if (batimentId && parcelleId) {
                    batiment2Parcelle.set(batimentId, parcelleId);
                }
            });
            console.log(`✅ ${batiment2Parcelle.size} liaisons bâtiment → parcelle\n`);
        } else {
            console.log(`⚠️  ${relBatParcelleFile} introuvable, liaison impossible\n`);
        }
        
        // ÉTAPE 5 : Indexer les annexes SITADEL
        console.log('📂 ÉTAPE 5 : Lecture SITADEL...');
        
        // 5a. Lire rel_parcelle_sitadel pour créer parcelle → permis
        const parcelle2Permis = new Map();
        const relFile = path.join(BDNB_DIR, 'rel_parcelle_sitadel.csv');
        
        if (fs.existsSync(relFile)) {
            await readCSV(relFile, (row) => {
                const parcelleId = row.parcelle_id;
                const permisId = row.type_numero_dau;
                
                if (parcelleId && permisId) {
                    if (!parcelle2Permis.has(parcelleId)) {
                        parcelle2Permis.set(parcelleId, []);
                    }
                    parcelle2Permis.get(parcelleId).push(permisId);
                }
            });
            console.log(`  ↪ ${parcelle2Permis.size} parcelles liées à des permis`);
        } else {
            console.log(`  ⚠️  ${relFile} introuvable, annexes non disponibles`);
        }
        
        // 4b. Lire sitadel pour créer permis → annexes
        const permis2Annexes = new Map();
        const sitadelFile = path.join(BDNB_DIR, 'sitadel.csv');
        
        if (fs.existsSync(sitadelFile)) {
            await readCSV(sitadelFile, (row) => {
                const permisId = row.type_numero_dau;
                const typeAnnexe = row.type_annexe;
                const datePermis = row.date_reelle_autorisation;
                
                if (permisId && typeAnnexe) {
                    if (!permis2Annexes.has(permisId)) {
                        permis2Annexes.set(permisId, {
                            piscine: false,
                            garage: false,
                            veranda: false,
                            date: datePermis
                        });
                    }
                    
                    const annexes = permis2Annexes.get(permisId);
                    
                    if (typeAnnexe.toLowerCase().includes('piscine')) annexes.piscine = true;
                    if (typeAnnexe.toLowerCase().includes('garage')) annexes.garage = true;
                    if (typeAnnexe.toLowerCase().includes('véranda') || typeAnnexe.toLowerCase().includes('veranda')) annexes.veranda = true;
                    if (typeAnnexe === 'plusieurs annexes') {
                        // On considère qu'il y a potentiellement tout
                        annexes.garage = true;
                    }
                }
            });
            console.log(`  ↪ ${permis2Annexes.size} permis avec annexes détectées`);
        } else {
            console.log(`  ⚠️  ${sitadelFile} introuvable, annexes non disponibles`);
        }
        
        console.log('✅ Annexes indexées\n');
        
        // ÉTAPE 6 : Lire les transactions DVF et construire la base
        console.log('📂 ÉTAPE 6 : Lecture batiment_groupe_dvf_open_representatif.csv...');
        
        const dvfFile = path.join(BDNB_DIR, 'batiment_groupe_dvf_open_representatif.csv');
        if (!fs.existsSync(dvfFile)) {
            throw new Error(`Fichier manquant : ${dvfFile}`);
        }
        
        const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO dvf_avec_dpe_et_annexes (
                id_mutation, id_parcelle, batiment_groupe_id,
                valeur_fonciere, date_mutation,
                surface_bati_maison, surface_bati_appartement, surface_terrain, nb_pieces,
                latitude, longitude, code_departement,
                classe_dpe,
                presence_piscine, presence_garage, presence_veranda, date_permis_annexes,
                type_bien, prix_m2_bati, prix_m2_terrain
            ) VALUES (
                ?, ?, ?,
                ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?,
                ?, ?, ?, ?,
                ?, ?, ?
            )
        `);
        
        let inserted = 0;
        let skipped = 0;
        
        db.exec('BEGIN TRANSACTION');
        
        await readCSV(dvfFile, (row) => {
            const batimentId = row.batiment_groupe_id;
            const idMutation = row.id_mutation_dv3f || row.id_opendata;
            
            if (!batimentId || !idMutation) {
                skipped++;
                return;
            }
            
            // Récupérer la localisation
            const location = batimentGroupe.get(batimentId);
            if (!location) {
                skipped++;
                return;
            }
            
            // Récupérer le DPE
            const dpe = dpeData.get(batimentId) || {};
            
            // Récupérer les annexes via batiment → parcelle → permis → annexes
            let annexes = { piscine: 0, garage: 0, veranda: 0, date: null };
            let idParcelle = null;
            
            // 1. Trouver la parcelle via batiment_groupe_id
            if (batiment2Parcelle.has(batimentId)) {
                idParcelle = batiment2Parcelle.get(batimentId);
                
                // 2. Trouver les permis via parcelle_id
                if (parcelle2Permis.has(idParcelle)) {
                    const permis = parcelle2Permis.get(idParcelle);
                    
                    // 3. Trouver les annexes via permis
                    for (const permisId of permis) {
                        if (permis2Annexes.has(permisId)) {
                            const permisAnnexes = permis2Annexes.get(permisId);
                            if (permisAnnexes.piscine) annexes.piscine = 1;
                            if (permisAnnexes.garage) annexes.garage = 1;
                            if (permisAnnexes.veranda) annexes.veranda = 1;
                            if (permisAnnexes.date) annexes.date = permisAnnexes.date;
                        }
                    }
                }
            }
            
            // Extraire les données DVF
            const valeurFonciere = parseFloat(row.valeur_fonciere_dv3f) || null;
            const dateMutation = row.date_mutation_dv3f;
            const surfaceMaison = parseFloat(row.surface_bati_maison_dv3f) || null;
            const surfaceAppart = parseFloat(row.surface_bati_appartement_dv3f) || null;
            const surfaceTerrain = parseFloat(row.surface_terrain_mutee_dv3f) || null;
            const nbPieces = parseInt(row.nb_pieces_dv3f) || dpe.nb_pieces || null;
            
            // Déterminer le type de bien
            let typeBien = 'inconnu';
            if (surfaceMaison && surfaceMaison > 0) {
                typeBien = surfaceTerrain && surfaceTerrain > 0 ? 'maison_avec_terrain' : 'maison';
            } else if (surfaceAppart && surfaceAppart > 0) {
                typeBien = 'appartement';
            } else if (surfaceTerrain && surfaceTerrain > 0) {
                typeBien = 'terrain';
            }
            
            // Calculer prix/m²
            const surfaceBati = (surfaceMaison || 0) + (surfaceAppart || 0);
            const prixM2Bati = surfaceBati > 0 && valeurFonciere ? valeurFonciere / surfaceBati : null;
            const prixM2Terrain = surfaceTerrain > 0 && valeurFonciere ? valeurFonciere / surfaceTerrain : null;
            
            try {
                insertStmt.run(
                    idMutation, idParcelle, batimentId,
                    valeurFonciere, dateMutation,
                    surfaceMaison, surfaceAppart, surfaceTerrain, nbPieces,
                    location.latitude, location.longitude, location.code_departement,
                    dpe.classe_dpe,
                    annexes.piscine, annexes.garage, annexes.veranda, annexes.date,
                    typeBien, prixM2Bati, prixM2Terrain
                );
                inserted++;
                
                if (inserted % 10000 === 0) {
                    process.stdout.write(`\r  ↪ ${inserted} transactions insérées...`);
                }
            } catch (error) {
                skipped++;
            }
        });
        
        db.exec('COMMIT');
        console.log(`\r✅ ${inserted} transactions insérées (${skipped} ignorées)\n`);
        
        // ÉTAPE 6 : Statistiques
        console.log('📊 === STATISTIQUES ===');
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT code_departement) as nb_depts,
                SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) as avec_dpe,
                SUM(presence_piscine) as avec_piscine,
                SUM(presence_garage) as avec_garage,
                SUM(presence_veranda) as avec_veranda
            FROM dvf_avec_dpe_et_annexes
        `).get();
        
        console.log(`Total transactions : ${stats.total.toLocaleString()}`);
        console.log(`Départements : ${stats.nb_depts}`);
        console.log(`Avec DPE : ${stats.avec_dpe.toLocaleString()} (${(stats.avec_dpe/stats.total*100).toFixed(1)}%)`);
        console.log(`Avec piscine : ${stats.avec_piscine.toLocaleString()} (${(stats.avec_piscine/stats.total*100).toFixed(1)}%)`);
        console.log(`Avec garage : ${stats.avec_garage.toLocaleString()} (${(stats.avec_garage/stats.total*100).toFixed(1)}%)`);
        console.log(`Avec véranda : ${stats.avec_veranda.toLocaleString()} (${(stats.avec_veranda/stats.total*100).toFixed(1)}%)`);
        
        console.log(`\n✅ Base de données créée : ${DB_PATH}`);
        
        db.close();
        
    } catch (error) {
        console.error(`\n❌ Erreur:`, error);
        process.exit(1);
    }
})();

