#!/usr/bin/env node

/**
 * 🔍 Test de liaison DPE - Vérification des croisements
 * 
 * Ce script teste si les données DPE sont correctement liées
 * aux transactions DVF dans la base de données.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database', 'dvf_avec_dpe_et_annexes_enhanced.db');

console.log('🔍 === TEST DE LIAISON DPE ===');
console.log('📂 Base :', DB_FILE);
console.log('');

// Vérifier que la base existe
const fs = require('fs');
if (!fs.existsSync(DB_FILE)) {
    console.log('❌ Base de données introuvable');
    console.log('💡 Exécutez d\'abord : bash update-dvf-dpe-database.sh');
    process.exit(1);
}

const db = new Database(DB_FILE);

try {
    // Test 1 : Nombre total de transactions
    console.log('📊 ÉTAPE 1 : Statistiques générales');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const totalCount = db.prepare('SELECT COUNT(*) as count FROM dvf_avec_dpe_et_annexes').get();
    console.log(`📈 Total transactions : ${totalCount.count.toLocaleString()}`);
    
    // Test 2 : Transactions avec DPE
    const dpeCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM dvf_avec_dpe_et_annexes 
        WHERE classe_dpe IS NOT NULL AND classe_dpe != ''
    `).get();
    
    const dpePercentage = ((dpeCount.count / totalCount.count) * 100).toFixed(1);
    console.log(`🏠 Avec DPE : ${dpeCount.count.toLocaleString()} (${dpePercentage}%)`);
    
    // Test 3 : Distribution des classes DPE
    console.log('');
    console.log('📊 ÉTAPE 2 : Distribution des classes DPE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const dpeDistribution = db.prepare(`
        SELECT classe_dpe, COUNT(*) as count
        FROM dvf_avec_dpe_et_annexes 
        WHERE classe_dpe IS NOT NULL AND classe_dpe != ''
        GROUP BY classe_dpe
        ORDER BY classe_dpe
    `).all();
    
    dpeDistribution.forEach(row => {
        const percentage = ((row.count / dpeCount.count) * 100).toFixed(1);
        console.log(`   ${row.classe_dpe} : ${row.count.toLocaleString()} (${percentage}%)`);
    });
    
    // Test 4 : Vérification des liaisons par département
    console.log('');
    console.log('📊 ÉTAPE 3 : Vérification par département');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const deptStats = db.prepare(`
        SELECT 
            code_departement,
            COUNT(*) as total,
            SUM(CASE WHEN classe_dpe IS NOT NULL AND classe_dpe != '' THEN 1 ELSE 0 END) as avec_dpe,
            ROUND(100.0 * SUM(CASE WHEN classe_dpe IS NOT NULL AND classe_dpe != '' THEN 1 ELSE 0 END) / COUNT(*), 1) as pourcentage_dpe
        FROM dvf_avec_dpe_et_annexes 
        GROUP BY code_departement
        ORDER BY code_departement
    `).all();
    
    deptStats.forEach(row => {
        console.log(`   ${row.code_departement} : ${row.total.toLocaleString()} transactions, ${row.avec_dpe.toLocaleString()} avec DPE (${row.pourcentage_dpe}%)`);
    });
    
    // Test 5 : Vérification des annexes
    console.log('');
    console.log('📊 ÉTAPE 4 : Vérification des annexes');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const annexesStats = db.prepare(`
        SELECT 
            SUM(presence_piscine) as piscines,
            SUM(presence_garage) as garages,
            SUM(presence_veranda) as verandas,
            SUM(CASE WHEN orientation_principale IS NOT NULL THEN 1 ELSE 0 END) as orientations,
            SUM(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 ELSE 0 END) as vitrages
        FROM dvf_avec_dpe_et_annexes
    `).get();
    
    console.log(`🏊 Piscines : ${annexesStats.piscines.toLocaleString()}`);
    console.log(`🚗 Garages : ${annexesStats.garages.toLocaleString()}`);
    console.log(`🏡 Vérandas : ${annexesStats.verandas.toLocaleString()}`);
    console.log(`🧭 Orientations : ${annexesStats.orientations.toLocaleString()}`);
    console.log(`🪟 Vitrages : ${annexesStats.vitrages.toLocaleString()}`);
    
    // Test 6 : Exemple de transaction complète
    console.log('');
    console.log('📊 ÉTAPE 5 : Exemple de transaction complète');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const example = db.prepare(`
        SELECT 
            batiment_groupe_id,
            valeur_fonciere,
            surface_bati_maison,
            surface_bati_appartement,
            nb_pieces,
            classe_dpe,
            presence_piscine,
            presence_garage,
            presence_veranda,
            orientation_principale,
            pourcentage_vitrage,
            nom_commune
        FROM dvf_avec_dpe_et_annexes 
        WHERE classe_dpe IS NOT NULL 
        AND presence_piscine = 1
        LIMIT 1
    `).get();
    
    if (example) {
        console.log('✅ Exemple trouvé :');
        console.log(`   🏠 Bâtiment : ${example.batiment_groupe_id}`);
        console.log(`   💰 Prix : ${example.valeur_fonciere.toLocaleString()}€`);
        console.log(`   📐 Surface maison : ${example.surface_bati_maison}m²`);
        console.log(`   🚪 Pièces : ${example.nb_pieces}`);
        console.log(`   ⚡ DPE : ${example.classe_dpe}`);
        console.log(`   🏊 Piscine : ${example.presence_piscine ? 'Oui' : 'Non'}`);
        console.log(`   🚗 Garage : ${example.presence_garage ? 'Oui' : 'Non'}`);
        console.log(`   🏡 Véranda : ${example.presence_veranda ? 'Oui' : 'Non'}`);
        console.log(`   🧭 Orientation : ${example.orientation_principale || 'N/A'}`);
        console.log(`   🪟 Vitrage : ${example.pourcentage_vitrage ? example.pourcentage_vitrage + '%' : 'N/A'}`);
        console.log(`   🏘️ Commune : ${example.nom_commune}`);
    } else {
        console.log('⚠️ Aucun exemple complet trouvé');
    }
    
    // Test 7 : Vérification des erreurs de liaison
    console.log('');
    console.log('📊 ÉTAPE 6 : Vérification des erreurs');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const errors = db.prepare(`
        SELECT COUNT(*) as count
        FROM dvf_avec_dpe_et_annexes 
        WHERE batiment_groupe_id IS NULL 
        OR valeur_fonciere IS NULL 
        OR valeur_fonciere <= 0
    `).get();
    
    console.log(`❌ Transactions avec erreurs : ${errors.count.toLocaleString()}`);
    
    if (errors.count === 0) {
        console.log('✅ Aucune erreur détectée');
    } else {
        console.log('⚠️ Des erreurs ont été détectées');
    }
    
    console.log('');
    console.log('✅ === TEST TERMINÉ ===');
    
    // Résumé final
    if (dpePercentage > 0) {
        console.log(`🎉 SUCCÈS : ${dpePercentage}% des transactions ont un DPE`);
    } else {
        console.log('❌ PROBLÈME : Aucune transaction n\'a de DPE');
        console.log('💡 Vérifiez le script create-dvf-dpe-annexes-db-enhanced.js');
    }
    
} catch (error) {
    console.error('❌ Erreur lors du test :', error.message);
    process.exit(1);
} finally {
    db.close();
}
