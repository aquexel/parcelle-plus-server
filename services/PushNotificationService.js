const admin = require('firebase-admin');
const path = require('path');

class PushNotificationService {
    constructor() {
        this.initialized = false;
        this.initializeFirebase();
    }

    initializeFirebase() {
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
            
            // Initialiser quand même la table pour les tests
            this.initializeFCMTable();
        }
    }

    /**
     * Envoyer une notification push pour un nouveau message
     */
    async sendMessageNotification(targetUserId, senderName, messageContent, roomId, senderId) {
        if (!this.initialized) {
            console.log('⚠️ Firebase non initialisé - Notification non envoyée');
            return false;
        }

        try {
            // Récupérer le token FCM de l'utilisateur cible
            const fcmToken = await this.getUserFCMToken(targetUserId);
            if (!fcmToken) {
                console.log(`⚠️ Token FCM non trouvé pour l'utilisateur ${targetUserId}`);
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

            const response = await admin.messaging().send(message);
            console.log(`✅ Notification envoyée: ${response}`);
            return true;

        } catch (error) {
            console.error('❌ Erreur envoi notification:', error.message);
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

            const response = await admin.messaging().send(message);
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
        return new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
            const db = new sqlite3.Database(dbPath);
            
            // Vérifier si le token existe déjà
            const checkQuery = "SELECT id FROM fcm_tokens WHERE fcm_token = ?";
            
            db.get(checkQuery, [fcmToken], (err, row) => {
                if (err) {
                    console.error('❌ Erreur vérification token FCM:', err);
                    db.close();
                    reject(err);
                    return;
                }
                
                if (row) {
                    // Token existe déjà, mettre à jour l'utilisateur
                    const updateQuery = "UPDATE fcm_tokens SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE fcm_token = ?";
                    
                    db.run(updateQuery, [userId, fcmToken], function(err) {
                        db.close();
                        
                        if (err) {
                            console.error('❌ Erreur mise à jour token FCM:', err);
                            reject(err);
                        } else {
                            console.log(`✅ Token FCM mis à jour pour utilisateur ${userId}`);
                            resolve(true);
                        }
                    });
                } else {
                    // Nouveau token, l'insérer
                    const insertQuery = "INSERT INTO fcm_tokens (user_id, fcm_token) VALUES (?, ?)";
                    
                    db.run(insertQuery, [userId, fcmToken], function(err) {
                        db.close();
                        
                        if (err) {
                            console.error('❌ Erreur insertion token FCM:', err);
                            reject(err);
                        } else {
                            console.log(`✅ Token FCM enregistré pour utilisateur ${userId}`);
                            resolve(true);
                        }
                    });
                }
            });
        });
    }

    /**
     * Vérifier si le service est initialisé
     */
    isInitialized() {
        return this.initialized;
    }
}

module.exports = PushNotificationService;
