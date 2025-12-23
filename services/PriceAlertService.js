const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class PriceAlertService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', 'parcelle_business.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.initializeDatabase();
    }

    initializeDatabase() {
        // Utiliser serialize() pour garantir l'ordre d'exécution
        this.db.serialize(() => {
            // Table pour les alertes de prix
            const createAlertsTable = `
                CREATE TABLE IF NOT EXISTS price_alerts (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    min_surface REAL NOT NULL,
                    max_surface REAL NOT NULL,
                    max_price REAL NOT NULL,
                    commune TEXT,
                    code_insee TEXT,
                    is_active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `;

            // Table pour suivre les annonces déjà notifiées
            const createNotifiedTable = `
                CREATE TABLE IF NOT EXISTS alert_notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    alert_id TEXT NOT NULL,
                    announcement_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    notified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (alert_id) REFERENCES price_alerts(id) ON DELETE CASCADE,
                    FOREIGN KEY (announcement_id) REFERENCES polygons(id) ON DELETE CASCADE,
                    UNIQUE(alert_id, announcement_id)
                )
            `;

            // Index pour améliorer les performances
            const createIndexes = [
                `CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts(user_id)`,
                `CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(is_active)`,
                `CREATE INDEX IF NOT EXISTS idx_notified_alert ON alert_notifications(alert_id)`,
                `CREATE INDEX IF NOT EXISTS idx_notified_announcement ON alert_notifications(announcement_id)`
            ];

            // Créer les tables d'abord, puis les index dans les callbacks
            this.db.run(createAlertsTable, (err) => {
                if (err) {
                    console.error('❌ Erreur création table price_alerts:', err);
                } else {
                    console.log('✅ Table price_alerts initialisée');
                    
                    // Créer la deuxième table après la première
                    this.db.run(createNotifiedTable, (err) => {
                        if (err) {
                            console.error('❌ Erreur création table alert_notifications:', err);
                        } else {
                            console.log('✅ Table alert_notifications initialisée');
                            
                            // Créer les index APRÈS que les deux tables soient créées
                            createIndexes.forEach(indexQuery => {
                                this.db.run(indexQuery, (err) => {
                                    if (err && !err.message.includes('already exists') && !err.message.includes('no such table')) {
                                        console.error('❌ Erreur création index:', err);
                                    }
                                });
                            });
                        }
                    });
                }
            });
        });
    }

    /**
     * Créer une nouvelle alerte de prix
     */
    async createAlert(alertData) {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            const now = new Date().toISOString();

            const query = `
                INSERT INTO price_alerts (
                    id, user_id, min_surface, max_surface, max_price, 
                    commune, code_insee, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                id,
                alertData.userId,
                alertData.minSurface || 0,
                alertData.maxSurface || 999999,
                alertData.maxPrice,
                alertData.commune || '',
                alertData.codeInsee || '',
                1,
                now,
                now
            ];

            this.db.run(query, params, function(err) {
                if (err) {
                    console.error('❌ Erreur création alerte:', err);
                    reject(err);
                } else {
                    const alert = {
                        id,
                        userId: alertData.userId,
                        minSurface: alertData.minSurface || 0,
                        maxSurface: alertData.maxSurface || 999999,
                        maxPrice: alertData.maxPrice,
                        commune: alertData.commune || '',
                        codeInsee: alertData.codeInsee || '',
                        isActive: true,
                        createdAt: now,
                        updatedAt: now
                    };
                    console.log(`✅ Alerte créée: ${id} pour l'utilisateur ${alertData.userId} (${alertData.minSurface}-${alertData.maxSurface}m², max ${alertData.maxPrice}€)`);
                    resolve(alert);
                }
            });
        });
    }

    /**
     * Récupérer toutes les alertes d'un utilisateur
     */
    async getUserAlerts(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM price_alerts
                WHERE user_id = ?
                ORDER BY created_at DESC
            `;

            this.db.all(query, [userId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération alertes:', err);
                    reject(err);
                } else {
                    const alerts = rows.map(row => ({
                        id: row.id,
                        userId: row.user_id,
                        minSurface: row.min_surface,
                        maxSurface: row.max_surface,
                        maxPrice: row.max_price,
                        commune: row.commune,
                        codeInsee: row.code_insee,
                        isActive: row.is_active === 1,
                        createdAt: row.created_at,
                        updatedAt: row.updated_at
                    }));
                    console.log(`✅ ${alerts.length} alertes récupérées pour l'utilisateur ${userId}`);
                    resolve(alerts);
                }
            });
        });
    }

    /**
     * Récupérer toutes les alertes actives
     */
    async getActiveAlerts() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM price_alerts
                WHERE is_active = 1
                ORDER BY created_at DESC
            `;

            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération alertes actives:', err);
                    reject(err);
                } else {
                    const alerts = rows.map(row => ({
                        id: row.id,
                        userId: row.user_id,
                        minSurface: row.min_surface,
                        maxSurface: row.max_surface,
                        maxPrice: row.max_price,
                        commune: row.commune,
                        codeInsee: row.code_insee,
                        isActive: true,
                        createdAt: row.created_at,
                        updatedAt: row.updated_at
                    }));
                    console.log(`✅ ${alerts.length} alertes actives récupérées`);
                    resolve(alerts);
                }
            });
        });
    }

    /**
     * Mettre à jour une alerte
     */
    async updateAlert(alertId, updateData) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            const updateFields = [];
            const params = [];

            if (updateData.minSurface !== undefined) {
                updateFields.push('min_surface = ?');
                params.push(updateData.minSurface);
            }
            if (updateData.maxSurface !== undefined) {
                updateFields.push('max_surface = ?');
                params.push(updateData.maxSurface);
            }
            if (updateData.maxPrice !== undefined) {
                updateFields.push('max_price = ?');
                params.push(updateData.maxPrice);
            }
            if (updateData.commune !== undefined) {
                updateFields.push('commune = ?');
                params.push(updateData.commune);
            }
            if (updateData.codeInsee !== undefined) {
                updateFields.push('code_insee = ?');
                params.push(updateData.codeInsee);
            }
            if (updateData.isActive !== undefined) {
                updateFields.push('is_active = ?');
                params.push(updateData.isActive ? 1 : 0);
            }

            updateFields.push('updated_at = ?');
            params.push(now);
            params.push(alertId);

            const query = `
                UPDATE price_alerts
                SET ${updateFields.join(', ')}
                WHERE id = ?
            `;

            this.db.run(query, params, function(err) {
                if (err) {
                    console.error('❌ Erreur mise à jour alerte:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    console.log(`⚠️ Alerte non trouvée: ${alertId}`);
                    resolve(null);
                } else {
                    console.log(`✅ Alerte mise à jour: ${alertId}`);
                    resolve({ id: alertId, ...updateData, updatedAt: now });
                }
            });
        });
    }

    /**
     * Supprimer une alerte
     */
    async deleteAlert(alertId) {
        return new Promise((resolve, reject) => {
            const query = `DELETE FROM price_alerts WHERE id = ?`;

            this.db.run(query, [alertId], function(err) {
                if (err) {
                    console.error('❌ Erreur suppression alerte:', err);
                    reject(err);
                } else if (this.changes === 0) {
                    console.log(`⚠️ Alerte non trouvée: ${alertId}`);
                    resolve(false);
                } else {
                    console.log(`✅ Alerte supprimée: ${alertId}`);
                    resolve(true);
                }
            });
        });
    }

    /**
     * Vérifier si une annonce correspond aux critères d'alertes actives
     * Retourne les alertes qui matchent
     */
    async checkAnnouncementForAlerts(announcement) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT pa.* 
                FROM price_alerts pa
                LEFT JOIN alert_notifications an ON pa.id = an.alert_id AND an.announcement_id = ?
                WHERE pa.is_active = 1
                AND pa.min_surface <= ?
                AND pa.max_surface >= ?
                AND pa.max_price >= ?
                AND (pa.commune = '' OR pa.commune = ?)
                AND an.id IS NULL
            `;

            const params = [
                announcement.id,
                announcement.surface,
                announcement.surface,
                announcement.price,
                announcement.commune || ''
            ];

            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('❌ Erreur vérification alertes:', err);
                    reject(err);
                } else {
                    const matchingAlerts = rows.map(row => ({
                        id: row.id,
                        userId: row.user_id,
                        minSurface: row.min_surface,
                        maxSurface: row.max_surface,
                        maxPrice: row.max_price,
                        commune: row.commune,
                        codeInsee: row.code_insee
                    }));

                    if (matchingAlerts.length > 0) {
                        console.log(`🔔 ${matchingAlerts.length} alertes correspondent à l'annonce ${announcement.id}`);
                    }
                    resolve(matchingAlerts);
                }
            });
        });
    }

    /**
     * Marquer une annonce comme notifiée pour une alerte
     */
    async markAsNotified(alertId, announcementId, userId) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO alert_notifications (alert_id, announcement_id, user_id)
                VALUES (?, ?, ?)
            `;

            this.db.run(query, [alertId, announcementId, userId], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint')) {
                        console.log(`⚠️ Notification déjà envoyée: alerte ${alertId}, annonce ${announcementId}`);
                        resolve({ alreadyNotified: true });
                    } else {
                        console.error('❌ Erreur enregistrement notification:', err);
                        reject(err);
                    }
                } else {
                    console.log(`✅ Notification enregistrée: alerte ${alertId}, annonce ${announcementId}`);
                    resolve({ id: this.lastID, alertId, announcementId, userId });
                }
            });
        });
    }

    /**
     * Récupérer les statistiques des alertes d'un utilisateur
     */
    async getUserAlertStats(userId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    pa.id,
                    pa.min_surface,
                    pa.max_surface,
                    pa.max_price,
                    pa.commune,
                    pa.is_active,
                    pa.created_at,
                    COUNT(an.id) as notifications_sent
                FROM price_alerts pa
                LEFT JOIN alert_notifications an ON pa.id = an.alert_id
                WHERE pa.user_id = ?
                GROUP BY pa.id
                ORDER BY pa.created_at DESC
            `;

            this.db.all(query, [userId], (err, rows) => {
                if (err) {
                    console.error('❌ Erreur récupération stats alertes:', err);
                    reject(err);
                } else {
                    const stats = rows.map(row => ({
                        alertId: row.id,
                        minSurface: row.min_surface,
                        maxSurface: row.max_surface,
                        maxPrice: row.max_price,
                        commune: row.commune,
                        isActive: row.is_active === 1,
                        createdAt: row.created_at,
                        notificationsSent: row.notifications_sent
                    }));
                    console.log(`✅ Stats alertes pour l'utilisateur ${userId}: ${stats.length} alertes`);
                    resolve(stats);
                }
            });
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('❌ Erreur fermeture base de données:', err);
            } else {
                console.log('✅ Base de données fermée (PriceAlertService)');
            }
        });
    }
}

module.exports = PriceAlertService;






