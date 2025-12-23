const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
const db = new Database(dbPath);

console.log('📊 Liste des utilisateurs dans la base de données:\n');

try {
    const users = db.prepare('SELECT id, username, email, is_active, is_verified, user_type FROM users').all();
    
    if (users.length === 0) {
        console.log('⚠️ Aucun utilisateur trouvé dans la base de données');
        console.log('\n💡 Pour créer un utilisateur, utilisez le script create-user.js');
    } else {
        console.log(`✅ ${users.length} utilisateur(s) trouvé(s):\n`);
        users.forEach((user, index) => {
            console.log(`${index + 1}. Username: ${user.username}`);
            console.log(`   Email: ${user.email}`);
            console.log(`   Type: ${user.user_type}`);
            console.log(`   Actif: ${user.is_active === 1 ? 'Oui' : 'Non'}`);
            console.log(`   Vérifié: ${user.is_verified === 1 ? 'Oui' : 'Non'}`);
            console.log(`   ID: ${user.id}`);
            console.log('');
        });
    }
} catch (error) {
    console.error('❌ Erreur:', error.message);
}

db.close();

