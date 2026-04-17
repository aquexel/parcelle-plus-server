const Database = require('better-sqlite3');
const path = require('path');

class EntitlementService {
    constructor() {
        const dbDir = path.join(__dirname, '..', 'database');
        this.dbPath = path.join(dbDir, 'parcelle_business.db');
        this.db = new Database(this.dbPath);
        this.initializeDatabase();
    }

    initializeDatabase() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS monetization_user_state (
                user_id TEXT PRIMARY KEY,
                seller_subscription_until INTEGER,
                buyer_subscription_until INTEGER,
                roi_subscription_until INTEGER,
                buyer_contact_pack_balance INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS buyer_contact_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                buyer_id TEXT NOT NULL,
                seller_id TEXT NOT NULL,
                announcement_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(buyer_id, seller_id)
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS seller_usage_counters (
                user_id TEXT PRIMARY KEY,
                free_estimations_used INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS seller_announcement_publications (
                announcement_id TEXT PRIMARY KEY,
                seller_id TEXT NOT NULL,
                free_until_ms INTEGER,
                paid_until_ms INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_buyer_contact_events_buyer
            ON buyer_contact_events(buyer_id)
        `);
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_seller_publications_seller
            ON seller_announcement_publications(seller_id)
        `);

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS monetization_launch_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                promo_free_until_ms INTEGER,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        this.db.prepare(`
            INSERT OR IGNORE INTO monetization_launch_config (id, promo_free_until_ms)
            VALUES (1, NULL)
        `).run();
    }

    /**
     * Période de lancement : tout gratuit jusqu'à promo_free_until_ms (inclus côté temps : now < until).
     * NULL = pas de promo active (monétisation normale).
     */
    getLaunchPromoFreeUntilMs() {
        const row = this.db.prepare(`
            SELECT promo_free_until_ms FROM monetization_launch_config WHERE id = 1
        `).get();
        const v = row?.promo_free_until_ms;
        if (v == null || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }

    getLaunchPromoStatus(now = Date.now()) {
        const freeUntilMs = this.getLaunchPromoFreeUntilMs();
        const active = freeUntilMs != null && freeUntilMs > now;
        return { active, freeUntilMs };
    }

    isLaunchPromoActive(now = Date.now()) {
        const until = this.getLaunchPromoFreeUntilMs();
        return until != null && until > now;
    }

    /**
     * Active une période gratuite globale à partir de maintenant (ex. 3 mois).
     * Si une promo est déjà en cours, prolonge à partir de max(now, fin actuelle).
     */
    setLaunchPromoMonthsFromNow(months) {
        const m = Number(months);
        if (!Number.isFinite(m) || m <= 0) {
            throw new Error('months doit être un nombre positif');
        }
        const addMs = Math.round(m * 30 * 24 * 60 * 60 * 1000);
        const now = Date.now();
        const currentUntil = this.getLaunchPromoFreeUntilMs() || 0;
        const base = Math.max(now, currentUntil);
        const newUntil = base + addMs;
        this.db.prepare(`
            UPDATE monetization_launch_config
            SET promo_free_until_ms = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `).run(newUntil);
        return this.getLaunchPromoStatus(now);
    }

    /** Termine la promo tout de suite (monétisation réactivée). */
    endLaunchPromoNow() {
        this.db.prepare(`
            UPDATE monetization_launch_config
            SET promo_free_until_ms = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `).run();
        return this.getLaunchPromoStatus(Date.now());
    }

    /** Fixe une date de fin absolue (ms depuis epoch), ou null pour repasser en payant. */
    setLaunchPromoEndMs(endMs) {
        if (endMs == null) {
            this.db.prepare(`
                UPDATE monetization_launch_config
                SET promo_free_until_ms = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            `).run();
        } else {
            const n = Number(endMs);
            if (!Number.isFinite(n)) throw new Error('endMs invalide');
            this.db.prepare(`
                UPDATE monetization_launch_config
                SET promo_free_until_ms = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            `).run(Math.round(n));
        }
        return this.getLaunchPromoStatus(Date.now());
    }

    ensureUserState(userId) {
        this.db.prepare(`
            INSERT INTO monetization_user_state (user_id)
            VALUES (?)
            ON CONFLICT(user_id) DO NOTHING
        `).run(userId);
    }

    ensureSellerCounter(userId) {
        this.db.prepare(`
            INSERT INTO seller_usage_counters (user_id)
            VALUES (?)
            ON CONFLICT(user_id) DO NOTHING
        `).run(userId);
    }

    getUserState(userId) {
        this.ensureUserState(userId);
        return this.db.prepare(`
            SELECT
                seller_subscription_until,
                buyer_subscription_until,
                roi_subscription_until,
                buyer_contact_pack_balance
            FROM monetization_user_state
            WHERE user_id = ?
        `).get(userId);
    }

    isSubscriptionActive(untilMs, now = Date.now()) {
        return Boolean(untilMs && untilMs > now);
    }

    getPricing() {
        return {
            sellerSubscriptionMonthlyEur: 5,
            buyerContactPackEur: 2,
            buyerContactPackSize: 3,
            buyerSubscriptionMonthlyEur: 3,
            roiOptionMonthlyEur: 3,
            sellerWeeklyAnnouncementEur: 2,
            sellerFirstAnnouncementFreeDays: 7
        };
    }

    getUserEntitlements(userId) {
        this.ensureUserState(userId);
        this.ensureSellerCounter(userId);

        const now = Date.now();
        const state = this.getUserState(userId);

        const sellerUsage = this.db.prepare(`
            SELECT free_estimations_used
            FROM seller_usage_counters
            WHERE user_id = ?
        `).get(userId);

        const contactedSellers = this.db.prepare(`
            SELECT COUNT(*) AS count
            FROM buyer_contact_events
            WHERE buyer_id = ?
        `).get(userId)?.count || 0;

        const sellerFreeLimit = 5;
        const buyerFreeContactLimit = 3;

        const sellerPublicationStats = this.getSellerPublicationStats(userId);

        const launchPromo = this.getLaunchPromoStatus(now);

        return {
            userId,
            pricing: this.getPricing(),
            launchPromo,
            seller: {
                subscriptionActive: Boolean(state?.seller_subscription_until && state.seller_subscription_until > now),
                subscriptionUntil: state?.seller_subscription_until || null,
                freeEstimationsLimit: sellerFreeLimit,
                freeEstimationsUsed: sellerUsage?.free_estimations_used || 0,
                freeEstimationsRemaining: Math.max(0, sellerFreeLimit - (sellerUsage?.free_estimations_used || 0)),
                publication: sellerPublicationStats
            },
            buyer: {
                subscriptionActive: Boolean(state?.buyer_subscription_until && state.buyer_subscription_until > now),
                subscriptionUntil: state?.buyer_subscription_until || null,
                freeSellerContactLimit: buyerFreeContactLimit,
                distinctSellersContacted: contactedSellers,
                freeSellerContactsRemaining: Math.max(0, buyerFreeContactLimit - contactedSellers),
                contactPackBalance: state?.buyer_contact_pack_balance || 0
            },
            roi: {
                subscriptionActive: Boolean(state?.roi_subscription_until && state.roi_subscription_until > now),
                subscriptionUntil: state?.roi_subscription_until || null
            }
        };
    }

    getSellerPublicationStats(sellerId) {
        const now = Date.now();
        const rows = this.db.prepare(`
            SELECT announcement_id, free_until_ms, paid_until_ms
            FROM seller_announcement_publications
            WHERE seller_id = ?
        `).all(sellerId);

        let activeCount = 0;
        rows.forEach((row) => {
            const visibleUntil = Math.max(row.free_until_ms || 0, row.paid_until_ms || 0);
            if (visibleUntil > now) activeCount += 1;
        });

        return {
            totalTrackedAnnouncements: rows.length,
            activeAnnouncements: activeCount
        };
    }

    addBuyerContactPacks(userId, packs = 1) {
        this.ensureUserState(userId);
        const safePacks = Number.isInteger(packs) && packs > 0 ? packs : 1;
        const creditsToAdd = safePacks * 3;

        this.db.prepare(`
            UPDATE monetization_user_state
            SET
                buyer_contact_pack_balance = buyer_contact_pack_balance + ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).run(creditsToAdd, userId);

        return this.getUserEntitlements(userId).buyer;
    }

    consumeSellerEstimation(userId) {
        this.ensureUserState(userId);
        this.ensureSellerCounter(userId);

        if (this.isLaunchPromoActive()) {
            return {
                allowed: true,
                usageType: 'launch_promo',
                entitlements: this.getUserEntitlements(userId).seller
            };
        }

        const state = this.getUserState(userId);
        if (this.isSubscriptionActive(state?.seller_subscription_until)) {
            return {
                allowed: true,
                usageType: 'seller_subscription',
                entitlements: this.getUserEntitlements(userId).seller
            };
        }

        const currentUsage = this.db.prepare(`
            SELECT free_estimations_used
            FROM seller_usage_counters
            WHERE user_id = ?
        `).get(userId)?.free_estimations_used || 0;

        const freeLimit = 5;
        if (currentUsage >= freeLimit) {
            return {
                allowed: false,
                reason: 'SELLER_ESTIMATION_LIMIT_REACHED',
                message: 'Les 5 estimations gratuites sont utilisees. Activez l abonnement vendeur.',
                entitlements: this.getUserEntitlements(userId).seller
            };
        }

        this.db.prepare(`
            UPDATE seller_usage_counters
            SET
                free_estimations_used = free_estimations_used + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).run(userId);

        return {
            allowed: true,
            usageType: 'free',
            entitlements: this.getUserEntitlements(userId).seller
        };
    }

    registerAnnouncementCreation(sellerId, announcementId) {
        if (!sellerId || !announcementId) {
            return {
                allowed: false,
                reason: 'INVALID_ANNOUNCEMENT_PARAMS',
                message: 'sellerId et announcementId sont requis'
            };
        }

        this.ensureUserState(sellerId);
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        if (this.isLaunchPromoActive(now)) {
            const promoUntil = this.getLaunchPromoFreeUntilMs() || now + sevenDaysMs;
            this.db.prepare(`
                INSERT INTO seller_announcement_publications
                (announcement_id, seller_id, free_until_ms, paid_until_ms, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(announcement_id) DO UPDATE SET
                    seller_id = excluded.seller_id,
                    free_until_ms = excluded.free_until_ms,
                    paid_until_ms = excluded.paid_until_ms,
                    updated_at = CURRENT_TIMESTAMP
            `).run(announcementId, sellerId, promoUntil, promoUntil);
            return { allowed: true, usageType: 'launch_promo', freeUntilMs: promoUntil };
        }

        const state = this.getUserState(sellerId);
        const sellerSubscriptionActive = this.isSubscriptionActive(state?.seller_subscription_until, now);
        if (sellerSubscriptionActive) {
            this.db.prepare(`
                INSERT INTO seller_announcement_publications
                (announcement_id, seller_id, free_until_ms, paid_until_ms, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(announcement_id) DO UPDATE SET
                    seller_id = excluded.seller_id,
                    updated_at = CURRENT_TIMESTAMP
            `).run(announcementId, sellerId, now + sevenDaysMs, now + sevenDaysMs);

            return { allowed: true, usageType: 'seller_subscription' };
        }

        const hasAnyPublication = this.db.prepare(`
            SELECT COUNT(*) AS count
            FROM seller_announcement_publications
            WHERE seller_id = ?
        `).get(sellerId)?.count || 0;

        if (hasAnyPublication > 0) {
            return {
                allowed: false,
                reason: 'SELLER_FIRST_ANNOUNCEMENT_ONLY',
                message: 'Sans abonnement vendeur, seule la premiere annonce est disponible.'
            };
        }

        this.db.prepare(`
            INSERT INTO seller_announcement_publications
            (announcement_id, seller_id, free_until_ms, paid_until_ms, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(announcementId, sellerId, now + sevenDaysMs, null);

        return {
            allowed: true,
            usageType: 'first_announcement_free_7_days',
            freeUntilMs: now + sevenDaysMs
        };
    }

    canAnnouncementBePublic(announcementId, sellerId) {
        if (!announcementId || !sellerId) {
            return { allowed: false, reason: 'INVALID_ANNOUNCEMENT_PARAMS' };
        }
        this.ensureUserState(sellerId);
        const now = Date.now();
        if (this.isLaunchPromoActive(now)) {
            return {
                allowed: true,
                usageType: 'launch_promo',
                visibleUntilMs: this.getLaunchPromoFreeUntilMs()
            };
        }
        const state = this.getUserState(sellerId);
        if (this.isSubscriptionActive(state?.seller_subscription_until, now)) {
            return { allowed: true, usageType: 'seller_subscription', visibleUntilMs: null };
        }

        const publication = this.db.prepare(`
            SELECT free_until_ms, paid_until_ms
            FROM seller_announcement_publications
            WHERE announcement_id = ? AND seller_id = ?
        `).get(announcementId, sellerId);

        if (!publication) {
            return {
                allowed: false,
                reason: 'ANNOUNCEMENT_NOT_REGISTERED',
                message: 'Annonce non enregistree pour publication.'
            };
        }

        const visibleUntilMs = Math.max(publication.free_until_ms || 0, publication.paid_until_ms || 0);
        if (visibleUntilMs > now) {
            return { allowed: true, usageType: 'free_or_paid_window', visibleUntilMs };
        }

        return {
            allowed: false,
            reason: 'ANNOUNCEMENT_PUBLICATION_EXPIRED',
            message: 'La periode gratuite est terminee. Activez l abonnement vendeur.'
        };
    }

    extendAnnouncementPublication(announcementId, sellerId, weeks = 1) {
        const safeWeeks = Number.isInteger(weeks) && weeks > 0 ? weeks : 1;
        const addMs = safeWeeks * 7 * 24 * 60 * 60 * 1000;
        const publication = this.db.prepare(`
            SELECT free_until_ms, paid_until_ms
            FROM seller_announcement_publications
            WHERE announcement_id = ? AND seller_id = ?
        `).get(announcementId, sellerId);

        if (!publication) {
            return { success: false, message: 'Annonce non enregistree' };
        }

        const base = Math.max(Date.now(), publication.paid_until_ms || 0, publication.free_until_ms || 0);
        const newPaidUntil = base + addMs;
        this.db.prepare(`
            UPDATE seller_announcement_publications
            SET
                paid_until_ms = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE announcement_id = ? AND seller_id = ?
        `).run(newPaidUntil, announcementId, sellerId);

        return { success: true, paidUntilMs: newPaidUntil };
    }

    canUseRoiCalculation(userId) {
        this.ensureUserState(userId);
        const now = Date.now();
        if (this.isLaunchPromoActive(now)) {
            return { allowed: true, usageType: 'launch_promo' };
        }
        const state = this.getUserState(userId);
        if (this.isSubscriptionActive(state?.buyer_subscription_until, now)) {
            return { allowed: true, usageType: 'buyer_subscription' };
        }
        if (this.isSubscriptionActive(state?.roi_subscription_until, now)) {
            return { allowed: true, usageType: 'roi_subscription' };
        }
        return {
            allowed: false,
            reason: 'ROI_SUBSCRIPTION_REQUIRED',
            message: 'Le calcul de rentabilite necessite une option ROI ou un abonnement acheteur.'
        };
    }

    setSubscription(userId, planCode, months = 1) {
        this.ensureUserState(userId);
        const safeMonths = Number.isInteger(months) && months > 0 ? months : 1;
        const now = Date.now();
        const monthMs = 30 * 24 * 60 * 60 * 1000;
        const addMs = safeMonths * monthMs;

        let column = null;
        if (planCode === 'seller_monthly') column = 'seller_subscription_until';
        if (planCode === 'buyer_monthly') column = 'buyer_subscription_until';
        if (planCode === 'roi_monthly') column = 'roi_subscription_until';
        if (!column) {
            throw new Error('planCode invalide');
        }

        const current = this.getUserState(userId)?.[column] || 0;
        const base = Math.max(now, current);
        const newUntil = base + addMs;

        this.db.prepare(`
            UPDATE monetization_user_state
            SET
                ${column} = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).run(newUntil, userId);

        return this.getUserEntitlements(userId);
    }

    registerBuyerContact({ buyerId, sellerId, announcementId }) {
        this.ensureUserState(buyerId);
        if (!buyerId || !sellerId) {
            return {
                allowed: false,
                reason: 'INVALID_CONTACT_PARAMS',
                message: 'buyerId et sellerId sont requis'
            };
        }

        if (buyerId === sellerId) {
            return {
                allowed: false,
                reason: 'SELF_CONTACT_FORBIDDEN',
                message: 'Un utilisateur ne peut pas se contacter lui-meme'
            };
        }

        const now = Date.now();
        if (this.isLaunchPromoActive(now)) {
            const existingContact = this.db.prepare(`
                SELECT id
                FROM buyer_contact_events
                WHERE buyer_id = ? AND seller_id = ?
            `).get(buyerId, sellerId);
            if (existingContact) {
                return {
                    allowed: true,
                    usageType: 'existing_relationship',
                    entitlements: this.getUserEntitlements(buyerId).buyer
                };
            }
            this.db.prepare(`
                INSERT INTO buyer_contact_events (buyer_id, seller_id, announcement_id)
                VALUES (?, ?, ?)
            `).run(buyerId, sellerId, announcementId || null);
            return {
                allowed: true,
                usageType: 'launch_promo',
                entitlements: this.getUserEntitlements(buyerId).buyer
            };
        }

        const txn = this.db.transaction(() => {
            const existingContact = this.db.prepare(`
                SELECT id
                FROM buyer_contact_events
                WHERE buyer_id = ? AND seller_id = ?
            `).get(buyerId, sellerId);

            // Contact deja etabli avec ce vendeur: idempotent, pas de nouvelle consommation.
            if (existingContact) {
                return {
                    allowed: true,
                    usageType: 'existing_relationship'
                };
            }

            const state = this.db.prepare(`
                SELECT buyer_subscription_until, buyer_contact_pack_balance
                FROM monetization_user_state
                WHERE user_id = ?
            `).get(buyerId);

            const buyerSubscriptionActive = Boolean(
                state?.buyer_subscription_until && state.buyer_subscription_until > now
            );

            const contactedSellers = this.db.prepare(`
                SELECT COUNT(*) AS count
                FROM buyer_contact_events
                WHERE buyer_id = ?
            `).get(buyerId)?.count || 0;

            const freeLimit = 3;
            let usageType = 'free';

            if (!buyerSubscriptionActive && contactedSellers >= freeLimit) {
                const packBalance = state?.buyer_contact_pack_balance || 0;
                if (packBalance <= 0) {
                    return {
                        allowed: false,
                        reason: 'BUYER_CONTACT_LIMIT_REACHED',
                        message: 'Limite gratuite atteinte. Souscrivez un abonnement acheteur ou achetez un pack de 3 contacts.'
                    };
                }

                this.db.prepare(`
                    UPDATE monetization_user_state
                    SET
                        buyer_contact_pack_balance = buyer_contact_pack_balance - 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND buyer_contact_pack_balance > 0
                `).run(buyerId);
                usageType = 'paid_pack';
            } else if (buyerSubscriptionActive) {
                usageType = 'buyer_subscription';
            }

            this.db.prepare(`
                INSERT INTO buyer_contact_events (buyer_id, seller_id, announcement_id)
                VALUES (?, ?, ?)
            `).run(buyerId, sellerId, announcementId || null);

            return {
                allowed: true,
                usageType
            };
        });

        const result = txn();
        return {
            ...result,
            entitlements: this.getUserEntitlements(buyerId).buyer
        };
    }
}

module.exports = EntitlementService;
