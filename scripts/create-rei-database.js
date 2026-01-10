/**
 * Script pour créer la base SQLite REI optimisée à partir du CSV REI_2024.csv
 * 
 * Ce script :
 * 1. Lit le fichier REI_2024.csv (112MB)
 * 2. Extrait uniquement les colonnes nécessaires (12 colonnes au lieu de 1101)
 * 3. Crée une base SQLite optimisée (~1-2MB au lieu de 112MB)
 * 4. Place la base dans database/rei.db pour être servie par l'application
 * 
 * Usage: node scripts/create-rei-database.js
 */

// Utiliser sqlite3 (compatible avec tous les systèmes, binaires pré-compilés disponibles)
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const yauzl = require('yauzl');
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);

// Chemins des fichiers
const IMPOT_DIR = path.join(__dirname, '..', 'Impot');
const DB_DIR = path.join(__dirname, '..', 'database');

// Fonction pour obtenir l'année courante du serveur (N) et année précédente (N-1)
// Calculée dynamiquement pour toujours utiliser la date actuelle du serveur
function getCurrentYear() {
    return new Date().getFullYear();
}

function getPreviousYear() {
    return getCurrentYear() - 1;
}

function getPreviousYear2() {
    return getCurrentYear() - 2;
}

// URL du fichier REI sur data.gouv.fr
// Priorité: Variables d'environnement > URLs par défaut
const REI_CSV_URL_TEMPLATE = process.env.REI_CSV_URL_TEMPLATE || null;

// URLs par défaut pour téléchargement automatique depuis data.economie.gouv.fr
// Ces URLs pointent vers des fichiers ZIP qui contiennent le CSV
// Structure URL: https://data.economie.gouv.fr/api/datasets/1.0/impots-locaux-fichier-de-recensement-des-elements-dimposition-a-la-fiscalite-dir/attachments/rei_{YEAR}_fichier_notice_trace_zip/
const DEFAULT_REI_URLS = {
    // URL pour 2024 (ZIP contenant REI_2024.csv)
    '2024': process.env.REI_CSV_URL_2024 || 'https://data.economie.gouv.fr/api/datasets/1.0/impots-locaux-fichier-de-recensement-des-elements-dimposition-a-la-fiscalite-dir/attachments/rei_2024_fichier_notice_trace_zip/',
    // URL pour 2023 (même structure, remplace {YEAR} par 2023)
    '2023': process.env.REI_CSV_URL_2023 || 'https://data.economie.gouv.fr/api/datasets/1.0/impots-locaux-fichier-de-recensement-des-elements-dimposition-a-la-fiscalite-dir/attachments/rei_2023_fichier_notice_trace_zip/',
};

// Fonction pour obtenir l'URL du fichier REI pour une année donnée
function getReiCsvUrl(year) {
    // 1. Template d'URL (priorité si configuré)
    if (REI_CSV_URL_TEMPLATE) {
        return REI_CSV_URL_TEMPLATE.replace('{YEAR}', year);
    }
    
    // 2. Variable d'environnement spécifique (REI_CSV_URL_2024, etc.)
    const envUrl = process.env[`REI_CSV_URL_${year}`];
    if (envUrl) {
        return envUrl;
    }
    
    // 3. URL par défaut dans la map
    if (DEFAULT_REI_URLS[year.toString()]) {
        return DEFAULT_REI_URLS[year.toString()];
    }
    
    // 4. Tentative de construction d'URL générique (peut ne pas fonctionner si structure change)
    // Note: data.gouv.fr change souvent la structure, mieux vaut utiliser les URLs complètes
    return null;
}

// Colonnes à extraire du CSV (indices dans le fichier)
// D'après l'analyse : DEP=0, COM=2, LIBCOM=4, E11=69, E12=70, E13=72, E31=81, E32=82, E33=84, E51=87, E52=88, E53=89
const COLUMNS_MAP = {
    'DEP': 0,           // Département
    'COM': 2,           // Code commune
    'LIBCOM': 4,        // Nom commune
    'E11': 69,          // Base nette communale (€)
    'E12': 70,          // Taux communal (%)
    'E13': 72,          // Montant réel communal (€)
    'E31': 81,          // Base nette départementale/EPCI (€)
    'E32': 82,          // Taux départemental/EPCI (%)
    'E33': 84,          // Montant réel départemental/EPCI (€)
    'E51': 87,          // Base nette TSE (€)
    'E52': 88,          // Taux TSE (%)
    'E53': 89           // Montant réel TSE (€)
};

// Fonction pour parser un nombre (gère les virgules et espaces français)
function parseNumber(value) {
    if (!value || value.trim() === '') return null;
    // Remplacer les espaces et virgules par des points
    const cleaned = value.toString().replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}

// Variables globales (initialisées dynamiquement dans createReiDatabase)
let csvSize = 0;
let selectedYear = null;
let csvFile = null;
let dbFile = null;

/**
 * Cherche le fichier REI local pour une année donnée
 * Retourne le chemin du fichier s'il existe, null sinon
 */
function findLocalReiFile(year) {
    const filePath = path.join(IMPOT_DIR, `REI_${year}.csv`);
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`✅ Fichier REI_${year}.csv trouvé localement (${sizeMB} MB)`);
        return { path: filePath, year: year, size: stats.size };
    }
    return null;
}

/**
 * Cherche ou télécharge les fichiers REI pour deux années consécutives
 * Recherche N, puis N-1, puis N-2 pour toujours avoir deux années consécutives
 * Permet de comparer l'évolution des taux d'imposition
 */
