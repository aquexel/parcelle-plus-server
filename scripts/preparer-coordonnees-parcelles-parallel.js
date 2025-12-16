#!/usr/bin/env node

/**
 * Script de préparation ponctuelle PARALLÈLE (multi-thread)
 * Utilise les 4 cœurs du Raspberry Pi pour traiter 4x plus vite
 */

const { Worker } = require('worker_threads');
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const DB_PARCELLE = path.join(__dirname, '..', 'database', 'parcelles.db');
const NUM_WORKERS = 4; // 4 cœurs du Raspberry Pi

console.log('\n🗺️  PRÉPARATION DES COORDONNÉES GPS DES PARCELLES (PARALLÈLE)\n');
console.log('   📂 Base parcelles:', DB_PARCELLE);
console.log('   🚀 Nombre de workers:', NUM_WORKERS, '\n');

// Vérifier la structure de la table
const db = new Database(DB_PARCELLE);
const tableInfo = db.prepare("PRAGMA table_info(parcelle)").all();
const hasLatitude = tableInfo.some(col => col.name === 'latitude');
const hasLongitude = tableInfo.some(col => col.name === 'longitude');

if (!hasLatitude || !hasLongitude) {
    console.log('📋 Ajout des colonnes latitude/longitude...\n');
    
    if (!hasLatitude) {
        db.exec('ALTER TABLE parcelle ADD COLUMN latitude REAL');
    }
    if (!hasLongitude) {
        db.exec('ALTER TABLE parcelle ADD COLUMN longitude REAL');
    }
    
    console.log('✅ Colonnes ajoutées\n');
}

// Compter les parcelles à traiter
console.log('📊 Comptage des parcelles...\n');

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

db.close();

// Lancer les workers
console.log(`🔄 Lancement de ${NUM_WORKERS} workers parallèles...\n`);

const startTime = Date.now();
let workersCompleted = 0;
let totalProcessedGlobal = 0;
let totalSuccessGlobal = 0;

const workers = [];

for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = new Worker(__filename, {
        workerData: {
            workerId: i,
            numWorkers: NUM_WORKERS,
            dbPath: DB_PARCELLE
        }
    });
    
    worker.on('message', (msg) => {
        if (msg.type === 'progress') {
            console.log(`   [Worker ${msg.workerId}] ${msg.message}`);
        } else if (msg.type === 'complete') {
            totalProcessedGlobal += msg.processed;
            totalSuccessGlobal += msg.success;
            workersCompleted++;
            
            console.log(`   ✅ Worker ${msg.workerId} terminé : ${msg.success.toLocaleString()}/${msg.processed.toLocaleString()} coordonnées extraites\n`);
            
            if (workersCompleted === NUM_WORKERS) {
                // Tous les workers ont terminé
                const totalTime = Math.round((Date.now() - startTime) / 1000);
                const finalCount = new Database(DB_PARCELLE).prepare('SELECT COUNT(*) as count FROM parcelle WHERE latitude IS NOT NULL AND longitude IS NOT NULL').get().count;
                
                console.log('\n✅ TRAITEMENT PARALLÈLE TERMINÉ !\n');
                console.log(`   📊 Résultats :`);
                console.log(`      - Parcelles traitées : ${totalProcessedGlobal.toLocaleString()}`);
                console.log(`      - Coordonnées extraites : ${totalSuccessGlobal.toLocaleString()}`);
                console.log(`      - Total avec GPS : ${finalCount.toLocaleString()}/${countTotal.toLocaleString()}`);
                console.log(`      - Taux de succès : ${Math.round((totalSuccessGlobal / totalProcessedGlobal) * 100)}%`);
                console.log(`      - Durée totale : ${Math.floor(totalTime / 60)}min ${totalTime % 60}s`);
                console.log(`      - Vitesse moyenne : ${Math.round(totalProcessedGlobal / totalTime)} parcelles/s`);
                console.log(`      - Accélération : x${NUM_WORKERS} grâce au parallélisme ! 🚀\n`);
                
                process.exit(0);
            }
        }
    });
    
    worker.on('error', (err) => {
        console.error(`   ❌ Erreur Worker ${i}:`, err);
    });
    
    workers.push(worker);
}

