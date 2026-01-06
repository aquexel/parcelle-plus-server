const path = require('path');

// Charger firebase-admin de manière conditionnelle
let admin = null;
try {
    admin = require('firebase-admin');
} catch (error) {
    // firebase-admin n'est pas installé, on continuera sans
    console.log('⚠️ firebase-admin non disponible - L\'enregistrement des tokens FCM fonctionnera, mais l\'envoi de notifications nécessitera firebase-admin');
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
            console.log('⚠️ firebase-admin non installé - Enregistrement des tokens FCM activé, envoi de notifications désactivé');
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
                console.log('⚠️ Fichier firebase-service-account.json non trouvé. Notifications push désactivées.');
                console.log('📋 Pour activer les notifications push:');
                console.log('   1. Créez un projet Firebase');
                console.log('   2. Téléchargez le fichier de clé de service');
                console.log('   3. Placez-le dans le dossier racine du serveur');
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
            console.log('✅ Firebase Admin SDK initialisé - Notifications push activées');
            
            // Initialiser la table FCM tokens
            this.initializeFCMTable();
            
        } catch (error) {
            console.error('❌ Erreur initialisation Firebase:', error.message);
            console.log('⚠️ Notifications push désactivées');
            
            // Initialiser quand même la table pour permettre l'enregistrement des tokens
            this.initializeFCMTable();
        }
    }

    /**
     * Envoyer une notification push pour un nouveau message
     */
    async sendMessageNotification(targetUserId, senderName, messageContent, roomId, senderId) {
        console.log(`📱 [sendMessageNotification] Début pour utilisateur ${targetUserId}, initialisé: ${this.initialized}`);
        if (!this.initialized) {
            console.log('⚠️ Firebase non initialisé - Notification non envoyée');
            return false;
        }

        let fcmToken = null;
        try {
            // Récupérer le token FCM de l'utilisateur cible
            console.log(`📱 [sendMessageNotification] Récupération token FCM pour ${targetUserId}...`);
            fcmToken = await this.getUserFCMToken(targetUserId);
            if (!fcmToken) {
                console.log(`⚠️ Token FCM non trouvé pour l'utilisateur ${targetUserId}`);
                return false;
            }
            console.log(`📱 [sendMessageNotification] Token FCM récupéré: ${fcmToken.substring(0, 20)}...`);

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
            console.log(`📱 [sendMessageNotification] Envoi notification via Firebase...`);
            const response = await this.admin.messaging().send(message);
            console.log(`✅ [sendMessageNotification] Notification envoyée avec succès: ${response}`);
            return true;

        } catch (error) {
            console.error('❌ Erreur envoi notification:', error.message);
            console.error(`❌ Code erreur: ${error.code}`);
            console.error(`❌ Token utilisé: ${fcmToken || 'non récupéré'}`);
            console.error(`❌ Détails erreur:`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
            if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
                console.log(`⚠️ Token FCM invalide ou expiré pour ${targetUserId} - Suppression du token de la base de données`);
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
     */
    async sendOfferNotification(targetUserId, senderName, offerStatus, messageContent) {
        if (!this.initialized) {
            console.log('⚠️ Firebase non initialisé - Notification non envoyée');
            return false;
        }

        try {
            const fcmToken = await this.getUserFCMToken(targetUserId);
            if (!fcmToken) {
                console.log(`⚠️ Token FCM non trouvé pour l'utilisateur ${targetUserId}`);
                return false;
            }

            const message = {
                token: fcmToken,
                data: {
                    type: 'offer_update',
                    sender_name: senderName,
                    offer_status: offerStatus,
                    message: messageContent
                },
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
            console.log(`✅ Notification proposition envoyée: ${response}`);
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
                console.log('✅ Table fcm_tokens créée/vérifiée');
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
                            console.log(`✅ [deleteUserFCMToken] Token FCM invalide supprimé pour utilisateur ${userId} (${this.changes} ligne(s) supprimée(s))`);
                        } else {
                            console.log(`ℹ️ [deleteUserFCMToken] Token FCM non trouvé pour suppression (utilisateur: ${userId})`);
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
                    console.log(`✅ Token FCM trouvé pour ${userId}`);
                    resolve(row.fcm_token);
                } else {
                    console.log(`⚠️ Aucun token FCM trouvé pour ${userId}`);
                    resolve(null);
                }
            });
        });
    }

    /**
     * Enregistrer le token FCM d'un utilisateur
     */
    async registerUserFCMToken(userId, fcmToken) {
        console.log(`📱 [registerUserFCMToken] Début pour utilisateur: ${userId}`);
        return new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
            
            console.log(`📱 [registerUserFCMToken] Chemin DB: ${dbPath}`);
            
            // Vérifier que le fichier de base de données existe
            const fs = require('fs');
            if (!fs.existsSync(dbPath)) {
                console.error(`❌ [registerUserFCMToken] Base de données non trouvée: ${dbPath}`);
                reject(new Error(`Base de données non trouvée: ${dbPath}`));
                return;
            }
            
            console.log(`📱 [registerUserFCMToken] Base de données trouvée, ouverture...`);
            
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
                if (err) {
                    console.error('❌ [registerUserFCMToken] Erreur ouverture base de données:', err);
                    reject(err);
                    return;
                }
                console.log(`📱 [registerUserFCMToken] Base de données ouverte avec succès`);
                
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
                
                console.log(`📱 [registerUserFCMToken] Création/vérification table fcm_tokens...`);
                
                db.run(createTableQuery, (err) => {
                if (err) {
                    console.error('❌ [registerUserFCMToken] Erreur création/vérification table fcm_tokens:', err);
                    console.error('❌ [registerUserFCMToken] Détails:', err.message);
                    console.error('❌ [registerUserFCMToken] Code:', err.code);
                    db.close();
                    reject(err);
                    return;
                }
                
                console.log(`📱 [registerUserFCMToken] Table fcm_tokens vérifiée/créée`);
                
                // Vérifier si le token existe déjà (récupérer aussi user_id pour comparer)
                const checkQuery = "SELECT id, user_id FROM fcm_tokens WHERE fcm_token = ?";
                
                console.log(`📱 [registerUserFCMToken] Vérification si token existe déjà...`);
                
                db.get(checkQuery, [fcmToken], (err, row) => {
                    if (err) {
                        console.error('❌ [registerUserFCMToken] Erreur vérification token FCM:', err);
                        console.error('❌ [registerUserFCMToken] Détails erreur:', err.message);
                        console.error('❌ [registerUserFCMToken] Code erreur:', err.code);
                        db.close();
                        reject(err);
                        return;
                    }
                    
                    console.log(`📱 [registerUserFCMToken] Token existe déjà: ${row ? 'Oui (ID: ' + row.id + ', User: ' + row.user_id + ')' : 'Non'}`);
                    
                    if (row) {
                        // Token existe déjà, vérifier si l'utilisateur est déjà le même
                        const existingUserId = row.user_id;
                        console.log(`📱 [registerUserFCMToken] Token existant trouvé - ID: ${row.id}, User actuel: ${existingUserId}, Nouveau user: ${userId}`);
                        
                        if (existingUserId === userId) {
                            // L'utilisateur est déjà associé à ce token, juste mettre à jour la date
                            const updateQuery = "UPDATE fcm_tokens SET updated_at = CURRENT_TIMESTAMP WHERE fcm_token = ? AND user_id = ?";
                            
                            console.log(`📱 [registerUserFCMToken] Token déjà associé au bon utilisateur, mise à jour timestamp...`);
                            
                            db.run(updateQuery, [fcmToken, userId], function(err) {
                                if (err) {
                                    console.error('❌ [registerUserFCMToken] Erreur mise à jour timestamp:', err);
                                    console.error('❌ [registerUserFCMToken] Détails erreur:', err.message);
                                    console.error('❌ [registerUserFCMToken] Code erreur:', err.code);
                                    db.close();
                                    reject(err);
                                } else {
                                    console.log(`✅ [registerUserFCMToken] Timestamp mis à jour (changes: ${this.changes})`);
                                    db.close();
                                    resolve(true);
                                }
                            });
                        } else {
                            // Token existe mais pour un autre utilisateur, mettre à jour
                            const updateQuery = "UPDATE fcm_tokens SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE fcm_token = ?";
                            
                            console.log(`📱 [registerUserFCMToken] Token associé à un autre utilisateur, mise à jour...`);
                            
                            db.run(updateQuery, [userId, fcmToken], function(err) {
                                if (err) {
                                    console.error('❌ [registerUserFCMToken] Erreur mise à jour token FCM:', err);
                                    console.error('❌ [registerUserFCMToken] Détails erreur:', err.message);
                                    console.error('❌ [registerUserFCMToken] Code erreur:', err.code);
                                    db.close();
                                    reject(err);
                                } else {
                                    console.log(`✅ [registerUserFCMToken] Token FCM mis à jour pour utilisateur ${userId} (ID existant: ${row.id}, changes: ${this.changes})`);
                                    db.close();
                                    resolve(true);
                                }
                            });
                        }
                    } else {
                        // Nouveau token, l'insérer
                        const insertQuery = "INSERT INTO fcm_tokens (user_id, fcm_token) VALUES (?, ?)";
                        
                        console.log(`📱 [registerUserFCMToken] Insertion nouveau token...`);
                        
                        db.run(insertQuery, [userId, fcmToken], function(err) {
                            if (err) {
                                console.error('❌ [registerUserFCMToken] Erreur insertion token FCM:', err);
                                console.error('❌ [registerUserFCMToken] Détails erreur:', err.message);
                                console.error('❌ [registerUserFCMToken] Code erreur:', err.code);
                                db.close();
                                reject(err);
                            } else {
                                console.log(`✅ [registerUserFCMToken] Token FCM enregistré pour utilisateur ${userId} (Nouveau ID: ${this.lastID}, changes: ${this.changes})`);
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
            console.log(`⚠️ Firebase non initialisé - Notification non envoyée pour utilisateur ${userId}`);
            return false;
        }

        let fcmToken = null;
        try {
            // Récupérer le token FCM de l'utilisateur
            fcmToken = await this.getUserFCMToken(userId);
            if (!fcmToken) {
                console.log(`⚠️ Token FCM non trouvé pour l'utilisateur ${userId} - Notification non envoyée`);
                console.log(`💡 L'utilisateur doit ouvrir l'application pour enregistrer son token FCM`);
                return false;
            }

            console.log(`📱 Tentative d'envoi notification à ${userId} avec token FCM: ${fcmToken.substring(0, 20)}...`);

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
            console.log(`✅ Notification personnalisée envoyée avec succès (messageId: ${response}) pour utilisateur ${userId}`);
            return true;

        } catch (error) {
            console.error(`❌ Erreur envoi notification personnalisée pour ${userId}:`, error.message);
            console.error(`❌ Code erreur: ${error.code}`);
            console.error(`❌ Token utilisé: ${fcmToken || 'non récupéré'}`);
            console.error(`❌ Détails erreur:`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
            if (error.code === 'messaging/invalid-registration-token' || error.code === 'messaging/registration-token-not-registered') {
                console.log(`⚠️ Token FCM invalide ou expiré pour ${userId} - Suppression du token de la base de données`);
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
