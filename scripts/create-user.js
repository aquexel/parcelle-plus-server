const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
const db = new Database(dbPath);

// Récupérer les arguments de la ligne de commande
const args = process.argv.slice(2);
const username = args[0];
const email = args[1];
const password = args[2];
const userType = args[3] || 'buyer';

if (!username || !email || !password) {
    console.log('❌ Usage: node create-user.js <username> <email> <password> [userType]');
    console.log('   Exemple: node create-user.js admin admin@example.com password123 seller');
    process.exit(1);
}

async function createUser() {
    try {
        // Vérifier si l'utilisateur existe déjà
        const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existingUser) {
            console.log('❌ Un utilisateur avec ce nom d\'utilisateur ou cet email existe déjà');
            process.exit(1);
        }
        
        // Hasher le mot de passe
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Générer un token de vérification d'email
        const emailVerificationToken = crypto.randomBytes(32).toString('hex');
        const emailVerificationExpires = Date.now() + (24 * 60 * 60 * 1000); // 24 heures
        
        // Créer l'utilisateur
        const userId = uuidv4();
        const insertUser = db.prepare(`
            INSERT INTO users (id, username, email, password_hash, full_name, phone, user_type, is_active, is_verified, email_verification_token, email_verification_expires)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
        `);
        
        insertUser.run(
            userId,
            username,
            email,
            passwordHash,
            null, // full_name
            null, // phone
            userType,
            emailVerificationToken,
            emailVerificationExpires
        );
        
        console.log('✅ Utilisateur créé avec succès!');
        console.log(`   Username: ${username}`);
        console.log(`   Email: ${email}`);
        console.log(`   Type: ${userType}`);
        console.log(`   ID: ${userId}`);
        console.log(`   Email vérifié: Oui (créé directement)`);
        
    } catch (error) {
        console.error('❌ Erreur lors de la création de l\'utilisateur:', error.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

createUser();

