/**
 * Service d'estimation DVF avec pondération DPE
 * 
 * Méthodologie :
 * 1. Récupérer les transactions DVF avec DPE dans un rayon
 * 2. Calculer les écarts réels de prix entre chaque classe DPE
 * 3. Ajuster chaque transaction vers le DPE du bien à estimer
 * 4. Calculer la médiane pondérée
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database', 'dpe_bdnb.db');

// Ordre des classes DPE (A = meilleur, G = pire)
const DPE_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

/**
 * Rechercher les transactions DVF avec DPE dans un rayon
 */
async function searchTransactionsWithDPE(lat, lon, radiusMeters, typeFilter = 'appartement', monthsBack = 24) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error('❌ Erreur ouverture base DPE:', err);
                reject(err);
                return;
            }
        });

        const dateLimite = new Date();
        dateLimite.setMonth(dateLimite.getMonth() - monthsBack);
        const dateLimiteStr = dateLimite.toISOString().split('T')[0].replace(/-/g, '/');

        let query = `
            SELECT 
                batiment_groupe_id,
                valeur_fonciere,
                date_mutation,
                surface_bati_maison,
                surface_bati_appartement,
                surface_terrain,
                nb_pieces,
                prix_m2_local,
                prix_m2_terrain,
                nb_maisons,
                nb_appartements,
                classe_dpe,
                classe_ges,
                surface_habitable_dpe,
                annee_construction,
                conso_energie,
                type_batiment_dpe,
                adresse,
                latitude,
                longitude,
                (6371000 * acos(
                    cos(radians(?)) * cos(radians(latitude)) * 
                    cos(radians(longitude) - radians(?)) + 
                    sin(radians(?)) * sin(radians(latitude))
                )) AS distance
            FROM dvf_avec_dpe
            WHERE classe_dpe IS NOT NULL
            AND classe_dpe != ''
            AND date_mutation >= ?
        `;

        const params = [lat, lon, lat, dateLimiteStr];

        // Filtrer par type de bien
        if (typeFilter === 'appartement') {
            query += ` AND nb_appartements > 0 AND surface_bati_appartement > 0`;
        } else if (typeFilter === 'maison') {
            query += ` AND nb_maisons > 0 AND surface_bati_maison > 0`;
        }

        query += ` HAVING distance < ?`;
        params.push(radiusMeters);

        query += ` ORDER BY distance ASC`;

        db.all(query, params, (err, rows) => {
            db.close();
            if (err) {
                console.error('❌ Erreur recherche transactions:', err);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

/**
 * Calculer le prix/m² médian par classe DPE
 */
function calculerPrixMedianParClasse(transactions) {
    const prixParClasse = {};
    
    // Regrouper les transactions par classe DPE
    transactions.forEach(txn => {
        if (!txn.classe_dpe || !txn.prix_m2_local) return;
        
        if (!prixParClasse[txn.classe_dpe]) {
            prixParClasse[txn.classe_dpe] = [];
        }
        prixParClasse[txn.classe_dpe].push(txn.prix_m2_local);
    });
    
    // Calculer la médiane pour chaque classe
    const medianes = {};
    for (const [classe, prix] of Object.entries(prixParClasse)) {
        prix.sort((a, b) => a - b);
        const mid = Math.floor(prix.length / 2);
        medianes[classe] = prix.length % 2 === 0 
            ? (prix[mid - 1] + prix[mid]) / 2 
            : prix[mid];
    }
    
    return { medianes, counts: Object.fromEntries(Object.entries(prixParClasse).map(([k, v]) => [k, v.length])) };
}

/**
 * Calculer les écarts entre classes DPE adjacentes
 */
function calculerEcartsEntreClasses(medianes) {
    const ecarts = {};
    
    for (let i = 0; i < DPE_ORDER.length - 1; i++) {
        const classeActuelle = DPE_ORDER[i];
        const classeInferieure = DPE_ORDER[i + 1];
        
        if (medianes[classeActuelle] && medianes[classeInferieure]) {
            const ecart = (medianes[classeInferieure] - medianes[classeActuelle]) / medianes[classeActuelle];
            ecarts[`${classeActuelle}->${classeInferieure}`] = ecart;
        }
    }
    
    return ecarts;
}

/**
 * Calculer le facteur d'ajustement pour passer d'une classe DPE à une autre
 */
function getFacteurAjustement(classeSource, classeCible, ecarts, medianes) {
    if (!classeSource || !classeCible || classeSource === classeCible) {
        return 1.0; // Pas d'ajustement si même classe
    }
    
    const indexSource = DPE_ORDER.indexOf(classeSource);
    const indexCible = DPE_ORDER.indexOf(classeCible);
    
    if (indexSource === -1 || indexCible === -1) {
        return 1.0; // Classe inconnue
    }
    
    // Utiliser les médianes observées si disponibles
    if (medianes[classeSource] && medianes[classeCible]) {
        return medianes[classeCible] / medianes[classeSource];
    }
    
    // Sinon, cumuler les écarts entre classes
    let facteur = 1.0;
    const direction = indexCible > indexSource ? 1 : -1; // Descendre ou monter
    
    for (let i = indexSource; i !== indexCible; i += direction) {
        const classeA = DPE_ORDER[i];
        const classeB = DPE_ORDER[i + direction];
        const key = direction === 1 ? `${classeA}->${classeB}` : `${classeB}->${classeA}`;
        
        if (ecarts[key]) {
            facteur *= (1 + ecarts[key]);
        } else if (ecarts[`${classeA}->${classeB}`]) {
            // Utiliser l'écart inverse
            facteur *= (1 - ecarts[`${classeA}->${classeB}`]);
        } else {
            // Écart par défaut : -6% par classe descendante
            facteur *= direction === 1 ? 0.94 : 1.064;
        }
    }
    
    return facteur;
}

/**
 * Ajuster toutes les transactions vers un DPE cible
 */
function ajusterTransactionsVersDPE(transactions, dpeCible, ecarts, medianes) {
    const transactionsAjustees = transactions.map(txn => {
        const facteur = getFacteurAjustement(txn.classe_dpe, dpeCible, ecarts, medianes);
        const prixM2Ajuste = txn.prix_m2_local * facteur;
        
        return {
            ...txn,
            prix_m2_ajuste: prixM2Ajuste,
            facteur_ajustement: facteur
        };
    });
    
    return transactionsAjustees;
}

/**
 * Calculer la médiane d'un tableau de nombres
 */
function calculerMediane(valeurs) {
    if (valeurs.length === 0) return 0;
    
    const sorted = [...valeurs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 === 0 
        ? (sorted[mid - 1] + sorted[mid]) / 2 
        : sorted[mid];
}

/**
 * Fonction principale : Estimation avec pondération DPE
 */
async function estimateWithDPE(lat, lon, dpeCible, typeFilter, radiusMeters, monthsBack = 24) {
    try {
        // 1. Récupérer les transactions avec DPE
        const transactions = await searchTransactionsWithDPE(lat, lon, radiusMeters, typeFilter, monthsBack);
        
        if (transactions.length === 0) {
            return {
                prixMoyenM2: 0,
                prixMedianM2: 0,
                nbTransactions: 0,
                nbAvecDPE: 0,
                fiabilite: 0,
                transactions: [],
                message: 'Aucune transaction trouvée dans le secteur'
            };
        }
        
        const transactionsAvecDPE = transactions.filter(t => t.classe_dpe);
        
        // Si pas de DPE cible ou pas assez de transactions avec DPE, calcul classique
        if (!dpeCible || transactionsAvecDPE.length < 3) {
            const prixM2List = transactions.map(t => t.prix_m2_local).filter(p => p > 0);
            const prixMedian = calculerMediane(prixM2List);
            
            return {
                prixMoyenM2: Math.round(prixMedian),
                prixMedianM2: Math.round(prixMedian),
                nbTransactions: transactions.length,
                nbAvecDPE: transactionsAvecDPE.length,
                fiabilite: Math.min(100, Math.round((transactions.length / 10) * 100)),
                transactions: transactions,
                distributionDPE: getDistributionDPE(transactionsAvecDPE),
                message: 'Calcul sans pondération DPE (données insuffisantes)'
            };
        }
        
        // 2. Calculer les prix médians par classe DPE
        const { medianes, counts } = calculerPrixMedianParClasse(transactionsAvecDPE);
        
        // 3. Calculer les écarts entre classes
        const ecarts = calculerEcartsEntreClasses(medianes);
        
        // 4. Ajuster les transactions vers le DPE cible
        const transactionsAjustees = ajusterTransactionsVersDPE(transactionsAvecDPE, dpeCible, ecarts, medianes);
        
        // 5. Calculer la médiane ajustée
        const prixM2Ajustes = transactionsAjustees.map(t => t.prix_m2_ajuste);
        const prixMedianAjuste = calculerMediane(prixM2Ajustes);
        
        // 6. Calculer la fiabilité
        const fiabilite = Math.min(100, Math.round(
            (transactionsAjustees.length / 15) * 100 * // Nombre de transactions
            (Object.keys(medianes).length / 7) // Diversité des classes DPE
        ));
        
        return {
            prixMoyenM2: Math.round(prixMedianAjuste),
            prixMedianM2: Math.round(prixMedianAjuste),
            nbTransactions: transactions.length,
            nbAvecDPE: transactionsAjustees.length,
            fiabilite: fiabilite,
            transactions: transactionsAjustees,
            distributionDPE: counts,
            medianParClasse: medianes,
            ecartsEntreClasses: ecarts,
            message: `Estimation avec pondération DPE ${dpeCible}`
        };
        
    } catch (error) {
        console.error('❌ Erreur estimation avec DPE:', error);
        throw error;
    }
}

/**
 * Obtenir la distribution des classes DPE
 */
function getDistributionDPE(transactions) {
    const distribution = {};
    transactions.forEach(txn => {
        if (txn.classe_dpe) {
            distribution[txn.classe_dpe] = (distribution[txn.classe_dpe] || 0) + 1;
        }
    });
    return distribution;
}

module.exports = {
    estimateWithDPE,
    searchTransactionsWithDPE,
    calculerPrixMedianParClasse,
    calculerEcartsEntreClasses
};