async function findOrDownloadReiFiles() {
    // Calculer N, N-1, N-2 à partir de la date actuelle du serveur
    const currentYear = getCurrentYear();
    const previousYear = getPreviousYear();
    const previousYear2 = getPreviousYear2();
    const serverDate = new Date().toLocaleDateString('fr-FR');
    
    console.log(`\n🔍 Recherche fichiers REI pour comparaison (date serveur: ${serverDate})...`);
    console.log(`   Année N: ${currentYear}`);
    console.log(`   Année N-1: ${previousYear}`);
    console.log(`   Année N-2: ${previousYear2}`);
    console.log(`   Objectif: Trouver deux années consécutives pour comparaison\n`);
    
    const foundFiles = [];
    
    // 1. Chercher localement l'année N
    console.log(`\n1️⃣  Recherche année ${currentYear} (N)...`);
    let fileN = findLocalReiFile(currentYear);
    if (!fileN) {
        // Essayer de télécharger N automatiquement
        const urlN = getReiCsvUrl(currentYear);
        if (urlN) {
            try {
                const targetPath = path.join(IMPOT_DIR, `REI_${currentYear}.csv`);
                await downloadReiCsv(currentYear, targetPath, urlN);
                if (fs.existsSync(targetPath)) {
                    const stats = fs.statSync(targetPath);
                    fileN = { path: targetPath, year: currentYear, size: stats.size };
                }
            } catch (error) {
                console.log(`   ⚠️  Échec téléchargement année ${currentYear}: ${error.message}`);
            }
        } else {
            console.log(`   ⚠️  URL non disponible pour l'année ${currentYear} - Configurez REI_CSV_URL_TEMPLATE ou REI_CSV_URL_${currentYear}`);
        }
    }
    
    if (fileN) {
        foundFiles.push(fileN);
        console.log(`   ✅ Année ${currentYear} trouvée/téléchargée`);
    } else {
        console.log(`   ❌ Année ${currentYear} non disponible`);
    }
    
    // 2. Chercher localement l'année N-1
    console.log(`\n2️⃣  Recherche année ${previousYear} (N-1)...`);
    let fileN1 = findLocalReiFile(previousYear);
    if (!fileN1) {
        // Toujours essayer de télécharger N-1 pour avoir deux années consécutives si on a N
        // ou pour compléter la paire même si on n'a pas N
        const urlN1 = getReiCsvUrl(previousYear);
        if (urlN1) {
            try {
                const targetPath = path.join(IMPOT_DIR, `REI_${previousYear}.csv`);
                await downloadReiCsv(previousYear, targetPath, urlN1);
                if (fs.existsSync(targetPath)) {
                    const stats = fs.statSync(targetPath);
                    fileN1 = { path: targetPath, year: previousYear, size: stats.size };
                }
            } catch (error) {
                console.log(`   ⚠️  Échec téléchargement année ${previousYear}: ${error.message}`);
            }
        } else {
            console.log(`   ⚠️  URL non disponible pour l'année ${previousYear} - Configurez REI_CSV_URL_TEMPLATE ou REI_CSV_URL_${previousYear}`);
        }
    }
    
    if (fileN1) {
        foundFiles.push(fileN1);
        console.log(`   ✅ Année ${previousYear} trouvée/téléchargée`);
        
        // Si on a N et N-1, c'est parfait (deux années consécutives)
        if (fileN && fileN1) {
            console.log(`\n✅ Paire trouvée: ${currentYear} et ${previousYear} (années consécutives)`);
            return foundFiles.sort((a, b) => b.year - a.year); // Trier par année décroissante
        }
    } else {
        console.log(`   ❌ Année ${previousYear} non disponible`);
    }
    
    // 3. Si on n'a pas deux années consécutives, chercher N-2
    if (foundFiles.length < 2) {
        console.log(`\n3️⃣  Recherche année ${previousYear2} (N-2) pour compléter la paire...`);
        let fileN2 = findLocalReiFile(previousYear2);
        
        if (!fileN2) {
            // Essayer de télécharger N-2 automatiquement
            const urlN2 = getReiCsvUrl(previousYear2);
            if (urlN2) {
                try {
                    const targetPath = path.join(IMPOT_DIR, `REI_${previousYear2}.csv`);
                    await downloadReiCsv(previousYear2, targetPath, urlN2);
                    if (fs.existsSync(targetPath)) {
                        const stats = fs.statSync(targetPath);
                        fileN2 = { path: targetPath, year: previousYear2, size: stats.size };
                    }
                } catch (error) {
                    console.log(`   ⚠️  Échec téléchargement année ${previousYear2}: ${error.message}`);
                }
            } else {
                console.log(`   ⚠️  URL non disponible pour l'année ${previousYear2} - Configurez REI_CSV_URL_TEMPLATE ou REI_CSV_URL_${previousYear2}`);
            }
        }
        
        if (fileN2) {
            foundFiles.push(fileN2);
            console.log(`   ✅ Année ${previousYear2} trouvée/téléchargée`);
            
            // Si on a trouvé N-2 (ex: 2024), chercher aussi N-3 (ex: 2023) pour avoir deux années consécutives
            if (fileN2.year === previousYear2) {
                const previousYear3 = previousYear2 - 1; // N-3 (ex: 2023 si N-2 = 2024)
                console.log(`\n4️⃣  Recherche année ${previousYear3} (N-3) pour compléter la paire consécutive avec ${previousYear2}...`);
                let fileN3 = findLocalReiFile(previousYear3);
                
                if (!fileN3) {
                    // Essayer de télécharger N-3 automatiquement
                    const urlN3 = getReiCsvUrl(previousYear3);
                    if (urlN3) {
                        try {
                            const targetPath = path.join(IMPOT_DIR, `REI_${previousYear3}.csv`);
                            await downloadReiCsv(previousYear3, targetPath, urlN3);
                            if (fs.existsSync(targetPath)) {
                                const stats = fs.statSync(targetPath);
                                fileN3 = { path: targetPath, year: previousYear3, size: stats.size };
                            }
                        } catch (error) {
                            console.log(`   ⚠️  Échec téléchargement année ${previousYear3}: ${error.message}`);
                        }
                    } else {
                        console.log(`   ⚠️  URL non disponible pour l'année ${previousYear3} - Configurez REI_CSV_URL_TEMPLATE ou REI_CSV_URL_${previousYear3}`);
                    }
                }
                
                if (fileN3) {
                    foundFiles.push(fileN3);
                    console.log(`   ✅ Année ${previousYear3} trouvée/téléchargée`);
                    // Maintenant on a deux années consécutives : previousYear2 et previousYear3
                    console.log(`\n✅ Paire d'années consécutives trouvée: ${previousYear2} et ${previousYear3}`);
                } else {
                    console.log(`   ❌ Année ${previousYear3} non disponible`);
                }
            }
        } else {
            console.log(`   ❌ Année ${previousYear2} non disponible`);
        }
    }
    
    // Vérifier qu'on a deux années consécutives
    if (foundFiles.length === 0) {
        console.log(`\n❌ Aucun fichier REI trouvé ou téléchargeable`);
        return null;
    }
    
    // Trier par année décroissante
    foundFiles.sort((a, b) => b.year - a.year);
    
    // Si on a seulement un fichier, retourner juste celui-là
    if (foundFiles.length === 1) {
        console.log(`\n⚠️  Seulement une année trouvée: ${foundFiles[0].year}`);
        console.log(`   La base sera créée avec une seule année (pas de comparaison possible)`);
        return foundFiles;
    }
    
    // Vérifier qu'on a deux années consécutives
    const years = foundFiles.map(f => f.year).sort((a, b) => b - a);
    const year1 = years[0];
    const year2 = years[1];
    
    if (year1 - year2 === 1) {
        console.log(`\n✅ Paire d'années consécutives trouvée: ${year1} et ${year2}`);
        return [foundFiles.find(f => f.year === year1), foundFiles.find(f => f.year === year2)];
    } else {
        // Si pas consécutives, prendre les deux plus récentes
        console.log(`\n⚠️  Années trouvées pas consécutives: ${years.join(', ')}`);
        console.log(`   Utilisation des deux années les plus récentes: ${year1} et ${year2}`);
        return [foundFiles.find(f => f.year === year1), foundFiles.find(f => f.year === year2)];
    }
}

