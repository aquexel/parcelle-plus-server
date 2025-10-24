#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

console.log('🧪 TEST: Jointure intelligente DPE-DVF par surface\n');

// Configuration
const CSV_DIR = path.join(__dirname, 'open_data_millesime_2024-10-a_dep40_csv', 'csv');
const DB_FILE = path.join(__dirname, 'test_intelligent_join.db');

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
            nombre_pieces_principales INTEGER,
            batiment_groupe_id TEXT
        )
    `);
    
    // Charger quelques lignes de test DPE
    console.log('📂 Chargement des données DPE de test...');
    
    const dpeFile = path.join(CSV_DIR, 'batiment_groupe_dpe_representatif_logement.csv');
    if (!fs.existsSync(dpeFile)) {
        console.log('❌ Fichier DPE non trouvé:', dpeFile);
        process.exit(1);
    }
    
    const dpeContent = fs.readFileSync(dpeFile, 'utf8');
    const dpeLines = dpeContent.split('\n').slice(1, 21); // Prendre les 20 premières lignes
    
    const insertDpeStmt = db.prepare(`
        INSERT OR IGNORE INTO temp_bdnb_dpe 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let dpeLoadedCount = 0;
    for (const line of dpeLines) {
        if (line.trim()) {
            const columns = line.split(',');
            if (columns.length >= 20) {
                const batimentId = columns[0]?.trim();
                const identifiantDpe = columns[1]?.trim();
                const classeDpe = columns[18]?.trim(); // classe_bilan_dpe
                const surfaceHabitable = parseFloat(columns[14]) || null; // surface_habitable_logement
                
                if (batimentId && identifiantDpe && classeDpe && classeDpe !== 'N') {
                    insertDpeStmt.run(
                        batimentId,
                        identifiantDpe,
                        classeDpe,
                        'sud', // orientation par défaut
                        15.0,  // vitrage par défaut
                        surfaceHabitable,
                        0,     // piscine
                        1,     // garage
                        0      // véranda
                    );
                    dpeLoadedCount++;
                }
            }
        }
    }
    
    console.log(`✅ ${dpeLoadedCount} DPE chargés\n`);
    
    // Charger quelques lignes de test DVF
    console.log('📂 Chargement des données DVF de test...');
    
    const dvfFile = path.join(CSV_DIR, 'batiment_groupe_dvf_open_representatif.csv');
    if (!fs.existsSync(dvfFile)) {
        console.log('❌ Fichier DVF non trouvé:', dvfFile);
        process.exit(1);
    }
    
    const dvfContent = fs.readFileSync(dvfFile, 'utf8');
    const dvfLines = dvfContent.split('\n').slice(1, 21); // Prendre les 20 premières lignes
    
    const insertDvfStmt = db.prepare(`
        INSERT OR IGNORE INTO temp_dvf 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    let dvfLoadedCount = 0;
    for (const line of dvfLines) {
        if (line.trim()) {
            const columns = line.split(',');
            if (columns.length >= 10) {
                const idMutation = columns[0]?.trim();
                const idParcelle = columns[1]?.trim();
                const typeLocal = columns[2]?.trim();
                const surfaceBati = parseFloat(columns[3]) || null;
                const valeurFonciere = parseFloat(columns[4]) || null;
                const nbPieces = parseInt(columns[5]) || null;
                const batimentId = columns[6]?.trim();
                
                if (idMutation && idParcelle && typeLocal && surfaceBati && valeurFonciere) {
                    insertDvfStmt.run(
                        idMutation,
                        idParcelle,
                        typeLocal,
                        surfaceBati,
                        valeurFonciere,
                        nbPieces,
                        batimentId
                    );
                    dvfLoadedCount++;
                }
            }
        }
    }
    
    console.log(`✅ ${dvfLoadedCount} transactions DVF chargées\n`);
    
    // Analyser les bâtiments avec plusieurs DPE
    console.log('🔍 Analyse des bâtiments avec plusieurs DPE...');
    
    const multipleDpeQuery = db.prepare(`
        SELECT 
            batiment_groupe_id,
            COUNT(*) as nb_dpe,
            GROUP_CONCAT(identifiant_dpe) as identifiants_dpe,
            GROUP_CONCAT(classe_dpe) as classes_dpe,
            GROUP_CONCAT(surface_habitable_logement) as surfaces_dpe
        FROM temp_bdnb_dpe 
        GROUP BY batiment_groupe_id 
        HAVING COUNT(*) > 1
        ORDER BY nb_dpe DESC
        LIMIT 5
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
            console.log(`   📏 Surfaces: ${result.surfaces_dpe}`);
            console.log('');
        }
    } else {
        console.log('⚠️ Aucun bâtiment avec plusieurs DPE trouvé dans l\'échantillon');
    }
    
    // Tester la jointure intelligente
    console.log('🧪 Test de la jointure intelligente par surface...');
    
    const testBatiment = multipleDpeResults[0];
    if (testBatiment) {
        // Trouver les transactions DVF pour ce bâtiment
        const dvfForBatiment = db.prepare(`
            SELECT * FROM temp_dvf 
            WHERE batiment_groupe_id = ?
        `).all(testBatiment.batiment_groupe_id);
        
        if (dvfForBatiment.length > 0) {
            console.log(`🏢 Bâtiment test: ${testBatiment.batiment_groupe_id}`);
            console.log(`   📊 Transactions DVF: ${dvfForBatiment.length}`);
            console.log('');
            
            for (const dvf of dvfForBatiment) {
                console.log(`   🏠 Transaction: ${dvf.id_mutation}`);
                console.log(`      📏 Surface DVF: ${dvf.surface_reelle_bati} m²`);
                console.log(`      💰 Valeur: ${dvf.valeur_fonciere} €`);
                
                // Tester la jointure intelligente
                const intelligentJoin = db.prepare(`
                    SELECT 
                        classe_dpe,
                        identifiant_dpe,
                        surface_habitable_logement,
                        ABS(surface_habitable_logement - ?) as difference_surface
                    FROM temp_bdnb_dpe 
                    WHERE batiment_groupe_id = ?
                      AND ABS(surface_habitable_logement - ?) < 10
                    ORDER BY ABS(surface_habitable_logement - ?)
                    LIMIT 1
                `).get(dvf.surface_reelle_bati, testBatiment.batiment_groupe_id, dvf.surface_reelle_bati, dvf.surface_reelle_bati);
                
                if (intelligentJoin) {
                    console.log(`      🎯 DPE sélectionné: ${intelligentJoin.classe_dpe}`);
                    console.log(`      🆔 Identifiant: ${intelligentJoin.identifiant_dpe}`);
                    console.log(`      📏 Surface DPE: ${intelligentJoin.surface_habitable_logement} m²`);
                    console.log(`      📊 Différence: ${intelligentJoin.difference_surface} m²`);
                } else {
                    console.log(`      ❌ Aucun DPE trouvé avec une différence < 10 m²`);
                }
                console.log('');
            }
        } else {
            console.log(`⚠️ Aucune transaction DVF trouvée pour le bâtiment ${testBatiment.batiment_groupe_id}`);
        }
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
