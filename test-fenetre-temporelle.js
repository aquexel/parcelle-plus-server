#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

console.log('🧪 TEST: Fenêtre temporelle DPE-Vente (6 mois)\n');

// Configuration
const CSV_DIR = path.join(__dirname, 'open_data_millesime_2024-10-a_dep40_csv', 'csv');
const DB_FILE = path.join(__dirname, 'test_fenetre_temporelle.db');

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
    
    // Données de test avec fenêtre temporelle
    console.log('📂 Insertion des données de test...');
    
    // DPE de test (multi-années avec fenêtre temporelle)
    const insertDpeStmt = db.prepare(`
        INSERT OR IGNORE INTO temp_bdnb_dpe 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const dpeTestData = [
        // Bâtiment 1 : Vente 2024/03/15
        ['bdnb-bg-1113', 'DPE-2018', 'C', 'sud', 15.0, 45, '2018/10/21', 0, 1, 0],  // Avant vente
        ['bdnb-bg-1113', 'DPE-2024-05', 'D', 'nord', 12.5, 45, '2024/05/10', 1, 1, 0],  // 2 mois après vente ✅
        ['bdnb-bg-1113', 'DPE-2024-12', 'B', 'est', 18.0, 45, '2024/12/20', 0, 0, 1],   // 9 mois après vente ❌
        
        // Bâtiment 2 : Vente 2024/06/01
        ['bdnb-bg-2222', 'DPE-2023', 'C', 'est', 18.0, 52, '2023/08/15', 0, 0, 1],     // Avant vente
        ['bdnb-bg-2222', 'DPE-2024-08', 'B', 'est', 18.0, 52, '2024/08/15', 0, 0, 1],   // 2.5 mois après vente ✅
        ['bdnb-bg-2222', 'DPE-2025-01', 'A', 'est', 20.0, 52, '2025/01/15', 1, 0, 1],   // 7.5 mois après vente ❌
        
        // Bâtiment 3 : Vente 2024/01/01
        ['bdnb-bg-3333', 'DPE-2024-02', 'D', 'ouest', 16.0, 38, '2024/02/15', 0, 1, 0], // 1.5 mois après vente ✅
        ['bdnb-bg-3333', 'DPE-2024-09', 'C', 'ouest', 16.0, 38, '2024/09/15', 0, 1, 0], // 8.5 mois après vente ❌
    ];
    
    dpeTestData.forEach(data => insertDpeStmt.run(...data));
    
    // Ventes de test
    const insertDvfStmt = db.prepare(`
        INSERT OR IGNORE INTO temp_dvf 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const dvfTestData = [
        ['2024-001', '40293000AC0070', 'Appartement', 45, 120000, '2024/03/15', 3, 'bdnb-bg-1113'],
        ['2024-002', '40293000AC0071', 'Appartement', 52, 135000, '2024/06/01', 4, 'bdnb-bg-2222'],
        ['2024-003', '40293000AC0072', 'Appartement', 38, 110000, '2024/01/01', 3, 'bdnb-bg-3333']
    ];
    
    dvfTestData.forEach(data => insertDvfStmt.run(...data));
    
    console.log('✅ Données de test insérées\n');
    
    // Test de la logique avec fenêtre temporelle
    console.log('🧪 Test de la logique avec fenêtre temporelle (6 mois)...');
    
    const testQuery = db.prepare(`
        SELECT 
            dvf.id_mutation,
            dvf.date_mutation,
            dvf.surface_reelle_bati,
            dvf.batiment_groupe_id,
            -- Calculer la différence en jours
            julianday('2024/12/31') - julianday(dvf.date_mutation) as jours_depuis_vente,
            -- DPE sélectionné selon la logique
            (SELECT dpe.classe_dpe 
             FROM temp_bdnb_dpe dpe
             WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
               AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
               AND (
                   -- DPE avant la vente : toujours valide
                   dpe.date_etablissement_dpe <= dvf.date_mutation
                   OR
                   -- DPE après la vente : seulement si dans les 6 mois
                   (dpe.date_etablissement_dpe > dvf.date_mutation 
                    AND julianday(dpe.date_etablissement_dpe) - julianday(dvf.date_mutation) <= 180)
               )
             ORDER BY 
               CASE 
                 -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
                 WHEN dpe.date_etablissement_dpe > dvf.date_mutation 
                 THEN dpe.date_etablissement_dpe DESC
                 -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
                 ELSE dpe.date_etablissement_dpe ASC
               END,
               ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati)
             LIMIT 1) as dpe_selectionne,
            -- Date du DPE sélectionné
            (SELECT dpe.date_etablissement_dpe 
             FROM temp_bdnb_dpe dpe
             WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
               AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
               AND (
                   dpe.date_etablissement_dpe <= dvf.date_mutation
                   OR
                   (dpe.date_etablissement_dpe > dvf.date_mutation 
                    AND julianday(dpe.date_etablissement_dpe) - julianday(dvf.date_mutation) <= 180)
               )
             ORDER BY 
               CASE 
                 WHEN dpe.date_etablissement_dpe > dvf.date_mutation 
                 THEN dpe.date_etablissement_dpe DESC
                 ELSE dpe.date_etablissement_dpe ASC
               END,
               ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati)
             LIMIT 1) as date_dpe_selectionne,
            -- Différence en jours entre DPE et vente
            (SELECT julianday(dpe.date_etablissement_dpe) - julianday(dvf.date_mutation)
             FROM temp_bdnb_dpe dpe
             WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
               AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
               AND (
                   dpe.date_etablissement_dpe <= dvf.date_mutation
                   OR
                   (dpe.date_etablissement_dpe > dvf.date_mutation 
                    AND julianday(dpe.date_etablissement_dpe) - julianday(dvf.date_mutation) <= 180)
               )
             ORDER BY 
               CASE 
                 WHEN dpe.date_etablissement_dpe > dvf.date_mutation 
                 THEN dpe.date_etablissement_dpe DESC
                 ELSE dpe.date_etablissement_dpe ASC
               END,
               ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati)
             LIMIT 1) as difference_jours
        FROM temp_dvf dvf
        ORDER BY dvf.date_mutation DESC
    `);
    
    const results = testQuery.all();
    
    console.log('📊 Résultats des tests avec fenêtre temporelle :');
    console.log('');
    
    results.forEach(result => {
        console.log(`🏠 Transaction: ${result.id_mutation}`);
        console.log(`   📅 Date vente: ${result.date_mutation}`);
        console.log(`   📏 Surface: ${result.surface_reelle_bati} m²`);
        console.log(`   🏢 Bâtiment: ${result.batiment_groupe_id}`);
        console.log(`   🎯 DPE sélectionné: ${result.dpe_selectionne || 'Aucun'}`);
        console.log(`   📅 Date DPE: ${result.date_dpe_selectionne || 'N/A'}`);
        
        if (result.difference_jours !== null) {
            const jours = Math.round(result.difference_jours);
            const mois = Math.round(jours / 30);
            console.log(`   ⏰ Différence: ${jours} jours (${mois} mois)`);
            
            if (jours > 0) {
                console.log(`   ✅ DPE après vente (${jours <= 180 ? 'dans les 6 mois' : 'plus de 6 mois'})`);
            } else {
                console.log(`   ✅ DPE avant vente`);
            }
        }
        console.log('');
    });
    
    // Vérification des DPE disponibles par bâtiment
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
    
    // Test de validation de la fenêtre temporelle
    console.log('\n🧪 Validation de la fenêtre temporelle :');
    
    const validationQuery = db.prepare(`
        SELECT 
            dvf.id_mutation,
            dvf.date_mutation,
            dpe.date_etablissement_dpe,
            dpe.classe_dpe,
            julianday(dpe.date_etablissement_dpe) - julianday(dvf.date_mutation) as difference_jours,
            CASE 
                WHEN julianday(dpe.date_etablissement_dpe) - julianday(dvf.date_mutation) <= 180 
                THEN '✅ DANS LA FENÊTRE'
                ELSE '❌ HORS FENÊTRE'
            END as statut_fenetre
        FROM temp_dvf dvf
        CROSS JOIN temp_bdnb_dpe dpe
        WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
          AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
          AND dpe.date_etablissement_dpe > dvf.date_mutation
        ORDER BY dvf.id_mutation, difference_jours
    `);
    
    const validations = validationQuery.all();
    
    validations.forEach(validation => {
        const jours = Math.round(validation.difference_jours);
        const mois = Math.round(jours / 30);
        console.log(`   🏠 ${validation.id_mutation}: DPE ${validation.classe_dpe} (${validation.date_etablissement_dpe})`);
        console.log(`      ⏰ ${jours} jours (${mois} mois) - ${validation.statut_fenetre}`);
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
