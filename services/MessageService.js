const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class MessageService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.initializeDatabase();
    }

    initializeDatabase() {
        const createMessagesTable = `
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                sender_id TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                content TEXT NOT NULL,
                room TEXT DEFAULT 'general',
                message_type TEXT DEFAULT 'text',
                reply_to TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createRoomsTable = `
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                created_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        // Créer les tables
        this.db.run(createMessagesTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table messages:', err);
            } else {
            }
        });

        this.db.run(createRoomsTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table rooms:', err);
            } else {
                // Créer la room par défaut
                this.createDefaultRoom();
            }
        });
    }

    async createDefaultRoom() {
        const defaultRoom = {
            id: 'general',
            name: 'Général',
            description: 'Salon de discussion principal',
            createdBy: 'system'
        };

        return new Promise((resolve, reject) => {
            const query = `
                INSERT OR IGNORE INTO rooms (id, name, description, created_by)
                VALUES (?, ?, ?, ?)
            `;

            this.db.run(query, [
                defaultRoom.id,
                defaultRoom.name,
                defaultRoom.description,
                defaultRoom.createdBy
            ], function(err) {
                if (err) {
                    console.error('❌ Erreur création room par défaut:', err);
                    reject(err);
                } else {
                    resolve(defaultRoom);
                }
            });
        });
    }

    async saveMessage(messageData) {
        return new Promise(async (resolve, reject) => {
            try {
                // NOUVEAU: Créer automatiquement la room si elle n'existe pas
                const roomId = messageData.room || 'general';
                
                // Si c'est une room privée (commence par "private_"), la créer automatiquement
                if (roomId.startsWith('private_')) {
                    // Utiliser le username de l'autre utilisateur si fourni dans messageData
                    const otherUserName = messageData.targetUserName || messageData.otherUserName || null;
                    await this.ensurePrivateRoomExists(roomId, messageData.senderId, otherUserName);
                }
                
                const id = uuidv4();
                const now = new Date().toISOString();
                
                const query = `
                    INSERT INTO messages (
                        id, sender_id, sender_name, content, room, message_type, reply_to, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const params = [
                    id,
                    messageData.senderId || 'anonymous',
                    messageData.senderName || 'Utilisateur',
                    messageData.content || '',
                    roomId,
                    messageData.messageType || 'text',
                    messageData.replyTo || null,
                    now,
                    now
                ];

                this.db.run(query, params, function(err) {
                    if (err) {
                        console.error('❌ Erreur sauvegarde message:', err);
                        reject(err);
                    } else {
                        const savedMessage = {
                            id,
                            senderId: messageData.senderId || 'anonymous',
                            senderName: messageData.senderName || 'Utilisateur',
                            content: messageData.content || '',
                            room: roomId,
                            messageType: messageData.messageType || 'text',
                            replyTo: messageData.replyTo || null,
                            createdAt: now,
                            updatedAt: now
                        };
                        
                        resolve(savedMessage);
                    }
                });
            } catch (error) {
                console.error('❌ Erreur lors de la sauvegarde du message:', error);
                reject(error);
            }
        });
    }

    async getMessages(room = 'general', limit = 50, offset = 0) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, sender_id, sender_name, content, room, message_type, reply_to, created_at, updated_at
                FROM messages 
                WHERE room = ? 
                ORDER BY created_at DESC 
                LIMIT ? OFFSET ?
            `;

            this.db.all(query, [room, limit, offset], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération messages:', err);
                    reject(err);
                } else {
                    const messages = rows.reverse();
                    resolve(messages);
                }
            });
        });
    }

    // Alias pour compatibilité avec les routes
    async getMessagesByRoom(roomId, limit = 50, offset = 0) {
        return this.getMessages(roomId, limit, offset);
    }

    // Alias pour compatibilité avec les routes
    async createMessage(messageData) {
        return this.saveMessage(messageData);
    }

    async getMessageById(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, sender_id, sender_name, content, room, message_type, reply_to, created_at, updated_at
                FROM messages 
                WHERE id = ?
            `;

            this.db.get(query, [id], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération message:', err);
                    reject(err);
                } else if (row) {
                    resolve(row);
                } else {
                    resolve(null);
                }
            });
        });
    }

    async getMessagesByUser(senderId, limit = 100) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, sender_id, sender_name, content, room, message_type, reply_to, created_at, updated_at
                FROM messages 
                WHERE sender_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `;

            this.db.all(query, [senderId, limit], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération messages utilisateur:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async deleteMessage(id) {
        return new Promise((resolve, reject) => {
            const query = `DELETE FROM messages WHERE id = ?`;

            this.db.run(query, [id], function(err) {
                if (err) {
                    console.error('❌ Erreur suppression message:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    async updateMessage(id, content) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            const query = `
                UPDATE messages 
                SET content = ?, updated_at = ? 
                WHERE id = ?
            `;

            this.db.run(query, [content, now, id], function(err) {
                if (err) {
                    console.error('❌ Erreur mise à jour message:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    resolve(null);
                } else {
                    resolve({ id, content, updatedAt: now });
                }
            });
        });
    }

    // Gestion des rooms
    async createRoom(roomData) {
        return new Promise((resolve, reject) => {
            const id = roomData.id || uuidv4();
            const now = new Date().toISOString();
            
            const query = `
                INSERT INTO rooms (id, name, description, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `;

            const params = [
                id,
                roomData.name || 'Nouvelle Room',
                roomData.description || '',
                roomData.createdBy || 'anonymous',
                now,
                now
            ];

            this.db.run(query, params, function(err) {
                if (err) {
                    console.error('❌ Erreur création room:', err);
                    reject(err);
                } else {
                    const savedRoom = {
                        id,
                        name: roomData.name || 'Nouvelle Room',
                        description: roomData.description || '',
                        createdBy: roomData.createdBy || 'anonymous',
                        createdAt: now,
                        updatedAt: now
                    };
                    
                    resolve(savedRoom);
                }
            });
        });
    }

    async getAllRooms() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    r.id, r.name, r.description, r.created_by, r.created_at, r.updated_at,
                    COUNT(m.id) as message_count
                FROM rooms r
                LEFT JOIN messages m ON r.id = m.room
                GROUP BY r.id
                ORDER BY r.created_at ASC
            `;

            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération rooms:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getRoomById(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    r.id, r.name, r.description, r.created_by, r.created_at, r.updated_at,
                    COUNT(m.id) as message_count
                FROM rooms r
                LEFT JOIN messages m ON r.id = m.room
                WHERE r.id = ?
                GROUP BY r.id
            `;

            this.db.get(query, [id], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération room:', err);
                    reject(err);
                } else if (row) {
                    resolve(row);
                } else {
                    resolve(null);
                }
            });
        });
    }

    async getMessageStats() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total_messages,
                    COUNT(DISTINCT sender_id) as unique_senders,
                    COUNT(DISTINCT room) as active_rooms,
                    COUNT(CASE WHEN created_at > datetime('now', '-1 day') THEN 1 END) as messages_last_24h,
                    COUNT(CASE WHEN created_at > datetime('now', '-1 hour') THEN 1 END) as messages_last_hour
                FROM messages
            `;

            this.db.get(query, [], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération statistiques messages:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async searchMessages(searchTerm, room = null, limit = 50) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT 
                    id, sender_id, sender_name, content, room, message_type, reply_to, created_at, updated_at
                FROM messages 
                WHERE content LIKE ?
            `;
            let params = [`%${searchTerm}%`];

            if (room) {
                query += ` AND room = ?`;
                params.push(room);
            }

            query += ` ORDER BY created_at DESC LIMIT ?`;
            params.push(limit);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Erreur recherche messages:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // NOUVELLE MÉTHODE: Créer automatiquement une room privée si elle n'existe pas
    async ensurePrivateRoomExists(roomId, creatorId, otherUserName = null) {
        return new Promise((resolve, reject) => {
            // Vérifier si la room existe déjà
            const checkQuery = `SELECT id, name FROM rooms WHERE id = ?`;
            
            this.db.get(checkQuery, [roomId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur vérification room:', err);
                    reject(err);
                    return;
                }
                
                if (row) {
                    // La room existe déjà - mettre à jour le nom si un username est fourni et que le nom est générique
                    if (otherUserName && row.name === 'Conversation privée') {
                        const updatedRoomName = `Chat avec ${otherUserName}`;
                        const updateQuery = `UPDATE rooms SET name = ?, updated_at = datetime('now') WHERE id = ?`;
                        this.db.run(updateQuery, [updatedRoomName, roomId], (updateErr) => {
                            if (updateErr) {
                                console.error('❌ Erreur mise à jour nom room:', updateErr);
                            } else {
                                row.name = updatedRoomName;
                            }
                            resolve(row);
                        });
                    } else {
                        resolve(row);
                    }
                    return;
                }
                
                // Créer la room privée
                
                // Extraire les IDs des utilisateurs du nom de la room
                // Le format peut être: private_user1_user2 ou private_user1_user2_announcement_id
                let userIds = roomId.replace('private_', '').split('_');
                // Si c'est une room avec annonce, retirer le dernier élément (announcement_id)
                if (roomId.includes('_announcement_')) {
                    userIds = roomId.replace('private_', '').split('_announcement_')[0].split('_');
                }
                
                // Utiliser le username si fourni, sinon nom générique
                const roomName = otherUserName ? `Chat avec ${otherUserName}` : `Conversation privée`;
                const roomDescription = otherUserName 
                    ? `Conversation avec ${otherUserName}`
                    : `Conversation entre utilisateurs ${userIds.join(' et ')}`;
                
                const createQuery = `
                    INSERT INTO rooms (id, name, description, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
                `;
                
                this.db.run(createQuery, [roomId, roomName, roomDescription, creatorId], function(err) {
                    if (err) {
                        console.error('❌ Erreur création room privée:', err);
                        reject(err);
                    } else {
                        resolve({
                            id: roomId,
                            name: roomName,
                            description: roomDescription,
                            created_by: creatorId
                        });
                    }
                });
            });
        });
    }

    // Supprimer une room et tous ses messages
    async deleteRoom(roomId) {
        return new Promise((resolve, reject) => {
            // D'abord supprimer tous les messages de la room
            const deleteMessages = `DELETE FROM messages WHERE room = ?`;
            
            this.db.run(deleteMessages, [roomId], (err) => {
                if (err) {
                    console.error('❌ Erreur suppression messages de la room:', err);
                    reject(err);
                    return;
                }
                
                
                // Ensuite supprimer la room elle-même
                const deleteRoom = `DELETE FROM rooms WHERE id = ?`;
                
                this.db.run(deleteRoom, [roomId], function(err) {
                    if (err) {
                        console.error('❌ Erreur suppression room:', err);
                        reject(err);
                    } else if (this.changes === 0) {
                        resolve(false); // Room n'existait pas
                    } else {
                        resolve(true); // Room supprimée avec succès
                    }
                });
            });
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('❌ Erreur fermeture base de données:', err);
            } else {
            }
        });
    }
}

module.exports = MessageService; 