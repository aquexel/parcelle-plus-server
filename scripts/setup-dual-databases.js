const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Créer le dossier database s'il n'existe pas
const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('✅ Dossier database créé');
}

const businessDbPath = path.join(dbDir, 'parcelle_business.db');
const chatDbPath = path.join(dbDir, 'parcelle_chat.db');

console.log('🚀 === INITIALISATION DOUBLE BASE DE DONNÉES PARCELLE PLUS ===');
console.log(`📁 Base métier: ${businessDbPath}`);
console.log(`📁 Base chat: ${chatDbPath}`);

// Supprimer les anciennes bases si elles existent
if (fs.existsSync(businessDbPath)) {
    fs.unlinkSync(businessDbPath);
    console.log('🗑️ Ancienne base métier supprimée');
}

if (fs.existsSync(chatDbPath)) {
    fs.unlinkSync(chatDbPath);
    console.log('🗑️ Ancienne base chat supprimée');
}

// Supprimer aussi l'ancienne base unique
const oldDbPath = path.join(dbDir, 'parcelle_plus.db');
if (fs.existsSync(oldDbPath)) {
    fs.unlinkSync(oldDbPath);
    console.log('🗑️ Ancienne base unique supprimée');
}

const businessDb = new sqlite3.Database(businessDbPath);
const chatDb = new sqlite3.Database(chatDbPath);

// ========== BASE MÉTIER ==========
const createBusinessTables = () => {
    return new Promise((resolve, reject) => {
        businessDb.serialize(() => {
            // Table des polygones/parcelles
            businessDb.run(`
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
                    is_public INTEGER DEFAULT 0,
                    zone_plu TEXT,
                    orientation TEXT,
                    luminosite REAL,
                    surface_maison REAL,
                    nombre_pieces INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table polygons:', err);
                } else {
                    console.log('✅ Table polygons créée (base métier)');
                }
            });

            // Table des utilisateurs
            businessDb.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE,
                    password_hash TEXT NOT NULL,
                    full_name TEXT,
                    phone TEXT,
                    user_type TEXT DEFAULT 'user',
                    device_id TEXT,
                    avatar_url TEXT,
                    is_active INTEGER DEFAULT 1,
                    is_verified INTEGER DEFAULT 0,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table users:', err);
                } else {
                    console.log('✅ Table users créée (base métier)');
                }
            });

            // Table des sessions/auth
            businessDb.run(`
                CREATE TABLE IF NOT EXISTS user_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token TEXT UNIQUE NOT NULL,
                    expires_at DATETIME NOT NULL,
                    device_info TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table user_sessions:', err);
                } else {
                    console.log('✅ Table user_sessions créée (base métier)');
                }
            });

            resolve();
        });
    });
};

// ========== BASE CHAT ==========
const createChatTables = () => {
    return new Promise((resolve, reject) => {
        chatDb.serialize(() => {
            // Table des rooms
            chatDb.run(`
                CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    room_type TEXT DEFAULT 'private',
                    created_by TEXT NOT NULL,
                    participants TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table rooms:', err);
                } else {
                    console.log('✅ Table rooms créée (base chat)');
                }
            });

            // Table des messages
            chatDb.run(`
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
                    console.log('✅ Table messages créée (base chat)');
                }
            });

            // Table des participants de room
            chatDb.run(`
                CREATE TABLE IF NOT EXISTS room_participants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (room_id) REFERENCES rooms(id)
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur création table room_participants:', err);
                } else {
                    console.log('✅ Table room_participants créée (base chat)');
                }
            });

            resolve();
        });
    });
};

// ========== DONNÉES D'EXEMPLE ==========
const insertSampleData = () => {
    return new Promise((resolve, reject) => {
        // Utilisateur système dans base métier
        businessDb.run(`
            INSERT OR IGNORE INTO users (id, username, email, password_hash, user_type, device_id, is_active, is_verified)
            VALUES ('system', 'Système', 'system@parcelle.plus', '', 'system', 'raspberry-pi', 1, 1)
        `, (err) => {
            if (err) {
                console.error('❌ Erreur insertion utilisateur système:', err);
            } else {
                console.log('✅ Utilisateur système créé (base métier)');
            }
        });

        // Room générale dans base chat
        chatDb.serialize(() => {
            chatDb.run(`
                INSERT OR IGNORE INTO rooms (id, name, description, room_type, created_by)
                VALUES ('general', 'Général', 'Salon de discussion principal', 'public', 'system')
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur insertion room par défaut:', err);
                } else {
                    console.log('✅ Room par défaut créée (base chat)');
                }
            });

            // Message de bienvenue
            chatDb.run(`
                INSERT OR IGNORE INTO messages (id, sender_id, sender_name, content, room, message_type)
                VALUES ('welcome', 'system', 'Système', 'Bienvenue sur le chat ParcellePlus ! 🏠', 'general', 'text')
            `, (err) => {
                if (err) {
                    console.error('❌ Erreur insertion message bienvenue:', err);
                } else {
                    console.log('✅ Message de bienvenue créé (base chat)');
                }
            });

            resolve();
        });
    });
};

// ========== VÉRIFICATION ==========
const checkDatabases = () => {
    return new Promise((resolve, reject) => {
        console.log('\n📊 === VÉRIFICATION BASE MÉTIER ===');
        
        businessDb.get("SELECT COUNT(*) as count FROM polygons", (err, row) => {
            if (err) {
                console.error('❌ Erreur vérification polygons:', err);
            } else {
                console.log(`📊 Polygones: ${row.count}`);
            }
        });

        businessDb.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (err) {
                console.error('❌ Erreur vérification users:', err);
            } else {
                console.log(`📊 Utilisateurs: ${row.count}`);
            }
        });

        console.log('\n📊 === VÉRIFICATION BASE CHAT ===');
        
        chatDb.get("SELECT COUNT(*) as count FROM rooms", (err, row) => {
            if (err) {
                console.error('❌ Erreur vérification rooms:', err);
            } else {
                console.log(`📊 Rooms: ${row.count}`);
            }
        });

        chatDb.get("SELECT COUNT(*) as count FROM messages", (err, row) => {
            if (err) {
                console.error('❌ Erreur vérification messages:', err);
            } else {
                console.log(`📊 Messages: ${row.count}`);
                resolve();
            }
        });
    });
};

// ========== EXÉCUTION ==========
(async () => {
    try {
        console.log('\n🔧 Création des tables métier...');
        await createBusinessTables();
        
        console.log('\n💬 Création des tables chat...');
        await createChatTables();
        
        console.log('\n📝 Insertion des données d\'exemple...');
        await insertSampleData();
        
        console.log('\n🔍 Vérification des bases...');
        await checkDatabases();
        
        console.log('\n🎉 ========================================');
        console.log('🎉 DOUBLE BASE DE DONNÉES CRÉÉE AVEC SUCCÈS !');
        console.log('🎉 ========================================');
        console.log('💡 Base métier: parcelle_business.db');
        console.log('💡 Base chat: parcelle_chat.db');
        console.log('💡 ');
        console.log('💡 Redémarrez le serveur pour utiliser les nouvelles bases');
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
    } finally {
        businessDb.close((err) => {
            if (err) {
                console.error('❌ Erreur fermeture base métier:', err);
            } else {
                console.log('✅ Base métier fermée');
            }
        });
        
        chatDb.close((err) => {
            if (err) {
                console.error('❌ Erreur fermeture base chat:', err);
            } else {
                console.log('✅ Base chat fermée');
            }
        });
    }
})();