/**
 * Télécharge le fichier ZIP REI depuis data.economie.gouv.fr et extrait le CSV
 */
async function downloadReiCsv(year, targetPath, downloadUrl = null) {
    // Déterminer l'URL pour cette année
    if (!downloadUrl) {
        downloadUrl = getReiCsvUrl(year);
    }
    
    if (!downloadUrl) {
        throw new Error(`URL de téléchargement non configurée pour l'année ${year}. Configurez REI_CSV_URL_TEMPLATE (recommandé) ou REI_CSV_URL_${year}`);
    }
    
    console.log(`📥 Téléchargement fichier REI pour ${year} depuis data.economie.gouv.fr...`);
    console.log(`   URL: ${downloadUrl}`);
    
    // Créer le dossier Impot s'il n'existe pas
    if (!fs.existsSync(IMPOT_DIR)) {
        fs.mkdirSync(IMPOT_DIR, { recursive: true });
        console.log(`📁 Dossier créé: ${IMPOT_DIR}`);
    }
    
    // Le fichier téléchargé est un ZIP, on le télécharge temporairement
    const zipPath = path.join(IMPOT_DIR, `REI_${year}_temp.zip`);
    const url = new URL(downloadUrl);
    const client = url.protocol === 'https:' ? https : http;
    
    // Télécharger le ZIP
    await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(zipPath);
        
        const request = client.get(url, (response) => {
            if (response.statusCode !== 200) {
                fileStream.close();
                fs.unlinkSync(zipPath);
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }
            
            let downloadedBytes = 0;
            const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
            
            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes > 0) {
                    const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                    const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
                    process.stdout.write(`\r   📥 ZIP: ${percent}% (${downloadedMB} MB)`);
                }
            });
            
            response.pipe(fileStream);
            
            fileStream.on('finish', () => {
                fileStream.close();
                console.log(`\n✅ ZIP téléchargé`);
                resolve();
            });
            
            response.on('error', (err) => {
                fileStream.close();
                fs.unlinkSync(zipPath);
                reject(err);
            });
            
            fileStream.on('error', (err) => {
                fileStream.close();
                fs.unlinkSync(zipPath);
                reject(err);
            });
        });
        
        request.on('error', (err) => {
            if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
            reject(err);
        });
        
        request.setTimeout(600000, () => { // 10 minutes timeout
            request.destroy();
            if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
            reject(new Error('Timeout lors du téléchargement'));
        });
    });
    
    // Extraire le CSV du ZIP
    console.log(`\n📦 Extraction du CSV depuis le ZIP...`);
    await extractCsvFromZip(zipPath, targetPath, year);
    
    // Supprimer le fichier ZIP temporaire
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
        console.log(`   🗑️  Fichier ZIP temporaire supprimé`);
    }
    
    console.log(`✅ Fichier REI_${year}.csv extrait avec succès`);
}

/**
 * Extrait le fichier CSV depuis le ZIP téléchargé
 */
function extractCsvFromZip(zipPath, targetPath, year) {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                reject(new Error(`Erreur ouverture ZIP: ${err.message}`));
                return;
            }
            
            let csvFound = false;
            const expectedCsvName = `REI_${year}.csv`;
            
            zipfile.readEntry();
            
            zipfile.on('entry', (entry) => {
                // Chercher le fichier CSV (REI_YYYY.csv)
                if (entry.fileName.endsWith('.csv') && entry.fileName.includes(`REI_${year}`)) {
                    csvFound = true;
                    console.log(`   📄 Fichier trouvé dans ZIP: ${entry.fileName}`);
                    
                    zipfile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            reject(new Error(`Erreur lecture entrée ZIP: ${err.message}`));
                            return;
                        }
                        
                        const writeStream = fs.createWriteStream(targetPath);
                        let extractedBytes = 0;
                        
                        readStream.on('data', (chunk) => {
                            extractedBytes += chunk.length;
                            const extractedMB = (extractedBytes / (1024 * 1024)).toFixed(2);
                            process.stdout.write(`\r   📦 Extraction: ${extractedMB} MB`);
                        });
                        
                        readStream.pipe(writeStream);
                        
                        writeStream.on('finish', () => {
                            writeStream.close();
                            console.log(`\n   ✅ CSV extrait: ${(extractedBytes / (1024 * 1024)).toFixed(2)} MB`);
                            zipfile.close();
                            resolve();
                        });
                        
                        readStream.on('error', (err) => {
                            writeStream.close();
                            zipfile.close();
                            reject(new Error(`Erreur extraction CSV: ${err.message}`));
                        });
                        
                        writeStream.on('error', (err) => {
                            readStream.destroy();
                            zipfile.close();
                            reject(new Error(`Erreur écriture CSV: ${err.message}`));
                        });
                    });
                } else {
                    // Ignorer les autres fichiers (PDF, XLSX, etc.)
                    zipfile.readEntry();
                }
            });
            
            zipfile.on('end', () => {
                if (!csvFound) {
                    reject(new Error(`Fichier REI_${year}.csv non trouvé dans le ZIP. Vérifiez que le ZIP contient bien le CSV attendu.`));
                }
            });
            
            zipfile.on('error', (err) => {
                reject(new Error(`Erreur ZIP: ${err.message}`));
            });
        });
    });
}


