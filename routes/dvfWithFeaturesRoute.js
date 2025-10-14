/**
 * 📡 ROUTE API : Recherche DVF avec DPE et Annexes
 * 
 * Retourne les transactions immobilières enrichies pour
 * l'algorithme de régression comparative côté Android
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database', 'dvf_avec_dpe_et_annexes.db');

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
        // Récupérer les paramètres
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);
        const radius = parseInt(req.query.radius) || 500;
        const typeBien = req.query.type_bien || null;
        const monthsBack = parseInt(req.query.months_back) || 24;
        const minSurface = parseFloat(req.query.min_surface) || null;
        const maxSurface = parseFloat(req.query.max_surface) || null;
        const classeDPE = req.query.classe_dpe ? req.query.classe_dpe.split(',') : null;
        const avecPiscine = req.query.avec_piscine ? parseInt(req.query.avec_piscine) : null;
        const avecGarage = req.query.avec_garage ? parseInt(req.query.avec_garage) : null;
        const avecVeranda = req.query.avec_veranda ? parseInt(req.query.avec_veranda) : null;
        const limit = parseInt(req.query.limit) || 100;
        
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
        
        // Ouvrir la base de données
        const db = new Database(DB_PATH, { readonly: true });
        
        // Calcul approximatif des bornes GPS pour le rayon
        // 1 degré lat ≈ 111 km
        // 1 degré lon ≈ 111 km * cos(lat)
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
        let query = `
            SELECT 
                id_mutation,
                valeur_fonciere,
                date_mutation,
                surface_bati_maison,
                surface_bati_appartement,
                surface_terrain,
                nb_pieces,
                latitude,
                longitude,
                code_departement,
                nom_commune,
                classe_dpe,
                presence_piscine,
                presence_garage,
                presence_veranda,
                type_bien,
                prix_m2_bati,
                prix_m2_terrain
            FROM dvf_avec_dpe_et_annexes
            WHERE latitude BETWEEN ? AND ?
              AND longitude BETWEEN ? AND ?
              AND date_mutation >= ?
              AND valeur_fonciere > 0
        `;
        
        const params = [minLat, maxLat, minLon, maxLon, dateLimitStr];
        
        // Filtres optionnels
        if (typeBien) {
            query += ` AND type_bien = ?`;
            params.push(typeBien);
        }
        
        if (minSurface !== null) {
            query += ` AND (surface_bati_maison + surface_bati_appartement) >= ?`;
            params.push(minSurface);
        }
        
        if (maxSurface !== null) {
            query += ` AND (surface_bati_maison + surface_bati_appartement) <= ?`;
            params.push(maxSurface);
        }
        
        if (classeDPE && classeDPE.length > 0) {
            const placeholders = classeDPE.map(() => '?').join(',');
            query += ` AND classe_dpe IN (${placeholders})`;
            params.push(...classeDPE);
        }
        
        if (avecPiscine !== null) {
            query += ` AND presence_piscine = ?`;
            params.push(avecPiscine);
        }
        
        if (avecGarage !== null) {
            query += ` AND presence_garage = ?`;
            params.push(avecGarage);
        }
        
        if (avecVeranda !== null) {
            query += ` AND presence_veranda = ?`;
            params.push(avecVeranda);
        }
        
        query += ` LIMIT ?`;
        params.push(limit * 2); // Récupérer plus pour filtrer par distance ensuite
        
        // Exécuter la requête
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        
        // Calculer la distance réelle et filtrer
        const transactions = rows
            .map(row => {
                const distance = calculateDistance(lat, lon, row.latitude, row.longitude);
                return {
                    ...row,
                    distance_meters: Math.round(distance)
                };
            })
            .filter(t => t.distance_meters <= radius)
            .sort((a, b) => a.distance_meters - b.distance_meters)
            .slice(0, limit);
        
        // Calculer les statistiques
        const prixM2Bati = transactions
            .map(t => t.prix_m2_bati)
            .filter(p => p !== null && p > 0);
        
        const surfacesBati = transactions
            .map(t => (t.surface_bati_maison || 0) + (t.surface_bati_appartement || 0))
            .filter(s => s > 0);
        
        const statistics = {
            avg_prix_m2_bati: prixM2Bati.length > 0
                ? Math.round(prixM2Bati.reduce((a, b) => a + b, 0) / prixM2Bati.length)
                : null,
            median_prix_m2_bati: prixM2Bati.length > 0
                ? prixM2Bati.sort((a, b) => a - b)[Math.floor(prixM2Bati.length / 2)]
                : null,
            avg_surface_bati: surfacesBati.length > 0
                ? Math.round(surfacesBati.reduce((a, b) => a + b, 0) / surfacesBati.length)
                : null,
            count_with_dpe: transactions.filter(t => t.classe_dpe !== null).length,
            count_with_piscine: transactions.filter(t => t.presence_piscine === 1).length,
            count_with_garage: transactions.filter(t => t.presence_garage === 1).length,
            count_with_veranda: transactions.filter(t => t.presence_veranda === 1).length
        };
        
        db.close();
        
        // Réponse
        res.json({
            success: true,
            count: transactions.length,
            radius_used: radius,
            filters: {
                type_bien: typeBien,
                months_back: monthsBack,
                min_surface: minSurface,
                max_surface: maxSurface,
                classe_dpe: classeDPE,
                avec_piscine: avecPiscine,
                avec_garage: avecGarage,
                avec_veranda: avecVeranda
            },
            transactions,
            statistics
        });
        
    } catch (error) {
        console.error('Erreur route DVF avec features:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la recherche DVF',
            message: error.message
        });
    }
};

