const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Service de distribution P2P des photos
 * Gère le tracking des clients ayant les photos et la découverte des sources
 */
class PhotoDistributionService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', 'parcelle_business.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.initializeDatabase();
        
        // Configuration
        this.MIN_CLIENTS_BEFORE_CLEANUP = 3; // Nombre minimum de clients ayant les photos avant nettoyage serveur
        this.CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 heures en millisecondes
        
        // Démarrer le nettoyage périodique
        this.startCleanupScheduler();
    }
    
    initializeDatabase() {
        // Table pour tracker quels clients ont quelles photos avec versioning
        const createPhotoClientsTable = `
            CREATE TABLE IF NOT EXISTS photo_clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                announcement_id TEXT NOT NULL,
                photo_index INTEGER NOT NULL,
                client_user_id TEXT NOT NULL,
                has_photo INTEGER DEFAULT 1,
                is_seller INTEGER DEFAULT 0,
                is_server INTEGER DEFAULT 0,
                photo_version TEXT DEFAULT '1',
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (announcement_id) REFERENCES polygons(id) ON DELETE CASCADE,
                UNIQUE(announcement_id, photo_index, client_user_id)
            )
        `;
        
        // Table pour tracker les versions de photos
        const createPhotoVersionsTable = `
            CREATE TABLE IF NOT EXISTS photo_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                announcement_id TEXT NOT NULL,
                photo_index INTEGER NOT NULL,
                version TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_current INTEGER DEFAULT 1,
                FOREIGN KEY (announcement_id) REFERENCES polygons(id) ON DELETE CASCADE,
                UNIQUE(announcement_id, photo_index, version)
            )
        `;
        
        // Table pour les demandes silencieuses de photos (P2P)
        const createPhotoRequestsTable = `
            CREATE TABLE IF NOT EXISTS photo_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                announcement_id TEXT NOT NULL,
                photo_index INTEGER NOT NULL,
                requested_from_user_id TEXT NOT NULL,
                requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                fulfilled INTEGER DEFAULT 0,
                fulfilled_at DATETIME,
                FOREIGN KEY (announcement_id) REFERENCES polygons(id) ON DELETE CASCADE,
                UNIQUE(announcement_id, photo_index, requested_from_user_id)
            )
        `;
        
        // Index pour améliorer les performances
        const createIndexes = [
            `CREATE INDEX IF NOT EXISTS idx_photo_clients_announcement ON photo_clients(announcement_id, photo_index)`,
            `CREATE INDEX IF NOT EXISTS idx_photo_clients_client ON photo_clients(client_user_id)`,
            `CREATE INDEX IF NOT EXISTS idx_photo_clients_last_seen ON photo_clients(last_seen)`,
            `CREATE INDEX IF NOT EXISTS idx_photo_clients_version ON photo_clients(announcement_id, photo_index, photo_version)`,
            `CREATE INDEX IF NOT EXISTS idx_photo_versions_announcement ON photo_versions(announcement_id, photo_index)`,
            `CREATE INDEX IF NOT EXISTS idx_photo_versions_current ON photo_versions(announcement_id, photo_index, is_current)`,
            `CREATE INDEX IF NOT EXISTS idx_photo_requests_user ON photo_requests(requested_from_user_id, fulfilled)`,
            `CREATE INDEX IF NOT EXISTS idx_photo_requests_announcement ON photo_requests(announcement_id, photo_index)`
        ];
        
        this.db.run(createPhotoClientsTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table photo_clients:', err);
            } else {
                
                // Créer la table des versions
                this.db.run(createPhotoVersionsTable, (err) => {
                    if (err) {
                        console.error('❌ Erreur création table photo_versions:', err);
                    } else {
                        
                        // Créer la table des demandes silencieuses
                        this.db.run(createPhotoRequestsTable, (err) => {
                            if (err) {
                                console.error('❌ Erreur création table photo_requests:', err);
                            } else {
                                
                                // Créer les index
                                createIndexes.forEach(indexQuery => {
                                    this.db.run(indexQuery, (err) => {
                                        if (err && !err.message.includes('already exists')) {
                                            console.error('❌ Erreur création index:', err);
                                        }
                                    });
                                });
                                
                                // Ajouter la colonne photo_version si elle n'existe pas (migration)
                                this.db.run(`ALTER TABLE photo_clients ADD COLUMN photo_version TEXT DEFAULT '1'`, (err) => {
                                    if (err && !err.message.includes('duplicate column')) {
                                        // Colonne existe déjà, pas de problème
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    }
    
    /**
     * Enregistre qu'un client (vendeur ou serveur) a uploadé une photo
     * @param photoVersion Version de la photo (timestamp ou numéro de version)
     */
    registerPhotoSource(announcementId, photoIndex, userId, isSeller = false, isServer = false, photoVersion = null) {
        return new Promise((resolve, reject) => {
            // Obtenir la version actuelle ou générer une nouvelle
            this.getCurrentPhotoVersion(announcementId, photoIndex).then(currentVersion => {
                const version = photoVersion || currentVersion || Date.now().toString();
                
                // Si c'est une nouvelle version (mise à jour), créer une nouvelle entrée de version
                if (photoVersion && photoVersion !== currentVersion) {
                    this.createNewPhotoVersion(announcementId, photoIndex, version, userId).then(() => {
                        this.insertPhotoClient(announcementId, photoIndex, userId, isSeller, isServer, version, resolve, reject);
                    }).catch(reject);
                } else {
                    this.insertPhotoClient(announcementId, photoIndex, userId, isSeller, isServer, version, resolve, reject);
                }
            }).catch(reject);
        });
    }
    
    /**
     * Insère ou met à jour un client photo
     */
    insertPhotoClient(announcementId, photoIndex, userId, isSeller, isServer, version, resolve, reject) {
        const query = `
            INSERT OR REPLACE INTO photo_clients 
            (announcement_id, photo_index, client_user_id, has_photo, is_seller, is_server, photo_version, last_seen)
            VALUES (?, ?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        this.db.run(query, [announcementId, photoIndex, userId, isSeller ? 1 : 0, isServer ? 1 : 0, version], (err) => {
            if (err) {
                console.error('❌ Erreur enregistrement source photo:', err);
                reject(err);
            } else {
                resolve(version);
            }
        });
    }
    
    /**
     * Crée une nouvelle version de photo
     */
    createNewPhotoVersion(announcementId, photoIndex, version, updatedBy) {
        return new Promise((resolve, reject) => {
            // Marquer toutes les anciennes versions comme non courantes
            const markOldQuery = `
                UPDATE photo_versions
                SET is_current = 0
                WHERE announcement_id = ? AND photo_index = ? AND is_current = 1
            `;
            
            this.db.run(markOldQuery, [announcementId, photoIndex], (err) => {
                if (err) {
                    console.error('❌ Erreur marquage anciennes versions:', err);
                    reject(err);
                    return;
                }
                
                // Créer la nouvelle version
                const insertQuery = `
                    INSERT OR REPLACE INTO photo_versions
                    (announcement_id, photo_index, version, updated_by, updated_at, is_current)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
                `;
                
                this.db.run(insertQuery, [announcementId, photoIndex, version, updatedBy], (err) => {
                    if (err) {
                        console.error('❌ Erreur création version photo:', err);
                        reject(err);
                    } else {
                        
                        // Notifier les clients qui ont une ancienne version
                        this.notifyClientsOfPhotoUpdate(announcementId, photoIndex, version);
                        resolve(version);
                    }
                });
            });
        });
    }
    
    /**
     * Obtient la version actuelle d'une photo
     */
    getCurrentPhotoVersion(announcementId, photoIndex) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT version FROM photo_versions
                WHERE announcement_id = ? AND photo_index = ? AND is_current = 1
                ORDER BY updated_at DESC
                LIMIT 1
            `;
            
            this.db.get(query, [announcementId, photoIndex], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? row.version : null);
                }
            });
        });
    }
    
    /**
     * Vérifie si un client a la dernière version d'une photo
     */
    hasLatestPhotoVersion(announcementId, photoIndex, userId) {
        return new Promise((resolve, reject) => {
            Promise.all([
                this.getCurrentPhotoVersion(announcementId, photoIndex),
                new Promise((res, rej) => {
                    const query = `
                        SELECT photo_version FROM photo_clients
                        WHERE announcement_id = ? AND photo_index = ? AND client_user_id = ? AND has_photo = 1
                    `;
                    this.db.get(query, [announcementId, photoIndex, userId], (err, row) => {
                        if (err) rej(err);
                        else res(row ? row.photo_version : null);
                    });
                })
            ]).then(([currentVersion, clientVersion]) => {
                resolve(currentVersion === clientVersion);
            }).catch(reject);
        });
    }
    
    /**
     * Obtient la liste des clients qui ont besoin de mettre à jour leur photo
     */
    getClientsNeedingUpdate(announcementId, photoIndex, currentVersion) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT DISTINCT client_user_id
                FROM photo_clients
                WHERE announcement_id = ? AND photo_index = ? AND has_photo = 1
                AND (photo_version IS NULL OR photo_version != ?)
            `;
            
            this.db.all(query, [announcementId, photoIndex, currentVersion], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows.map(row => row.client_user_id));
                }
            });
        });
    }
    
    /**
     * Notifie les clients d'une mise à jour de photo (pour future implémentation WebSocket)
     */
    notifyClientsOfPhotoUpdate(announcementId, photoIndex, newVersion) {
        this.getClientsNeedingUpdate(announcementId, photoIndex, newVersion).then(clientIds => {
            if (clientIds.length > 0) {
                // TODO: Implémenter notification WebSocket ou push notification
            }
        }).catch(err => {
            console.error('❌ Erreur notification clients:', err);
        });
    }
    
    /**
     * Enregistre qu'un client a téléchargé et stocké une photo localement
     */
    registerPhotoClient(announcementId, photoIndex, userId) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT OR REPLACE INTO photo_clients 
                (announcement_id, photo_index, client_user_id, has_photo, is_seller, is_server, last_seen)
                VALUES (?, ?, ?, 1, 0, 0, CURRENT_TIMESTAMP)
            `;
            
            this.db.run(query, [announcementId, photoIndex, userId], (err) => {
                if (err) {
                    console.error('❌ Erreur enregistrement client photo:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    
    /**
     * Trouve les meilleures sources pour télécharger une photo
     * Retourne les sources triées par priorité (serveur > vendeur > autres clients)
     */
    findPhotoSources(announcementId, photoIndex, excludeUserId = null) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT client_user_id, is_seller, is_server, last_seen
                FROM photo_clients
                WHERE announcement_id = ? AND photo_index = ? AND has_photo = 1
            `;
            
            const params = [announcementId, photoIndex];
            
            if (excludeUserId) {
                query += ` AND client_user_id != ?`;
                params.push(excludeUserId);
            }
            
            query += ` ORDER BY is_server DESC, is_seller DESC, last_seen DESC`;
            
            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Erreur recherche sources photo:', err);
                    reject(err);
                } else {
                    const sources = rows.map(row => ({
                        userId: row.client_user_id,
                        isSeller: row.is_seller === 1,
                        isServer: row.is_server === 1,
                        lastSeen: row.last_seen
                    }));
                    resolve(sources);
                }
            });
        });
    }
    
    /**
     * Compte le nombre de clients ayant une photo spécifique (sans compter le serveur)
     * Le vendeur est compté comme client et conserve toujours ses photos
     */
    countPhotoClients(announcementId, photoIndex) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT COUNT(*) as count
                FROM photo_clients
                WHERE announcement_id = ? AND photo_index = ? AND has_photo = 1 AND is_server = 0
            `;
            
            this.db.get(query, [announcementId, photoIndex], (err, row) => {
                if (err) {
                    console.error('❌ Erreur comptage clients photo:', err);
                    reject(err);
                } else {
                    // Le vendeur est toujours compté et conserve ses photos
                    resolve(row ? row.count : 0);
                }
            });
        });
    }
    
    /**
     * Vérifie si le serveur peut supprimer une photo (assez de clients l'ont)
     */
    canCleanupServerPhoto(announcementId, photoIndex) {
        return new Promise((resolve, reject) => {
            this.countPhotoClients(announcementId, photoIndex).then(count => {
                resolve(count >= this.MIN_CLIENTS_BEFORE_CLEANUP);
            }).catch(reject);
        });
    }
    
    /**
     * Marque une photo comme supprimée du serveur
     */
    markServerPhotoRemoved(announcementId, photoIndex) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE photo_clients
                SET has_photo = 0, last_seen = CURRENT_TIMESTAMP
                WHERE announcement_id = ? AND photo_index = ? AND is_server = 1
            `;
            
            this.db.run(query, [announcementId, photoIndex], (err) => {
                if (err) {
                    console.error('❌ Erreur marquage photo serveur supprimée:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    
    /**
     * Mise à jour du last_seen pour un client (heartbeat)
     */
    updateClientHeartbeat(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE photo_clients
                SET last_seen = CURRENT_TIMESTAMP
                WHERE client_user_id = ? AND has_photo = 1
            `;
            
            this.db.run(query, [userId], (err) => {
                if (err) {
                    console.error('❌ Erreur heartbeat client:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    
    /**
     * Compte le nombre de photos disponibles pour une annonce (via P2P)
     * Retourne le nombre de photo_index distincts qui ont au moins une source
     */
    getAnnouncementPhotoCount(announcementId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT COUNT(DISTINCT photo_index) as count
                FROM photo_clients
                WHERE announcement_id = ? AND has_photo = 1
            `;
            
            this.db.get(query, [announcementId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur comptage photos annonce:', err);
                    reject(err);
                } else {
                    resolve(row ? row.count : 0);
                }
            });
        });
    }
    
    /**
     * Nettoyage automatique : supprime les photos du serveur si assez de clients les ont
     * IMPORTANT: Le vendeur conserve toujours ses photos localement et reste une source
     */
    async cleanupOldPhotos() {
        try {
            
            // Récupérer toutes les photos du serveur (pas les vendeurs - ils gardent toujours leurs photos)
            const query = `
                SELECT DISTINCT announcement_id, photo_index
                FROM photo_clients
                WHERE is_server = 1 AND has_photo = 1
            `;
            
            this.db.all(query, [], async (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération photos serveur:', err);
                    return;
                }
                
                let cleanedCount = 0;
                
                for (const row of rows) {
                    const canCleanup = await this.canCleanupServerPhoto(row.announcement_id, row.photo_index);
                    if (canCleanup) {
                        // Vérifier qu'il reste au moins une source (vendeur ou autre client)
                        const sources = await this.findPhotoSources(row.announcement_id, row.photo_index, 'server');
                        if (sources.length > 0) {
                            // Il y a d'autres sources (vendeur, clients), on peut supprimer du serveur
                            // Marquer comme supprimé (le fichier sera supprimé par le serveur)
                            await this.markServerPhotoRemoved(row.announcement_id, row.photo_index);
                            cleanedCount++;
                        } else {
                        }
                    }
                }
                
                if (cleanedCount > 0) {
                } else {
                }
            });
        } catch (error) {
            console.error('❌ Erreur nettoyage automatique:', error);
        }
    }
    
    /**
     * Enregistre une demande silencieuse de photo (P2P)
     */
    registerSilentPhotoRequest(announcementId, photoIndex, requestedFromUserId) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT OR IGNORE INTO photo_requests 
                (announcement_id, photo_index, requested_from_user_id, requested_at, fulfilled)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
            `;
            
            this.db.run(query, [announcementId, photoIndex, requestedFromUserId], function(err) {
                if (err) {
                    console.error('❌ Erreur enregistrement demande silencieuse:', err);
                    reject(err);
                } else {
                    if (this.changes > 0) {
                    }
                    resolve(this.changes > 0);
                }
            });
        });
    }
    
    /**
     * Récupère les demandes de photos en attente pour un utilisateur
     */
    getPendingPhotoRequests(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT pr.announcement_id, pr.photo_index, pr.requested_at
                FROM photo_requests pr
                INNER JOIN photo_clients pc ON 
                    pc.announcement_id = pr.announcement_id AND 
                    pc.photo_index = pr.photo_index AND
                    pc.client_user_id = pr.requested_from_user_id AND
                    pc.has_photo = 1
                WHERE pr.requested_from_user_id = ? AND pr.fulfilled = 0
                ORDER BY pr.requested_at ASC
            `;
            
            this.db.all(query, [userId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération demandes silencieuses:', err);
                    reject(err);
                } else {
                    resolve(rows.map(row => ({
                        announcementId: row.announcement_id,
                        photoIndex: row.photo_index,
                        requestedAt: row.requested_at
                    })));
                }
            });
        });
    }
    
    /**
     * Marque une demande comme satisfaite
     */
    markRequestFulfilled(announcementId, photoIndex, userId) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE photo_requests 
                SET fulfilled = 1, fulfilled_at = CURRENT_TIMESTAMP
                WHERE announcement_id = ? AND photo_index = ? AND requested_from_user_id = ?
            `;
            
            this.db.run(query, [announcementId, photoIndex, userId], function(err) {
                if (err) {
                    console.error('❌ Erreur marquage demande comme satisfaite:', err);
                    reject(err);
                } else {
                    resolve(this.changes > 0);
                }
            });
        });
    }
    
    /**
     * Démarre le scheduler de nettoyage périodique
     */
    startCleanupScheduler() {
        // Nettoyage toutes les 24h
        setInterval(() => {
            this.cleanupOldPhotos();
        }, this.CLEANUP_INTERVAL);
        
        // Premier nettoyage après 1h
        setTimeout(() => {
            this.cleanupOldPhotos();
        }, 60 * 60 * 1000);
        
    }
}

module.exports = PhotoDistributionService;
