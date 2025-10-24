#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

console.log('🧪 TEST: Logique chronologique DPE-Vente\n');

// Configuration
const CSV_DIR = path.join(__dirname, 'open_data_millesime_2024-10-a_dep40_csv', 'csv');
const DB_FILE = path.join(__dirname, 'test_chronologie.db');

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
            surface_habitable_logement REAL,
            date_etablissement_dpe TEXT,
            presence_piscine INTEGER DEFAULT 0,
            presence_garage INTEGER DEFAULT 0,
            presence_veranda INTEGER DEFAULT 0,
            PRIMARY KEY (batiment_groupe_id, identifiant_dpe)
        )
    `);
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS temp_dvf (
            id_mutation TEXT,
            id_parcelle TEXT,
            type_local TEXT,
            surface_reelle_bati REAL,
            valeur_fonciere REAL,
            date_mutation TEXT,
            nombre_pieces_principales INTEGER,
            batiment_groupe_id TEXT
        )
    `);
    
    // Données de test
    console.log('📂 Insertion des données de test...');
    
    // DPE de test (multi-années)
    const insertDpeStmt = db.prepare(`
        INSERT OR IGNORE INTO temp_bdnb_dpe 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const dpeTestData = [
        ['bdnb-bg-1113', 'DPE-2013', 'E', 'sud', 15.0, 45, '2013/10/14', 0, 1, 0],
        ['bdnb-bg-1113', 'DPE-2018', 'C', 'sud', 15.0, 45, '2018/10/21', 0, 1, 0],
        ['bdnb-bg-1113', 'DPE-2022', 'D', 'nord', 12.5, 45, '2022/09/20', 1, 1, 0],
        ['bdnb-bg-2222', 'DPE-2015', 'C', 'est', 18.0, 52, '2015/03/31', 0, 0, 1],
        ['bdnb-bg-2222', 'DPE-2023', 'B', 'est', 18.0, 52, '2023/11/07', 0, 0, 1]
    ];
    
    dpeTestData.forEach(data => insertDpeStmt.run(...data));
    
    // Ventes de test
    const insertDvfStmt = db.prepare(`
        INSERT OR IGNORE INTO temp_dvf 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const dvfTestData = [
        ['2024-001', '40293000AC0070', 'Appartement', 45, 120000, '2024/03/15', 3, 'bdnb-bg-1113'],
        ['2023-002', '40293000AC0071', 'Appartement', 52, 135000, '2023/08/22', 4, 'bdnb-bg-2222'],
        ['2020-003', '40293000AC0072', 'Appartement', 45, 110000, '2020/11/10', 3, 'bdnb-bg-1113']
    ];
    
    dvfTestData.forEach(data => insertDvfStmt.run(...data));
    
    console.log('✅ Données de test insérées\n');
    
    // Test de la logique chronologique
    console.log('🧪 Test de la logique chronologique...');
    
    const testQuery = db.prepare(`
        SELECT 
            dvf.id_mutation,
            dvf.date_mutation,
            dvf.surface_reelle_bati,
            dvf.batiment_groupe_id,
            -- DPE le plus récent après la vente
            (SELECT dpe.classe_dpe 
             FROM temp_bdnb_dpe dpe
             WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
               AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
               AND dpe.date_etablissement_dpe > dvf.date_mutation
             ORDER BY dpe.date_etablissement_dpe DESC
             LIMIT 1) as dpe_apres_vente,
            -- DPE le plus ancien avant la vente (si pas de DPE après)
            (SELECT dpe.classe_dpe 
             FROM temp_bdnb_dpe dpe
             WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
               AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
               AND dpe.date_etablissement_dpe <= dvf.date_mutation
               AND NOT EXISTS (
                   SELECT 1 FROM temp_bdnb_dpe dpe2 
                   WHERE dpe2.batiment_groupe_id = dpe.batiment_groupe_id
                     AND dpe2.date_etablissement_dpe > dvf.date_mutation
                     AND ABS(dpe2.surface_habitable_logement - dvf.surface_reelle_bati) < 10
               )
             ORDER BY dpe.date_etablissement_dpe ASC
             LIMIT 1) as dpe_avant_vente,
            -- DPE final sélectionné
            COALESCE(
                (SELECT dpe.classe_dpe 
                 FROM temp_bdnb_dpe dpe
                 WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
                   AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
                   AND dpe.date_etablissement_dpe > dvf.date_mutation
                 ORDER BY dpe.date_etablissement_dpe DESC
                 LIMIT 1),
                (SELECT dpe.classe_dpe 
                 FROM temp_bdnb_dpe dpe
                 WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
                   AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
                   AND dpe.date_etablissement_dpe <= dvf.date_mutation
                 ORDER BY dpe.date_etablissement_dpe DESC
                 LIMIT 1)
            ) as dpe_final
        FROM temp_dvf dvf
        ORDER BY dvf.date_mutation DESC
    `);
    
    const results = testQuery.all();
    
    console.log('📊 Résultats des tests :');
    console.log('');
    
    results.forEach(result => {
        console.log(`🏠 Transaction: ${result.id_mutation}`);
        console.log(`   📅 Date vente: ${result.date_mutation}`);
        console.log(`   📏 Surface: ${result.surface_reelle_bati} m²`);
        console.log(`   🏢 Bâtiment: ${result.batiment_groupe_id}`);
        console.log(`   🔋 DPE après vente: ${result.dpe_apres_vente || 'Aucun'}`);
        console.log(`   🔋 DPE avant vente: ${result.dpe_avant_vente || 'Aucun'}`);
        console.log(`   🎯 DPE final: ${result.dpe_final || 'Aucun'}`);
        console.log('');
    });
    
    // Vérification des DPE disponibles
    console.log('🔍 DPE disponibles par bâtiment :');
    
    const dpeByBatiment = db.prepare(`
        SELECT 
            batiment_groupe_id,
            classe_dpe,
            date_etablissement_dpe,
            surface_habitable_logement
        FROM temp_bdnb_dpe 
        ORDER BY batiment_groupe_id, date_etablissement_dpe
    `).all();
    
    let currentBatiment = null;
    dpeByBatiment.forEach(dpe => {
        if (dpe.batiment_groupe_id !== currentBatiment) {
            console.log(`\n🏢 Bâtiment: ${dpe.batiment_groupe_id}`);
            currentBatiment = dpe.batiment_groupe_id;
        }
        console.log(`   📅 ${dpe.date_etablissement_dpe}: DPE ${dpe.classe_dpe} (${dpe.surface_habitable_logement} m²)`);
    });
    
    console.log('\n✅ Test terminé avec succès !');
    
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
