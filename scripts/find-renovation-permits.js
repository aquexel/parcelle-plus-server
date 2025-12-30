#!/usr/bin/env node

/**
 * 🔍 SCRIPT POUR TROUVER LES PERMIS DE CONSTRUIRE AVEC RÉNOVATION
 * 
 * Cherche dans les bases de données :
 * - terrains_pc_sans_pa.db
 * - terrains_batir_complet.db
 * 
 * Les permis de rénovation sont identifiés par :
 * - type_terrain = 'RENOVATION'
 * - Ou NATURE_PROJET_COMPLETEE = '2' / NATURE_PROJET_DECLAREE = '2'
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PC_SANS_PA = path.join(__dirname, '..', 'database', 'terrains_pc_sans_pa.db');
const DB_COMPLET = path.join(__dirname, '..', 'database', 'terrains_batir_complet.db');

function findRenovations(dbPath, dbName) {
    if (!fs.existsSync(dbPath)) {
        console.log(`⚠️  Base ${dbName} non trouvée : ${dbPath}`);
        return null;
    }

    console.log(`\n📊 Analyse de ${dbName}...`);
    const db = new Database(dbPath, { readonly: true });

    try {
        // Vérifier si la table existe
        const tables = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name LIKE '%terrain%'
        `).all();

        if (tables.length === 0) {
            console.log(`   ⚠️  Aucune table trouvée dans ${dbName}`);
            return null;
        }

        const tableName = tables[0].name;
        console.log(`   📋 Table: ${tableName}`);

        // Vérifier si la colonne type_terrain existe
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
        const hasTypeTerrain = columns.some(col => col.name === 'type_terrain');

        if (!hasTypeTerrain) {
            console.log(`   ⚠️  Colonne type_terrain non trouvée dans ${tableName}`);
            return null;
        }

        // Compter les rénovations
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_renovations,
                SUM(CASE WHEN surface_reelle_bati > 0 THEN 1 ELSE 0 END) as avec_bati,
                SUM(CASE WHEN surface_totale > 0 THEN 1 ELSE 0 END) as avec_terrain,
                AVG(valeur_fonciere) as prix_moyen,
                AVG(surface_reelle_bati) as surface_bati_moyenne,
                AVG(surface_totale) as surface_terrain_moyenne,
                AVG(prix_m2) as prix_m2_moyen
            FROM ${tableName}
            WHERE type_terrain = 'RENOVATION'
        `).get();

        if (!stats || stats.total_renovations === 0) {
            console.log(`   ❌ Aucune rénovation trouvée dans ${tableName}`);
            return null;
        }

        console.log(`\n   ✅ ${stats.total_renovations.toLocaleString()} permis de rénovation trouvés`);
        console.log(`      - Avec bâti: ${stats.avec_bati?.toLocaleString() || 0}`);
        console.log(`      - Avec terrain: ${stats.avec_terrain?.toLocaleString() || 0}`);
        console.log(`      - Prix moyen: ${stats.prix_moyen ? Math.round(stats.prix_moyen).toLocaleString() : 'N/A'} €`);
        console.log(`      - Surface bâti moyenne: ${stats.surface_bati_moyenne ? Math.round(stats.surface_bati_moyenne) : 'N/A'} m²`);
        console.log(`      - Surface terrain moyenne: ${stats.surface_terrain_moyenne ? Math.round(stats.surface_terrain_moyenne) : 'N/A'} m²`);
        console.log(`      - Prix/m² moyen: ${stats.prix_m2_moyen ? Math.round(stats.prix_m2_moyen) : 'N/A'} €/m²`);

        // Statistiques par département
        const statsByDept = db.prepare(`
            SELECT 
                code_departement,
                COUNT(*) as nb_renovations,
                AVG(valeur_fonciere) as prix_moyen,
                AVG(surface_reelle_bati) as surface_bati_moyenne
            FROM ${tableName}
            WHERE type_terrain = 'RENOVATION'
            GROUP BY code_departement
            ORDER BY nb_renovations DESC
            LIMIT 10
        `).all();

        if (statsByDept.length > 0) {
            console.log(`\n   📊 Top 10 départements par nombre de rénovations:`);
            statsByDept.forEach((dept, i) => {
                console.log(`      ${i + 1}. ${dept.code_departement}: ${dept.nb_renovations.toLocaleString()} rénovations (prix moyen: ${Math.round(dept.prix_moyen || 0).toLocaleString()} €)`);
            });
        }

        // Exemples de rénovations
        const examples = db.prepare(`
            SELECT 
                id,
                id_parcelle,
                id_mutation,
                valeur_fonciere,
                surface_totale,
                surface_reelle_bati,
                prix_m2,
                date_mutation,
                nom_commune,
                code_commune,
                code_departement
            FROM ${tableName}
            WHERE type_terrain = 'RENOVATION'
            ORDER BY date_mutation DESC
            LIMIT 5
        `).all();

        if (examples.length > 0) {
            console.log(`\n   📋 Exemples de rénovations (5 plus récentes):`);
            examples.forEach((ex, i) => {
                console.log(`      ${i + 1}. ${ex.nom_commune} (${ex.code_departement}) - ${ex.date_mutation}`);
                console.log(`         Parcelle: ${ex.id_parcelle} | Mutation: ${ex.id_mutation}`);
                console.log(`         Prix: ${ex.valeur_fonciere?.toLocaleString() || 'N/A'} € | Bâti: ${ex.surface_reelle_bati ? Math.round(ex.surface_reelle_bati) : 'N/A'} m² | Terrain: ${ex.surface_totale ? Math.round(ex.surface_totale) : 'N/A'} m²`);
            });
        }

        return {
            total: stats.total_renovations,
            stats: stats,
            byDept: statsByDept,
            examples: examples
        };

    } catch (error) {
        console.error(`   ❌ Erreur lors de l'analyse de ${dbName}:`, error.message);
        return null;
    } finally {
        db.close();
    }
}

// Fonction principale
function main() {
    console.log('🔍 === RECHERCHE DES PERMIS DE CONSTRUIRE AVEC RÉNOVATION ===\n');

    const results = [];

    // Chercher dans terrains_pc_sans_pa.db
    const result1 = findRenovations(DB_PC_SANS_PA, 'terrains_pc_sans_pa.db');
    if (result1) results.push({ db: 'terrains_pc_sans_pa.db', ...result1 });

    // Chercher dans terrains_batir_complet.db
    const result2 = findRenovations(DB_COMPLET, 'terrains_batir_complet.db');
    if (result2) results.push({ db: 'terrains_batir_complet.db', ...result2 });

    // Résumé global
    if (results.length > 0) {
        const totalGlobal = results.reduce((sum, r) => sum + r.total, 0);
        console.log(`\n🎉 === RÉSUMÉ GLOBAL ===`);
        console.log(`   Total permis de rénovation trouvés: ${totalGlobal.toLocaleString()}`);
        results.forEach(r => {
            console.log(`   - ${r.db}: ${r.total.toLocaleString()} rénovations`);
        });
    } else {
        console.log(`\n❌ Aucune base de données avec des rénovations trouvée.`);
        console.log(`   Vérifiez que les bases existent :`);
        console.log(`   - ${DB_PC_SANS_PA}`);
        console.log(`   - ${DB_COMPLET}`);
    }
}

main();

