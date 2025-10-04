const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const path = require('path');

class UserService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', 'parcelle_business.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.initializeDatabase();
    }

    initializeDatabase() {
        const createUsersTable = `
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
        `;

        // Table pour les sessions utilisateur
        const createSessionsTable = `
            CREATE TABLE IF NOT EXISTS user_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                device_info TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `;

        this.db.run(createUsersTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table users:', err);
            } else {
                console.log('✅ Table users initialisée');
            }
        });

        this.db.run(createSessionsTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table sessions:', err);
            } else {
                console.log('✅ Table sessions initialisée');
            }
        });
    }

    // ========== AUTHENTIFICATION ==========

    async registerUser(userData) {
        return new Promise(async (resolve, reject) => {
            try {
                // Validation des données
                if (!userData.username || userData.username.length < 3) {
                    return reject(new Error('Nom d\'utilisateur requis (min 3 caractères)'));
                }
                
                if (!userData.password || userData.password.length < 6) {
                    return reject(new Error('Mot de passe requis (min 6 caractères)'));
                }

                if (!userData.email || !this.isValidEmail(userData.email)) {
                    return reject(new Error('Email valide requis'));
                }

                // Vérifier si l'utilisateur existe déjà
                const existingUser = await this.getUserByUsername(userData.username);
                if (existingUser) {
                    return reject(new Error('Nom d\'utilisateur déjà utilisé'));
                }

                const existingEmail = await this.getUserByEmail(userData.email);
                if (existingEmail) {
                    return reject(new Error('Email déjà utilisé'));
                }

                // Hasher le mot de passe
                const passwordHash = await bcrypt.hash(userData.password, 10);
                
                const id = uuidv4();
                const now = new Date().toISOString();
                
                const query = `
                    INSERT INTO users (
                        id, username, email, password_hash, full_name, phone, 
                        user_type, device_id, is_active, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const params = [
                    id,
                    userData.username,
                    userData.email,
                    passwordHash,
                    userData.fullName || '',
                    userData.phone || '',
                    userData.userType || 'user',
                    userData.deviceId || '',
                    1,
                    now,
                    now
                ];

                this.db.run(query, params, function(err) {
                    if (err) {
                        console.error('❌ Erreur création utilisateur:', err);
                        reject(err);
                    } else {
                        const newUser = {
                            id,
                            username: userData.username,
                            email: userData.email,
                            fullName: userData.fullName || '',
                            phone: userData.phone || '',
                            userType: userData.userType || 'buyer',
                            isActive: true,
                            createdAt: now,
                            updatedAt: now
                        };
                        
                        console.log(`✅ Utilisateur inscrit: ${id} (${userData.username})`);
                        resolve(newUser);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async loginUser(username, password) {
        return new Promise(async (resolve, reject) => {
            try {
                // Récupérer l'utilisateur
                const user = await this.getUserByUsernameWithPassword(username);
                if (!user) {
                    return reject(new Error('Nom d\'utilisateur ou mot de passe incorrect'));
                }

                // Vérifier le mot de passe
                const passwordValid = await bcrypt.compare(password, user.password_hash);
                if (!passwordValid) {
                    return reject(new Error('Nom d\'utilisateur ou mot de passe incorrect'));
                }

                if (!user.is_active) {
                    return reject(new Error('Compte désactivé'));
                }

                // Mettre à jour last_seen
                await this.updateLastSeen(user.id);

                // Créer une session
                const session = await this.createSession(user.id);

                const userResponse = {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    fullName: user.full_name,
                    phone: user.phone,
                    userType: user.user_type,
                    avatarUrl: user.avatar_url,
                    isVerified: user.is_verified === 1,
                    token: session.token,
                    expiresAt: session.expires_at
                };

                console.log(`✅ Utilisateur connecté: ${user.id} (${user.username})`);
                resolve(userResponse);

            } catch (error) {
                reject(error);
            }
        });
    }

    async createSession(userId, deviceInfo = '') {
        return new Promise((resolve, reject) => {
            const sessionId = uuidv4();
            const token = uuidv4() + '_' + Date.now();
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours
            const now = new Date().toISOString();

            const query = `
                INSERT INTO user_sessions (id, user_id, token, expires_at, device_info, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `;

            this.db.run(query, [sessionId, userId, token, expiresAt.toISOString(), deviceInfo, now], function(err) {
                if (err) {
                    console.error('❌ Erreur création session:', err);
                    reject(err);
                } else {
                    resolve({
                        id: sessionId,
                        token: token,
                        expires_at: expiresAt.toISOString()
                    });
                }
            });
        });
    }

    async validateSession(token) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT s.*, u.id as user_id, u.username, u.email, u.full_name, 
                       u.user_type, u.is_active
                FROM user_sessions s
                JOIN users u ON s.user_id = u.id
                WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
            `;

            this.db.get(query, [token], (err, row) => {
                if (err) {
                    console.error('❌ Erreur validation session:', err);
                    reject(err);
                } else if (row) {
                    resolve({
                        sessionId: row.id,
                        user: {
                            id: row.user_id,
                            username: row.username,
                            email: row.email,
                            fullName: row.full_name,
                            userType: row.user_type
                        }
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }

    async logoutUser(token) {
        return new Promise((resolve, reject) => {
            const query = `DELETE FROM user_sessions WHERE token = ?`;
            
            this.db.run(query, [token], function(err) {
                if (err) {
                    console.error('❌ Erreur déconnexion:', err);
                    reject(err);
                } else {
                    console.log(`✅ Session supprimée: ${token.substring(0, 8)}...`);
                    resolve(this.changes > 0);
                }
            });
        });
    }

    // ========== GESTION UTILISATEURS ==========

    async getUserByUsernameWithPassword(username) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM users WHERE username = ? OR email = ?
            `;

            this.db.get(query, [username, username], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération utilisateur:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getUserByEmail(email) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT id, username, email, full_name, user_type, created_at
                FROM users WHERE email = ?
            `;

            this.db.get(query, [email], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération utilisateur par email:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getUserById(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, username, email, full_name, phone, user_type, 
                    avatar_url, is_verified, last_seen, created_at, updated_at
                FROM users 
                WHERE id = ? AND is_active = 1
            `;

            this.db.get(query, [id], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération utilisateur:', err);
                    reject(err);
                } else if (row) {
                    console.log(`✅ Utilisateur récupéré: ${id}`);
                    resolve(row);
                } else {
                    console.log(`⚠️ Utilisateur non trouvé: ${id}`);
                    resolve(null);
                }
            });
        });
    }

    async getUserByUsername(username) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, username, email, full_name, phone, user_type, 
                    avatar_url, is_verified, last_seen, created_at, updated_at
                FROM users 
                WHERE username = ? AND is_active = 1
            `;

            this.db.get(query, [username], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération utilisateur par nom:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async updateUserProfile(userId, profileData) {
        return new Promise((resolve, reject) => {
            const updates = [];
            const params = [];

            if (profileData.fullName !== undefined) {
                updates.push('full_name = ?');
                params.push(profileData.fullName);
            }
            if (profileData.phone !== undefined) {
                updates.push('phone = ?');
                params.push(profileData.phone);
            }
            if (profileData.avatarUrl !== undefined) {
                updates.push('avatar_url = ?');
                params.push(profileData.avatarUrl);
            }

            if (updates.length === 0) {
                return resolve(false);
            }

            updates.push('updated_at = ?');
            params.push(new Date().toISOString());
            params.push(userId);

            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;

            this.db.run(query, params, function(err) {
                if (err) {
                    console.error('❌ Erreur mise à jour profil:', err);
                    reject(err);
                } else {
                    console.log(`✅ Profil mis à jour: ${userId}`);
                    resolve(this.changes > 0);
                }
            });
        });
    }

    async searchUsers(searchTerm, userType = null, limit = 20) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT id, username, full_name, user_type, avatar_url, last_seen
                FROM users 
                WHERE is_active = 1 AND (username LIKE ? OR full_name LIKE ?)
            `;
            let params = [`%${searchTerm}%`, `%${searchTerm}%`];

            if (userType) {
                query += ` AND user_type = ?`;
                params.push(userType);
            }

            query += ` ORDER BY last_seen DESC LIMIT ?`;
            params.push(limit);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Erreur recherche utilisateurs:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async updateLastSeen(id) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            const query = `
                UPDATE users 
                SET last_seen = ?, updated_at = ? 
                WHERE id = ?
            `;

            this.db.run(query, [now, now, id], function(err) {
                if (err) {
                    console.error('❌ Erreur mise à jour last_seen:', err);
                    reject(err);
                } else {
                    resolve(this.changes > 0);
                }
            });
        });
    }

    async getAllUsers(limit = 100) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, username, email, full_name, user_type, last_seen, created_at
                FROM users 
                WHERE is_active = 1
                ORDER BY created_at DESC 
                LIMIT ?
            `;

            this.db.all(query, [limit], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération utilisateurs:', err);
                    reject(err);
                } else {
                    console.log(`✅ ${rows.length} utilisateurs récupérés`);
                    resolve(rows);
                }
            });
        });
    }

    // ========== UTILITAIRES ==========

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // ========== NETTOYAGE ==========

    async cleanExpiredSessions() {
        return new Promise((resolve, reject) => {
            const query = `DELETE FROM user_sessions WHERE expires_at < datetime('now')`;
            
            this.db.run(query, function(err) {
                if (err) {
                    console.error('❌ Erreur nettoyage sessions:', err);
                    reject(err);
                } else {
                    console.log(`✅ ${this.changes} sessions expirées supprimées`);
                    resolve(this.changes);
                }
            });
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('❌ Erreur fermeture base de données:', err);
            } else {
                console.log('✅ Base de données fermée');
            }
        });
    }
}

module.exports = UserService; 