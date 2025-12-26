const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Chemin vers la base de données métier
const dbPath = path.join(__dirname, '..', 'database', 'parcelle_business.db');

console.log('🚀 === MIGRATION : Ajout des colonnes orientation, luminosite, surface_maison ===');
console.log(`📁 Base de données: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
    console.error('❌ Base de données non trouvée. Assurez-vous que le serveur a été démarré au moins une fois.');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

// Vérifier si les colonnes existent déjà
const checkColumnExists = (columnName) => {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(polygons)", (err, rows) => {
            if (err) {
                reject(err);
            } else {
                const exists = rows.some(row => row.name === columnName);
                resolve(exists);
            }
        });
    });
};

// Ajouter une colonne si elle n'existe pas
const addColumnIfNotExists = async (columnName, columnType) => {
    const exists = await checkColumnExists(columnName);
    if (exists) {
        console.log(`✅ Colonne ${columnName} existe déjà`);
        return false;
    } else {
        return new Promise((resolve, reject) => {
            const query = `ALTER TABLE polygons ADD COLUMN ${columnName} ${columnType}`;
            db.run(query, (err) => {
                if (err) {
                    console.error(`❌ Erreur ajout colonne ${columnName}:`, err.message);
                    reject(err);
                } else {
                    console.log(`✅ Colonne ${columnName} ajoutée avec succès`);
                    resolve(true);
                }
            });
        });
    }
};

// Exécuter la migration
(async () => {
    try {
        console.log('\n🔍 Vérification des colonnes existantes...');
        
        // Vérifier que la table polygons existe
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='polygons'", async (err, row) => {
            if (err) {
                console.error('❌ Erreur vérification table:', err);
                db.close();
                process.exit(1);
            }
            
            if (!row) {
                console.error('❌ Table polygons non trouvée. La base de données semble vide.');
                db.close();
                process.exit(1);
            }
            
            console.log('✅ Table polygons trouvée\n');
            
            try {
                // Ajouter les colonnes une par une
                await addColumnIfNotExists('orientation', 'TEXT');
                await addColumnIfNotExists('luminosite', 'REAL');
                await addColumnIfNotExists('surface_maison', 'REAL');
                
                console.log('\n🎉 ========================================');
                console.log('🎉 MIGRATION TERMINÉE AVEC SUCCÈS !');
                console.log('🎉 ========================================');
                console.log('💡 Les colonnes ont été ajoutées sans supprimer les données');
                console.log('💡 Vous pouvez maintenant redémarrer le serveur');
                
            } catch (error) {
                console.error('❌ Erreur lors de la migration:', error);
            } finally {
                db.close((err) => {
                    if (err) {
                        console.error('❌ Erreur fermeture base:', err);
                    } else {
                        console.log('✅ Base de données fermée');
                    }
                    process.exit(0);
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la migration:', error);
        db.close();
        process.exit(1);
    }
})();

