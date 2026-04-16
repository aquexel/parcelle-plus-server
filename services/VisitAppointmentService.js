const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

/**
 * Rendez-vous de visite : proposition par une partie, acceptation / refus par l'autre (même logique métier qu'une offre simplifiée).
 */
class VisitAppointmentService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', 'parcelle_chat.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.initializeDatabase();
    }

    initializeDatabase() {
        const sql = `
            CREATE TABLE IF NOT EXISTS visit_appointments (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                announcement_id TEXT NOT NULL,
                buyer_id TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                buyer_name TEXT NOT NULL,
                seller_name TEXT NOT NULL,
                proposer_id TEXT NOT NULL,
                proposer_name TEXT NOT NULL,
                slot_datetime TEXT NOT NULL,
                note TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `;
        this.db.run(sql, (err) => {
            if (err) {
                console.error('❌ Erreur création visit_appointments:', err);
            } else {
                console.log('✅ Table visit_appointments prête');
            }
        });
        this.db.run('CREATE INDEX IF NOT EXISTS idx_visit_room ON visit_appointments(room_id)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_visit_buyer ON visit_appointments(buyer_id)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_visit_seller ON visit_appointments(seller_id)');
    }

    rowToJson(row) {
        return {
            id: row.id,
            roomId: row.room_id,
            announcementId: row.announcement_id,
            buyerId: row.buyer_id,
            sellerId: row.seller_id,
            buyerName: row.buyer_name,
            sellerName: row.seller_name,
            proposerId: row.proposer_id,
            proposerName: row.proposer_name,
            slotDatetime: row.slot_datetime,
            note: row.note || '',
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    getById(id) {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM visit_appointments WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row ? this.rowToJson(row) : null);
            });
        });
    }

    getByRoom(roomId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM visit_appointments WHERE room_id = ? ORDER BY created_at DESC',
                [roomId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve((rows || []).map((r) => this.rowToJson(r)));
                }
            );
        });
    }

    getByUser(userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM visit_appointments
                 WHERE (buyer_id = ? OR seller_id = ?)
                 AND status IN ('pending', 'accepted')
                 ORDER BY slot_datetime ASC`,
                [userId, userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve((rows || []).map((r) => this.rowToJson(r)));
                }
            );
        });
    }

    create(data) {
        const {
            roomId,
            announcementId,
            buyerId,
            sellerId,
            buyerName,
            sellerName,
            proposerId,
            proposerName,
            slotDatetime,
            note
        } = data;

        return new Promise((resolve, reject) => {
            if (!roomId || !announcementId || !buyerId || !sellerId || !proposerId || !slotDatetime) {
                reject(new Error('Champs requis: roomId, announcementId, buyerId, sellerId, proposerId, slotDatetime'));
                return;
            }
            if (proposerId !== buyerId && proposerId !== sellerId) {
                reject(new Error('Le proposant doit être l’acheteur ou le vendeur'));
                return;
            }

            const id = uuidv4();
            const now = new Date().toISOString();
            const noteVal = note || '';
            const bn = buyerName || 'Acheteur';
            const sn = sellerName || 'Vendeur';
            const pn = proposerName || '';

            this.db.run(
                `UPDATE visit_appointments SET status = 'superseded', updated_at = ?
                 WHERE room_id = ? AND status = 'pending'`,
                [now, roomId],
                (updErr) => {
                    if (updErr) {
                        reject(updErr);
                        return;
                    }
                    this.db.run(
                        `INSERT INTO visit_appointments (
                            id, room_id, announcement_id, buyer_id, seller_id, buyer_name, seller_name,
                            proposer_id, proposer_name, slot_datetime, note, status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
                        [
                            id,
                            roomId,
                            announcementId,
                            buyerId,
                            sellerId,
                            bn,
                            sn,
                            proposerId,
                            pn,
                            slotDatetime,
                            noteVal,
                            now,
                            now
                        ],
                        (insErr) => {
                            if (insErr) {
                                reject(insErr);
                                return;
                            }
                            this.getById(id).then(resolve).catch(reject);
                        }
                    );
                }
            );
        });
    }

    accept(id, userId) {
        return new Promise((resolve, reject) => {
            this.getById(id)
                .then((v) => {
                    if (!v) {
                        reject(new Error('Rendez-vous introuvable'));
                        return;
                    }
                    if (v.status !== 'pending') {
                        reject(new Error('Ce rendez-vous n’est plus en attente'));
                        return;
                    }
                    if (v.proposerId === userId) {
                        reject(new Error('Vous ne pouvez pas accepter votre propre proposition'));
                        return;
                    }
                    if (v.buyerId !== userId && v.sellerId !== userId) {
                        reject(new Error('Non autorisé'));
                        return;
                    }
                    const now = new Date().toISOString();
                    this.db.run(
                        `UPDATE visit_appointments SET status = 'accepted', updated_at = ? WHERE id = ?`,
                        [now, id],
                        (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            this.getById(id).then(resolve).catch(reject);
                        }
                    );
                })
                .catch(reject);
        });
    }

    reject(id, userId) {
        return new Promise((resolve, reject) => {
            this.getById(id)
                .then((v) => {
                    if (!v) {
                        reject(new Error('Rendez-vous introuvable'));
                        return;
                    }
                    if (v.status !== 'pending') {
                        reject(new Error('Ce rendez-vous n’est plus en attente'));
                        return;
                    }
                    if (v.proposerId === userId) {
                        reject(new Error('Utilisez une nouvelle proposition pour modifier le créneau'));
                        return;
                    }
                    if (v.buyerId !== userId && v.sellerId !== userId) {
                        reject(new Error('Non autorisé'));
                        return;
                    }
                    const now = new Date().toISOString();
                    this.db.run(
                        `UPDATE visit_appointments SET status = 'rejected', updated_at = ? WHERE id = ?`,
                        [now, id],
                        (err) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            this.getById(id).then(resolve).catch(reject);
                        }
                    );
                })
                .catch(reject);
        });
    }

    deleteByRoom(roomId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM visit_appointments WHERE room_id = ?', [roomId], function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    deleteByAnnouncementId(announcementId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM visit_appointments WHERE announcement_id = ?', [announcementId], function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }
}

module.exports = VisitAppointmentService;
