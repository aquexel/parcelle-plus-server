const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
const db = new Database(dbPath);

console.log('📊 Liste des utilisateurs et leurs tokens:\n');

try {
    const users = db.prepare('SELECT id, username, email, email_verification_token, is_verified, datetime(email_verification_expires/1000, \'unixepoch\') as expires_at FROM users ORDER BY email').all();
    
    if (users.length === 0) {
        console.log('⚠️ Aucun utilisateur trouvé dans la base de données');
    } else {
        console.log(`✅ ${users.length} utilisateur(s) trouvé(s):\n`);
        users.forEach((user, index) => {
            console.log(`${index + 1}. ${user.email} (${user.username})`);
            console.log(`   ID: ${user.id}`);
            console.log(`   Vérifié: ${user.is_verified === 1 ? 'Oui' : 'Non'}`);
            console.log(`   Token: ${user.email_verification_token || '❌ AUCUN TOKEN'}`);
            console.log(`   Expire: ${user.expires_at || 'N/A'}`);
            console.log('');
        });
    }
} catch (error) {
    console.error('❌ Erreur:', error.message);
} finally {
    db.close();
}

