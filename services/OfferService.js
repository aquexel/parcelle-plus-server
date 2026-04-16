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
        // Base de données des utilisateurs (différente)
        this.usersDbPath = path.join(__dirname, '..', 'database', 'parcelle_business.db');
        this.usersDb = new sqlite3.Database(this.usersDbPath);
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

        // Table pour les signatures électroniques
        const createSignaturesTable = `
            CREATE TABLE IF NOT EXISTS offer_signatures (
                id TEXT PRIMARY KEY,
                offer_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT NOT NULL,
                user_email TEXT NOT NULL,
                signature_type TEXT NOT NULL,
                signature_timestamp DATETIME DEFAULT NULL,
                pdf_path TEXT,
                email_verification_token TEXT,
                email_verified INTEGER DEFAULT 0,
                prenom TEXT,
                nom TEXT,
                date_naissance TEXT,
                adresse TEXT,
                FOREIGN KEY (offer_id) REFERENCES offers(id)
            )
        `;

        this.db.run(createOffersTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table offers:', err);
            } else {
            }
        });

        this.db.run(createConversationAnnouncementsTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table conversation_announcements:', err);
            } else {
            }
        });

        this.db.run(createOfferHistoryTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table offer_history:', err);
            } else {
            }
        });

        this.db.run(createSignaturesTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table offer_signatures:', err);
            } else {
                
                // Migration: Ajouter les colonnes email_verification_token et email_verified si elles n'existent pas
                this.migrateSignaturesTable();
            }
        });
    }
    
    migrateSignaturesTable() {
        // Vérifier si les colonnes existent déjà
        this.db.all("PRAGMA table_info(offer_signatures)", (err, columns) => {
            if (err) {
                console.error('❌ Erreur vérification colonnes offer_signatures:', err);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            const needsEmailVerificationToken = !columnNames.includes('email_verification_token');
            const needsEmailVerified = !columnNames.includes('email_verified');
            
            if (needsEmailVerificationToken || needsEmailVerified) {
                
                if (needsEmailVerificationToken) {
                    this.db.run("ALTER TABLE offer_signatures ADD COLUMN email_verification_token TEXT", (err) => {
                        if (err) {
                            console.error('❌ Erreur ajout colonne email_verification_token:', err);
                        } else {
                        }
                    });
                }
                
                if (needsEmailVerified) {
                    this.db.run("ALTER TABLE offer_signatures ADD COLUMN email_verified INTEGER DEFAULT 0", (err) => {
                        if (err) {
                            console.error('❌ Erreur ajout colonne email_verified:', err);
                        } else {
                        }
                    });
                }
            }
            
            // Migration: Nettoyer les signatures où email n'est pas vérifié mais qui ont un timestamp
            // (ces signatures ont été créées avec l'ancien comportement où un timestamp était créé automatiquement)
            this.db.run(
                "UPDATE offer_signatures SET signature_timestamp = NULL WHERE email_verified = 0 AND signature_timestamp IS NOT NULL",
                (err) => {
                    if (err) {
                        console.error('❌ Erreur nettoyage signatures invalides:', err);
                    } else {
                    }
                }
            );
            
            // Migration: Ajouter les colonnes pour les informations personnelles si elles n'existent pas
            const columnsToAdd = [
                { name: 'prenom', type: 'TEXT' },
                { name: 'nom', type: 'TEXT' },
                { name: 'date_naissance', type: 'TEXT' },
                { name: 'adresse', type: 'TEXT' }
            ];
            
            columnsToAdd.forEach(column => {
                this.db.run(
                    `ALTER TABLE offer_signatures ADD COLUMN ${column.name} ${column.type}`,
                    (err) => {
                        if (err && !err.message.includes('duplicate column name')) {
                            console.error(`❌ Erreur ajout colonne ${column.name}:`, err);
                        } else if (!err) {
                        }
                    }
                );
            });
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
                        resolve({ alreadyLinked: true });
                    } else {
                        console.error('❌ Erreur liaison annonce-conversation:', err);
                        reject(err);
                    }
                } else {
                    resolve({ id, ...data, createdAt: now });
                }
            });
        });
    }


    /**
     * Récupérer l'annonce liée à une conversation
     */
    async getUserConversations(userId) {
        return new Promise((resolve, reject) => {
            // Récupérer les conversations depuis parcelle_chat.db
            const conversationQuery = `
                SELECT DISTINCT
                    ca.room_id,
                    ca.announcement_id,
                    ca.buyer_id,
                    ca.seller_id,
                    ca.created_at
                FROM conversation_announcements ca
                WHERE ca.buyer_id = ? OR ca.seller_id = ?
                ORDER BY ca.created_at DESC
            `;
            
            this.db.all(conversationQuery, [userId, userId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération conversations utilisateur:', err);
                    reject(err);
                } else {
                    
                    // Pour chaque conversation, récupérer les noms d'utilisateurs depuis parcelle_business.db
                    let processed = 0;
                    const conversations = [];
                    
                    rows.forEach(row => {
                        // Récupérer le nom de l'acheteur depuis users
                        this.usersDb.get("SELECT username FROM users WHERE id = ?", [row.buyer_id], (err, buyer) => {
                            if (err) {
                                console.error('❌ Erreur récupération acheteur:', err);
                            }
                            
                            // Récupérer le nom du vendeur depuis users
                            this.usersDb.get("SELECT username FROM users WHERE id = ?", [row.seller_id], (err, seller) => {
                                if (err) {
                                    console.error('❌ Erreur récupération vendeur:', err);
                                }
                                
                                const conversation = {
                                    id: row.room_id,
                                    roomId: row.room_id,
                                    announcementId: row.announcement_id,
                                    buyerId: row.buyer_id,
                                    sellerId: row.seller_id,
                                    buyerName: buyer?.username || `Utilisateur ${row.buyer_id.substring(0, 8)}`,
                                    sellerName: seller?.username || `Utilisateur ${row.seller_id.substring(0, 8)}`,
                                    createdAt: row.created_at,
                                    messageCount: 0
                                };
                                
                                conversations.push(conversation);
                                
                                processed++;
                                if (processed === rows.length) {
                                    resolve(conversations);
                                }
                            });
                        });
                    });
                    
                    if (rows.length === 0) {
                        resolve([]);
                    }
                }
            });
        });
    }

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
                // Contre-proposition vendeur : une offre « pending » existe encore côté acheteur ;
                // ne pas appliquer la règle « une seule proposition pending » (sinon DUPLICATE puis
                // createCounterOffer marque l'offre en countered sans insérer la contre-offre).
                const isCounterOffer = offerData.status === 'counter_offer' && !!offerData.parentOfferId;

                if (!isCounterOffer) {
                    // Vérifier si l'acheteur a déjà une proposition active pour cette annonce
                    const hasActiveOffer = await this.hasActiveOfferForAnnouncement(offerData.announcementId, offerData.buyerId);

                    if (hasActiveOffer) {
                        console.log(`❌ Proposition refusée: l'acheteur ${offerData.buyerId} a déjà une proposition active pour l'annonce ${offerData.announcementId}`);
                        return resolve({
                            error: 'Vous avez déjà une proposition en cours pour cette annonce. Attendez la réponse du vendeur.',
                            code: 'DUPLICATE_OFFER'
                        });
                    }
                }

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
                ORDER BY created_at ASC
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
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Vérifier si un acheteur a déjà une proposition en cours pour une annonce
     */
    async hasActiveOfferForAnnouncement(announcementId, buyerId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT COUNT(*) as count
                FROM offers 
                WHERE announcement_id = ? AND buyer_id = ? AND status = 'pending'
            `;

            this.db.get(query, [announcementId, buyerId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur vérification proposition existante:', err);
                    reject(err);
                } else {
                    const hasActiveOffer = row.count > 0;
                    resolve(hasActiveOffer);
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

            query += ` ORDER BY created_at ASC`;

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

                if (counterOffer && counterOffer.error && counterOffer.code === 'DUPLICATE_OFFER') {
                    reject(new Error(counterOffer.error || 'Impossible de créer la contre-proposition'));
                    return;
                }
                if (!counterOffer || !counterOffer.id) {
                    reject(new Error('Échec création de la contre-proposition'));
                    return;
                }

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
     * Ajouter une signature électronique (ou créer une entrée en attente de vérification email)
     */
    async addSignature(signatureData) {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            const query = `
                INSERT INTO offer_signatures (
                    id, offer_id, user_id, user_name, user_email, 
                    signature_type, signature_timestamp, pdf_path,
                    email_verification_token, email_verified
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            this.db.run(query, [
                id,
                signatureData.offerId,
                signatureData.userId,
                signatureData.userName,
                signatureData.userEmail,
                signatureData.signatureType, // 'buyer' ou 'seller'
                signatureData.signatureTimestamp || null, // NULL par défaut, sera défini lors de finalizeSignature
                signatureData.pdfPath || null,
                signatureData.emailVerificationToken || null,
                signatureData.emailVerified || 0
            ], (err) => {
                if (err) {
                    console.error('❌ Erreur ajout signature:', err);
                    reject(err);
                } else {
                    resolve({ id, ...signatureData });
                }
            });
        });
    }

    /**
     * Mettre à jour le token de vérification email pour une signature
     */
    async updateSignatureVerificationToken(signatureId, verificationToken) {
        return new Promise((resolve, reject) => {
            const query = `UPDATE offer_signatures SET email_verification_token = ? WHERE id = ?`;
            this.db.run(query, [verificationToken, signatureId], (err) => {
                if (err) {
                    console.error('❌ Erreur mise à jour token vérification:', err);
                    reject(err);
                } else {
                    resolve(true);
                }
            });
        });
    }

    /**
     * Vérifier le token d'email et marquer comme vérifié
     */
    async verifySignatureEmail(offerId, userId, verificationToken) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE offer_signatures 
                SET email_verified = 1, email_verification_token = NULL 
                WHERE offer_id = ? AND user_id = ? AND email_verification_token = ? AND email_verified = 0
            `;
            this.db.run(query, [offerId, userId, verificationToken], function(err) {
                if (err) {
                    console.error('❌ Erreur vérification email:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('Token invalide ou déjà utilisé'));
                } else {
                    resolve(true);
                }
            });
        });
    }

    /**
     * Récupérer une signature par offer_id et user_id
     */
    async getSignatureByOfferAndUser(offerId, userId) {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM offer_signatures WHERE offer_id = ? AND user_id = ?`;
            this.db.get(query, [offerId, userId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération signature:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    /**
     * Finaliser une signature (mettre à jour le timestamp de signature et les informations personnelles)
     */
    async finalizeSignature(offerId, userId, prenom = null, nom = null, dateNaissance = null, adresse = null) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            const query = `UPDATE offer_signatures SET signature_timestamp = ?, prenom = ?, nom = ?, date_naissance = ?, adresse = ? WHERE offer_id = ? AND user_id = ? AND email_verified = 1`;
            this.db.run(query, [now, prenom, nom, dateNaissance, adresse, offerId, userId], function(err) {
                if (err) {
                    console.error('❌ Erreur finalisation signature:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    reject(new Error('Signature non trouvée ou email non vérifié'));
                } else {
                    resolve(true);
                }
            });
        });
    }

    /**
     * Récupérer les signatures d'une offre
     */
    async getSignaturesByOfferId(offerId) {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM offer_signatures WHERE offer_id = ? ORDER BY signature_timestamp ASC`;
            this.db.all(query, [offerId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération signatures:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Mettre à jour le chemin du PDF pour une signature
     */
    async updateSignaturePdfPath(offerId, pdfPath) {
        return new Promise((resolve, reject) => {
            const query = `UPDATE offer_signatures SET pdf_path = ? WHERE offer_id = ?`;
            this.db.run(query, [pdfPath, offerId], (err) => {
                if (err) {
                    console.error('❌ Erreur mise à jour PDF path:', err);
                    reject(err);
                } else {
                    resolve(true);
                }
            });
        });
    }

    /**
     * Accepter une proposition
     * - En attente (pending) : seul le vendeur accepte l'offre de l'acheteur
     * - Contre-proposition (counter_offer) : seul l'acheteur accepte l'offre du vendeur
     * - Déjà acceptée (accepted) dans le flux contre-offre : le vendeur peut confirmer à son tour
     */
    async acceptOffer(offerId, actorId, actorName) {
        const offer = await this.getOfferById(offerId);
        if (!offer) {
            throw new Error('Proposition non trouvée');
        }
        if (offer.status === 'accepted') {
            const isCounterFlow = !!offer.parent_offer_id;
            if (!isCounterFlow) {
                throw new Error('Cette proposition est déjà acceptée');
            }
            if (offer.seller_id !== actorId) {
                throw new Error('Seul le vendeur peut confirmer cette acceptation');
            }
            await this.addOfferHistory({
                offerId,
                action: 'seller_confirmed_acceptance',
                actorId,
                actorName,
                previousStatus: 'accepted',
                newStatus: 'accepted',
                comment: 'Acceptation confirmée par le vendeur'
            });
            return this.getOfferById(offerId);
        }
        if (offer.status !== 'pending' && offer.status !== 'counter_offer') {
            throw new Error('Cette proposition ne peut plus être acceptée');
        }
        if (offer.status === 'pending' && offer.seller_id !== actorId) {
            throw new Error('Seul le vendeur peut accepter cette proposition');
        }
        if (offer.status === 'counter_offer' && offer.buyer_id !== actorId) {
            throw new Error('Seul l\'acheteur peut accepter cette contre-proposition');
        }
        return this.updateOfferStatus(offerId, 'accepted', actorId, actorName, 'Proposition acceptée');
    }

    /**
     * Refuser une proposition
     * - En attente : seul le vendeur refuse l'offre acheteur
     * - Contre-proposition : seul l'acheteur refuse la contre-offre vendeur
     */
    async rejectOffer(offerId, actorId, actorName, reason = null) {
        const offer = await this.getOfferById(offerId);
        if (!offer) {
            throw new Error('Proposition non trouvée');
        }
        if (offer.status !== 'pending' && offer.status !== 'counter_offer') {
            throw new Error('Cette proposition ne peut plus être refusée');
        }
        if (offer.status === 'pending' && offer.seller_id !== actorId) {
            throw new Error('Seul le vendeur peut refuser cette proposition');
        }
        if (offer.status === 'counter_offer' && offer.buyer_id !== actorId) {
            throw new Error('Seul l\'acheteur peut refuser cette contre-proposition');
        }
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

    /**
     * Supprime toutes les conversations et offres liées à une annonce
     * @param {string} announcementId - ID de l'annonce
     * @returns {Promise<{conversationsDeleted: number, offersDeleted: number, messagesDeleted: number}>}
     */
    deleteConversationsAndOffersByAnnouncement(announcementId) {
        return new Promise((resolve, reject) => {

            // Récupérer d'abord les room_ids des conversations liées à cette annonce
            const getRoomsQuery = `SELECT room_id FROM conversation_announcements WHERE announcement_id = ?`;
            
            this.db.all(getRoomsQuery, [announcementId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération rooms:', err);
                    return reject(err);
                }

                const roomIds = rows.map(row => row.room_id);

                if (roomIds.length === 0) {
                    return resolve({ conversationsDeleted: 0, offersDeleted: 0, messagesDeleted: 0 });
                }

                // Créer les placeholders pour la requête IN
                const placeholders = roomIds.map(() => '?').join(',');

                // 1. Supprimer les messages de ces conversations
                const deleteMessagesQuery = `DELETE FROM messages WHERE room IN (${placeholders})`;
                
                this.db.run(deleteMessagesQuery, roomIds, function(err) {
                    if (err) {
                        console.error('❌ Erreur suppression messages:', err);
                        return reject(err);
                    }
                    
                    const messagesDeleted = this.changes;

                    // 2. Supprimer les offres de ces conversations
                    const deleteOffersQuery = `DELETE FROM offers WHERE announcement_id = ?`;
                    
                    this.db.run(deleteOffersQuery, [announcementId], function(err) {
                        if (err) {
                            console.error('❌ Erreur suppression offres:', err);
                            return reject(err);
                        }
                        
                        const offersDeleted = this.changes;

                        this.db.run(
                            'DELETE FROM visit_appointments WHERE announcement_id = ?',
                            [announcementId],
                            function (vErr) {
                                if (vErr) {
                                    console.error('❌ Erreur suppression visit_appointments:', vErr);
                                }
                            }
                        );

                        this.db.run(
                            'DELETE FROM visit_appointments WHERE announcement_id = ?',
                            [announcementId],
                            function (vErr) {
                                if (vErr) {
                                    console.error('❌ Erreur suppression visit_appointments:', vErr);
                                }
                            }
                        );

                        // 3. Supprimer les liens conversation-annonce
                        const deleteConversationsQuery = `DELETE FROM conversation_announcements WHERE announcement_id = ?`;
                        
                        this.db.run(deleteConversationsQuery, [announcementId], function(err) {
                            if (err) {
                                console.error('❌ Erreur suppression conversations:', err);
                                return reject(err);
                            }
                            
                            const conversationsDeleted = this.changes;

                            resolve({
                                conversationsDeleted,
                                offersDeleted,
                                messagesDeleted
                            });
                        }.bind(this));
                    }.bind(this));
                }.bind(this));
            });
        });
    }

    /**
     * Supprimer une conversation pour une annonce spécifique
     */
    async deleteConversationForAnnouncement(announcementId, buyerId, sellerId) {
        return new Promise((resolve) => {
            this.db.serialize(() => {
                let deletedCount = 0;
                
                // 1. Trouver la room liée à cette annonce
                this.db.get(`
                    SELECT room_id FROM conversation_announcements 
                    WHERE announcement_id = ? AND buyer_id = ? AND seller_id = ?
                `, [announcementId, buyerId, sellerId], (err, row) => {
                    if (err) {
                        console.error('❌ Erreur recherche conversation:', err);
                        resolve({ success: false, error: err.message });
                        return;
                    }
                    
                    if (!row) {
                        resolve({ success: true, deletedCount: 0, message: 'Aucune conversation trouvée' });
                        return;
                    }
                    
                    const roomId = row.room_id;
                    
                    // 2. Supprimer les propositions liées
                    this.db.run(`
                        DELETE FROM offers WHERE room_id = ?
                    `, [roomId], function(err) {
                        if (err) {
                            console.error('❌ Erreur suppression propositions:', err);
                            console.error('❌ Détails erreur:', err.message);
                            console.error('❌ Code erreur:', err.code);
                        } else {
                            deletedCount += this.changes;
                        }
                    });

                    this.db.run(`
                        DELETE FROM visit_appointments WHERE room_id = ?
                    `, [roomId], function(err) {
                        if (err) {
                            console.error('❌ Erreur suppression rendez-vous visite:', err);
                        } else {
                            deletedCount += this.changes;
                        }
                    });

                    this.db.run(`
                        DELETE FROM visit_appointments WHERE room_id = ?
                    `, [roomId], function(err) {
                        if (err) {
                            console.error('❌ Erreur suppression rendez-vous visite:', err);
                        } else {
                            console.log(`🗑️ ${this.changes} rendez-vous visite supprimés`);
                            deletedCount += this.changes;
                        }
                    });
                    
                    // 3. Supprimer les messages
                    this.db.run(`
                        DELETE FROM messages WHERE room = ?
                    `, [roomId], function(err) {
                        if (err) {
                            console.error('❌ Erreur suppression messages:', err);
                        } else {
                            deletedCount += this.changes;
                        }
                    });
                    
                    // 4. Supprimer la liaison annonce-conversation
                    this.db.run(`
                        DELETE FROM conversation_announcements 
                        WHERE announcement_id = ? AND buyer_id = ? AND seller_id = ?
                    `, [announcementId, buyerId, sellerId], function(err) {
                        if (err) {
                            console.error('❌ Erreur suppression liaison:', err);
                            resolve({ success: false, error: err.message });
                        } else {
                            deletedCount += this.changes;
                            
                            resolve({ 
                                success: true, 
                                deletedCount: deletedCount,
                                message: `Conversation supprimée: ${deletedCount} éléments supprimés`
                            });
                        }
                    });
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

module.exports = OfferService;




