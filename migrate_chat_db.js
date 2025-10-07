const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'database');
const DB_PATH = path.join(DB_DIR, 'parcelle_chat.db');

console.log('🔧 Migration de la base de données parcelle_chat.db');
console.log('='.repeat(60));

// Ouvrir la base de données
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Erreur connexion à la base:', err.message);
        process.exit(1);
    }
    console.log('✅ Connexion à la base établie');
});

// Fonction pour exécuter une requête
function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// Fonction pour obtenir les infos d'une table
function getTableInfo(tableName) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function migrateDatabase() {
    try {
        console.log('\n📋 Vérification de la structure de la table rooms...');
        
        // Vérifier si la colonne 'name' existe dans rooms
        const roomsInfo = await getTableInfo('rooms');
        const hasNameColumn = roomsInfo.some(col => col.name === 'name');
        
        if (!hasNameColumn) {
            console.log('⚠️  La colonne "name" n\'existe pas dans la table rooms');
            console.log('🔄 Recréation de la table rooms...');
            
            // Sauvegarder les anciennes données si elles existent
            await runQuery('DROP TABLE IF EXISTS rooms_backup');
            await runQuery('ALTER TABLE rooms RENAME TO rooms_backup');
            
            // Créer la nouvelle table rooms avec la bonne structure
            await runQuery(`
                CREATE TABLE rooms (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    created_by TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            console.log('✅ Nouvelle table rooms créée');
            
            // Essayer de migrer les anciennes données si possible
            try {
                await runQuery(`
                    INSERT INTO rooms (id, created_by, created_at, name, description)
                    SELECT id, 'migrated', CURRENT_TIMESTAMP, 'Room ' || id, 'Migrated room'
                    FROM rooms_backup
                `);
                console.log('✅ Anciennes données migrées');
            } catch (e) {
                console.log('⚠️  Impossible de migrer les anciennes données:', e.message);
            }
            
            // Supprimer la sauvegarde
            await runQuery('DROP TABLE IF EXISTS rooms_backup');
        } else {
            console.log('✅ La table rooms a déjà la bonne structure');
        }
        
        console.log('\n📋 Vérification de la structure de la table messages...');
        
        // Vérifier la structure de messages
        const messagesInfo = await getTableInfo('messages');
        const hasSenderIdColumn = messagesInfo.some(col => col.name === 'sender_id');
        const hasSenderNameColumn = messagesInfo.some(col => col.name === 'sender_name');
        const hasRoomColumn = messagesInfo.some(col => col.name === 'room');
        
        if (!hasSenderIdColumn || !hasSenderNameColumn || !hasRoomColumn) {
            console.log('⚠️  La table messages n\'a pas la bonne structure');
            console.log('🔄 Recréation de la table messages...');
            
            // Sauvegarder les anciennes données
            await runQuery('DROP TABLE IF EXISTS messages_backup');
            await runQuery('ALTER TABLE messages RENAME TO messages_backup');
            
            // Créer la nouvelle table messages
            await runQuery(`
                CREATE TABLE messages (
                    id TEXT PRIMARY KEY,
                    sender_id TEXT NOT NULL,
                    sender_name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    room TEXT NOT NULL,
                    message_type TEXT DEFAULT 'text',
                    reply_to TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            console.log('✅ Nouvelle table messages créée');
            
            // Essayer de migrer les anciennes données si possible
            try {
                await runQuery(`
                    INSERT INTO messages (id, sender_id, sender_name, content, room, created_at)
                    SELECT 
                        id, 
                        COALESCE(senderId, sender_id, 'unknown') as sender_id,
                        COALESCE(sender_name, 'Unknown') as sender_name,
                        content,
                        COALESCE(roomId, room, 'general') as room,
                        COALESCE(createdAt, created_at, CURRENT_TIMESTAMP) as created_at
                    FROM messages_backup
                `);
                console.log('✅ Anciennes données migrées');
            } catch (e) {
                console.log('⚠️  Impossible de migrer les anciennes données:', e.message);
            }
            
            // Supprimer la sauvegarde
            await runQuery('DROP TABLE IF EXISTS messages_backup');
        } else {
            console.log('✅ La table messages a déjà la bonne structure');
        }
        
        console.log('\n🎉 Migration terminée avec succès !');
        
    } catch (error) {
        console.error('\n❌ Erreur lors de la migration:', error.message);
        throw error;
    }
}

// Exécuter la migration
migrateDatabase()
    .then(() => {
        console.log('\n✅ Base de données migrée');
        db.close();
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Échec de la migration:', error);
        db.close();
        process.exit(1);
    });


