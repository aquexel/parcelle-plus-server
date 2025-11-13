/**
 * 📡 ROUTE API : Recherche terrains à bâtir avec filtre viabilisation
 * 
 * Utilise la base terrains_batir.db pour filtrer terrains viabilisés/non-viabilisés
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'database');
const DB_PATH = path.join(DB_DIR, 'terrains_batir.db');

// Créer le répertoire database s'il n'existe pas
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

/**
 * Calcule la distance entre deux points GPS (formule de Haversine)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Rayon de la Terre en mètres
    
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
}

/**
 * Route principale
 * 
 * ⚠️ ROUTE TEMPORAIREMENT DÉSACTIVÉE
 * La base de données pour les PC (Permis de Construire) issue de PA (Permis d'Aménager)
 * n'est pas encore opérationnelle.
 */
module.exports = (req, res) => {
    // Route temporairement désactivée
    return res.status(503).json({
        success: false,
        error: 'Service non disponible',
        message: 'La base de données pour les terrains à bâtir (PC issue de PA) n\'est pas encore opérationnelle. Ce service sera disponible prochainement.'
    });
    
    /* CODE DÉSACTIVÉ - À RÉACTIVER QUAND LA BASE SERA PRÊTE
    try {
        const startTime = Date.now();
        // Récupérer les paramètres
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);
        const radius = parseInt(req.query.radius) || 500;
        const monthsBack = parseInt(req.query.months_back) || 36;
        const minSurface = parseFloat(req.query.min_surface) || null;
        const maxSurface = parseFloat(req.query.max_surface) || null;
        const estViabilise = req.query.est_terrain_viabilise === 'true' ? 1 : 0;
        const limit = parseInt(req.query.limit) || 30;
        
        console.log('\n[TERRAIN][REQ] ---------------------------------------------------------------');
        console.log('[TERRAIN][REQ] Params:', { lat, lon, radius, estViabilise, limit });

        // Validation
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({
                success: false,
                error: 'Paramètres lat et lon obligatoires'
            });
        }
        
        // Ouvrir la base de données
        const db = new Database(DB_PATH, { readonly: true });
        
        // Calcul approximatif des bornes GPS
        const latDelta = (radius / 1000) / 111.0;
        const lonDelta = (radius / 1000) / (111.0 * Math.cos(lat * Math.PI / 180));
        
        const minLat = lat - latDelta;
        const maxLat = lat + latDelta;
        const minLon = lon - lonDelta;
        const maxLon = lon + lonDelta;
        
        // Date limite
        const dateLimit = new Date();
        dateLimit.setMonth(dateLimit.getMonth() - monthsBack);
        const dateLimitStr = dateLimit.toISOString().split('T')[0].replace(/-/g, '/');
        
        // Construire la requête SQL
        let query = `
            SELECT 
                id_parcelle,
                valeur_fonciere,
                surface_totale,
                prix_m2,
                date_mutation,
                latitude,
                longitude,
                nom_commune,
                est_terrain_viabilise
            FROM terrains_batir
            WHERE latitude BETWEEN ? AND ?
              AND longitude BETWEEN ? AND ?
              AND est_terrain_viabilise = ?
              AND valeur_fonciere > 0
              AND prix_m2 BETWEEN 5 AND 5000
        `;
        
        const params = [minLat, maxLat, minLon, maxLon, estViabilise];
        
        // Filtres optionnels de surface
        if (minSurface !== null && minSurface > 0) {
            query += ` AND surface_totale >= ?`;
            params.push(minSurface * 0.7); // Tolérance -30%
        }
        
        if (maxSurface !== null && maxSurface > 0) {
            query += ` AND surface_totale <= ?`;
            params.push(maxSurface * 1.3); // Tolérance +30%
        }
        
        query += ` 
            ORDER BY date_mutation DESC 
            LIMIT ?
        `;
        params.push(limit * 2);
        
        // Exécuter la requête
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        
        // Calculer la distance réelle et filtrer
        const transactions = rows
            .map(row => {
                const distance = calculateDistance(lat, lon, row.latitude, row.longitude);
                return {
                    id_mutation: `TERRAIN_${row.id_parcelle}`,
                    valeur_fonciere: row.valeur_fonciere,
                    date_mutation: row.date_mutation,
                    surface_terrain: row.surface_totale,
                    prix_m2_terrain: row.prix_m2,
                    latitude: row.latitude,
                    longitude: row.longitude,
                    nom_commune: row.nom_commune,
                    est_terrain_viabilise: row.est_terrain_viabilise === 1,
                    distance_meters: Math.round(distance)
                };
            })
            .filter(t => t.distance_meters <= radius)
            .sort((a, b) => a.distance_meters - b.distance_meters)
            .slice(0, limit);
        
        const durationMs = Date.now() - startTime;
        console.log(`[TERRAIN][RESP] ${transactions.length} terrains retournés en ${durationMs} ms`);
        if (transactions.length > 0) {
            const preview = transactions.slice(0, 3).map(t => ({
                id_parcelle: t.id_parcelle,
                prix_m2: t.prix_m2,
                valeur_fonciere: t.valeur_fonciere,
                surface_totale: t.surface_totale,
                distance_m: t.distance_meters,
                est_viabilise: t.est_terrain_viabilise,
                type_permis: t.type_permis,
                nom_commune: t.nom_commune
            }));
            console.table(preview);
        } else {
            console.log('[TERRAIN][RESP] Aucun terrain renvoyé.');
        }

        // Calculer les statistiques
        const prixM2 = transactions
            .map(t => t.prix_m2_terrain)
            .filter(p => p > 0);
        
        const statistics = {
            avg_prix_m2: prixM2.length > 0
                ? Math.round(prixM2.reduce((a, b) => a + b, 0) / prixM2.length)
                : null,
            count_with_viabilise: transactions.filter(t => t.est_terrain_viabilise).length,
            count_without_viabilise: transactions.filter(t => !t.est_terrain_viabilise).length
        };
        
        db.close();
        
        // Réponse
        res.json({
            success: true,
            count: transactions.length,
            radius_used: radius,
            filters: {
                est_terrain_viabilise: estViabilise === 1,
                months_back: monthsBack,
                min_surface: minSurface,
                max_surface: maxSurface
            },
            transactions,
            statistics
        });
        
    } catch (error) {
        console.error('Erreur route terrains batir:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la recherche terrains à bâtir',
            message: error.message
        });
    }
    */
};

