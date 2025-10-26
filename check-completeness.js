const Database = require('better-sqlite3');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database', 'dvf_bdnb_complete.db');

const db = new Database(DB_FILE);

const stats = db.prepare(`
    SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN batiment_groupe_id IS NOT NULL THEN 1 END) as avec_batiment,
        COUNT(CASE WHEN classe_dpe IS NOT NULL THEN 1 END) as avec_dpe,
        COUNT(CASE WHEN orientation_principale IS NOT NULL THEN 1 END) as avec_orientation,
        COUNT(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 END) as avec_vitrage,
        COUNT(CASE WHEN presence_piscine = 1 THEN 1 END) as avec_piscine,
        COUNT(CASE WHEN presence_garage = 1 THEN 1 END) as avec_garage,
        COUNT(CASE WHEN presence_veranda = 1 THEN 1 END) as avec_veranda,
        COUNT(CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL THEN 1 END) as avec_gps,
        COUNT(CASE WHEN surface_reelle_bati IS NOT NULL THEN 1 END) as avec_surface_bati
    FROM dvf_bdnb_complete
`).get();

console.log('📊 Pourcentages de complétude:\n');
console.log(`Total transactions: ${stats.total.toLocaleString()}\n`);
console.log(`   Bâtiment BDNB: ${stats.avec_batiment.toLocaleString()} (${(stats.avec_batiment/stats.total*100).toFixed(1)}%)`);
console.log(`   DPE: ${stats.avec_dpe.toLocaleString()} (${(stats.avec_dpe/stats.total*100).toFixed(1)}%)`);
console.log(`   Orientation: ${stats.avec_orientation.toLocaleString()} (${(stats.avec_orientation/stats.total*100).toFixed(1)}%)`);
console.log(`   Vitrage: ${stats.avec_vitrage.toLocaleString()} (${(stats.avec_vitrage/stats.total*100).toFixed(1)}%)`);
console.log(`   Piscine: ${stats.avec_piscine.toLocaleString()} (${(stats.avec_piscine/stats.total*100).toFixed(1)}%)`);
console.log(`   Garage: ${stats.avec_garage.toLocaleString()} (${(stats.avec_garage/stats.total*100).toFixed(1)}%)`);
console.log(`   Véranda: ${stats.avec_veranda.toLocaleString()} (${(stats.avec_veranda/stats.total*100).toFixed(1)}%)`);
console.log(`   GPS: ${stats.avec_gps.toLocaleString()} (${(stats.avec_gps/stats.total*100).toFixed(1)}%)`);
console.log(`   Surface bâti: ${stats.avec_surface_bati.toLocaleString()} (${(stats.avec_surface_bati/stats.total*100).toFixed(1)}%)`);

db.close();

