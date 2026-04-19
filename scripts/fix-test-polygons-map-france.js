#!/usr/bin/env node
/**
 * Repositionne les annonces de test (CommuneTest / TestCommune / titre "test contact")
 * sur une zone visible en France (Landes, près de Dax), au format { lat, lng } comme test/test-server.js.
 *
 * Utilise PUT /api/polygons/:id (sans auth sur les déploiements actuels — à sécuriser côté serveur si besoin).
 *
 *   node scripts/fix-test-polygons-map-france.js [BASE_URL]
 *   PARCELLE_API_KEY=... PARCELLE_SERVER_URL=... node scripts/fix-test-polygons-map-france.js
 */

const BASE = process.argv[2] || process.env.PARCELLE_SERVER_URL || 'http://149.202.33.164';
const API_KEY = process.env.PARCELLE_API_KEY || '';

function headers(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (API_KEY) h['X-API-Key'] = API_KEY;
    return h;
}

function coordsForIndex(i) {
    const baseLat = 43.7102 + i * 0.0015;
    const baseLng = -1.0578 + i * 0.0004;
    return [
        { lat: baseLat, lng: baseLng },
        { lat: baseLat + 0.0002, lng: baseLng - 0.00015 },
        { lat: baseLat + 0.00015, lng: baseLng + 0.00018 },
        { lat: baseLat, lng: baseLng },
    ];
}

function isTestPolygon(p) {
    const c = (p.commune || '').trim();
    const t = (p.title || '') + (p.description || '');
    if (c === 'CommuneTest' || c === 'TestCommune') return true;
    if (/test contact|Test API auto|seed-contact-test-data/i.test(t)) return true;
    return false;
}

async function main() {
    const lim = process.env.PARCELLE_PUBLIC_LIMIT || '500';
    const res = await fetch(`${BASE}/api/polygons/public?limit=${lim}`, { headers: headers(false) });
    if (!res.ok) throw new Error(`GET public -> ${res.status}`);
    const list = await res.json();
    const targets = list.filter(isTestPolygon);
    if (targets.length === 0) {
        console.log('Aucune annonce de test à corriger (filtre commune/titre).');
        return;
    }
    console.log(`Base: ${BASE} — ${targets.length} annonce(s) à repositionner.`);
    let i = 0;
    for (const p of targets) {
        const body = {
            coordinates: coordsForIndex(i),
            commune: 'Dax',
            codeInsee: '40088',
        };
        const put = await fetch(`${BASE}/api/polygons/${p.id}`, {
            method: 'PUT',
            headers: headers(true),
            body: JSON.stringify(body),
        });
        const text = await put.text();
        if (!put.ok) {
            console.error(`Échec ${p.id}: HTTP ${put.status} ${text}`);
            continue;
        }
        console.log(`OK ${p.id} — ${p.title || ''}`);
        i += 1;
    }
    console.log('Terminé. Ouvrez la carte autour de Dax (Landes) pour voir les marqueurs.');
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
