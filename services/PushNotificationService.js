const path = require('path');

// Charger firebase-admin de manière conditionnelle
let admin = null;
try {
    admin = require('firebase-admin');
} catch (error) {
    // firebase-admin n'est pas installé, on continuera sans
}

class PushNotificationService {
    constructor() {
        this.initialized = false;
        this.admin = admin; // Stocker la référence à admin
        this.initializeFirebase();
    }

    initializeFirebase() {
        // Si firebase-admin n'est pas disponible, on ne peut pas initialiser Firebase
        if (!admin) {
            // Initialiser quand même la table pour permettre l'enregistrement des tokens
            this.initializeFCMTable();
            return;
        }

        try {
            // Chemin vers le fichier de clé de service Firebase
            const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');
            
            // Vérifier si le fichier existe
            const fs = require('fs');
            if (!fs.existsSync(serviceAccountPath)) {
                // Initialiser quand même la table pour permettre l'enregistrement des tokens
                this.initializeFCMTable();
                return;
            }

            // Initialiser Firebase Admin SDK
            const serviceAccount = require(serviceAccountPath);
            
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: serviceAccount.project_id
            });

            this.initialized = true;
            
            // Initialiser la table FCM tokens
            this.initializeFCMTable();
            
        } catch (error) {
            console.error('❌ Erreur initialisation Firebase:', error.message);
            
            // Initialiser quand même la table pour permettre l'enregistrement des tokens
            this.initializeFCMTable();
        }
    }

    /**
     * Envoyer une notification push pour un nouveau message
     */
    async sendMessageNotification(targetUserId, senderName, messageContent, roomId, senderId) {
        if (!this.initialized) {
            return false;
        }

        let fcmToken = null;
        try {
            // Récupérer le token FCM de l'utilisateur cible
            fcmToken = await this.getUserFCMToken(targetUserId);
            if (!fcmToken) {
                return false;
            }

            const message = {
                token: fcmToken,
                data: {
                    type: 'new_message',
                    sender_name: senderName,
                    message: messageContent,
                    room_id: roomId,
                    sender_id: senderId
                },
                notification: {
                    title: `💬 ${senderName}`,
                    body: messageContent
                },
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channelId: 'parcelle_plus_messages'
                    }
                }
            };

            if (!this.admin) {
                throw new Error('firebase-admin non disponible');
            }
            const response = await this.admin.messaging().send(message);
            return true;

        } catch (error) {
            console.error('❌ Erreur envoi notification:', error.message);
            console.error(`❌ Code erreur: ${error.code}`);
            console.error(`❌ Token utilisé: ${fcmToken || 'non récupéré'}`);
            console.error(`❌ Détails erreur:`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
            if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
                // Supprimer le token invalide de la base de données
                if (fcmToken) {
                    try {
                        await this.deleteUserFCMToken(targetUserId, fcmToken);
                    } catch (deleteError) {
                        console.error(`❌ Erreur lors de la suppression du token invalide:`, deleteError.message);
                    }
                }
            }
            return false;
        }
    }

    /**
     * Envoyer une notification pour une mise à jour de proposition
     * @param {Record<string, string>} [extraData] — champs FCM (ex. room_id) pour ouvrir le bon chat côté app
     */
    async sendOfferNotification(targetUserId, senderName, offerStatus, messageContent, extraData = {}) {
        if (!this.initialized) {
            return false;
        }

        try {
            const fcmToken = await this.getUserFCMToken(targetUserId);
            if (!fcmToken) {
                return false;
            }

            const dataPayload = { type: 'offer_update', sender_name: String(senderName || ''), offer_status: String(offerStatus || ''), message: String(messageContent || '') };
            for (const [k, v] of Object.entries(extraData || {})) {
                if (v != null && v !== '') dataPayload[k] = String(v);
            }

            const message = {
                token: fcmToken,
                data: dataPayload,
                notification: {
                    title: `💰 Proposition de ${senderName}`,
                    body: messageContent
                },
                android: {
                    priority: 'high'
                }
            };

            if (!this.admin) {
                throw new Error('firebase-admin non disponible');
            }
            const response = await this.admin.messaging().send(message);
            return true;

        } catch (error) {
            console.error('❌ Erreur envoi notification proposition:', error.message);
            return false;
        }
    }

    /**
     * Initialiser la table FCM tokens
     */
    initializeFCMTable() {
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
        const db = new sqlite3.Database(dbPath);
        
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
                console.error('❌ Erreur création table fcm_tokens:', err);
            } else {
            }
        });
        
        db.close();
    }

    /**
     * Supprimer un token FCM invalide de la base de données
     */
    async deleteUserFCMToken(userId, fcmToken) {
        return new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
            const fs = require('fs');
            
            if (!fs.existsSync(dbPath)) {
                console.error(`❌ [deleteUserFCMToken] Base de données non trouvée: ${dbPath}`);
                reject(new Error(`Base de données non trouvée: ${dbPath}`));
                return;
            }
            
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
                if (err) {
                    console.error('❌ [deleteUserFCMToken] Erreur ouverture base de données:', err);
                    reject(err);
                    return;
                }
                
                const deleteQuery = "DELETE FROM fcm_tokens WHERE user_id = ? AND fcm_token = ?";
                db.run(deleteQuery, [userId, fcmToken], function(err) {
                    if (err) {
                        console.error('❌ [deleteUserFCMToken] Erreur suppression token:', err);
                        db.close();
                        reject(err);
                    } else {
                        if (this.changes > 0) {
                        } else {
                        }
                        db.close();
                        resolve(this.changes > 0);
                    }
                });
            });
        });
    }

    /**
     * Récupérer le token FCM d'un utilisateur
     */
    async getUserFCMToken(userId) {
        return new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
            const db = new sqlite3.Database(dbPath);
            
            const query = "SELECT fcm_token FROM fcm_tokens WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1";
            
            db.get(query, [userId], (err, row) => {
                db.close();
                
                if (err) {
                    console.error('❌ Erreur récupération token FCM:', err);
                    reject(err);
                } else if (row) {
                    resolve(row.fcm_token);
                } else {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Enregistrer le token FCM d'un utilisateur
     */
    async registerUserFCMToken(userId, fcmToken) {
        return new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
            
            // Vérifier que le fichier de base de données existe
            const fs = require('fs');
            if (!fs.existsSync(dbPath)) {
                console.error(`❌ Base de données non trouvée: ${dbPath}`);
                reject(new Error(`Base de données non trouvée: ${dbPath}`));
                return;
            }
            
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
                if (err) {
                    console.error('❌ Erreur ouverture base de données FCM:', err.message);
                    reject(err);
                    return;
                }
                
                // S'assurer que la table existe
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
                    console.error('❌ Erreur création table fcm_tokens:', err.message);
                    db.close();
                    reject(err);
                    return;
                }
                
                // Vérifier si le token existe déjà (récupérer aussi user_id pour comparer)
                const checkQuery = "SELECT id, user_id FROM fcm_tokens WHERE fcm_token = ?";
                
                db.get(checkQuery, [fcmToken], (err, row) => {
                    if (err) {
                        console.error('❌ Erreur vérification token FCM:', err.message);
                        db.close();
                        reject(err);
                        return;
                    }
                    
                    if (row) {
                        // Token existe déjà, vérifier si l'utilisateur est déjà le même
                        const existingUserId = row.user_id;
                        
                        if (existingUserId === userId) {
                            // L'utilisateur est déjà associé à ce token, juste mettre à jour la date
                            const updateQuery = "UPDATE fcm_tokens SET updated_at = CURRENT_TIMESTAMP WHERE fcm_token = ? AND user_id = ?";
                            
                            db.run(updateQuery, [fcmToken, userId], function(err) {
                                if (err) {
                                    console.error('❌ Erreur mise à jour timestamp FCM:', err.message);
                                    db.close();
                                    reject(err);
                                } else {
                                    db.close();
                                    resolve(true);
                                }
                            });
                        } else {
                            // Token existe mais pour un autre utilisateur, mettre à jour
                            const updateQuery = "UPDATE fcm_tokens SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE fcm_token = ?";
                            
                            db.run(updateQuery, [userId, fcmToken], function(err) {
                                if (err) {
                                    console.error('❌ Erreur mise à jour token FCM:', err.message);
                                    db.close();
                                    reject(err);
                                } else {
                                    db.close();
                                    resolve(true);
                                }
                            });
                        }
                    } else {
                        // Nouveau token, l'insérer
                        const insertQuery = "INSERT INTO fcm_tokens (user_id, fcm_token) VALUES (?, ?)";
                        
                        db.run(insertQuery, [userId, fcmToken], function(err) {
                            if (err) {
                                console.error('❌ Erreur insertion token FCM:', err.message);
                                db.close();
                                reject(err);
                            } else {
                                db.close();
                                resolve(true);
                            }
                        });
                    }
                });
                }); // Fermeture du callback de db.run(createTableQuery)
            }); // Fermeture du callback de sqlite3.Database
        });
    }

    /**
     * Envoyer une notification personnalisée
     */
    async sendCustomNotification(userId, title, body, data = {}) {
        if (!this.initialized) {
            return false;
        }

        let fcmToken = null;
        try {
            // Récupérer le token FCM de l'utilisateur
            fcmToken = await this.getUserFCMToken(userId);
            if (!fcmToken) {
                return false;
            }


            const message = {
                token: fcmToken,
                notification: {
                    title: title,
                    body: body
                },
                data: {
                    ...data,
                    timestamp: new Date().toISOString()
                },
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        priority: 'high',
                        channelId: 'parcelle_plus_alerts'
                    }
                }
            };

            if (!this.admin) {
                throw new Error('firebase-admin non disponible');
            }
            const response = await this.admin.messaging().send(message);
            return true;

        } catch (error) {
            console.error(`❌ Erreur envoi notification personnalisée pour ${userId}:`, error.message);
            console.error(`❌ Code erreur: ${error.code}`);
            console.error(`❌ Token utilisé: ${fcmToken || 'non récupéré'}`);
            console.error(`❌ Détails erreur:`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
            if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
                // Supprimer le token invalide de la base de données
                if (fcmToken) {
                    try {
                        await this.deleteUserFCMToken(userId, fcmToken);
                    } catch (deleteError) {
                        console.error(`❌ Erreur lors de la suppression du token invalide:`, deleteError.message);
                    }
                }
            }
            return false;
        }
    }

    /**
     * Vérifier si le service est initialisé
     */
    isInitialized() {
        return this.initialized;
    }
}

module.exports = PushNotificationService;
