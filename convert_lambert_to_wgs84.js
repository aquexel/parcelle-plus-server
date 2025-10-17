/**
 * Conversion Lambert 93 (EPSG:2154) vers WGS84 (EPSG:4326)
 * Formules de conversion approximatives pour la France métropolitaine
 */

// Constantes Lambert 93
const LAMBERT93 = {
    n: 0.7256077650,
    c: 11754255.426,
    xs: 700000,
    ys: 12655612.050,
    e: 0.0818191910428
};

// Constantes WGS84
const WGS84_A = 6378137; // demi grand axe
const WGS84_E = 0.08181919104281579; // excentricité

/**
 * Convertit des coordonnées Lambert 93 en WGS84
 * @param {number} x - Coordonnée X Lambert 93 (en mètres)
 * @param {number} y - Coordonnée Y Lambert 93 (en mètres)
 * @returns {{lat: number, lng: number}} Coordonnées WGS84 (degrés)
 */
function lambert93ToWGS84(x, y) {
    // Conversion Lambert93 -> géographiques
    const R = Math.sqrt((x - LAMBERT93.xs) ** 2 + (y - LAMBERT93.ys) ** 2);
    const gamma = Math.atan((x - LAMBERT93.xs) / (LAMBERT93.ys - y));
    const lon = gamma / LAMBERT93.n + (3 * Math.PI / 180); // longitude centrale à 3°E
    
    const latIso = -1 / LAMBERT93.n * Math.log(Math.abs(R / LAMBERT93.c));
    let lat = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
    
    // Itération pour améliorer la précision
    let diff = 1;
    while (Math.abs(diff) > 1e-10) {
        const latNext = 2 * Math.atan(
            Math.pow(
                (1 + LAMBERT93.e * Math.sin(lat)) / (1 - LAMBERT93.e * Math.sin(lat)),
                LAMBERT93.e / 2
            ) * Math.exp(latIso)
        ) - Math.PI / 2;
        diff = latNext - lat;
        lat = latNext;
    }
    
    return {
        lat: lat * 180 / Math.PI,
        lng: lon * 180 / Math.PI
    };
}

/**
 * Parse une géométrie WKT et extrait le centroïde
 * @param {string} wkt - Géométrie au format WKT (POINT, POLYGON, MULTIPOLYGON)
 * @returns {{x: number, y: number} | null} Centroïde en Lambert 93
 */
function extractCentroidFromWKT(wkt) {
    if (!wkt || typeof wkt !== 'string') return null;
    
    // Extraire tous les nombres (coordonnées)
    const coordsMatch = wkt.match(/[\d.]+/g);
    if (!coordsMatch || coordsMatch.length < 2) return null;
    
    const coords = coordsMatch.map(Number);
    
    // Séparer X et Y
    const xCoords = [];
    const yCoords = [];
    for (let i = 0; i < coords.length; i += 2) {
        if (coords[i] && coords[i+1]) {
            xCoords.push(coords[i]);
            yCoords.push(coords[i+1]);
        }
    }
    
    if (xCoords.length === 0 || yCoords.length === 0) return null;
    
    // Calculer le centroïde (moyenne des coordonnées)
    const centroidX = xCoords.reduce((a, b) => a + b, 0) / xCoords.length;
    const centroidY = yCoords.reduce((a, b) => a + b, 0) / yCoords.length;
    
    return { x: centroidX, y: centroidY };
}

/**
 * Convertit une géométrie WKT Lambert 93 en coordonnées WGS84
 * @param {string} wkt - Géométrie au format WKT
 * @returns {{lat: number, lng: number} | null} Coordonnées WGS84 ou null si erreur
 */
function wktLambert93ToWGS84(wkt) {
    const centroid = extractCentroidFromWKT(wkt);
    if (!centroid) return null;
    
    const wgs84 = lambert93ToWGS84(centroid.x, centroid.y);
    
    // Vérifier que les coordonnées sont valides pour la France
    if (wgs84.lat < 41 || wgs84.lat > 51 || wgs84.lng < -5 || wgs84.lng > 10) {
        return null; // Hors limites France
    }
    
    return wgs84;
}

module.exports = {
    lambert93ToWGS84,
    extractCentroidFromWKT,
    wktLambert93ToWGS84
};

// Test si exécuté directement
if (require.main === module) {
    // Test avec des coordonnées Lambert 93 connues
    const testCases = [
        { x: 652000, y: 6862000, name: "Paris (approximatif)" },
        { x: 351771, y: 6288488, name: "Saubrigues (40)" }
    ];
    
    console.log('🧪 Tests de conversion Lambert 93 → WGS84\n');
    testCases.forEach(test => {
        const result = lambert93ToWGS84(test.x, test.y);
        console.log(`📍 ${test.name}`);
        console.log(`   Lambert93: (${test.x}, ${test.y})`);
        console.log(`   WGS84: (${result.lat.toFixed(6)}, ${result.lng.toFixed(6)})\n`);
    });
    
    // Test WKT
    const testWKT = 'MULTIPOLYGON (((351771.0 6288488.2,351771.772565839 6288490.48090867,351775.774249686 6288500.3941369,351777.684146164 6288499.70945704,351772.37216938 6288487.61192741,351771.0 6288488.2)))';
    console.log('🧪 Test parsing WKT\n');
    console.log(`WKT: ${testWKT.substring(0, 80)}...`);
    const wgs84 = wktLambert93ToWGS84(testWKT);
    if (wgs84) {
        console.log(`✅ Centroïde WGS84: (${wgs84.lat.toFixed(6)}, ${wgs84.lng.toFixed(6)})`);
    } else {
        console.log('❌ Erreur parsing WKT');
    }
}