// Variables pour stocker les fichiers trouvés
let reiFiles = [];
let mainYear = null; // Année principale (la plus récente)

// Map pour stocker les tarifs VLF par commune (code commune -> { appartement: tarif, maison: tarif })
// Format: { "40088": { appartement: 5.18, maison: 4.12 } }
let vlfTarifsMap = {};

// Fonction principale
async function createReiDatabase() {
    // Calculer dynamiquement N, N-1, N-2 à partir de la date du serveur
    const currentYear = getCurrentYear();
    const previousYear = getPreviousYear();
    const previousYear2 = getPreviousYear2();
    const serverDate = new Date().toLocaleDateString('fr-FR');
    
    console.log('🏗️ === CRÉATION BASE SQLITE REI OPTIMISÉE ===\n');
    console.log(`📅 Date du serveur: ${serverDate}`);
    console.log(`📅 Année courante (N): ${currentYear}`);
    console.log(`📅 Année précédente (N-1): ${previousYear}`);
    console.log(`📅 Année précédente-1 (N-2): ${previousYear2}`);
    console.log(`\n🎯 Objectif: Trouver deux années consécutives pour comparaison des taux\n`);
    
    // Chercher ou télécharger les fichiers REI (N, N-1, N-2)
    const foundFiles = await findOrDownloadReiFiles();
    
    if (!foundFiles || foundFiles.length === 0) {
        console.error('\n❌ Aucun fichier REI trouvé ou téléchargeable');
        console.error('');
        console.error('💡 Solutions:');
        console.error(`   1. Placer manuellement REI_${currentYear}.csv, REI_${previousYear}.csv ou REI_${previousYear2}.csv dans le dossier Impot/`);
        console.error('   2. Ou définir les variables d\'environnement:');
        console.error(`      export REI_CSV_URL_2024="https://www.data.gouv.fr/.../REI_${currentYear}.csv"`);
        console.error(`      export REI_CSV_URL_2023="https://www.data.gouv.fr/.../REI_${previousYear}.csv"`);
        console.error('   3. Ou utiliser un template (recommandé):');
        console.error('      export REI_CSV_URL_TEMPLATE="https://www.data.gouv.fr/.../REI_{YEAR}.csv"');
        console.error('   4. Télécharger depuis: https://www.data.gouv.fr/fr/datasets/reference-des-elements-dimposition-a-la-fiscalite-directe-locale-rei/');
        process.exit(1);
    }
    
    // Utiliser les fichiers trouvés
    reiFiles = foundFiles;
    mainYear = foundFiles[0].year; // Année principale (la plus récente)
    
    const totalSize = foundFiles.reduce((sum, f) => sum + f.size, 0);
    const totalSizeMB = totalSize / (1024 * 1024);
    
    // Nom de la base: rei.db (simple et unique)
    dbFile = path.join(DB_DIR, 'rei.db');
    
    console.log(`\n✅ Fichiers sélectionnés: ${foundFiles.length} année(s)`);
    foundFiles.forEach(f => {
        console.log(`   📄 REI_${f.year}.csv (${(f.size / (1024 * 1024)).toFixed(2)} MB)`);
    });
    console.log(`📊 Taille totale CSV: ${totalSizeMB.toFixed(2)} MB`);
    console.log(`📅 Année principale: ${mainYear}`);
    if (foundFiles.length === 2) {
        console.log(`📊 Comparaison: ${foundFiles[0].year} vs ${foundFiles[1].year}`);
    }
    console.log(`🎯 Extraction: 12 colonnes sur 1101 (réduction estimée: ~99%)\n`);
    
    // Créer le dossier database s'il n'existe pas
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
        console.log(`📁 Dossier créé: ${DB_DIR}`);
    }
    
    // Supprimer l'ancienne base si elle existe
    if (fs.existsSync(dbFile)) {
        fs.unlinkSync(dbFile);
        console.log(`🗑️  Ancienne base supprimée: ${path.basename(dbFile)}`);
    }
    
    // Charger les tarifs VLF depuis le CSV des tarifs
    console.log(`\n📊 Chargement des tarifs VLF (catégorie 5)...`);
    await loadVlfTarifs();
    const tarifsCount = Object.keys(vlfTarifsMap).length;
    console.log(`✅ ${tarifsCount} communes avec tarifs VLF chargés`);
    
    // Créer la base SQLite
    console.log(`\n📦 Création base SQLite: ${path.basename(dbFile)}`);
    const db = new sqlite3.Database(dbFile);
    
    // Configuration optimisée
    db.serialize(() => {
        // Optimisations SQLite
        db.run("PRAGMA journal_mode = WAL");
        db.run("PRAGMA synchronous = NORMAL");
        db.run("PRAGMA cache_size = -32000"); // 32 MB
        db.run("PRAGMA temp_store = MEMORY");
        
            // Créer la table avec colonnes VLF
            const createTable = `
            CREATE TABLE IF NOT EXISTS rei_communes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code_commune TEXT NOT NULL,
                code_departement TEXT NOT NULL,
                code_commune_insee TEXT NOT NULL,
                nom_commune TEXT NOT NULL,
                base_nette_commune REAL,
                taux_commune REAL,
                montant_reel_commune REAL,
                base_nette_departement REAL,
                taux_departement REAL,
                montant_reel_departement REAL,
                base_nette_tse REAL,
                taux_tse REAL,
                montant_reel_tse REAL,
                vlf_categorie5_appartement REAL,
                vlf_categorie5_maison REAL,
                annee INTEGER,
                date_import INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `;
        
        db.run(createTable, (err) => {
            if (err) {
                console.error('❌ Erreur création table:', err);
                db.close();
                process.exit(1);
            }
            console.log('✅ Table rei_communes créée');
            
            // Créer les index (permettre plusieurs années pour même commune)
            const indexes = [
                "CREATE INDEX IF NOT EXISTS idx_rei_code_commune ON rei_communes(code_commune)",
                "CREATE INDEX IF NOT EXISTS idx_rei_code_annee ON rei_communes(code_commune, annee)", // Optimise comparaisons entre années
                "CREATE INDEX IF NOT EXISTS idx_rei_annee ON rei_communes(annee)", // Optimise filtres par année
                "CREATE INDEX IF NOT EXISTS idx_rei_dep_com ON rei_communes(code_departement, code_commune_insee)",
                "CREATE INDEX IF NOT EXISTS idx_rei_nom ON rei_communes(nom_commune)"
            ];
            
            let indexCount = 0;
            indexes.forEach(indexQuery => {
                db.run(indexQuery, (err) => {
                    if (err) {
                        console.error(`❌ Erreur création index: ${err.message}`);
                    } else {
                        indexCount++;
                        if (indexCount === indexes.length) {
                            console.log('✅ Index créés');
                            processAllCsvFiles(db);
                        }
                    }
                });
            });
        });
    });
}

