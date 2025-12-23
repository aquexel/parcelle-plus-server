const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
const db = new sqlite3.Database(dbPath);

// Récupérer le token depuis les arguments
const token = process.argv[2];

if (!token) {
    console.log('❌ Usage: node debug-email-token.js <token>');
    console.log('   Exemple: node debug-email-token.js abc123...');
    process.exit(1);
}

console.log('🔍 Debug du token de vérification email\n');
console.log(`Token reçu: ${token}`);
console.log(`Longueur: ${token.length} caractères\n`);

// Chercher l'utilisateur avec ce token
db.get(`
    SELECT 
        id, 
        username, 
        email, 
        email_verification_token,
        email_verification_expires,
        is_verified,
        datetime(email_verification_expires/1000, 'unixepoch') as expires_at_formatted
    FROM users 
    WHERE email_verification_token = ?
`, [token], (err, user) => {
    if (err) {
        console.error('❌ Erreur:', err.message);
        db.close();
        process.exit(1);
    }
    
    if (!user) {
        console.log('❌ Aucun utilisateur trouvé avec ce token');
        console.log('\n📋 Recherche de tous les tokens existants:\n');
        
        // Lister tous les utilisateurs avec leurs tokens
        db.all(`
            SELECT 
                username,
                email,
                email_verification_token,
                is_verified,
                datetime(email_verification_expires/1000, 'unixepoch') as expires_at
            FROM users
            WHERE email_verification_token IS NOT NULL
            ORDER BY email
        `, [], (err, users) => {
            if (err) {
                console.error('❌ Erreur:', err.message);
            } else if (users.length === 0) {
                console.log('   Aucun token trouvé dans la base de données');
            } else {
                users.forEach((u, index) => {
                    console.log(`${index + 1}. ${u.email} (${u.username})`);
                    console.log(`   Token: ${u.email_verification_token}`);
                    console.log(`   Vérifié: ${u.is_verified === 1 ? 'Oui' : 'Non'}`);
                    console.log(`   Expire: ${u.expires_at || 'N/A'}`);
                    console.log(`   Token correspond: ${u.email_verification_token === token ? '✅ OUI' : '❌ NON'}`);
                    console.log('');
                });
            }
            db.close();
        });
    } else {
        console.log('✅ Utilisateur trouvé!\n');
        console.log(`Username: ${user.username}`);
        console.log(`Email: ${user.email}`);
        console.log(`Token en base: ${user.email_verification_token}`);
        console.log(`Token correspond: ${user.email_verification_token === token ? '✅ OUI' : '❌ NON'}`);
        console.log(`Déjà vérifié: ${user.is_verified === 1 ? 'Oui' : 'Non'}`);
        console.log(`Expire: ${user.expires_at_formatted}`);
        
        const now = Date.now();
        const expires = user.email_verification_expires;
        const isExpired = expires < now;
        console.log(`Expiré: ${isExpired ? '❌ OUI' : '✅ NON'}`);
        
        if (isExpired) {
            const hoursExpired = ((now - expires) / (1000 * 60 * 60)).toFixed(2);
            console.log(`   Expiré il y a ${hoursExpired} heures`);
        } else {
            const hoursRemaining = ((expires - now) / (1000 * 60 * 60)).toFixed(2);
            console.log(`   Expire dans ${hoursRemaining} heures`);
        }
        
        db.close();
    }
});

