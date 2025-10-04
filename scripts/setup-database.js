const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Créer le dossier database s'il n'existe pas
const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('✅ Dossier database créé');
}

const dbPath = path.join(dbDir, 'parcelle_plus.db');
const db = new sqlite3.Database(dbPath);

console.log('🚀 === INITIALISATION BASE DE DONNÉES PARCELLE PLUS ===');
console.log(`📁 Chemin base de données: ${dbPath}`);

// Créer toutes les tables
const createTables = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Table des polygones
            db.run(`
                CREATE TABLE IF NOT EXISTS polygons (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    coordinates TEXT NOT NULL,
                    surface REAL NOT NULL,
                    commune TEXT,
                    code_insee TEXT,
                    price REAL,
                    status TEXT DEFAULT 'available',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table polygons:', err);
                } else {
                    console.log('✅ Table polygons créée');
                }
            });

            // Table des messages
            db.run(`
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    sender_id TEXT NOT NULL,
                    sender_name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    room TEXT DEFAULT 'general',
                    message_type TEXT DEFAULT 'text',
                    reply_to TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table messages:', err);
                } else {
                    console.log('✅ Table messages créée');
                }
            });

            // Table des utilisateurs
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE,
                    user_type TEXT DEFAULT 'buyer',
                    device_id TEXT,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table users:', err);
                } else {
                    console.log('✅ Table users créée');
                }
            });

            // Table des rooms
            db.run(`
                CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    created_by TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table rooms:', err);
                } else {
                    console.log('✅ Table rooms créée');
                }
            });

            resolve();
        });
    });
};

// Insérer des données d'exemple
const insertSampleData = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Room par défaut
            db.run(`
                INSERT OR IGNORE INTO rooms (id, name, description, created_by)
                VALUES ('general', 'Général', 'Salon de discussion principal', 'system')
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur insertion room par défaut:', err);
                } else {
                    console.log('✅ Room par défaut créée');
                }
            });

            // Utilisateur système
            db.run(`
                INSERT OR IGNORE INTO users (id, username, email, user_type, device_id)
                VALUES ('system', 'Système', 'system@parcelle.plus', 'system', 'raspberry-pi')
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur insertion utilisateur système:', err);
                } else {
                    console.log('✅ Utilisateur système créé');
                }
            });

            // Message de bienvenue
            db.run(`
                INSERT OR IGNORE INTO messages (id, sender_id, sender_name, content, room, message_type)
                VALUES ('welcome', 'system', 'Système', 'Bienvenue sur le serveur ParcellePlus ! 🏠', 'general', 'text')
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur insertion message bienvenue:', err);
                } else {
                    console.log('✅ Message de bienvenue créé');
                }
            });

            resolve();
        });
    });
};

// Vérifier la base de données
const checkDatabase = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Compter les enregistrements
            db.get("SELECT COUNT(*) as count FROM polygons", (err, row) => {
                if (err) {
                    console.error('❌ Erreur vérification polygons:', err);
                } else {
                    console.log(`📊 Polygones: ${row.count}`);
                }
            });

            db.get("SELECT COUNT(*) as count FROM messages", (err, row) => {
                if (err) {
                    console.error('❌ Erreur vérification messages:', err);
                } else {
                    console.log(`📊 Messages: ${row.count}`);
                }
            });

            db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
                if (err) {
                    console.error('❌ Erreur vérification users:', err);
                } else {
                    console.log(`📊 Utilisateurs: ${row.count}`);
                }
            });

            db.get("SELECT COUNT(*) as count FROM rooms", (err, row) => {
                if (err) {
                    console.error('❌ Erreur vérification rooms:', err);
                } else {
                    console.log(`📊 Rooms: ${row.count}`);
                }
            });

            resolve();
        });
    });
};

// Exécuter l'initialisation
(async () => {
    try {
        await createTables();
        await insertSampleData();
        await checkDatabase();
        
        console.log('🎉 ========================================');
        console.log('🎉 BASE DE DONNÉES INITIALISÉE AVEC SUCCÈS !');
        console.log('🎉 ========================================');
        console.log('💡 Vous pouvez maintenant démarrer le serveur avec:');
        console.log('💡 npm start');
        console.log('💡 ');
        console.log('💡 Ou en mode développement avec:');
        console.log('💡 npm run dev');
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
    } finally {
        db.close((err) => {
            if (err) {
                console.error('❌ Erreur fermeture base de données:', err);
            } else {
                console.log('✅ Base de données fermée');
            }
        });
    }
})(); 