// Fonction pour traiter un fichier CSV pour une année donnée
function processCsvFileForYear(db, fileInfo, onComplete) {
    console.log(`\n📖 Lecture du fichier REI_${fileInfo.year}.csv...`);
    
    const rows = [];
    let rowCount = 0;
    let isHeader = true;
    const year = fileInfo.year;
    
    // Préparer la requête d'insertion avec colonnes VLF (transaction pour performance)
    const insertStmt = db.prepare(`
        INSERT INTO rei_communes (
            code_commune, code_departement, code_commune_insee, nom_commune,
            base_nette_commune, taux_commune, montant_reel_commune,
            base_nette_departement, taux_departement, montant_reel_departement,
            base_nette_tse, taux_tse, montant_reel_tse,
            vlf_categorie5_appartement, vlf_categorie5_maison, annee
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Interface readline pour lire ligne par ligne (efficace pour gros fichiers)
    const rl = readline.createInterface({
        input: fs.createReadStream(fileInfo.path, { encoding: 'utf-8' }),
        crlfDelay: Infinity
    });
    
    rl.on('line', (line) => {
        // Ignorer les lignes vides
        if (!line || line.trim() === '') {
            return;
        }
        
        // Sauter l'en-tête
        if (isHeader) {
            isHeader = false;
            const headers = line.split(';');
            console.log(`📋 Headers trouvés: ${headers.length} colonnes`);
            console.log(`   DEP (index ${COLUMNS_MAP.DEP}): "${headers[COLUMNS_MAP.DEP]}"`);
            console.log(`   COM (index ${COLUMNS_MAP.COM}): "${headers[COLUMNS_MAP.COM]}"`);
            console.log(`   LIBCOM (index ${COLUMNS_MAP.LIBCOM}): "${headers[COLUMNS_MAP.LIBCOM]}"`);
            console.log(`   E11 (index ${COLUMNS_MAP.E11}): "${headers[COLUMNS_MAP.E11]}"`);
            console.log(`   E12 (index ${COLUMNS_MAP.E12}): "${headers[COLUMNS_MAP.E12]}"`);
            return;
        }
        
        // Parser la ligne (point-virgule comme séparateur)
        const values = line.split(';');
        
        // Vérifier qu'on a assez de colonnes
        if (values.length < 90) {
            return; // Ignorer les lignes incomplètes
        }
        
        // Extraire les valeurs selon les indices fixes
        const dep = (values[COLUMNS_MAP.DEP] || '').toString().trim();
        const com = (values[COLUMNS_MAP.COM] || '').toString().trim();
        const libcom = (values[COLUMNS_MAP.LIBCOM] || '').toString().trim();
        
        // Ignorer les lignes invalides
        if (!dep || !com || !libcom) {
            return;
        }
        
        const codeCommune = dep + com;
        
        // Parser les nombres (colonnes E)
        const e11 = parseNumber(values[COLUMNS_MAP.E11]);
        const e12 = parseNumber(values[COLUMNS_MAP.E12]);
        const e13 = parseNumber(values[COLUMNS_MAP.E13]);
        const e31 = parseNumber(values[COLUMNS_MAP.E31]);
        const e32 = parseNumber(values[COLUMNS_MAP.E32]);
        const e33 = parseNumber(values[COLUMNS_MAP.E33]);
        const e51 = parseNumber(values[COLUMNS_MAP.E51]);
        const e52 = parseNumber(values[COLUMNS_MAP.E52]);
        const e53 = parseNumber(values[COLUMNS_MAP.E53]);
        
        // Récupérer les tarifs VLF pour cette commune (catégorie 5)
        const vlfTarifs = vlfTarifsMap[codeCommune] || {};
        const vlfAppartement = vlfTarifs.appartement || null;
        const vlfMaison = vlfTarifs.maison || null;
        
        // Ajouter à la liste avec l'année et les tarifs VLF
        rows.push({
            codeCommune,
            dep,
            com,
            libcom,
            e11, e12, e13,
            e31, e32, e33,
            e51, e52, e53,
            vlfAppartement,
            vlfMaison,
            year: year // Utiliser l'année du fichier en cours
        });
        
        rowCount++;
        
        // Afficher progression tous les 10000 lignes
        if (rowCount % 10000 === 0) {
            process.stdout.write(`\r📊 ${rowCount} lignes traitées...`);
        }
        
        // Insérer par batch de 1000 pour éviter la saturation mémoire
        if (rows.length >= 1000) {
            insertBatchSync(db, insertStmt, rows.splice(0, 1000));
        }
    });
    
    rl.on('close', () => {
        console.log(`\n✅ ${rowCount} lignes lues du CSV pour l'année ${year}`);
        
        // Insérer les dernières lignes
        if (rows.length > 0) {
            insertBatchSync(db, insertStmt, rows);
        }
        
        // Finaliser la requête
        insertStmt.finalize(() => {
            // Appeler le callback pour passer au fichier suivant
            onComplete(rowCount, year);
        });
    });
    
    rl.on('error', (err) => {
        console.error(`❌ Erreur lecture CSV pour année ${year}:`, err);
        insertStmt.finalize();
        onComplete(0, year); // Appeler le callback même en cas d'erreur
    });
}

