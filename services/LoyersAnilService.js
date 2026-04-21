/**
 * Lecture de la base SQLite « Carte des loyers » ANIL / data.gouv (2025).
 * Source des fichiers : https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025
 * Mention obligatoire : « Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin ».
 */
const fs = require('fs');
const path = require('path');

const DB_FILENAME = 'loyers_anil.db';

/** Métropole : 5 chiffres. Corse : 2A ou 2B + 3 chiffres (ex. 2A004, 2B108). */
function isValidCommuneInseeCode(code) {
    const c = String(code || '').trim().toUpperCase();
    if (/^\d{5}$/.test(c)) return true;
    if (/^2[AB]\d{3}$/.test(c)) return true;
    return false;
}

/**
 * Normalise une saisie ou une valeur API vers la clé stockée en base.
 * @param {string} code
 * @returns {string} chaîne vide si non reconnue
 */
function normalizeCommuneInseeInput(code) {
    const s = String(code || '').trim();
    if (!s) return '';
    const up = s.toUpperCase();
    if (/^2[AB]\d{3}$/.test(up)) return up;
    if (/^\d{5}$/.test(up)) return up;
    if (/^\d{1,5}$/.test(up)) return up.padStart(5, '0');
    return '';
}

const REFERENCE_M2 = {
    APP: 52,
    APP12: 37,
    APP3: 72,
    MAISON: 92
};

const SEGMENT_LABELS = {
    APP: 'Appartement (toutes typologies, réf. 52 m²)',
    APP12: 'Appartement T1–T2 (réf. 37 m²)',
    APP3: 'Appartement T3+ (réf. 72 m²)',
    MAISON: 'Maison (réf. 92 m²)'
};

class LoyersAnilService {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', DB_FILENAME);
    }

    isAvailable() {
        return fs.existsSync(this.dbPath);
    }

    /**
     * @param {string} codeInsee 5 chiffres ou Corse 2A### / 2B###
     * @returns {object|null}
     */
    getCommuneRows(codeInsee) {
        if (!this.isAvailable()) return null;
        const code = normalizeCommuneInseeInput(codeInsee);
        if (!isValidCommuneInseeCode(code)) return null;
        const Database = require('better-sqlite3');
        const db = new Database(this.dbPath, { readonly: true });
        try {
            const rows = db
                .prepare(
                    `SELECT code_insee, segment, libgeo, dep, reg, loypredm2, lwr_ipm2, upr_ipm2, typpred, nbobs_com, nbobs_mail, r2_adj
                     FROM loyers_communes WHERE code_insee = ? ORDER BY segment`
                )
                .all(code);
            return rows.length ? rows : null;
        } finally {
            db.close();
        }
    }

    buildCommunePayload(codeInsee) {
        const rows = this.getCommuneRows(codeInsee);
        if (!rows) return null;
        const canonicalCode = rows[0].code_insee || normalizeCommuneInseeInput(codeInsee);

        const libgeo = rows[0].libgeo || '';
        const segments = rows.map((r) => {
            const refM2 = REFERENCE_M2[r.segment] || 52;
            const loy = r.loypredm2 != null ? Number(r.loypredm2) : null;
            const low = r.lwr_ipm2 != null ? Number(r.lwr_ipm2) : null;
            const high = r.upr_ipm2 != null ? Number(r.upr_ipm2) : null;
            return {
                segment: r.segment,
                label: SEGMENT_LABELS[r.segment] || r.segment,
                referenceSurfaceM2: refM2,
                loypredm2: loy,
                lwrIpM2: low,
                uprIpM2: high,
                monthlyRentPred: loy != null ? Math.round(loy * refM2) : null,
                monthlyRentLow: low != null ? Math.round(low * refM2) : null,
                monthlyRentHigh: high != null ? Math.round(high * refM2) : null,
                typpred: r.typpred,
                nbobsCom: r.nbobs_com,
                nbobsMail: r.nbobs_mail,
                r2Adj: r.r2_adj != null ? Number(r.r2_adj) : null
            };
        });

        return {
            codeInsee: canonicalCode,
            libgeo,
            sourceAttribution:
                'Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin',
            datasetTitle: "Carte des loyers — indicateurs d'annonces par commune (2025)",
            datasetUrl:
                'https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025',
            caution:
                'Indicateurs expérimentaux (loyers charges comprises, annonces non meublées). Prudence si R² < 0,5, nb. observations < 30 ou intervalle large.',
            segments
        };
    }

    /**
     * Loyer mensuel estimé = loyer au m² × surface (même logique locataire / bailleur).
     */
    estimate(codeInsee, segment, surfaceM2) {
        const rows = this.getCommuneRows(codeInsee);
        if (!rows) return null;
        const canonicalCode = rows[0].code_insee || normalizeCommuneInseeInput(codeInsee);
        const row = rows.find((r) => r.segment === segment);
        if (!row || surfaceM2 <= 0) return null;
        const s = Number(surfaceM2);
        const loy = row.loypredm2 != null ? Number(row.loypredm2) : null;
        const low = row.lwr_ipm2 != null ? Number(row.lwr_ipm2) : null;
        const high = row.upr_ipm2 != null ? Number(row.upr_ipm2) : null;
        return {
            codeInsee: canonicalCode,
            segment,
            surfaceM2: s,
            loypredm2: loy,
            lwrIpM2: low,
            uprIpM2: high,
            monthlyRentPred: loy != null ? Math.round(loy * s) : null,
            monthlyRentLow: low != null ? Math.round(low * s) : null,
            monthlyRentHigh: high != null ? Math.round(high * s) : null,
            libgeo: row.libgeo,
            sourceAttribution:
                'Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin'
        };
    }

    /**
     * Loyers prédits au m² pour une liste de codes INSEE et un segment (APP, APP12, APP3, MAISON).
     * @param {string[]} codeInsees
     * @param {string} segment
     * @returns {{ codeInsee: string, libgeo: string, loypredm2: number|null }[]}
     */
    getLoypredForCodes(codeInsees, segment) {
        if (!this.isAvailable() || !codeInsees || codeInsees.length === 0) return [];
        const uniq = [
            ...new Set(codeInsees.map((c) => normalizeCommuneInseeInput(c)).filter((c) => c && isValidCommuneInseeCode(c)))
        ];
        if (!uniq.length) return [];
        const cap = uniq.slice(0, 400);
        const Database = require('better-sqlite3');
        const db = new Database(this.dbPath, { readonly: true });
        try {
            const placeholders = cap.map(() => '?').join(',');
            const rows = db
                .prepare(
                    `SELECT code_insee, libgeo, loypredm2 FROM loyers_communes WHERE segment = ? AND code_insee IN (${placeholders})`
                )
                .all(segment, ...cap);
            return rows.map((r) => ({
                codeInsee: r.code_insee,
                libgeo: r.libgeo || '',
                loypredm2: r.loypredm2 != null ? Number(r.loypredm2) : null
            }));
        } finally {
            db.close();
        }
    }
}

module.exports = {
    LoyersAnilService,
    REFERENCE_M2,
    SEGMENT_LABELS,
    DB_FILENAME,
    isValidCommuneInseeCode,
    normalizeCommuneInseeInput
};
