// Conversion Lambert 93 vers GPS (WGS84) - Version simplifiée
// Basée sur les formules de transformation officielles françaises

/**
 * Convertit des coordonnées Lambert 93 vers GPS (WGS84)
 * @param {number} x - Coordonnée X Lambert 93
 * @param {number} y - Coordonnée Y Lambert 93
 * @returns {Object} {longitude, latitude} en degrés décimaux
 */
function lambert93ToGPS(x, y) {
    // Paramètres de la projection Lambert 93
    const a = 6378137.0; // Demi-grand axe de l'ellipsoïde GRS80
    const e = 0.081819191; // Première excentricité
    const n = 0.7256077650; // Exposant de la projection
    const c = 11754255.426; // Constante de la projection
    const xs = 700000; // Coordonnée X du pôle
    const ys = 12655612.050; // Coordonnée Y du pôle
    
    // Conversion Lambert 93 vers coordonnées géographiques
    const r = Math.sqrt((x - xs) * (x - xs) + (y - ys) * (y - ys));
    const gamma = Math.atan((x - xs) / (ys - y));
    
    const lat_iso = -1 / n * Math.log(Math.abs(r / c));
    
    // Calcul de la latitude
    let lat = lat_iso;
    for (let i = 0; i < 15; i++) {
        const lat_prev = lat;
        const es = e * Math.sin(lat);
        const lat_new = 2 * Math.atan(Math.exp(lat_iso) * Math.pow((1 + es) / (1 - es), e / 2)) - Math.PI / 2;
        lat = lat_new;
        if (Math.abs(lat - lat_prev) < 1e-10) break;
    }
    
    // Calcul de la longitude
    const lon = gamma / n + 3 * Math.PI / 180; // 3° = méridien central
    
    // Conversion en degrés
    const latitude = lat * 180 / Math.PI;
    const longitude = lon * 180 / Math.PI;
    
    return { longitude, latitude };
}

/**
 * Convertit une géométrie WKT Lambert 93 vers GPS
 * @param {string} wkt - Géométrie WKT (ex: "POINT (342428.23 6292097.06)")
 * @returns {string} Géométrie WKT en GPS
 */
function convertWKTToGPS(wkt) {
    if (!wkt || typeof wkt !== 'string') return null;
    
    // Extraction des coordonnées avec regex
    const coordRegex = /(\d+\.?\d*)\s+(\d+\.?\d*)/g;
    let convertedWKT = wkt;
    
    convertedWKT = convertedWKT.replace(coordRegex, (match, x, y) => {
        const coords = lambert93ToGPS(parseFloat(x), parseFloat(y));
        return `${coords.longitude.toFixed(6)} ${coords.latitude.toFixed(6)}`;
    });
    
    return convertedWKT;
}

/**
 * Extrait le centre d'une géométrie MULTIPOLYGON
 * @param {string} wkt - Géométrie WKT MULTIPOLYGON
 * @returns {Object} {longitude, latitude} du centre
 */
function getCenterFromWKT(wkt) {
    if (!wkt || !wkt.includes('MULTIPOLYGON')) return null;
    
    // Extraction de tous les points
    const coordRegex = /(\d+\.?\d*)\s+(\d+\.?\d*)/g;
    const points = [];
    let match;
    
    while ((match = coordRegex.exec(wkt)) !== null) {
        points.push({
            x: parseFloat(match[1]),
            y: parseFloat(match[2])
        });
    }
    
    if (points.length === 0) return null;
    
    // Calcul du centre (moyenne des coordonnées)
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    
    return lambert93ToGPS(centerX, centerY);
}

// Test de la conversion
console.log('🔄 Test de conversion Lambert 93 → GPS');
console.log('=====================================');

// Coordonnées de test
const testPoints = [
    { name: 'Point 1 (parcelle)', x: 342428.23, y: 6292097.06 },
    { name: 'Point 2 (adresse)', x: 343746.38, y: 6293495.01 },
    { name: 'Point 3 (test)', x: 350000, y: 6300000 }
];

testPoints.forEach(point => {
    const gps = lambert93ToGPS(point.x, point.y);
    console.log(`${point.name}:`);
    console.log(`  Lambert 93: (${point.x}, ${point.y})`);
    console.log(`  GPS: (${gps.longitude.toFixed(6)}, ${gps.latitude.toFixed(6)})`);
    console.log('');
});

// Test avec géométrie WKT
const wktExample = 'MULTIPOLYGON (((342428.232199524 6292097.0649575,342427.528501 6292100.65537537,342424.893942852 6292103.123456789)))';
console.log('🧪 Test avec géométrie WKT:');
console.log(`Original: ${wktExample.substring(0, 80)}...`);
const center = getCenterFromWKT(wktExample);
if (center) {
    console.log(`Centre GPS: (${center.longitude.toFixed(6)}, ${center.latitude.toFixed(6)})`);
}

module.exports = {
    lambert93ToGPS,
    convertWKTToGPS,
    getCenterFromWKT
};
