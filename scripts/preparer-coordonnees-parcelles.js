#!/usr/bin/env node

/**
 * Script de préparation ponctuelle : Extraction et conversion des coordonnées GPS
 * pour toutes les parcelles cadastrales
 * 
 * Ce script :
 * 1. Ajoute les colonnes latitude/longitude dans la table parcelle
 * 2. Extrait les centroïdes Lambert93 depuis geom_parcelle
 * 3. Convertit Lambert93 → WGS84
 * 4. Stocke les coordonnées pour réutilisation
 */

const Database = require('better-sqlite3');
const path = require('path');

// Chemins
const DB_PARCELLE = path.join(__dirname, '..', 'database', 'parcelles.db');

console.log('\n🗺️  PRÉPARATION DES COORDONNÉES GPS DES PARCELLES\n');
console.log('   📂 Base parcelles:', DB_PARCELLE);

// Ouvrir la base
const db = new Database(DB_PARCELLE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000'); // 32 MB de cache (optimisé pour Raspberry Pi 4GB)
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 30000000000'); // 30GB mmap pour lecture rapide

// Fonction d'extraction centroïde Lambert93 depuis WKT
function extraireCentroideLambert(geomWKT) {
    if (!geomWKT) return null;
    
    // Format attendu: MULTIPOLYGON ou POLYGON
    const coordsMatch = geomWKT.match(/[\d.]+\s+[\d.]+/g);
    if (!coordsMatch || coordsMatch.length === 0) return null;
    
    const points = coordsMatch.map(coord => {
        const [x, y] = coord.trim().split(/\s+/).map(Number);
        return { x, y };
    });
    
    // Calculer le centroïde (moyenne des points)
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    
    return {
        x: sumX / points.length,
        y: sumY / points.length
    };
}

// Fonction de conversion Lambert93 → WGS84
function convertirLambert93VersWGS84(x, y) {
    // Paramètres de la projection Lambert93
    const n = 0.7256077650532670;
    const C = 11754255.426096;
    const xs = 700000;
    const ys = 12655612.049876;
    
    const a = 6378137.0; // demi-grand axe WGS84
    const e = 0.08181919106; // excentricité WGS84
    
    const X = x - xs;
    const Y = y - ys;
    
    const R = Math.sqrt(X * X + Y * Y);
    const gamma = Math.atan2(X, -Y);
    
    const lon = gamma / n + (3 * Math.PI / 180); // longitude origine Lambert93
    
    const latIso = -1 / n * Math.log(Math.abs(R / C));
    
    // Itération pour trouver la latitude
    let phi = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
    let phi0 = 0;
    let epsilon = 1e-10;
    let maxIter = 100;
    let iter = 0;
    
    while (Math.abs(phi - phi0) > epsilon && iter < maxIter) {
        phi0 = phi;
        const eSinPhi = e * Math.sin(phi0);
        phi = 2 * Math.atan(
            Math.pow((1 + eSinPhi) / (1 - eSinPhi), e / 2) * Math.exp(latIso)
        ) - Math.PI / 2;
        iter++;
    }
    
    return {
        latitude: phi * 180 / Math.PI,
        longitude: lon * 180 / Math.PI
    };
}

// Étape 1 : Vérifier / Ajouter les colonnes
console.log('📋 Étape 1 : Vérification de la structure de la table...\n');

const tableInfo = db.prepare("PRAGMA table_info(parcelle)").all();
const hasLatitude = tableInfo.some(col => col.name === 'latitude');
const hasLongitude = tableInfo.some(col => col.name === 'longitude');

if (!hasLatitude || !hasLongitude) {
    console.log('   → Ajout des colonnes latitude/longitude...');
    
    if (!hasLatitude) {
        db.exec('ALTER TABLE parcelle ADD COLUMN latitude REAL');
    }
    if (!hasLongitude) {
        db.exec('ALTER TABLE parcelle ADD COLUMN longitude REAL');
    }
    
    console.log('   ✅ Colonnes ajoutées\n');
} else {
    console.log('   ✅ Colonnes déjà présentes\n');
}

// Étape 2 : Compter les parcelles à traiter
console.log('📊 Étape 2 : Comptage des parcelles...\n');

const countTotal = db.prepare('SELECT COUNT(*) as count FROM parcelle WHERE geom_parcelle IS NOT NULL').get().count;
const countDone = db.prepare('SELECT COUNT(*) as count FROM parcelle WHERE latitude IS NOT NULL AND longitude IS NOT NULL').get().count;
const countToDo = countTotal - countDone;

console.log(`   → Total parcelles avec géométrie : ${countTotal.toLocaleString()}`);
console.log(`   → Déjà traitées : ${countDone.toLocaleString()}`);
console.log(`   → Restantes : ${countToDo.toLocaleString()}\n`);

if (countToDo === 0) {
    console.log('✅ TOUTES LES PARCELLES ONT DÉJÀ DES COORDONNÉES GPS !\n');
    db.close();
    process.exit(0);
}

// Étape 3 : Traitement par batches
console.log('🔄 Étape 3 : Extraction et conversion des coordonnées...\n');

const BATCH_SIZE = 5000; // Réduit de 10000 à 5000 pour Raspberry Pi
let totalProcessed = 0;
let totalSuccess = 0;
let batchNum = 0;
const totalBatches = Math.ceil(countToDo / BATCH_SIZE);

// Utiliser un curseur basé sur l'ID au lieu d'OFFSET (plus efficace et cohérent)
const selectStmt = db.prepare(`
    SELECT parcelle_id, geom_parcelle 
    FROM parcelle 
    WHERE geom_parcelle IS NOT NULL 
      AND (latitude IS NULL OR longitude IS NULL)
    LIMIT ?
`);

const updateStmt = db.prepare(`
    UPDATE parcelle 
    SET latitude = ?, longitude = ? 
    WHERE parcelle_id = ?
`);

console.log(`   → Traitement par batches de ${BATCH_SIZE.toLocaleString()} parcelles...\n`);

const startTime = Date.now();

while (true) {
    batchNum++;
    
    console.log(`   📦 Batch ${batchNum}/${totalBatches} (traitement ${totalProcessed + 1} à ${totalProcessed + BATCH_SIZE})...`);
    
    // Récupérer toujours les BATCH_SIZE premières parcelles non traitées
    const parcelles = selectStmt.all(BATCH_SIZE);
    
    if (parcelles.length === 0) {
        console.log('   ✅ Plus de parcelles à traiter\n');
        break;
    }
    
    let batchSuccess = 0;
    
    // Traiter en micro-transactions de 500 (optimisé pour Raspberry Pi)
    const MICRO_BATCH = 500;
    for (let i = 0; i < parcelles.length; i += MICRO_BATCH) {
        const microBatch = parcelles.slice(i, i + MICRO_BATCH);
        
        db.transaction(() => {
            for (const parcelle of microBatch) {
                try {
                    const centroid = extraireCentroideLambert(parcelle.geom_parcelle);
                    if (centroid) {
                        const coords = convertirLambert93VersWGS84(centroid.x, centroid.y);
                        if (coords.latitude && coords.longitude) {
                            updateStmt.run(coords.latitude, coords.longitude, parcelle.parcelle_id);
                            batchSuccess++;
                        }
                    }
                } catch (err) {
                    // Ignorer les erreurs individuelles
                }
            }
        })();
        
        // Libérer la mémoire du micro-batch
        microBatch.length = 0;
    }
    
    // Libérer la mémoire du batch
    parcelles.length = 0;
    
    totalProcessed += parcelles.length;
    totalSuccess += batchSuccess;
    
    console.log(`      ✅ ${batchSuccess}/${parcelles.length} coordonnées extraites`);
    
    // Progression globale
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const rate = elapsed > 0 ? Math.round(totalProcessed / elapsed) : 0;
    
    // Compter combien il reste vraiment (recompte après chaque batch pour être précis)
    const currentRemaining = db.prepare('SELECT COUNT(*) as count FROM parcelle WHERE geom_parcelle IS NOT NULL AND (latitude IS NULL OR longitude IS NULL)').get().count;
    const percent = Math.round(((countDone + totalSuccess) * 100) / countTotal);
    const remaining = rate > 0 ? Math.round(currentRemaining / rate / 60) : 'N/A';
    
    console.log(`      📊 Progression : ${percent}% (${rate}/s, ~${remaining}min restantes, ${currentRemaining.toLocaleString()} restantes)\n`);
    
    // Checkpoint WAL tous les 10 batches (50,000 parcelles) pour éviter que le WAL devienne trop gros
    if (batchNum % 10 === 0) {
        const checkpointStart = Date.now();
        console.log('      🔄 Checkpoint WAL TRUNCATE...');
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        const checkpointDuration = Math.round((Date.now() - checkpointStart) / 1000);
        console.log(`      ✅ Checkpoint terminé en ${checkpointDuration}s\n`);
    }
    
    // GC forcé tous les batches pour libérer la mémoire
    if (global.gc) {
        global.gc();
    }
}

// Checkpoint final
console.log('   🔄 Checkpoint final...');
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

// Statistiques finales
const finalCount = db.prepare('SELECT COUNT(*) as count FROM parcelle WHERE latitude IS NOT NULL AND longitude IS NOT NULL').get().count;
const totalTime = Math.round((Date.now() - startTime) / 1000);

console.log('\n✅ TRAITEMENT TERMINÉ !\n');
console.log(`   📊 Résultats :`);
console.log(`      - Parcelles traitées : ${totalProcessed.toLocaleString()}`);
console.log(`      - Coordonnées extraites : ${totalSuccess.toLocaleString()}`);
console.log(`      - Total avec GPS : ${finalCount.toLocaleString()}/${countTotal.toLocaleString()}`);
console.log(`      - Taux de succès : ${Math.round((totalSuccess / totalProcessed) * 100)}%`);
console.log(`      - Durée totale : ${Math.floor(totalTime / 60)}min ${totalTime % 60}s`);
console.log(`      - Vitesse moyenne : ${Math.round(totalProcessed / totalTime)} parcelles/s\n`);

db.close();


