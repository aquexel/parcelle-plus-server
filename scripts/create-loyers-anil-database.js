#!/usr/bin/env node
/**
 * Télécharge les 4 CSV « Carte des loyers 2025 » (data.gouv) et construit database/loyers_anil.db
 *
 * Jeu de données : https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025
 *
 * Usage : node scripts/create-loyers-anil-database.js
 * Prérequis : npm install (csv-parser, better-sqlite3)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const csv = require('csv-parser');

const ROOT = path.join(__dirname, '..');
const OUT_DB = path.join(ROOT, 'database', 'loyers_anil.db');
const TMP_DIR = path.join(ROOT, 'tmp_loyers_import');

const SOURCES = [
    {
        segment: 'APP',
        url: 'https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/20251211-145010/pred-app-mef-dhup.csv',
        file: 'pred-app-mef-dhup.csv'
    },
    {
        segment: 'APP12',
        url: 'https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/20251211-144934/pred-app12-mef-dhup.csv',
        file: 'pred-app12-mef-dhup.csv'
    },
    {
        segment: 'APP3',
        url: 'https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/20251211-144951/pred-app3-mef-dhup.csv',
        file: 'pred-app3-mef-dhup.csv'
    },
    {
        segment: 'MAISON',
        url: 'https://static.data.gouv.fr/resources/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/20251211-145039/pred-mai-mef-dhup.csv',
        file: 'pred-mai-mef-dhup.csv'
    }
];

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const tmp = dest + '.part';
        const file = fs.createWriteStream(tmp);
        const req = https.get(url, { headers: { 'User-Agent': 'ParcellePlus-loyers-import/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlink(tmp, () => {});
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(tmp, () => {});
                return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    fs.rename(tmp, dest, (e) => (e ? reject(e) : resolve()));
                });
            });
        });
        req.on('error', (err) => {
            file.close();
            fs.unlink(tmp, () => {});
            reject(err);
        });
    });
}

function stripQuotes(s) {
    if (s == null) return '';
    let t = String(s).trim();
    if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
    return t;
}

function parseFrFloat(s) {
    const t = stripQuotes(s).replace(/\s/g, '').replace(',', '.');
    if (!t) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
}

function parseFrInt(s) {
    const t = stripQuotes(s).replace(/\s/g, '');
    if (!t) return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
}

function normalizeHeader(h) {
    return String(h || '')
        .replace(/^\uFEFF/, '')
        .replace(/^"|"$/g, '')
        .trim();
}

/** INSEE métropole (5 chiffres) ou Corse 2A### / 2B### comme dans les CSV ANIL. */
function normalizeInseeCsv(raw) {
    const t = stripQuotes(raw).replace(/\s/g, '').toUpperCase();
    if (!t) return null;
    if (/^2[AB]\d{3}$/.test(t)) return t;
    const digits = t.replace(/\D/g, '');
    if (!digits || !/^\d+$/.test(digits)) return null;
    const code = digits.padStart(5, '0');
    return /^\d{5}$/.test(code) ? code : null;
}

async function importCsvFile(db, segment, filePath) {
    const insert = db.prepare(`INSERT OR REPLACE INTO loyers_communes (
        code_insee, segment, libgeo, dep, reg, loypredm2, lwr_ipm2, upr_ipm2, typpred, nbobs_com, nbobs_mail, r2_adj
    ) VALUES (@code_insee,@segment,@libgeo,@dep,@reg,@loypredm2,@lwr_ipm2,@upr_ipm2,@typpred,@nbobs_com,@nbobs_mail,@r2_adj)`);

    const batch = db.transaction((rows) => {
        for (const r of rows) insert.run(r);
    });

    let buffer = [];
    const CHUNK = 800;

    await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(
                csv({
                    separator: ';',
                    mapHeaders: ({ header }) => normalizeHeader(header)
                })
            )
            .on('data', (row) => {
                const rawCode = stripQuotes(row.INSEE_C || row.insee_c);
                const code = normalizeInseeCsv(rawCode);
                if (!code) return;

                const lwrKey = Object.keys(row).find((k) => k.toLowerCase().includes('lwr') && k.toLowerCase().includes('ipm'));
                const uprKey = Object.keys(row).find((k) => k.toLowerCase().includes('upr') && k.toLowerCase().includes('ipm'));

                buffer.push({
                    code_insee: code,
                    segment,
                    libgeo: stripQuotes(row.LIBGEO || ''),
                    dep: stripQuotes(row.DEP || ''),
                    reg: stripQuotes(row.REG || ''),
                    loypredm2: parseFrFloat(row.loypredm2),
                    lwr_ipm2: lwrKey ? parseFrFloat(row[lwrKey]) : null,
                    upr_ipm2: uprKey ? parseFrFloat(row[uprKey]) : null,
                    typpred: stripQuotes(row.TYPPRED || ''),
                    nbobs_com: parseFrInt(row.nbobs_com),
                    nbobs_mail: parseFrInt(row.nbobs_mail),
                    r2_adj: parseFrFloat(row.R2_adj)
                });

                if (buffer.length >= CHUNK) {
                    batch(buffer);
                    buffer = [];
                }
            })
            .on('end', () => {
                if (buffer.length) batch(buffer);
                resolve();
            })
            .on('error', reject);
    });
}

async function main() {
    if (!fs.existsSync(path.join(ROOT, 'database'))) {
        fs.mkdirSync(path.join(ROOT, 'database'), { recursive: true });
    }
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

    console.log('📥 Téléchargement des CSV ANIL (carte des loyers 2025)…');
    for (const s of SOURCES) {
        const dest = path.join(TMP_DIR, s.file);
        if (!fs.existsSync(dest)) {
            console.log(`   → ${s.segment}: ${s.url}`);
            await downloadFile(s.url, dest);
        } else {
            console.log(`   (fichier déjà présent) ${s.file}`);
        }
    }

    if (fs.existsSync(OUT_DB)) fs.unlinkSync(OUT_DB);

    const Database = require('better-sqlite3');
    const db = new Database(OUT_DB);
    db.exec(`
        CREATE TABLE loyers_communes (
            code_insee TEXT NOT NULL,
            segment TEXT NOT NULL,
            libgeo TEXT,
            dep TEXT,
            reg TEXT,
            loypredm2 REAL,
            lwr_ipm2 REAL,
            upr_ipm2 REAL,
            typpred TEXT,
            nbobs_com INTEGER,
            nbobs_mail INTEGER,
            r2_adj REAL,
            PRIMARY KEY (code_insee, segment)
        );
        CREATE INDEX idx_loyers_communes_dep ON loyers_communes(dep);
    `);

    for (const s of SOURCES) {
        const fp = path.join(TMP_DIR, s.file);
        console.log(`📊 Import ${s.segment}…`);
        await importCsvFile(db, s.segment, fp);
    }

    const n = db.prepare('SELECT COUNT(*) AS c FROM loyers_communes').get().c;
    db.close();

    const mb = (fs.statSync(OUT_DB).size / (1024 * 1024)).toFixed(2);
    console.log(`✅ Base créée : ${OUT_DB} (${mb} Mo, ${n} lignes)`);
    console.log('   Mention légale : Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin');
}

main().catch((e) => {
    console.error('❌', e);
    process.exit(1);
});
