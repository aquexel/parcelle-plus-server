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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        this.db.run(createPolygonsTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table polygons:', err);
            } else {
                console.log('✅ Table polygons initialisée');
            }
        });
    }

    async getAllPolygons(userId = null, limit = 100) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT 
                    id, user_id, title, description, coordinates, surface, 
                    commune, code_insee, price, status, created_at, updated_at, is_public
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
                    commune, code_insee, price, status, created_at, updated_at, is_public
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
                    commune, code_insee, price, status, created_at, updated_at
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
                        coordinates: JSON.parse(row.coordinates)
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
                    id, user_id, title, description, price, area, coordinates, 
                    location, status, commune, code_insee, surface, created_at, updated_at, is_public
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                id,
                polygonData.userId || 'anonymous',
                polygonData.title || 'Nouvelle parcelle',
                polygonData.description || '',
                polygonData.price || 0,
                polygonData.area || polygonData.surface || 0,
                JSON.stringify(polygonData.coordinates),
                polygonData.location || polygonData.commune || '',
                polygonData.status || 'active',
                polygonData.commune || '',
                polygonData.codeInsee || '',
                polygonData.surface || polygonData.area || 0,
                now,
                now,
                polygonData.isPublic !== undefined ? (polygonData.isPublic ? 1 : 0) : 1 // Default public
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
                    // Récupérer le polygone mis à jour
                    resolve({ id, ...updateData, updatedAt: now });
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
                    commune, code_insee, price, status, created_at, updated_at
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
                        coordinates: JSON.parse(row.coordinates)
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
                    commune, code_insee, price, status, created_at, updated_at
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