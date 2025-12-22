const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

class UserService {
    constructor() {
        const dbDir = path.join(__dirname, '..', 'database');
        this.dbPath = path.join(dbDir, 'parcelle_chat.db');
        this.db = new Database(this.dbPath);
        
        // Créer les tables si elles n'existent pas
        this.initializeDatabase();
    }
    
    initializeDatabase() {
        // Table des utilisateurs
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT,
                phone TEXT,
                user_type TEXT DEFAULT 'buyer',
                device_id TEXT,
                is_active INTEGER DEFAULT 1,
                is_verified INTEGER DEFAULT 0,
                email_verification_token TEXT,
                email_verification_expires INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Table des sessions
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        // Index pour améliorer les performances
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        `);
    }
    
    async registerUser(userData) {
        const { username, email, password, fullName, phone, userType } = userData;
        
        // Vérifier si l'utilisateur existe déjà
        const existingUser = this.db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existingUser) {
            throw new Error('Un utilisateur avec ce nom d\'utilisateur ou cet email existe déjà');
        }
        
        // Hasher le mot de passe
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Générer un token de vérification d'email
        const emailVerificationToken = crypto.randomBytes(32).toString('hex');
        const emailVerificationExpires = Date.now() + (24 * 60 * 60 * 1000); // 24 heures
        
        // Créer l'utilisateur
        const userId = uuidv4();
        const insertUser = this.db.prepare(`
            INSERT INTO users (id, username, email, password_hash, full_name, phone, user_type, is_verified, email_verification_token, email_verification_expires)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `);
        
        insertUser.run(
            userId,
            username,
            email,
            passwordHash,
            fullName || null,
            phone || null,
            userType || 'buyer',
            emailVerificationToken,
            emailVerificationExpires
        );
        
        // Retourner les données de l'utilisateur (sans le mot de passe)
        const user = this.db.prepare('SELECT id, username, email, full_name, phone, user_type, is_verified FROM users WHERE id = ?').get(userId);
        
        return {
            ...user,
            emailVerificationToken // Retourner le token pour l'envoyer par email
        };
    }
    
    async verifyEmail(token) {
        const user = this.db.prepare(`
            SELECT id, email_verification_expires, is_verified 
            FROM users 
            WHERE email_verification_token = ?
        `).get(token);
        
        if (!user) {
            throw new Error('Token de vérification invalide');
        }
        
        if (user.is_verified === 1) {
            throw new Error('Email déjà vérifié');
        }
        
        if (user.email_verification_expires < Date.now()) {
            throw new Error('Token de vérification expiré');
        }
        
        // Marquer l'email comme vérifié
        this.db.prepare(`
            UPDATE users 
            SET is_verified = 1, 
                email_verification_token = NULL, 
                email_verification_expires = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(user.id);
        
        return this.db.prepare('SELECT id, username, email, full_name, phone, user_type, is_verified FROM users WHERE id = ?').get(user.id);
    }
    
    async resendVerificationEmail(email) {
        const user = this.db.prepare('SELECT id, username, email, is_verified FROM users WHERE email = ?').get(email);
        
        if (!user) {
            throw new Error('Aucun utilisateur trouvé avec cet email');
        }
        
        if (user.is_verified === 1) {
            throw new Error('Email déjà vérifié');
        }
        
        // Générer un nouveau token
        const emailVerificationToken = crypto.randomBytes(32).toString('hex');
        const emailVerificationExpires = Date.now() + (24 * 60 * 60 * 1000); // 24 heures
        
        this.db.prepare(`
            UPDATE users 
            SET email_verification_token = ?, 
                email_verification_expires = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(emailVerificationToken, emailVerificationExpires, user.id);
        
        return {
            emailVerificationToken,
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        };
    }
    
    async loginUser(username, password) {
        const user = this.db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
        
        if (!user) {
            throw new Error('Nom d\'utilisateur ou mot de passe incorrect');
        }
        
        // Vérifier le mot de passe
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            throw new Error('Nom d\'utilisateur ou mot de passe incorrect');
        }
        
        // Vérifier si le compte est actif
        if (user.is_active === 0) {
            throw new Error('Compte désactivé');
        }
        
        // Vérifier si l'email est vérifié (optionnel - vous pouvez rendre cela obligatoire)
        // if (user.is_verified === 0) {
        //     throw new Error('Veuillez vérifier votre email avant de vous connecter');
        // }
        
        // Créer une session
        const sessionId = uuidv4();
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 jours
        
        this.db.prepare(`
            INSERT INTO user_sessions (id, user_id, token, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(sessionId, user.id, token, expiresAt);
        
        // Retourner les données de l'utilisateur avec le token
        return {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.full_name,
                phone: user.phone,
                userType: user.user_type,
                isVerified: user.is_verified === 1,
                token: token,
                expiresAt: expiresAt
            }
        };
    }
    
    async logoutUser(token) {
        const result = this.db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
        return result.changes > 0;
    }
    
    async validateSession(token) {
        const session = this.db.prepare(`
            SELECT s.*, u.id, u.username, u.email, u.full_name, u.phone, u.user_type, u.is_verified
            FROM user_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ? AND s.expires_at > ?
        `).get(token, Date.now());
        
        if (!session) {
            return null;
        }
        
        return {
            user: {
                id: session.id,
                username: session.username,
                email: session.email,
                fullName: session.full_name,
                phone: session.phone,
                userType: session.user_type,
                isVerified: session.is_verified === 1
            }
        };
    }
    
    async getUserById(userId) {
        const user = this.db.prepare('SELECT id, username, email, full_name, phone, user_type, is_verified FROM users WHERE id = ?').get(userId);
        return user;
    }
    
    async updateUserProfile(userId, updateData) {
        const fields = [];
        const values = [];
        
        if (updateData.fullName !== undefined) {
            fields.push('full_name = ?');
            values.push(updateData.fullName);
        }
        if (updateData.phone !== undefined) {
            fields.push('phone = ?');
            values.push(updateData.phone);
        }
        if (updateData.userType !== undefined) {
            fields.push('user_type = ?');
            values.push(updateData.userType);
        }
        
        if (fields.length === 0) {
            return false;
        }
        
        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(userId);
        
        const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
        const result = this.db.prepare(sql).run(...values);
        
        return result.changes > 0;
    }
    
    async updateUserEmail(userId, newEmail, password) {
        const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        
        if (!user) {
            throw new Error('Utilisateur non trouvé');
        }
        
        // Vérifier le mot de passe
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            throw new Error('Mot de passe incorrect');
        }
        
        // Vérifier si l'email existe déjà
        const existingUser = this.db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, userId);
        if (existingUser) {
            throw new Error('Cet email est déjà utilisé');
        }
        