// Fonction pour traiter tous les fichiers CSV trouvés
function processAllCsvFiles(db) {
    if (!reiFiles || reiFiles.length === 0) {
        console.error('❌ Aucun fichier REI à traiter');
        db.close();
        process.exit(1);
    }
    
    console.log(`\n📚 Traitement de ${reiFiles.length} fichier(s) REI...`);
    
    // Démarrer une transaction pour toutes les insertions
    db.run("BEGIN TRANSACTION");
    
    let processedFiles = 0;
    let totalRows = 0;
    const yearStats = {};
    
    // Traiter chaque fichier séquentiellement
    function processNextFile(index) {
        if (index >= reiFiles.length) {
            // Tous les fichiers ont été traités, commit et finaliser
            db.run("COMMIT", (err) => {
                if (err) {
                    console.error('❌ Erreur commit final:', err);
                    db.run("ROLLBACK");
                    db.close();
                    process.exit(1);
                }
                
                console.log('\n📊 Vérification de la base...');
                
                // Compter les communes par année
                db.all("SELECT annee, COUNT(*) as count FROM rei_communes GROUP BY annee ORDER BY annee DESC", (err, rows) => {
                    if (err) {
                        console.error('❌ Erreur comptage:', err);
                    } else {
                        console.log('\n✅ Statistiques par année:');
                        rows.forEach(row => {
                            console.log(`   Année ${row.annee}: ${row.count} communes`);
                        });
                        
                        const totalCount = rows.reduce((sum, r) => sum + r.count, 0);
                        console.log(`\n✅ Total: ${totalCount} communes insérées dans la base`);
                        
                        // Vérifier la taille de la base
                        const dbSize = fs.statSync(dbFile).size / (1024 * 1024);
                        console.log(`📦 Taille base SQLite: ${dbSize.toFixed(2)} MB`);
                        
                        // Compression estimée
                        const totalCsvSize = reiFiles.reduce((sum, f) => sum + (f.size / (1024 * 1024)), 0);
                        const compressionRatio = ((totalCsvSize / dbSize) * 100).toFixed(1);
                        console.log(`📉 Réduction: ${compressionRatio}% de la taille originale`);
                        
                        console.log('\n🎉 Base REI créée avec succès!');
                        console.log(`📁 Fichier: ${path.basename(dbFile)}`);
                        console.log(`📅 Année principale: ${mainYear}`);
                        if (reiFiles.length === 2) {
                            const years = reiFiles.map(f => f.year).sort((a, b) => b - a);
                            console.log(`📊 Comparaison disponible: ${years[0]} vs ${years[1]}`);
                        }
                        console.log(`📂 Chemin: ${dbFile}`);
                        console.log('\n💡 La base peut maintenant être servie par votre serveur Node.js');
                        console.log(`   Route: GET /api/rei/download (retourne rei.db)`);
                        
                        db.close((err) => {
                            if (err) {
                                console.error('❌ Erreur fermeture base:', err);
                            } else {
                                console.log('✅ Base fermée');
                            }
                            process.exit(0);
                        });
                    }
                });
            });
            return;
        }
        
        const fileInfo = reiFiles[index];
        console.log(`\n${index + 1}/${reiFiles.length} - Traitement année ${fileInfo.year}...`);
        
        processCsvFileForYear(db, fileInfo, (rowCount, year) => {
            processedFiles++;
            totalRows += rowCount;
            yearStats[year] = rowCount;
            
            if (rowCount > 0) {
                console.log(`   ✅ Année ${year}: ${rowCount} communes insérées`);
            } else {
                console.log(`   ⚠️  Année ${year}: Aucune commune insérée`);
            }
            
            // Traiter le fichier suivant
            processNextFile(index + 1);
        });
    }
    
    // Démarrer le traitement du premier fichier
    processNextFile(0);
}

// Fonction pour insérer un batch de lignes avec tarifs VLF (synchrone pour performance)
function insertBatchSync(db, stmt, rows) {
    rows.forEach((row) => {
        try {
            stmt.run(
                row.codeCommune,
                row.dep,
                row.com,
                row.libcom,
                row.e11, row.e12, row.e13,
                row.e31, row.e32, row.e33,
                row.e51, row.e52, row.e53,
                row.vlfAppartement,  // vlf_categorie5_appartement
                row.vlfMaison,       // vlf_categorie5_maison
                row.year || mainYear || getCurrentYear()
            );
        } catch (err) {
            // Ignorer les erreurs de contrainte UNIQUE (doublons possibles)
            if (!err.message.includes('UNIQUE constraint')) {
                console.error(`❌ Erreur insertion ligne ${row.codeCommune}: ${err.message}`);
            }
        }
    });
}

/**
 * Télécharge le fichier CSV des tarifs VLF depuis data.gouv.fr
 * L'URL fournie est une API qui retourne les métadonnées du dataset
 */
