const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
const db = new Database(dbPath);

// Récupérer l'email depuis les arguments
const email = process.argv[2];

if (!email) {
    console.log('❌ Usage: node generate-verification-token.js <email>');
    console.log('   Exemple: node generate-verification-token.js user@example.com');
    process.exit(1);
}

try {
    // Trouver l'utilisateur
    const stmt = db.prepare('SELECT id, username, email, is_verified FROM users WHERE email = ?');
    const user = stmt.get(email);
    
    if (!user) {
        console.log(`❌ Aucun utilisateur trouvé avec l'email: ${email}`);
        db.close();
        process.exit(1);
    }
    
    console.log(`✅ Utilisateur trouvé: ${user.username} (${user.email})`);
    console.log(`   Actuellement vérifié: ${user.is_verified === 1 ? 'Oui' : 'Non'}\n`);
    
    // Générer un nouveau token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 heures
    
    // Mettre à jour l'utilisateur avec le nouveau token
    const updateStmt = db.prepare(`
        UPDATE users 
        SET email_verification_token = ?,
            email_verification_expires = ?,
            is_verified = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE email = ?
    `);
    
    updateStmt.run(token, expiresAt, email);
    
    console.log('✅ Nouveau token généré et enregistré!\n');
    console.log(`Token: ${token}`);
    console.log(`\nURL de vérification:`);
    console.log(`http://149.202.33.164:3000/api/auth/verify-email?token=${token}`);
    
} catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
} finally {
    db.close();
}

