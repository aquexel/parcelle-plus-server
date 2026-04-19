#!/usr/bin/env node
const crypto = require('crypto');
/**
 * Crée 1 acheteur + 5 vendeurs fictifs et une annonce (polygone) par vendeur
 * pour tester link-announcement / quotas de contact.
 *
 * Usage:
 *   node scripts/seed-contact-test-data.js [BASE_URL]
 *   PARCELLE_SERVER_URL=http://127.0.0.1:3000 node scripts/seed-contact-test-data.js
 *
 * Variables optionnelles:
 *   PARCELLE_API_KEY     — header X-API-Key si le serveur l'exige
 *   PARCELLE_TEST_PASSWORD — mot de passe commun (défaut: TestContact2026!)
 */

const BASE = process.argv[2] || process.env.PARCELLE_SERVER_URL || 'http://149.202.33.164';
const API_KEY = process.env.PARCELLE_API_KEY || '';
const PASSWORD = process.env.PARCELLE_TEST_PASSWORD || 'TestContact2026!';
const SUFFIX = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function headers(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (API_KEY) h['X-API-Key'] = API_KEY;
    return h;
}

async function postJson(path, body, extraHeaders = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { ...headers(true), ...extraHeaders },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { _raw: text };
    }
    if (!res.ok) {
        const err = new Error(`${path} -> HTTP ${res.status}`);
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

async function register({ username, email, userType }) {
    return postJson('/api/auth/register', {
        username,
        email,
        password: PASSWORD,
        userType: userType || 'buyer',
    });
}

async function login(username) {
    const data = await postJson('/api/auth/login', { username, password: PASSWORD });
    const token = data.user?.user?.token;
    const id = data.user?.user?.id;
    if (!token || !id) throw new Error('Réponse login inattendue (token ou id manquant)');
    return { token, id };
}

/** Même convention que test/test-server.js : { lat, lng }, zone visible carte FR (Landes). */
function frDaxCoordinates(index) {
    const baseLat = 43.7102 + index * 0.0015;
    const baseLng = -1.0578 + index * 0.0004;
    return [
        { lat: baseLat, lng: baseLng },
        { lat: baseLat + 0.0002, lng: baseLng - 0.00015 },
        { lat: baseLat + 0.00015, lng: baseLng + 0.00018 },
        { lat: baseLat, lng: baseLng },
    ];
}

async function postPolygon(token, index) {
    const body = {
        title: `Annonce test contact ${SUFFIX} #${index + 1}`,
        description: 'Jeu de données de test (script seed-contact-test-data.js)',
        coordinates: frDaxCoordinates(index),
        surface: 500 + index * 10,
        commune: 'Dax',
        codeInsee: '40088',
        price: 50000 + index * 1000,
        status: 'available',
        isPublic: true,
        type: 'TERRAIN',
    };
    return postJson('/api/polygons', body, {
        Authorization: `Bearer ${token}`,
        'X-Auth-Token': token,
    });
}

async function main() {
    console.log(`Base: ${BASE}`);
    const buyerUsername = `pp_ct_buy_${SUFFIX}`;
    const buyerEmail = `${buyerUsername}@test.invalid`;

    console.log('Inscription acheteur…');
    await register({ username: buyerUsername, email: buyerEmail, userType: 'buyer' });
    const buyer = await login(buyerUsername);
    console.log(`  OK buyer id=${buyer.id} username=${buyerUsername}`);

    const sellers = [];
    for (let i = 0; i < 5; i++) {
        const username = `pp_ct_sel_${SUFFIX}_${i}`;
        const email = `${username}@test.invalid`;
        console.log(`Inscription vendeur ${i + 1}/5…`);
        await register({ username, email, userType: 'seller' });
        const { token, id } = await login(username);
        console.log(`  Publication annonce…`);
        const polygon = await postPolygon(token, i);
        sellers.push({
            username,
            sellerId: id,
            announcementId: polygon.id,
            title: polygon.title,
        });
        console.log(`  OK seller=${id} annonce=${polygon.id}`);
    }

    console.log('\n--- Récapitulatif (conserver pour vos tests) ---');
    console.log(`Mot de passe commun: ${PASSWORD}`);
    console.log(`Acheteur: ${buyerUsername}  id=${buyer.id}`);
    console.log('\nVendeurs + annonces (JSON):');
    console.log(JSON.stringify({ buyer: { username: buyerUsername, id: buyer.id }, sellers }, null, 2));

    console.log('\nExemple POST /api/conversations/link-announcement (connecté en tant qu’acheteur):');
    const ex = sellers[0];
    const roomId = crypto.randomUUID();
    console.log(
        JSON.stringify(
            {
                roomId,
                announcementId: ex.announcementId,
                buyerId: buyer.id,
                sellerId: ex.sellerId,
            },
            null,
            2
        )
    );
}

main().catch((e) => {
    console.error('Échec:', e.message);
    if (e.body) console.error(JSON.stringify(e.body, null, 2));
    process.exit(1);
});
