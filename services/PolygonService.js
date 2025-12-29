const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class PolygonService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', 'parcelle_business.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.initializeDatabase();
    }

    initializeDatabase() {
        const createPolygonsTable = `
            CREATE TABLE IF NOT EXISTS polygons (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                price REAL,
                area REAL,
                coordinates TEXT NOT NULL,
                location TEXT,
                status TEXT DEFAULT 'active',
                commune TEXT,
                code_insee TEXT,
                surface REAL,
                zone_plu TEXT DEFAULT '',
                orientation TEXT,
                luminosite REAL,
                surface_maison REAL,
                nombre_pieces INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        // Table pour comptabiliser les vues d'annonces
        const createAnnouncementViewsTable = `
            CREATE TABLE IF NOT EXISTS announcement_views (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                announcement_id TEXT NOT NULL,
                viewer_id TEXT NOT NULL,
                viewer_type TEXT NOT NULL,
                viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (announcement_id) REFERENCES polygons(id) ON DELETE CASCADE
            )
        `;

        // Index pour améliorer les performances des requêtes
        const createViewsIndexes = [
            `CREATE INDEX IF NOT EXISTS idx_views_announcement ON announcement_views(announcement_id)`,
            `CREATE INDEX IF NOT EXISTS idx_views_viewer ON announcement_views(viewer_id)`,
            `CREATE INDEX IF NOT EXISTS idx_views_date ON announcement_views(viewed_at)`
        ];

        this.db.run(createPolygonsTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table polygons:', err);
            } else {
                console.log('✅ Table polygons initialisée');
                // Ajouter les colonnes si elles n'existent pas déjà
                this.db.run(`ALTER TABLE polygons ADD COLUMN zone_plu TEXT DEFAULT ''`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error('⚠️ Note: colonne zone_plu probablement déjà existante');
                    } else if (!err) {
                        console.log('✅ Colonne zone_plu ajoutée');
                    }
                });
                
                this.db.run(`ALTER TABLE polygons ADD COLUMN orientation TEXT`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        // Ignorer si la colonne existe déjà
                    } else if (!err) {
                        console.log('✅ Colonne orientation ajoutée');
                    }
                });
                
                this.db.run(`ALTER TABLE polygons ADD COLUMN luminosite REAL`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        // Ignorer si la colonne existe déjà
                    } else if (!err) {
                        console.log('✅ Colonne luminosite ajoutée');
                    }
                });
                
                this.db.run(`ALTER TABLE polygons ADD COLUMN surface_maison REAL`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        // Ignorer si la colonne existe déjà
                    } else if (!err) {
                        console.log('✅ Colonne surface_maison ajoutée');
                    }
                });
                
                this.db.run(`ALTER TABLE polygons ADD COLUMN nombre_pieces INTEGER`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        // Ignorer si la colonne existe déjà
                    } else if (!err) {
                        console.log('✅ Colonne nombre_pieces ajoutée');
                    }
                });
                
                this.db.run(`ALTER TABLE polygons ADD COLUMN type TEXT DEFAULT 'TERRAIN'`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        // Ignorer si la colonne existe déjà
                    } else if (!err) {
                        console.log('✅ Colonne type ajoutée');
                    }
                });
                
                this.db.run(`ALTER TABLE polygons ADD COLUMN classe_dpe TEXT`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        // Ignorer si la colonne existe déjà
                    } else if (!err) {
                        console.log('✅ Colonne classe_dpe ajoutée');
                    }
                });
            }
        });

        // Créer la table des vues
        this.db.run(createAnnouncementViewsTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table announcement_views:', err);
            } else {
                console.log('✅ Table announcement_views initialisée');
                // Créer les index
                createViewsIndexes.forEach(indexQuery => {
                    this.db.run(indexQuery, (err) => {
                        if (err) {
                            console.error('❌ Erreur création index:', err);
                        }
                    });
                });
            }
        });
    }

    async getAllPolygons(userId = null, limit = 100) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT 
                    id, user_id, title, description, coordinates, surface, 
                    commune, code_insee, price, status, created_at, updated_at, is_public, zone_plu,
                    orientation, luminosite, surface_maison, nombre_pieces, type, classe_dpe
                FROM polygons
            `;
            let params = [];

            if (userId) {
                query += ` WHERE user_id = ?`;
                params.push(userId);
            }

            query += ` ORDER BY created_at DESC LIMIT ?`;
            params.push(limit);

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération polygones:', err);
                    reject(err);
                } else {
                    const polygons = rows.map(row => ({
                        ...row,
                        coordinates: JSON.parse(row.coordinates),
                        isPublic: row.is_public === 1
                    }));
                    console.log(`✅ ${polygons.length} polygones récupérés`);
                    resolve(polygons);
                }
            });
        });
    }

    async getPublicPolygons(limit = 100) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, user_id, title, description, coordinates, surface, 
                    commune, code_insee, price, status, created_at, updated_at, is_public, zone_plu,
                    orientation, luminosite, surface_maison, nombre_pieces, type, classe_dpe
                FROM polygons
                WHERE is_public = 1 AND status = 'available'
                ORDER BY created_at DESC 
                LIMIT ?
            `;

            this.db.all(query, [limit], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération polygones publics:', err);
                    reject(err);
                } else {
                    const polygons = rows.map(row => ({
                        ...row,
                        coordinates: JSON.parse(row.coordinates),
                        isPublic: true
                    }));
                    console.log(`✅ ${polygons.length} polygones publics récupérés`);
                    resolve(polygons);
                }
            });
        });
    }

    async getPolygonById(id) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, user_id, title, description, coordinates, surface, 
                    commune, code_insee, price, status, created_at, updated_at, zone_plu,
                    orientation, luminosite, surface_maison, nombre_pieces, is_public, type, classe_dpe
                FROM polygons 
                WHERE id = ?
            `;

            this.db.get(query, [id], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération polygone:', err);
                    reject(err);
                } else if (row) {
                    const polygon = {
                        ...row,
                        coordinates: JSON.parse(row.coordinates),
                        isPublic: row.is_public === 1
                    };
                    console.log(`✅ Polygone récupéré: ${id}`);
                    resolve(polygon);
                } else {
                    console.log(`⚠️ Polygone non trouvé: ${id}`);
                    resolve(null);
                }
            });
        });
    }

    async savePolygon(polygonData) {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            const now = new Date().toISOString();
            
            const query = `
                INSERT INTO polygons (
                    id, user_id, title, description, price, coordinates, 
                    status, commune, code_insee, surface, created_at, updated_at, is_public, zone_plu,
                    orientation, luminosite, surface_maison, nombre_pieces, type, classe_dpe
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                id,
                polygonData.userId || 'anonymous',
                polygonData.title || 'Nouvelle parcelle',
                polygonData.description || '',
                polygonData.price || 0,
                JSON.stringify(polygonData.coordinates),
                polygonData.status || 'available',
                polygonData.commune || '',
                polygonData.codeInsee || '',
                polygonData.surface || polygonData.area || 0,
                now,
                now,
                polygonData.isPublic !== undefined ? (polygonData.isPublic ? 1 : 0) : 1, // Default public
                polygonData.zonePlu || '',
                polygonData.orientation || null,
                polygonData.luminosite !== undefined ? polygonData.luminosite : null,
                polygonData.surfaceMaison !== undefined ? polygonData.surfaceMaison : null,
                polygonData.nombrePieces !== undefined ? polygonData.nombrePieces : null,
                polygonData.type || 'TERRAIN',
                polygonData.classeDpe || null
            ];

            this.db.run(query, params, function(err) {
                if (err) {
                    console.error('❌ Erreur sauvegarde polygone:', err);
                    reject(err);
                } else {
                    const savedPolygon = {
                        id,
                        userId: polygonData.userId || 'anonymous',
                        title: polygonData.title || 'Nouvelle parcelle',
                        description: polygonData.description || '',
                        coordinates: Array.isArray(polygonData.coordinates) ? polygonData.coordinates : JSON.parse(polygonData.coordinates || '[]'),
                        surface: polygonData.surface || 0,
                        commune: polygonData.commune || '',
                        codeInsee: polygonData.codeInsee || '',
                        price: polygonData.price || 0,
                        status: polygonData.status || 'available',
                        isPublic: polygonData.isPublic !== undefined ? polygonData.isPublic : true,
                        zonePlu: polygonData.zonePlu || '',
                        orientation: polygonData.orientation || null,
                        luminosite: polygonData.luminosite !== undefined ? polygonData.luminosite : null,
                        surfaceMaison: polygonData.surfaceMaison !== undefined ? polygonData.surfaceMaison : null,
                        nombrePieces: polygonData.nombrePieces !== undefined ? polygonData.nombrePieces : null,
                        type: polygonData.type || 'TERRAIN',
                        createdAt: now,
                        updatedAt: now
                    };
                    
                    console.log(`✅ Polygone sauvegardé: ${id} (${savedPolygon.surface}m²)`);
                    resolve(savedPolygon);
                }
            });
        });
    }

    async updatePolygon(id, updateData) {
        return new Promise((resolve, reject) => {
            const self = this;
            const now = new Date().toISOString();
            
            // Construire la requête dynamiquement
            const updateFields = [];
            const params = [];
            
            if (updateData.title !== undefined) {
                updateFields.push('title = ?');
                params.push(updateData.title);
            }
            if (updateData.description !== undefined) {
                updateFields.push('description = ?');
                params.push(updateData.description);
            }
            if (updateData.coordinates !== undefined) {
                updateFields.push('coordinates = ?');
                params.push(JSON.stringify(updateData.coordinates));
            }
            if (updateData.surface !== undefined) {
                updateFields.push('surface = ?');
                params.push(updateData.surface);
            }
            if (updateData.commune !== undefined) {
                updateFields.push('commune = ?');
                params.push(updateData.commune);
            }
            if (updateData.codeInsee !== undefined) {
                updateFields.push('code_insee = ?');
                params.push(updateData.codeInsee);
            }
            if (updateData.price !== undefined) {
                updateFields.push('price = ?');
                params.push(updateData.price);
            }
            if (updateData.status !== undefined) {
                updateFields.push('status = ?');
                params.push(updateData.status);
            }
            if (updateData.isPublic !== undefined) {
                updateFields.push('is_public = ?');
                params.push(updateData.isPublic ? 1 : 0);
            }
            if (updateData.zonePlu !== undefined) {
                updateFields.push('zone_plu = ?');
                params.push(updateData.zonePlu);
            }
            if (updateData.orientation !== undefined) {
                updateFields.push('orientation = ?');
                params.push(updateData.orientation);
            }
            if (updateData.luminosite !== undefined) {
                updateFields.push('luminosite = ?');
                params.push(updateData.luminosite);
            }
            if (updateData.surfaceMaison !== undefined) {
                updateFields.push('surface_maison = ?');
                params.push(updateData.surfaceMaison);
            }
            if (updateData.nombrePieces !== undefined) {
                updateFields.push('nombre_pieces = ?');
                params.push(updateData.nombrePieces);
            }
            if (updateData.type !== undefined) {
                updateFields.push('type = ?');
                params.push(updateData.type);
            }
            
            updateFields.push('updated_at = ?');
            params.push(now);
            params.push(id);
            
            const query = `
                UPDATE polygons 
                SET ${updateFields.join(', ')} 
                WHERE id = ?
            `;

            this.db.run(query, params, function(err) {
                if (err) {
                    console.error('❌ Erreur mise à jour polygone:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    console.log(`⚠️ Polygone non trouvé pour mise à jour: ${id}`);
                    resolve(null);
                } else {
                    console.log(`✅ Polygone mis à jour: ${id}`);
                    // Récupérer le polygone mis à jour depuis la base
                    self.getPolygonById(id).then(resolve).catch(reject);
                }
            });
        });
    }

    async deletePolygon(id) {
        return new Promise((resolve, reject) => {
            const query = `DELETE FROM polygons WHERE id = ?`;

            this.db.run(query, [id], function(err) {
                if (err) {
                    console.error('❌ Erreur suppression polygone:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    console.log(`⚠️ Polygone non trouvé pour suppression: ${id}`);
                    resolve(false);
                } else {
                    console.log(`✅ Polygone supprimé: ${id}`);
                    resolve(true);
                }
            });
        });
    }

    async getPolygonsByUser(userId, limit = 100) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, user_id, title, description, coordinates, surface, 
                    commune, code_insee, price, status, created_at, updated_at, is_public, zone_plu,
                    orientation, luminosite, surface_maison, nombre_pieces, type
                FROM polygons 
                WHERE user_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `;

            this.db.all(query, [userId, limit], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération polygones utilisateur:', err);
                    reject(err);
                } else {
                    const polygons = rows.map(row => ({
                        ...row,
                        coordinates: JSON.parse(row.coordinates),
                        isPublic: row.is_public === 1
                    }));
                    console.log(`✅ ${polygons.length} polygones récupérés pour l'utilisateur ${userId}`);
                    resolve(polygons);
                }
            });
        });
    }

    async getPolygonsByCommune(commune, limit = 50) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    id, user_id, title, description, coordinates, surface, 
                    commune, code_insee, price, status, created_at, updated_at, zone_plu,
                    orientation, luminosite, surface_maison, nombre_pieces, is_public, type
                FROM polygons 
                WHERE commune LIKE ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `;

            this.db.all(query, [`%${commune}%`, limit], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération polygones commune:', err);
                    reject(err);
                } else {
                    const polygons = rows.map(row => ({
                        ...row,
                        coordinates: JSON.parse(row.coordinates)
                    }));
                    console.log(`✅ ${polygons.length} polygones récupérés pour la commune ${commune}`);
                    resolve(polygons);
                }
            });
        });
    }

    async getStats() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total_polygons,
                    COUNT(DISTINCT user_id) as unique_users,
                    AVG(surface) as avg_surface,
                    SUM(surface) as total_surface,
                    MIN(surface) as min_surface,
                    MAX(surface) as max_surface
                FROM polygons
            `;

            this.db.get(query, [], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération statistiques:', err);
                    reject(err);
                } else {
                    console.log('✅ Statistiques récupérées');
                    resolve(row);
                }
            });
        });
    }

    // ========== GESTION DES VUES D'ANNONCES ==========

    /**
     * Enregistrer une vue d'annonce par un acheteur
     */
    async recordView(announcementId, viewerId, viewerType = 'buyer') {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO announcement_views (announcement_id, viewer_id, viewer_type)
                VALUES (?, ?, ?)
            `;

            this.db.run(query, [announcementId, viewerId, viewerType], function(err) {
                if (err) {
                    console.error('❌ Erreur enregistrement vue:', err);
                    reject(err);
                } else {
                    console.log(`✅ Vue enregistrée: annonce ${announcementId} par ${viewerId}`);
                    resolve({ id: this.lastID, announcementId, viewerId, viewerType });
                }
            });
        });
    }

    /**
     * Récupérer le nombre de vues pour une annonce spécifique
     */
    async getAnnouncementViews(announcementId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total_views,
                    COUNT(DISTINCT viewer_id) as unique_viewers,
                    MAX(viewed_at) as last_viewed
                FROM announcement_views
                WHERE announcement_id = ?
            `;

            this.db.get(query, [announcementId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur récupération vues annonce:', err);
                    reject(err);
                } else {
                    console.log(`✅ Statistiques vues pour annonce ${announcementId}: ${row.total_views} vues, ${row.unique_viewers} visiteurs uniques`);
                    resolve({
                        announcementId,
                        totalViews: row.total_views || 0,
                        uniqueViewers: row.unique_viewers || 0,
                        lastViewed: row.last_viewed
                    });
                }
            });
        });
    }

    /**
     * Récupérer les statistiques de toutes les annonces d'un vendeur
     */
    async getSellerStats(sellerId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    p.id,
                    p.title,
                    p.price,
                    p.surface,
                    p.commune,
                    p.status,
                    p.created_at,
                    COUNT(av.id) as total_views,
                    COUNT(DISTINCT av.viewer_id) as unique_viewers,
                    MAX(av.viewed_at) as last_viewed
                FROM polygons p
                LEFT JOIN announcement_views av ON p.id = av.announcement_id
                WHERE p.user_id = ?
                GROUP BY p.id
                ORDER BY p.created_at DESC
            `;

            this.db.all(query, [sellerId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération statistiques vendeur:', err);
                    reject(err);
                } else {
                    const stats = rows.map(row => ({
                        announcementId: row.id,
                        title: row.title,
                        price: row.price,
                        surface: row.surface,
                        commune: row.commune,
                        status: row.status,
                        createdAt: row.created_at,
                        totalViews: row.total_views || 0,
                        uniqueViewers: row.unique_viewers || 0,
                        lastViewed: row.last_viewed
                    }));

                    const totalStats = {
                        totalAnnouncements: stats.length,
                        totalViews: stats.reduce((sum, s) => sum + s.totalViews, 0),
                        totalUniqueViewers: stats.reduce((sum, s) => sum + s.uniqueViewers, 0),
                        announcements: stats
                    };

                    console.log(`✅ Statistiques vendeur ${sellerId}: ${totalStats.totalAnnouncements} annonces, ${totalStats.totalViews} vues totales`);
                    resolve(totalStats);
                }
            });
        });
    }

    /**
     * Vérifier si un utilisateur a déjà vu une annonce (pour éviter les doublons)
     */
    async hasViewed(announcementId, viewerId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT COUNT(*) as count
                FROM announcement_views
                WHERE announcement_id = ? AND viewer_id = ?
            `;

            this.db.get(query, [announcementId, viewerId], (err, row) => {
                if (err) {
                    console.error('❌ Erreur vérification vue:', err);
                    reject(err);
                } else {
                    resolve(row.count > 0);
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

module.exports = PolygonService; 