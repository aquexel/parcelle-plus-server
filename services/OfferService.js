const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

/**
 * Service de gestion des propositions d'achat/vente
 * Gère les offres, contre-offres et négociations entre acheteurs et vendeurs
 */
class OfferService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.initializeDatabase();
    }

    initializeDatabase() {
        // Table des propositions
        const createOffersTable = `
            CREATE TABLE IF NOT EXISTS offers (
                id TEXT PRIMARY KEY,
                announcement_id TEXT NOT NULL,
                buyer_id TEXT NOT NULL,
                buyer_name TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                seller_name TEXT NOT NULL,
                room_id TEXT NOT NULL,
                original_price REAL NOT NULL,
                proposed_price REAL NOT NULL,
                proposed_polygon TEXT,
                proposed_surface REAL,
                status TEXT DEFAULT 'pending',
                message TEXT,
                parent_offer_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_offer_id) REFERENCES offers(id)
            )
        `;

        // Table pour lier les annonces aux conversations
        const createConversationAnnouncementsTable = `
            CREATE TABLE IF NOT EXISTS conversation_announcements (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                announcement_id TEXT NOT NULL,
                buyer_id TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                initial_message_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(room_id, announcement_id)
            )
        `;

        // Table pour l'historique des propositions
        const createOfferHistoryTable = `
            CREATE TABLE IF NOT EXISTS offer_history (
                id TEXT PRIMARY KEY,
                offer_id TEXT NOT NULL,
                action TEXT NOT NULL,
                actor_id TEXT NOT NULL,
                actor_name TEXT NOT NULL,
                previous_status TEXT,
                new_status TEXT,
                comment TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (offer_id) REFERENCES offers(id)
            )
        `;

        this.db.run(createOffersTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table offers:', err);
            } else {
                console.log('✅ Table offers initialisée');
            }
        });

        this.db.run(createConversationAnnouncementsTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table conversation_announcements:', err);
            } else {
                console.log('✅ Table conversation_announcements initialisée');
            }
        });

        this.db.run(createOfferHistoryTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table offer_history:', err);
            } else {
                console.log('✅ Table offer_history initialisée');
            }
        });
    }

    /**
     * Lier une annonce à une conversation lors du premier contact
     */
    async linkAnnouncementToConversation(data) {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            const now = new Date().toISOString();

            const query = `
                INSERT INTO conversation_announcements 
                (id, room_id, announcement_id, buyer_id, seller_id, initial_message_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

            this.db.run(query, [
                id,
                data.roomId,
                data.announcementId,
                data.buyerId,
                data.sellerId,
                data.initialMessageId || null,
                now
            ], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        console.log(`ℹ️ L'annonce ${data.announcementId} est déjà liée à la room ${data.roomId}`);
                        resolve({ alreadyLinked: true });
                    } else {
                        console.error('❌ Erreur liaison annonce-conversation:', err);
                        reject(err);
                    }
                } else {
                    console.log(`✅ Annonce ${data.announcementId} liée à la conversation ${data.roomId}`);
                    resolve({ id, ...data, createdAt: now });
                }
            });
        });
    }

    /**
     * Récupérer l'annonce liée à une conversation
     */
    async getConversationAnnouncement(roomId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM conversation_announcements 
                WHERE room_id = ?
                ORDER BY created_at DESC
                LIMIT 1
            `;

            this.db.get(query, [roomId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération annonce conversation:', err);
                    reject(err);
                } else {
                    resolve(row || null);
                }
            });
        });
    }

    /**
     * Créer une nouvelle proposition d'achat
     */
    async createOffer(offerData) {
        return new Promise(async (resolve, reject) => {
            try {
                const id = uuidv4();
                const now = new Date().toISOString();

                const query = `
                    INSERT INTO offers (
                        id, announcement_id, buyer_id, buyer_name, seller_id, seller_name,
                        room_id, original_price, proposed_price, proposed_polygon, 
                        proposed_surface, status, message, parent_offer_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                this.db.run(query, [
                    id,
                    offerData.announcementId,
                    offerData.buyerId,
                    offerData.buyerName,
                    offerData.sellerId,
                    offerData.sellerName,
                    offerData.roomId,
                    offerData.originalPrice,
                    offerData.proposedPrice,
                    offerData.proposedPolygon ? JSON.stringify(offerData.proposedPolygon) : null,
                    offerData.proposedSurface || null,
                    offerData.status || 'pending',
                    offerData.message || null,
                    offerData.parentOfferId || null,
                    now,
                    now
                ], async (err) => {
                    if (err) {
                        console.error('❌ Erreur création proposition:', err);
                        reject(err);
                    } else {
                        console.log(`✅ Proposition créée: ${id}`);

                        // Créer l'historique
                        await this.addOfferHistory({
                            offerId: id,
                            action: 'created',
                            actorId: offerData.buyerId,
                            actorName: offerData.buyerName,
                            newStatus: offerData.status || 'pending',
                            comment: offerData.message
                        });

                        const savedOffer = {
                            id,
                            ...offerData,
                            proposedPolygon: offerData.proposedPolygon,
                            status: offerData.status || 'pending',
                            createdAt: now,
                            updatedAt: now
                        };

                        resolve(savedOffer);
                    }
                });
            } catch (error) {
                console.error('❌ Erreur lors de la création de la proposition:', error);
                reject(error);
            }
        });
    }

    /**
     * Récupérer une proposition par son ID
     */
    async getOfferById(offerId) {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM offers WHERE id = ?`;

            this.db.get(query, [offerId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération proposition:', err);
                    reject(err);
                } else if (row) {
                    // Parser le polygone JSON
                    if (row.proposed_polygon) {
                        row.proposed_polygon = JSON.parse(row.proposed_polygon);
                    }
                    resolve(row);
                } else {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Récupérer toutes les propositions pour une conversation
     */
    async getOffersByRoom(roomId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM offers 
                WHERE room_id = ?
                ORDER BY created_at DESC
            `;

            this.db.all(query, [roomId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération propositions:', err);
                    reject(err);
                } else {
                    // Parser les polygones JSON
                    rows = rows.map(row => {
                        if (row.proposed_polygon) {
                            row.proposed_polygon = JSON.parse(row.proposed_polygon);
                        }
                        return row;
                    });
                    console.log(`✅ ${rows.length} propositions récupérées pour la room ${roomId}`);
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Récupérer les propositions pour un utilisateur (acheteur ou vendeur)
     */
    async getOffersByUser(userId, role = 'all') {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM offers WHERE `;
            let params = [];

            if (role === 'buyer') {
                query += `buyer_id = ?`;
                params = [userId];
            } else if (role === 'seller') {
                query += `seller_id = ?`;
                params = [userId];
            } else {
                query += `(buyer_id = ? OR seller_id = ?)`;
                params = [userId, userId];
            }

            query += ` ORDER BY created_at DESC`;

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération propositions utilisateur:', err);
                    reject(err);
                } else {
                    rows = rows.map(row => {
                        if (row.proposed_polygon) {
                            row.proposed_polygon = JSON.parse(row.proposed_polygon);
                        }
                        return row;
                    });
                    console.log(`✅ ${rows.length} propositions récupérées pour l'utilisateur ${userId}`);
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Mettre à jour le statut d'une proposition
     */
    async updateOfferStatus(offerId, newStatus, actorId, actorName, comment = null) {
        return new Promise(async (resolve, reject) => {
            try {
                // Récupérer l'ancien statut
                const offer = await this.getOfferById(offerId);
                if (!offer) {
                    reject(new Error('Proposition non trouvée'));
                    return;
                }

                const now = new Date().toISOString();
                const query = `
                    UPDATE offers 
                    SET status = ?, updated_at = ?
                    WHERE id = ?
                `;

                this.db.run(query, [newStatus, now, offerId], async (err) => {
                    if (err) {
                        console.error('❌ Erreur mise à jour statut proposition:', err);
                        reject(err);
                    } else {
                        console.log(`✅ Proposition ${offerId} - Statut changé: ${offer.status} → ${newStatus}`);

                        // Créer l'historique
                        await this.addOfferHistory({
                            offerId,
                            action: 'status_changed',
                            actorId,
                            actorName,
                            previousStatus: offer.status,
                            newStatus,
                            comment
                        });

                        const updatedOffer = await this.getOfferById(offerId);
                        resolve(updatedOffer);
                    }
                });
            } catch (error) {
                console.error('❌ Erreur lors de la mise à jour du statut:', error);
                reject(error);
            }
        });
    }

    /**
     * Créer une contre-proposition (le vendeur propose une modification)
     */
    async createCounterOffer(originalOfferId, counterOfferData) {
        return new Promise(async (resolve, reject) => {
            try {
                const originalOffer = await this.getOfferById(originalOfferId);
                if (!originalOffer) {
                    reject(new Error('Proposition originale non trouvée'));
                    return;
                }

                // Créer une nouvelle proposition avec l'ID de la proposition parente
                const counterOffer = await this.createOffer({
                    ...counterOfferData,
                    parentOfferId: originalOfferId,
                    announcementId: originalOffer.announcement_id,
                    roomId: originalOffer.room_id,
                    buyerId: originalOffer.buyer_id,
                    buyerName: originalOffer.buyer_name,
                    sellerId: originalOffer.seller_id,
                    sellerName: originalOffer.seller_name,
                    originalPrice: originalOffer.original_price,
                    status: 'counter_offer'
                });

                // Mettre à jour la proposition originale
                await this.updateOfferStatus(
                    originalOfferId, 
                    'countered', 
                    counterOfferData.sellerId || originalOffer.seller_id,
                    counterOfferData.sellerName || originalOffer.seller_name,
                    'Contre-proposition créée'
                );

                resolve(counterOffer);
            } catch (error) {
                console.error('❌ Erreur création contre-proposition:', error);
                reject(error);
            }
        });
    }

    /**
     * Accepter une proposition
     */
    async acceptOffer(offerId, actorId, actorName) {
        return this.updateOfferStatus(offerId, 'accepted', actorId, actorName, 'Proposition acceptée');
    }

    /**
     * Refuser une proposition
     */
    async rejectOffer(offerId, actorId, actorName, reason = null) {
        return this.updateOfferStatus(offerId, 'rejected', actorId, actorName, reason || 'Proposition refusée');
    }

    /**
     * Ajouter une entrée dans l'historique des propositions
     */
    async addOfferHistory(historyData) {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            const now = new Date().toISOString();

            const query = `
                INSERT INTO offer_history (
                    id, offer_id, action, actor_id, actor_name, 
                    previous_status, new_status, comment, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            this.db.run(query, [
                id,
                historyData.offerId,
                historyData.action,
                historyData.actorId,
                historyData.actorName,
                historyData.previousStatus || null,
                historyData.newStatus || null,
                historyData.comment || null,
                now
            ], (err) => {
                if (err) {
                    console.error('❌ Erreur ajout historique:', err);
                    reject(err);
                } else {
                    resolve({ id, ...historyData, createdAt: now });
                }
            });
        });
    }

    /**
     * Récupérer l'historique d'une proposition
     */
    async getOfferHistory(offerId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM offer_history 
                WHERE offer_id = ?
                ORDER BY created_at ASC
            `;

            this.db.all(query, [offerId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération historique:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Récupérer les statistiques des propositions
     */
    async getOfferStats(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                    COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
                    COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
                    COUNT(CASE WHEN status = 'counter_offer' THEN 1 END) as counter_offers,
                    COUNT(CASE WHEN buyer_id = ? THEN 1 END) as as_buyer,
                    COUNT(CASE WHEN seller_id = ? THEN 1 END) as as_seller
                FROM offers
                WHERE buyer_id = ? OR seller_id = ?
            `;

            this.db.get(query, [userId, userId, userId, userId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération statistiques:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('❌ Erreur fermeture base de données:', err);
            } else {
                console.log('✅ Base de données OfferService fermée');
            }
        });
    }
}

module.exports = OfferService;


