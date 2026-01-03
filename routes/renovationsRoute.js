/**
 * 📡 ROUTE API : Recherche Permis de Rénovation
 * 
 * Retourne les transactions de rénovation (type_terrain = 'RENOVATION')
 * depuis terrains_pc_sans_pa.db ou terrains_batir_complet.db
 * pour l'estimation de maisons avec "gros travaux"
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'database');
const DB_PC_SANS_PA = path.join(DB_DIR, 'terrains_pc_sans_pa.db');
const DB_COMPLET = path.join(DB_DIR, 'terrains_batir_complet.db');

/**
 * Calcule la distance entre deux points GPS (formule de Haversine)
 * @returns Distance en mètres
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Rayon de la Terre en mètres
    
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c; // Distance en mètres
}

/**
 * Route principale
 */
module.exports = (req, res) => {
    try {
        const startTime = Date.now();
        
        // Récupérer les paramètres
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);
        const radius = parseInt(req.query.radius) || 500;
        const monthsBack = parseInt(req.query.months_back) || 24;
        const minSurface = parseFloat(req.query.min_surface) || null;
        const maxSurface = parseFloat(req.query.max_surface) || null;
        const limit = parseInt(req.query.limit) || 100;
        
        console.log('\n[RENOVATIONS][REQ] ============================================================');
        console.log('[RENOVATIONS][REQ] Params:', {
            lat,
            lon,
            radius,
            monthsBack,
            limit,
            minSurface,
            maxSurface
        });
        
        // Validation
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({
                success: false,
                error: 'Paramètres lat et lon obligatoires et valides'
            });
        }
        
        // Vérifier que les coordonnées sont en France métropolitaine
        if (lat < 41 || lat > 51 || lon < -5 || lon > 10) {
            return res.status(400).json({
                success: false,
                error: 'Coordonnées hors de France métropolitaine'
            });
        }
        
        // Trouver la base de données disponible
        let dbPath = null;
        let tableName = null;
        
        if (fs.existsSync(DB_PC_SANS_PA)) {
            dbPath = DB_PC_SANS_PA;
            tableName = 'terrains_pc_sans_pa';
            console.log('[RENOVATIONS] Utilisation de terrains_pc_sans_pa.db');
        } else if (fs.existsSync(DB_COMPLET)) {
            dbPath = DB_COMPLET;
            // Ouvrir la base pour détecter le nom de la table
            const dbCheck = new Database(dbPath, { readonly: true });
            const tables = dbCheck.prepare(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name LIKE 'terrains%'
            `).all();
            dbCheck.close();
            
            // Chercher terrains_batir_complet en priorité, sinon terrains_batir
            const tableNames = tables.map(t => t.name);
            if (tableNames.includes('terrains_batir_complet')) {
                tableName = 'terrains_batir_complet';
            } else if (tableNames.includes('terrains_batir')) {
                tableName = 'terrains_batir';
            } else if (tableNames.length > 0) {
                tableName = tableNames[0]; // Prendre la première table trouvée
            } else {
                console.log('[RENOVATIONS][ERROR] Aucune table terrains trouvée dans terrains_batir_complet.db');
                return res.status(500).json({
                    success: false,
                    error: 'Table de rénovation non trouvée dans la base de données'
                });
            }
            console.log(`[RENOVATIONS] Utilisation de terrains_batir_complet.db avec table: ${tableName}`);
        } else {
            console.log('[RENOVATIONS][WARN] Aucune base de données de rénovation trouvée');
            return res.status(200).json({
                success: true,
                transactions: [],
                total: 0,
                message: 'Base de données de rénovation non disponible'
            });
        }
        
        // Ouvrir la base de données
        const db = new Database(dbPath, { readonly: true });
        
        // Calcul approximatif des bornes GPS pour le rayon
        const latDelta = (radius / 1000) / 111.0;
        const lonDelta = (radius / 1000) / (111.0 * Math.cos(lat * Math.PI / 180));
        
        const minLat = lat - latDelta;
        const maxLat = lat + latDelta;
        const minLon = lon - lonDelta;
        const maxLon = lon + lonDelta;
        
        // Date limite
        const dateLimit = new Date();
        dateLimit.setMonth(dateLimit.getMonth() - monthsBack);
        const dateLimitStr = dateLimit.toISOString().split('T')[0];
        
        // Construire la requête SQL
        // Note: Les colonnes peuvent varier selon la base, on adapte
        let query = `
            SELECT 
                id_mutation,
                valeur_fonciere,
                date_mutation,
                surface_reelle_bati,
                surface_totale as surface_terrain,
                latitude,
                longitude,
                nom_commune,
                prix_m2,
                type_terrain
            FROM ${tableName}
            WHERE type_terrain = 'RENOVATION'
              AND latitude BETWEEN ? AND ?
              AND longitude BETWEEN ? AND ?
              AND date_mutation >= ?
              AND valeur_fonciere > 0
              AND surface_reelle_bati > 0
        `;
        
        const params = [minLat, maxLat, minLon, maxLon, dateLimitStr];
        
        // Filtres optionnels
        if (minSurface !== null) {
            query += ` AND surface_reelle_bati >= ?`;
            params.push(minSurface);
        }
        
        if (maxSurface !== null) {
            query += ` AND surface_reelle_bati <= ?`;
            params.push(maxSurface);
        }
        
        query += ` ORDER BY date_mutation DESC LIMIT ?`;
        params.push(limit);
        
        // Exécuter la requête
        let rows = db.prepare(query).all(...params);
        
        // Calculer les distances et filtrer par rayon exact
        const transactions = rows
            .map(row => {
                const distance = calculateDistance(lat, lon, row.latitude, row.longitude);
                return {
                    ...row,
                    distance: Math.round(distance)
                };
            })
            .filter(tx => tx.distance <= radius)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);
        
        // Calculer le prix/m² si manquant
        transactions.forEach(tx => {
            if (!tx.prix_m2 && tx.surface_reelle_bati > 0) {
                tx.prix_m2 = tx.valeur_fonciere / tx.surface_reelle_bati;
            }
        });
        
        // Formater les transactions pour correspondre au format DVF
        const formattedTransactions = transactions.map(tx => ({
            idMutation: tx.id_mutation,
            valeurFonciere: tx.valeur_fonciere,
            dateMutation: tx.date_mutation,
            surfaceReelleBati: tx.surface_reelle_bati,
            surfaceBatiMaison: tx.surface_reelle_bati,
            surfaceTerrain: tx.surface_terrain || 0,
            latitude: tx.latitude,
            longitude: tx.longitude,
            nomCommune: tx.nom_commune || 'Commune inconnue',
            prixM2Bati: tx.prix_m2 || (tx.valeur_fonciere / tx.surface_reelle_bati),
            prixM2Terrain: null,
            nbPieces: null,
            typeBien: 'maison',
            classeDpe: null,
            presencePiscine: false,
            presenceGarage: false,
            distance: tx.distance
        }));
        
        const duration = Date.now() - startTime;
        
        console.log(`[RENOVATIONS][RESP] ${formattedTransactions.length} rénovations trouvées en ${duration}ms`);
        
        db.close();
        
        res.json({
            success: true,
            transactions: formattedTransactions,
            total: formattedTransactions.length,
            statistics: {
                countWithPiscine: 0,
                countWithGarage: 0,
                averagePrice: formattedTransactions.length > 0 
                    ? formattedTransactions.reduce((sum, t) => sum + t.valeurFonciere, 0) / formattedTransactions.length 
                    : 0,
                averagePriceM2: formattedTransactions.length > 0 && formattedTransactions[0].prixM2Bati
                    ? formattedTransactions.reduce((sum, t) => sum + (t.prixM2Bati || 0), 0) / formattedTransactions.length 
                    : 0
            }
        });
        
    } catch (error) {
        console.error('[RENOVATIONS][ERROR]', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la recherche de rénovations',
            message: error.message
        });
    }
};