async function downloadVlfTarifsCsv() {
    const apiUrl = 'https://www.data.gouv.fr/api/1/datasets/r/629800aa-b887-43f0-b48a-9f07214180a2';
    const targetPath = path.join(IMPOT_DIR, 'descriptif-tarifs-locaux-2024.csv');
    
    console.log(`   🌐 Récupération de l'URL de téléchargement depuis data.gouv.fr...`);
    
    try {
        // 1. Récupérer les métadonnées du dataset depuis l'API
        const metadata = await new Promise((resolve, reject) => {
            const url = new URL(apiUrl);
            const client = url.protocol === 'https:' ? https : http;
            
            const request = client.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Erreur parsing JSON: ${e.message}`));
                    }
                });
            });
            
            request.on('error', reject);
            request.setTimeout(30000, () => {
                request.destroy();
                reject(new Error('Timeout lors de la récupération des métadonnées'));
            });
        });
        
        // 2. Extraire l'URL de téléchargement du CSV depuis les métadonnées
        // L'API data.gouv.fr peut retourner différentes structures de réponse
        let downloadUrl = null;
        
        // Essayer plusieurs champs possibles dans l'ordre de probabilité
        if (metadata.url && (metadata.url.includes('.csv') || metadata.url.includes('csv') || metadata.url.startsWith('http'))) {
            downloadUrl = metadata.url;
        } else if (metadata.file_url) {
            downloadUrl = metadata.file_url;
        } else if (metadata.file && (metadata.file.includes('.csv') || metadata.file.startsWith('http'))) {
            downloadUrl = metadata.file;
        } else if (metadata.latest && metadata.latest.url) {
            downloadUrl = metadata.latest.url;
        } else if (metadata.resources && Array.isArray(metadata.resources)) {
            // Chercher un fichier CSV dans les ressources
            const csvResource = metadata.resources.find(r => 
                r.url && (r.url.includes('.csv') || r.format === 'csv' || r.title?.toLowerCase().includes('tarif') || r.title?.toLowerCase().includes('locaux'))
            );
            if (csvResource && csvResource.url) {
                downloadUrl = csvResource.url;
            }
        }
        
        // Si pas trouvé dans les métadonnées, essayer plusieurs URLs de fallback
        if (!downloadUrl) {
            console.log(`   ⚠️  URL de téléchargement non trouvée dans les métadonnées, tentative URLs alternatives...`);
            // Essayer plusieurs formats d'URL possibles pour data.gouv.fr
            // Format 1: /file/ au lieu de /r/
            downloadUrl = apiUrl.replace('/r/', '/file/');
            
            // Si ça ne marche pas, on pourra aussi essayer avec l'URL d'export CSV de data.economie.gouv.fr
            // Mais essayons d'abord avec l'URL directe
        }
        
        // S'assurer que l'URL est absolue
        if (downloadUrl && !downloadUrl.startsWith('http')) {
            downloadUrl = 'https://www.data.gouv.fr' + downloadUrl;
        }
        
        console.log(`   🔍 URL de téléchargement déterminée: ${downloadUrl}`);
        
        console.log(`   📥 Téléchargement du fichier CSV depuis: ${downloadUrl}`);
        
        // 3. Télécharger le fichier CSV
        const url = new URL(downloadUrl);
        const client = url.protocol === 'https:' ? https : http;
        
        // Créer le dossier Impot s'il n'existe pas
        if (!fs.existsSync(IMPOT_DIR)) {
            fs.mkdirSync(IMPOT_DIR, { recursive: true });
        }
        
        await new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(targetPath);
            let downloadedBytes = 0;
            
            const request = client.get(url, (response) => {
                // Si redirection, suivre la redirection
                if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        console.log(`   🔄 Redirection vers: ${redirectUrl}`);
                        fileStream.close();
                        fs.unlinkSync(targetPath);
                        // Télécharger depuis la nouvelle URL
                        const redirectClient = redirectUrl.startsWith('https') ? https : http;
                        const redirectRequest = redirectClient.get(redirectUrl, (redirectResponse) => {
                            if (redirectResponse.statusCode !== 200) {
                                fileStream.close();
                                if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                                reject(new Error(`HTTP ${redirectResponse.statusCode}: ${redirectResponse.statusMessage}`));
                                return;
                            }
                            handleDownload(redirectResponse, fileStream, targetPath, resolve, reject);
                        });
                        redirectRequest.on('error', reject);
                        redirectRequest.setTimeout(600000, () => {
                            redirectRequest.destroy();
                            if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                            reject(new Error('Timeout lors du téléchargement'));
                        });
                        return;
                    }
                }
                
                // Si erreur 404, essayer l'URL d'export direct depuis data.economie.gouv.fr
                if (response.statusCode === 404) {
                    console.log(`   ⚠️  URL non trouvée (404), tentative export direct depuis data.economie.gouv.fr...`);
                    fileStream.close();
                    fs.unlinkSync(targetPath);
                    
                    // Fallback: URL d'export CSV direct depuis data.economie.gouv.fr
                    const fallbackUrl = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/descriptif-tarifs-des-locaux-d-habitation_2024/exports/csv?limit=-1';
                    const fallbackClient = https;
                    const fallbackRequest = fallbackClient.get(fallbackUrl, (fallbackResponse) => {
                        if (fallbackResponse.statusCode !== 200) {
                            fileStream.close();
                            if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                            reject(new Error(`HTTP ${fallbackResponse.statusCode}: ${fallbackResponse.statusMessage}`));
                            return;
                        }
                        handleDownload(fallbackResponse, fileStream, targetPath, resolve, reject);
                    });
                    fallbackRequest.on('error', reject);
                    fallbackRequest.setTimeout(600000, () => {
                        fallbackRequest.destroy();
                        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                        reject(new Error('Timeout lors du téléchargement (fallback)'));
                    });
                    return;
                }
                
                if (response.statusCode !== 200) {
                    fileStream.close();
                    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                handleDownload(response, fileStream, targetPath, resolve, reject);
            });
            
            request.on('error', (err) => {
                fileStream.close();
                if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                reject(err);
            });
            
            request.setTimeout(600000, () => { // 10 minutes timeout
                request.destroy();
                if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
                reject(new Error('Timeout lors du téléchargement'));
            });
        });
        
        const stats = fs.statSync(targetPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`   ✅ Fichier téléchargé: ${path.basename(targetPath)} (${sizeMB} MB)`);
        return targetPath;
        
    } catch (error) {
        console.error(`   ❌ Erreur téléchargement fichier VLF: ${error.message}`);
        throw error;
    }
}

/**
 * Fonction helper pour gérer le téléchargement d'un fichier
 */
function handleDownload(response, fileStream, targetPath, resolve, reject) {
    let downloadedBytes = 0;
    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    
    response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
            const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
            const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
            process.stdout.write(`\r   📥 ${percent}% (${downloadedMB} MB)`);
        }
    });
    
    response.pipe(fileStream);
    
    fileStream.on('finish', () => {
        fileStream.close();
        if (totalBytes > 0) {
            console.log(''); // Nouvelle ligne après la barre de progression
        }
        resolve();
    });
    
    fileStream.on('error', (err) => {
        fileStream.close();
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        reject(err);
    });
    
    response.on('error', (err) => {
        fileStream.close();
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        reject(err);
    });
}

/**
 * Charge les tarifs VLF depuis le CSV des tarifs des locaux d'habitation
 * Télécharge automatiquement le fichier s'il n'existe pas
 * Extrait les tarifs pour catégorie 5, nature_locaux A (appartement) et M (maison)
 */
async function loadVlfTarifs() {
    const tarifsCsvPath = path.join(IMPOT_DIR, 'descriptif-tarifs-locaux-2024.csv');
    
    // Vérifier si le fichier existe, sinon le télécharger
    if (!fs.existsSync(tarifsCsvPath)) {
        console.log(`   ⚠️  Fichier tarifs VLF non trouvé: ${path.basename(tarifsCsvPath)}`);
        console.log(`   📥 Téléchargement automatique depuis data.gouv.fr...`);
        try {
            await downloadVlfTarifsCsv();
        } catch (error) {
            console.log(`   ❌ Échec téléchargement automatique: ${error.message}`);
            console.log(`   💡 Vous pouvez télécharger manuellement le fichier depuis:`);
            console.log(`      https://www.data.gouv.fr/api/1/datasets/r/629800aa-b887-43f0-b48a-9f07214180a2`);
            console.log(`      Et le placer dans: ${IMPOT_DIR}`);
            vlfTarifsMap = {}; // Initialiser vide si fichier non trouvé
            return;
        }
    } else {
        const stats = fs.statSync(tarifsCsvPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`   ✅ Fichier tarifs VLF trouvé: ${path.basename(tarifsCsvPath)} (${sizeMB} MB)`);
    }
    
    console.log(`   📖 Lecture du fichier: ${path.basename(tarifsCsvPath)}`);
    
    return new Promise((resolve, reject) => {
        const tarifsMap = {};
        let lineCount = 0;
        let isHeader = true;
        
        const rl = readline.createInterface({
            input: fs.createReadStream(tarifsCsvPath, { encoding: 'utf-8' }),
            crlfDelay: Infinity
        });
        
        rl.on('line', (line) => {
            // Ignorer les lignes vides
            if (!line || line.trim() === '') {
                return;
            }
            
            // Sauter l'en-tête
            if (isHeader) {
                isHeader = false;
                return;
            }
            
            // Parser la ligne (séparateur: point-virgule)
            // Format: nom_de_la_commune;departement;code_commune;code_commune_origine_du_tarif;nature_locaux;serie_tarif_bati;categorie;vl_au_m2
            const values = line.split(';');
            
            if (values.length < 8) {
                return; // Ignorer les lignes incomplètes
            }
            
            const codeCommune = (values[2] || '').trim(); // code_commune (INSEE 5 chiffres, ex: "40088")
            const natureLocaux = (values[4] || '').trim(); // nature_locaux: A (appartement), M (maison), D (dépendance)
            const categorie = (values[6] || '').trim(); // categorie: "5", "5M", "6", "7", "8", etc.
            const vlAuM2 = parseNumber(values[7]); // vl_au_m2: valeur locative au m² (année 1970)
            
            // Ignorer si code commune invalide ou tarif invalide
            if (!codeCommune || codeCommune.length !== 5 || !vlAuM2) {
                return;
            }
            
            // Ne garder que la catégorie 5 (exacte) pour appartement (A) et maison (M)
            // Note: "5M" est pour maison mais on cherche "5" ou catégorie proche pour maison
            // Selon les données observées, pour maison catégorie 5, on peut avoir "5" ou une catégorie proche
            // Pour l'instant, on garde catégorie "5" pour A et M, et "5M" pour M si disponible
            if ((categorie === '5' || categorie === '5M') && (natureLocaux === 'A' || natureLocaux === 'M')) {
                // Initialiser la commune si elle n'existe pas
                if (!tarifsMap[codeCommune]) {
                    tarifsMap[codeCommune] = { appartement: null, maison: null };
                }
                
                // Stocker le tarif selon la nature du local
                if (natureLocaux === 'A' && categorie === '5') {
                    // Appartement catégorie 5
                    tarifsMap[codeCommune].appartement = vlAuM2;
                } else if (natureLocaux === 'M' && (categorie === '5' || categorie === '5M')) {
                    // Maison catégorie 5 ou 5M
                    // Prendre la valeur si pas déjà définie, ou la moyenne si plusieurs valeurs
                    if (tarifsMap[codeCommune].maison === null) {
                        tarifsMap[codeCommune].maison = vlAuM2;
                    } else {
                        // Moyenne si plusieurs tarifs pour maison catégorie 5
                        tarifsMap[codeCommune].maison = (tarifsMap[codeCommune].maison + vlAuM2) / 2;
                    }
                }
            }
            
            lineCount++;
            
            // Afficher progression tous les 50000 lignes
            if (lineCount % 50000 === 0) {
                process.stdout.write(`\r   📊 ${lineCount} lignes lues...`);
            }
        });
        
        rl.on('close', () => {
            console.log(`\r   ✅ ${lineCount} lignes lues, tarifs extraits pour ${Object.keys(tarifsMap).length} communes`);
            
            // Compter les communes avec tarifs complets
            let communesCompletes = 0;
            let communesAppartementSeulement = 0;
            let communesMaisonSeulement = 0;
            
            Object.values(tarifsMap).forEach(tarif => {
                if (tarif.appartement !== null && tarif.maison !== null) {
                    communesCompletes++;
                } else if (tarif.appartement !== null) {
                    communesAppartementSeulement++;
                } else if (tarif.maison !== null) {
                    communesMaisonSeulement++;
                }
            });
            
            console.log(`   📊 Statistiques tarifs VLF:`);
            console.log(`      - Communes avec tarifs complets (A+M): ${communesCompletes}`);
            console.log(`      - Communes avec seulement appartement: ${communesAppartementSeulement}`);
            console.log(`      - Communes avec seulement maison: ${communesMaisonSeulement}`);
            
            vlfTarifsMap = tarifsMap;
            resolve();
        });
        
        rl.on('error', (err) => {
            console.error(`   ❌ Erreur lecture fichier tarifs VLF:`, err);
            vlfTarifsMap = {}; // Initialiser vide en cas d'erreur
            reject(err);
        });
    });
}

// Exécuter le script
if (require.main === module) {
    createReiDatabase().catch((err) => {
        console.error('❌ Erreur fatale:', err);
        process.exit(1);
    });
}

module.exports = { createReiDatabase };
