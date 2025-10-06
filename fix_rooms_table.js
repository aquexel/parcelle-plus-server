const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'parcelle_business.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Correction de la table rooms...');

// Supprimer l'ancienne table rooms
db.run('DROP TABLE IF EXISTS rooms', (err) => {
    if (err) {
        console.error('❌ Erreur suppression table rooms:', err);
        process.exit(1);
    }
    
    console.log('✅ Ancienne table rooms supprimée');
    
    // Créer la nouvelle table rooms avec la bonne structure
    const createRoomsTable = `
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_by TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;
    
    db.run(createRoomsTable, (err) => {
        if (err) {
            console.error('❌ Erreur création table rooms:', err);
            process.exit(1);
        }
        
        console.log('✅ Nouvelle table rooms créée');
        
        // Vérifier la structure
        db.all("PRAGMA table_info(rooms)", (err, columns) => {
            if (err) {
                console.error('❌ Erreur vérification structure:', err);
                process.exit(1);
            }
            
            console.log('📋 Structure de la table rooms:');
            columns.forEach(col => {
                console.log(`   - ${col.name}: ${col.type}`);
            });
            
            db.close();
            console.log('✅ Migration terminée !');
        });
    });
});

