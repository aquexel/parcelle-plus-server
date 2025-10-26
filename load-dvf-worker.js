const { workerData, parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Database = require('better-sqlite3');

const { filePath, dbFile, year } = workerData;

// Ouvrir la base en mode WAL pour permettre les accès concurrents
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

let count = 0;
const BATCH_SIZE = 100000;
const transactions = [];

function normalizeDate(dateStr) {
    if (!dateStr || dateStr === '') return null;
    const cleaned = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        return cleaned;
    }
    const match = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
        const [, day, month, yr] = match;
        return `${yr}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    const match2 = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match2) {
        const [, yr, month, day] = match2;
        return `${yr}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
}

const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO dvf_bdnb_complete VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
`);

const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
        insertStmt.run(
            row.id_mutation,
            row.date_mutation,
            row.valeur_fonciere,
            row.code_commune,
            row.nom_commune,
            row.code_departement,
            row.type_local,
            row.surface_reelle_bati,
            row.nombre_pieces_principales,
            row.nature_culture,
            row.surface_terrain,
            row.longitude,
            row.latitude,
            row.annee_source,
            row.prix_m2_bati,
            row.prix_m2_terrain,
            row.id_parcelle,
            row.batiment_groupe_id,
            row.classe_dpe,
            row.orientation_principale,
            row.pourcentage_vitrage,
            0, // presence_piscine
            0, // presence_garage
            0, // presence_veranda
            row.type_dpe,
            row.dpe_officiel,
            row.surface_habitable_logement,
            row.date_etablissement_dpe
        );
    }
});

fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => {
        const idMutation = row.id_mutation?.trim();
        const valeurFonciere = parseFloat(row.valeur_fonciere) || 0;
        
        if (!idMutation || valeurFonciere <= 0) return;
        
        const transaction = {
            id_mutation: idMutation,
            date_mutation: normalizeDate(row.date_mutation?.trim()),
            valeur_fonciere: valeurFonciere,
            code_commune: row.code_commune?.trim(),
            nom_commune: row.nom_commune?.trim(),
            code_departement: row.code_departement?.trim(),
            type_local: row.type_local?.trim(),
            surface_reelle_bati: parseFloat(row.surface_reelle_bati) || null,
            nombre_pieces_principales: parseInt(row.nombre_pieces_principales) || null,
            nature_culture: row.nature_culture?.trim(),
            surface_terrain: parseFloat(row.surface_terrain) || null,
            longitude: parseFloat(row.longitude) || null,
            latitude: parseFloat(row.latitude) || null,
            annee_source: year,
            prix_m2_bati: null,
            prix_m2_terrain: null,
            id_parcelle: row.id_parcelle?.trim(),
            batiment_groupe_id: null,
            classe_dpe: null,
            orientation_principale: null,
            pourcentage_vitrage: null,
            type_dpe: null,
            dpe_officiel: 1,
            surface_habitable_logement: null,
            date_etablissement_dpe: null
        };
        
        transactions.push(transaction);
        count++;
        
        // Insérer par batch
        if (transactions.length >= BATCH_SIZE) {
            insertBatch(transactions);
            transactions.length = 0;
        }
    })
    .on('end', () => {
        // Insérer les dernières transactions
        if (transactions.length > 0) {
            insertBatch(transactions);
        }
        
        parentPort.postMessage({
            type: 'done',
            count: count,
            year: year
        });
        db.close();
    })
    .on('error', (error) => {
        parentPort.postMessage({
            type: 'error',
            error: error.message,
            year: year
        });
        db.close();
    });

