/**
 * 📡 ROUTE API : Prix SAFER par commune
 * 
 * Retourne les prix des terres agricoles et forêts par code INSEE
 * pour l'estimation des terrains en zones A (agricole) et N (forestière) du PLU
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'database');
const DB_PATH = path.join(DB_DIR, 'safer_prices.db');

// Créer le répertoire database s'il n'existe pas
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

/**
 * Route principale
 */
module.exports = (req, res) => {
    try {
        const codeInsee = req.query.code_insee;
        
        console.log('\n[SAFER][REQ] =================================================================');
        console.log('[SAFER][REQ] Code INSEE:', codeInsee);
        
        // Validation
        if (!codeInsee || codeInsee.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Paramètre code_insee obligatoire'
            });
        }
        
        // Vérifier que le code INSEE est valide (5 chiffres)
        if (!/^\d{5}$/.test(codeInsee.trim())) {
            return res.status(400).json({
                success: false,
                error: 'Code INSEE invalide (doit être 5 chiffres)'
            });
        }
        
        // Vérifier que la base de données existe
        if (!fs.existsSync(DB_PATH)) {
            return res.status(503).json({
                success: false,
                error: 'Base de données SAFER non disponible',
                message: `Le fichier ${DB_PATH} n'existe pas. Veuillez exécuter le script de création de la base de données.`
            });
        }
        
        // Ouvrir la base de données
        let db;
        try {
            db = new Database(DB_PATH, { readonly: true });
        } catch (error) {
            console.error('[SAFER][ERROR] Impossible d\'ouvrir la base SAFER:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Base de données SAFER indisponible'
            });
        }
        
        // Rechercher les prix pour cette commune
        const query = `
            SELECT 
                code_insee,
                departement_code,
                departement_nom,
                commune_nom,
                prix_terre_ha,
                annee_terre,
                nombre_ventes_terre,
                prix_foret_ha,
                annee_foret,
                nombre_ventes_foret,
                source_terre_url,
                source_foret_url
            FROM safer_prices
            WHERE code_insee = ?
        `;
        
        const result = db.prepare(query).get(codeInsee.trim());
        
        db.close();
        
        if (!result) {
            console.log('[SAFER][RESP] Aucune donnée trouvée pour code INSEE:', codeInsee);
            return res.status(404).json({
                success: false,
                error: 'Aucune donnée SAFER trouvée pour ce code INSEE'
            });
        }
        
        // Convertir les prix par hectare en prix par m² (diviser par 10000)
        const prixTerreM2 = result.prix_terre_ha ? result.prix_terre_ha / 10000 : null;
        const prixForetM2 = result.prix_foret_ha ? result.prix_foret_ha / 10000 : null;
        
        const response = {
            success: true,
            code_insee: result.code_insee,
            commune: {
                nom: result.commune_nom,
                departement_code: result.departement_code,
                departement_nom: result.departement_nom
            },
            prix_terre: {
                prix_ha: result.prix_terre_ha,
                prix_m2: prixTerreM2,
                annee: result.annee_terre,
                nombre_ventes: result.nombre_ventes_terre,
                source_url: result.source_terre_url
            },
            prix_foret: {
                prix_ha: result.prix_foret_ha,
                prix_m2: prixForetM2,
                annee: result.annee_foret,
                nombre_ventes: result.nombre_ventes_foret,
                source_url: result.source_foret_url
            }
        };
        
        console.log('[SAFER][RESP] Données trouvées:', {
            commune: result.commune_nom,
            prix_terre_m2: prixTerreM2,
            prix_foret_m2: prixForetM2
        });
        
        res.json(response);
        
    } catch (error) {
        console.error('[SAFER][ERROR] Erreur:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération des prix SAFER',
            details: error.message
        });
    }
};

