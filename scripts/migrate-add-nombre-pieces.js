const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database', 'parcelle_business.db');

console.log('🚀 === DÉBUT MIGRATION nombre_pieces ===');
console.log(`📁 Base métier: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
    console.error('❌ Erreur: La base de données métier n\'existe pas. Exécutez setup-dual-databases.js d\'abord si c\'est une nouvelle installation.');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Fonction pour vérifier et ajouter une colonne
    const addColumn = (tableName, columnName, columnType) => {
        return new Promise((resolve, reject) => {
            db.get(`PRAGMA table_info(${tableName})`, (err, rows) => {
                if (err) {
                    console.error(`❌ Erreur vérification colonne ${columnName}:`, err);
                    reject(err);
                    return;
                }
                
                db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
                    if (err) {
                        console.error(`❌ Erreur récupération colonnes:`, err);
                        reject(err);
                        return;
                    }
                    
                    const columnExists = columns.some(col => col.name === columnName);
                    if (!columnExists) {
                        db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`, (err) => {
                            if (err) {
                                console.error(`❌ Erreur ajout colonne ${columnName}:`, err);
                                reject(err);
                            } else {
                                console.log(`✅ Colonne '${columnName}' ajoutée à la table '${tableName}'`);
                                resolve();
                            }
                        });
                    } else {
                        console.log(`☑️ Colonne '${columnName}' existe déjà dans la table '${tableName}'`);
                        resolve();
                    }
                });
            });
        });
    };

    (async () => {
        try {
            await addColumn('polygons', 'nombre_pieces', 'INTEGER');
            console.log('\n🎉 MIGRATION TERMINÉE AVEC SUCCÈS !');
        } catch (error) {
            console.error('\n❌ Erreur lors de la migration:', error);
        } finally {
            db.close((err) => {
                if (err) {
                    console.error('❌ Erreur fermeture base métier:', err);
                } else {
                    console.log('✅ Base métier fermée');
                }
            });
        }
    })();
});