        // Générer un nouveau token de vérification
        const emailVerificationToken = crypto.randomBytes(32).toString('hex');
        const emailVerificationExpires = Date.now() + (24 * 60 * 60 * 1000);
        
        // Mettre à jour l'email et réinitialiser la vérification
        this.db.prepare(`
            UPDATE users 
            SET email = ?, 
                is_verified = 0,
                email_verification_token = ?,
                email_verification_expires = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(newEmail, emailVerificationToken, emailVerificationExpires, userId);
        
        return {
            emailVerificationToken,
            user: this.getUserById(userId)
        };
    }
    
    async searchUsers(query, userType, limit = 50) {
        let sql = 'SELECT id, username, email, full_name, phone, user_type FROM users WHERE 1=1';
        const params = [];
        
        if (query) {
            sql += ' AND (username LIKE ? OR email LIKE ? OR full_name LIKE ?)';
            const searchTerm = `%${query}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        
        if (userType) {
            sql += ' AND user_type = ?';
            params.push(userType);
        }
        
        sql += ' LIMIT ?';
        params.push(limit);
        
        return this.db.prepare(sql).all(...params);
    }
    
    async getAllUsers(limit = 100) {
        return this.db.prepare('SELECT id, username, email, full_name, phone, user_type, is_verified FROM users LIMIT ?').all(limit);
    }
    
    async cleanExpiredSessions() {
        const result = this.db.prepare('DELETE FROM user_sessions WHERE expires_at < ?').run(Date.now());
        return result.changes;
    }
    
    async requestPasswordReset(email) {
        const user = this.db.prepare('SELECT id, username, email FROM users WHERE email = ?').get(email);
        
        if (!user) {
            // Ne pas révéler si l'email existe ou non pour des raisons de sécurité
            return {
                success: true,
                message: 'Si cet email existe, un lien de réinitialisation a été envoyé.'
            };
        }
        
        // Générer un token de réinitialisation
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = Date.now() + (60 * 60 * 1000); // 1 heure
        
        // Ajouter les colonnes si elles n'existent pas
        try {
            this.db.exec(`
                ALTER TABLE users ADD COLUMN password_reset_token TEXT;
                ALTER TABLE users ADD COLUMN password_reset_expires INTEGER;
            `);
        } catch (e) {
            // Les colonnes existent déjà, ignorer l'erreur
        }
        
        // Sauvegarder le token
        this.db.prepare(`
            UPDATE users 
            SET password_reset_token = ?, 
                password_reset_expires = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(resetToken, resetExpires, user.id);
        
        return {
            success: true,
            resetToken,
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        };
    }
    
    async resetPassword(token, newPassword) {
        const user = this.db.prepare(`
            SELECT id, password_reset_expires 
            FROM users 
            WHERE password_reset_token = ?
        `).get(token);
        
        if (!user) {
            throw new Error('Token de réinitialisation invalide');
        }
        
        if (user.password_reset_expires < Date.now()) {
            throw new Error('Token de réinitialisation expiré');
        }
        
        // Hasher le nouveau mot de passe
        const passwordHash = await bcrypt.hash(newPassword, 10);
        
        // Mettre à jour le mot de passe et supprimer le token
        this.db.prepare(`
            UPDATE users 
            SET password_hash = ?,
                password_reset_token = NULL,
                password_reset_expires = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(passwordHash, user.id);
        
        return this.db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(user.id);
    }
    
    async deleteUser(userId) {
        const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
        return result.changes > 0;
    }
    
    close() {
        this.db.close();
    }
}

module.exports = UserService;

