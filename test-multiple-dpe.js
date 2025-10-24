#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

console.log('🧪 TEST: Gestion des multiples DPE par bâtiment\n');

// Configuration
const CSV_DIR = path.join(__dirname, 'open_data_millesime_2024-10-a_dep40_csv', 'csv');
const DB_FILE = path.join(__dirname, 'test_multiple_dpe.db');

// Créer la base de données de test
const db = new Database(DB_FILE);

try {
    // Créer les tables temporaires
    console.log('📊 Création des tables temporaires...');
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS temp_bdnb_dpe (
            batiment_groupe_id TEXT,
            identifiant_dpe TEXT,
            classe_dpe TEXT,
            orientation_principale TEXT,
            pourcentage_vitrage REAL,
            presence_piscine INTEGER DEFAULT 0,
            presence_garage INTEGER DEFAULT 0,
            presence_veranda INTEGER DEFAULT 0,
            PRIMARY KEY (batiment_groupe_id, identifiant_dpe)
        )
    `);
    
    // Charger quelques lignes de test
    console.log('📂 Chargement des données DPE de test...');
    
    const csvFile = path.join(CSV_DIR, 'batiment_groupe_dpe_representatif_logement.csv');
    if (!fs.existsSync(csvFile)) {
        console.log('❌ Fichier DPE non trouvé:', csvFile);
        process.exit(1);
    }
    
    const csvContent = fs.readFileSync(csvFile, 'utf8');
    const lines = csvContent.split('\n').slice(1, 11); // Prendre les 10 premières lignes
    
    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO temp_bdnb_dpe 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let loadedCount = 0;
    for (const line of lines) {
        if (line.trim()) {
            const columns = line.split(',');
            if (columns.length >= 10) {
                const batimentId = columns[0]?.trim();
                const identifiantDpe = columns[1]?.trim();
                const classeDpe = columns[18]?.trim(); // classe_bilan_dpe
                
                if (batimentId && identifiantDpe && classeDpe && classeDpe !== 'N') {
                    insertStmt.run(
                        batimentId,
                        identifiantDpe,
                        classeDpe,
                        'sud', // orientation par défaut
                        15.0,  // vitrage par défaut
                        0,     // piscine
                        1,     // garage
                        0      // véranda
                    );
                    loadedCount++;
                }
            }
        }
    }
    
    console.log(`✅ ${loadedCount} DPE chargés\n`);
    
    // Analyser les bâtiments avec plusieurs DPE
    console.log('🔍 Analyse des bâtiments avec plusieurs DPE...');
    
    const multipleDpeQuery = db.prepare(`
        SELECT 
            batiment_groupe_id,
            COUNT(*) as nb_dpe,
            GROUP_CONCAT(identifiant_dpe) as identifiants_dpe,
            GROUP_CONCAT(classe_dpe) as classes_dpe
        FROM temp_bdnb_dpe 
        GROUP BY batiment_groupe_id 
        HAVING COUNT(*) > 1
        ORDER BY nb_dpe DESC
        LIMIT 10
    `);
    
    const multipleDpeResults = multipleDpeQuery.all();
    
    if (multipleDpeResults.length > 0) {
        console.log('✅ Bâtiments avec plusieurs DPE trouvés :');
        console.log('');
        
        for (const result of multipleDpeResults) {
            console.log(`🏢 Bâtiment: ${result.batiment_groupe_id}`);
            console.log(`   📊 Nombre de DPE: ${result.nb_dpe}`);
            console.log(`   🆔 Identifiants: ${result.identifiants_dpe}`);
            console.log(`   📈 Classes: ${result.classes_dpe}`);
            console.log('');
        }
    } else {
        console.log('⚠️ Aucun bâtiment avec plusieurs DPE trouvé dans l\'échantillon');
        console.log('   (Cela peut être normal si l\'échantillon est petit)');
    }
    
    // Tester la logique LIMIT 1
    console.log('🧪 Test de la logique LIMIT 1...');
    
    const testBatiment = multipleDpeResults[0];
    if (testBatiment) {
        const limit1Query = db.prepare(`
            SELECT classe_dpe, identifiant_dpe
            FROM temp_bdnb_dpe 
            WHERE batiment_groupe_id = ?
            LIMIT 1
        `);
        
        const limit1Result = limit1Query.get(testBatiment.batiment_groupe_id);
        
        console.log(`🏢 Bâtiment test: ${testBatiment.batiment_groupe_id}`);
        console.log(`   📊 Total DPE: ${testBatiment.nb_dpe}`);
        console.log(`   🎯 DPE sélectionné (LIMIT 1): ${limit1Result.classe_dpe}`);
        console.log(`   🆔 Identifiant sélectionné: ${limit1Result.identifiant_dpe}`);
        console.log('');
    }
    
    // Statistiques générales
    console.log('📊 Statistiques générales...');
    
    const statsQuery = db.prepare(`
        SELECT 
            COUNT(*) as total_dpe,
            COUNT(DISTINCT batiment_groupe_id) as total_batiments,
            ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT batiment_groupe_id), 2) as dpe_par_batiment
        FROM temp_bdnb_dpe
    `);
    
    const stats = statsQuery.get();
    
    console.log(`   📊 Total DPE: ${stats.total_dpe}`);
    console.log(`   🏢 Total bâtiments: ${stats.total_batiments}`);
    console.log(`   📈 DPE par bâtiment: ${stats.dpe_par_batiment}`);
    console.log('');
    
    console.log('✅ Test terminé avec succès !');
    
} catch (error) {
    console.error('❌ Erreur lors du test:', error.message);
    process.exit(1);
} finally {
    db.close();
    
    // Nettoyer le fichier de test
    if (fs.existsSync(DB_FILE)) {
        fs.unlinkSync(DB_FILE);
        console.log('🧹 Fichier de test nettoyé');
    }
}