// Si on est dans un worker thread, exécuter le traitement
if (require('worker_threads').workerData) {
    const { parentPort, workerData } = require('worker_threads');
    const { workerId, numWorkers, dbPath } = workerData;
    
    // Fonction d'extraction centroïde Lambert93 depuis WKT
    function extraireCentroideLambert(geomWKT) {
        if (!geomWKT) return null;
        
        const coordsMatch = geomWKT.match(/[\d.]+\s+[\d.]+/g);
        if (!coordsMatch || coordsMatch.length === 0) return null;
        
        const points = coordsMatch.map(coord => {
            const [x, y] = coord.trim().split(/\s+/).map(Number);
            return { x, y };
        });
        
        const sumX = points.reduce((sum, p) => sum + p.x, 0);
        const sumY = points.reduce((sum, p) => sum + p.y, 0);
        
        return {
            x: sumX / points.length,
            y: sumY / points.length
        };
    }
    
    // Fonction de conversion Lambert93 → WGS84
    function convertirLambert93VersWGS84(x, y) {
        const n = 0.7256077650532670;
        const C = 11754255.426096;
        const xs = 700000;
        const ys = 12655612.049876;
        
        const a = 6378137.0;
        const e = 0.08181919106;
        
        const X = x - xs;
        const Y = y - ys;
        
        const R = Math.sqrt(X * X + Y * Y);
        const gamma = Math.atan2(X, -Y);
        
        const lon = gamma / n + (3 * Math.PI / 180);
        
        const latIso = -1 / n * Math.log(Math.abs(R / C));
        
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
    
    // Ouvrir la base (chaque worker a sa propre connexion)
    const workerDb = new Database(dbPath);
    workerDb.pragma('journal_mode = WAL');
    workerDb.pragma('synchronous = NORMAL');
    workerDb.pragma('cache_size = -16000'); // 16 MB par worker (4 x 16 = 64 MB total)
    workerDb.pragma('temp_store = MEMORY');
    
    const BATCH_SIZE = 2000; // Plus petit par worker
    let totalProcessed = 0;
    let totalSuccess = 0;
    let batchNum = 0;
    
    // Chaque worker traite les parcelles selon son ID (modulo)
    const selectStmt = workerDb.prepare(`
        SELECT parcelle_id, geom_parcelle 
        FROM parcelle 
        WHERE geom_parcelle IS NOT NULL 
          AND (latitude IS NULL OR longitude IS NULL)
          AND (parcelle_id % ?) = ?
        LIMIT ?
    `);
    
    const updateStmt = workerDb.prepare(`
        UPDATE parcelle 
        SET latitude = ?, longitude = ? 
        WHERE parcelle_id = ?
    `);
    
    parentPort.postMessage({ type: 'progress', workerId, message: `Démarrage...` });
    
    while (true) {
        batchNum++;
        
        // Récupérer les parcelles pour ce worker (modulo)
        const parcelles = selectStmt.all(numWorkers, workerId, BATCH_SIZE);
        
        if (parcelles.length === 0) break;
        
        let batchSuccess = 0;
        
        // Traiter en micro-transactions de 500
        const MICRO_BATCH = 500;
        for (let i = 0; i < parcelles.length; i += MICRO_BATCH) {
            const microBatch = parcelles.slice(i, i + MICRO_BATCH);
            
            workerDb.transaction(() => {
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
        }
        
        totalProcessed += parcelles.length;
        totalSuccess += batchSuccess;
        
        // Log tous les 20 batches
        if (batchNum % 20 === 0) {
            parentPort.postMessage({ 
                type: 'progress', 
                workerId, 
                message: `Batch ${batchNum} : ${totalSuccess.toLocaleString()} coordonnées extraites`
            });
        }
        
        // Checkpoint tous les 50 batches
        if (batchNum % 50 === 0) {
            workerDb.exec('PRAGMA wal_checkpoint(PASSIVE)');
        }
        
        // GC
        if (global.gc) {
            global.gc();
        }
    }
    
    // Checkpoint final
    workerDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    workerDb.close();
    
    parentPort.postMessage({ 
        type: 'complete', 
        workerId, 
        processed: totalProcessed,
        success: totalSuccess
    });
}

