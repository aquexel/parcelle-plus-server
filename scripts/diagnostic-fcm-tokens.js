const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');

console.log('🔍 Diagnostic table fcm_tokens');
console.log(`📁 Chemin base de données: ${dbPath}`);
console.log(`📦 Base existe: ${fs.existsSync(dbPath) ? '✅ Oui' : '❌ Non'}`);

if (!fs.existsSync(dbPath)) {
    console.error('❌ Base de données non trouvée!');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Erreur ouverture base:', err);
        process.exit(1);
    }
    console.log('✅ Base de données ouverte');
});

// Vérifier si la table existe
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='fcm_tokens'", (err, row) => {
    if (err) {
        console.error('❌ Erreur vérification table:', err);
        db.close();
        return;
    }
    
    if (!row) {
        console.log('⚠️ Table fcm_tokens n\'existe pas - Création...');
        
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS fcm_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                fcm_token TEXT NOT NULL UNIQUE,
                device_info TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, fcm_token)
            )
        `;
        
        db.run(createTableQuery, (err) => {
            if (err) {
                console.error('❌ Erreur création table:', err);
                db.close();
                return;
            }
            console.log('✅ Table fcm_tokens créée');
            db.close();
        });
    } else {
        console.log('✅ Table fcm_tokens existe');
        
        // Compter les tokens
        db.get("SELECT COUNT(*) as count FROM fcm_tokens", (err, row) => {
            if (err) {
                console.error('❌ Erreur comptage:', err);
                db.close();
                return;
            }
            console.log(`📊 Nombre de tokens enregistrés: ${row.count}`);
            
            // Afficher quelques tokens
            db.all("SELECT user_id, fcm_token, created_at, updated_at FROM fcm_tokens LIMIT 5", (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération tokens:', err);
                } else {
                    console.log('\n📋 Tokens (premiers 5):');
                    rows.forEach((row, i) => {
                        console.log(`  ${i + 1}. User: ${row.user_id}`);
                        console.log(`     Token: ${row.fcm_token.substring(0, 30)}...`);
                        console.log(`     Créé: ${row.created_at}`);
                        console.log(`     Mis à jour: ${row.updated_at}`);
                    });
                }
                db.close();
            });
        });
    }
});
