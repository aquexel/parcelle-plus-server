const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Database = require('better-sqlite3');

const { filePath, tableName, dbFile, taskType } = workerData;

// Ouvrir la base en mode WAL pour permettre les accès concurrents
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

let count = 0;
let insertStmt;

// Préparer l'insertion selon la table
if (tableName === 'temp_bdnb_relations') {
    insertStmt = db.prepare(`INSERT OR IGNORE INTO temp_bdnb_relations VALUES (?, ?)`);
} else if (tableName === 'temp_bdnb_batiment') {
    insertStmt = db.prepare(`INSERT OR IGNORE INTO temp_bdnb_batiment VALUES (?, ?, ?, ?, ?, ?, ?)`);
} else if (tableName === 'temp_bdnb_dpe') {
    insertStmt = db.prepare(`INSERT OR IGNORE INTO temp_bdnb_dpe VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
} else if (tableName === 'temp_bdnb_parcelle') {
    insertStmt = db.prepare(`INSERT OR REPLACE INTO temp_bdnb_parcelle VALUES (?, ?, ?)`);
} else if (tableName === 'temp_parcelle_sitadel') {
    insertStmt = db.prepare(`INSERT OR REPLACE INTO temp_parcelle_sitadel VALUES (?, ?, ?)`);
}

function normalizeDate(dateStr) {
    if (!dateStr || dateStr === '') return null;
    const cleaned = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        return cleaned;
    }
    const match = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
        const [, day, month, year] = match;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    const match2 = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match2) {
        const [, year, month, day] = match2;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
}

function processRow(row, tableName) {
    if (tableName === 'temp_bdnb_relations') {
        const parcelleId = row.parcelle_id?.trim();
        const batimentId = row.batiment_groupe_id?.trim();
        if (parcelleId && batimentId) {
            return { parcelle_id: parcelleId, batiment_groupe_id: batimentId };
        }
    } else if (tableName === 'temp_bdnb_batiment') {
        const id = row.batiment_groupe_id?.trim();
        const commune = row.code_commune_insee?.trim();
        const nomCommune = row.libelle_commune_insee?.trim();
        const longitude = parseFloat(row.longitude) || null;
        const latitude = parseFloat(row.latitude) || null;
        const geomGroupe = row.geom_groupe?.trim() || null;
        const sGeomGroupe = parseFloat(row.s_geom_groupe) || null;
        
        if (id) {
            return {
                batiment_groupe_id: id,
                code_commune_insee: commune,
                libelle_commune_insee: nomCommune,
                longitude: longitude,
                latitude: latitude,
                geom_groupe: geomGroupe,
                s_geom_groupe: sGeomGroupe
            };
        }
    } else if (tableName === 'temp_bdnb_dpe') {
        const id = row.batiment_groupe_id?.trim();
        const dpe = row.classe_bilan_dpe?.trim();
        const orientation = 'mixte';
        const pourcentageVitrage = parseFloat(row.pourcentage_surface_baie_vitree_exterieur) || null;
        const surfaceHabitableLogement = parseFloat(row.surface_habitable_logement) || null;
        const dateEtablissementDpe = normalizeDate(row.date_etablissement_dpe?.trim()) || null;
        const presencePiscine = parseInt(row.presence_piscine) || 0;
        const presenceGarage = parseInt(row.presence_garage) || 0;
        const presenceVeranda = parseInt(row.presence_veranda) || 0;
        const typeDpe = row.type_dpe?.trim();
        const isDpeOfficiel = typeDpe === 'DPE' || !typeDpe;
        
        if (id && dpe && dpe !== 'N' && dpe !== '') {
            return {
                batiment_groupe_id: id,
                classe_dpe: dpe,
                orientation_principale: orientation,
                pourcentage_vitrage: pourcentageVitrage,
                surface_habitable_logement: surfaceHabitableLogement,
                date_etablissement_dpe: dateEtablissementDpe,
                presence_piscine: presencePiscine,
                presence_garage: presenceGarage,
                presence_veranda: presenceVeranda,
                type_dpe: typeDpe,
                dpe_officiel: isDpeOfficiel ? 1 : 0
            };
        }
    } else if (tableName === 'temp_bdnb_parcelle') {
        const parcelleId = row.parcelle_id?.trim();
        const surfaceGeomParcelle = parseFloat(row.s_geom_parcelle) || null;
        const geomParcelle = row.geom_parcelle?.trim() || null;
        
        if (parcelleId) {
            return {
                parcelle_id: parcelleId,
                surface_geom_parcelle: surfaceGeomParcelle,
                geom_parcelle: geomParcelle
            };
        }
    } else if (tableName === 'temp_parcelle_sitadel') {
        const parcelleId = row.parcelle_id?.trim();
        const indicateurPiscine = parseInt(row.indicateur_piscine) || 0;
        const indicateurGarage = parseInt(row.indicateur_garage) || 0;
        
        if (parcelleId) {
            return {
                parcelle_id: parcelleId,
                indicateur_piscine: indicateurPiscine,
                indicateur_garage: indicateurGarage
            };
        }
    }
    return null;
}

fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => {
        const processedRow = processRow(row, tableName);
        if (processedRow) {
            try {
                if (tableName === 'temp_bdnb_relations') {
                    insertStmt.run(processedRow.parcelle_id, processedRow.batiment_groupe_id);
                } else if (tableName === 'temp_bdnb_batiment') {
                    insertStmt.run(processedRow.batiment_groupe_id, processedRow.code_commune_insee, processedRow.libelle_commune_insee, processedRow.longitude, processedRow.latitude, processedRow.geom_groupe, processedRow.s_geom_groupe);
                } else if (tableName === 'temp_bdnb_dpe') {
                    insertStmt.run(processedRow.batiment_groupe_id, processedRow.classe_dpe, processedRow.orientation_principale, processedRow.pourcentage_vitrage, processedRow.surface_habitable_logement, processedRow.date_etablissement_dpe, processedRow.presence_piscine, processedRow.presence_garage, processedRow.presence_veranda, processedRow.type_dpe, processedRow.dpe_officiel);
                } else if (tableName === 'temp_bdnb_parcelle') {
                    insertStmt.run(processedRow.parcelle_id, processedRow.surface_geom_parcelle, processedRow.geom_parcelle);
                } else if (tableName === 'temp_parcelle_sitadel') {
                    insertStmt.run(processedRow.parcelle_id, processedRow.indicateur_piscine, processedRow.indicateur_garage);
                }
                count++;
            } catch (error) {
                // Ignorer les erreurs de contrainte
            }
        }
    })
    .on('end', () => {
        parentPort.postMessage({
            type: 'done',
            count: count,
            tableName: tableName
        });
        db.close();
    })
    .on('error', (error) => {
        parentPort.postMessage({
            type: 'error',
            error: error.message,
            tableName: tableName
        });
        db.close();
    });

