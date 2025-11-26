#!/usr/bin/env node

/**
 * 🏗️ SCRIPT COMPLET - CRÉATION BASE TERRAINS À BÂTIR UNIFIÉE
 * 
 * Ce script combine deux sources de terrains à bâtir :
 * 
 * ÉTAPE 1 : Créer la base avec PA (Permis d'Aménager)
 *   - Exécute create-terrains-batir-V2.js
 *   - Terrains NON_VIABILISE et VIABILISE issus de lotissements
 * 
 * ÉTAPE 2 : Créer la base avec PC sans PA (Permis de Construire)
 *   - Exécute create-terrains-pc-sans-pa-V2.js
 *   - Terrains VIABILISE (construction) et RENOVATION
 * 
 * ÉTAPE 3 : Fusionner les deux bases
 *   - Combine terrains_batir.db + terrains_pc_sans_pa.db
 *   - Crée terrains_batir_complet.db avec structure simplifiée
 * 
 * STRUCTURE FINALE (10 colonnes uniquement) :
 *   - id, valeur_fonciere, surface_totale, surface_reelle_bati, prix_m2
 *   - date_mutation, latitude, longitude, nom_commune
 *   - type_terrain (NON_VIABILISE | VIABILISE | RENOVATION)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const zlib = require('zlib');
const csv = require('csv-parser');

const DB_UNIFIE = path.join(__dirname, '..', 'database', 'terrains_batir_complet.db');
const DB_PA = path.join(__dirname, '..', 'database', 'terrains_batir.db');
const DB_PC = path.join(__dirname, '..', 'database', 'terrains_pc_sans_pa.db');
const SCRIPT_PA = path.join(__dirname, 'create-terrains-batir-V3.js');
const SCRIPT_PC = path.join(__dirname, 'create-terrains-pc-sans-pa-V2.js');

// Configuration téléchargements
const DATA_DIR = path.join(__dirname, '..');
const DVF_DIR = path.join(__dirname, '..', 'dvf_data');
const DFI_DIR = path.join(__dirname, '..', 'dvf_data'); // DFI dans le même dossier que DVF
const TEMP_DIR = path.join(__dirname, '..', 'temp_dfi');

// URLs PA/PC
// Format /r/ redirige directement vers le fichier CSV (géré par getDownloadUrl)
const URL_PA = 'https://www.data.gouv.fr/api/1/datasets/r/9db13a09-72a9-4871-b430-13872b4890b3';
const URL_PC = 'https://www.data.gouv.fr/api/1/datasets/r/65a9e264-7a20-46a9-9d98-66becb817bc3';
const FILE_PA = path.join(DATA_DIR, 'Liste-des-permis-damenager.2025-10.csv');
const FILE_PC = path.join(DATA_DIR, 'Liste-des-autorisations-durbanisme-creant-des-logements.2025-10.csv');

// URLs DFI
const URL_ZIP = 'https://data.economie.gouv.fr/api/datasets/1.0/documents-de-filiation-informatises-dfi-des-parcelles/attachments/documents_de_filiation_informatises_situation_juillet_2025_dept_2a0a_dept_580_zip/';
const URL_7Z = 'https://data.economie.gouv.fr/api/datasets/1.0/documents-de-filiation-informatises-dfi-des-parcelles/attachments/documents_de_filiation_informatises_situation_juillet_2025_dept_590_a_dept_976_7z/';
const ZIP_FILE = path.join(TEMP_DIR, 'dfi_2a_580.zip');
const FILE_7Z = path.join(TEMP_DIR, 'dfi_590_976.7z');

// Années DVF
const ANNEES_DVF = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

console.log('🏗️  === CRÉATION BASE TERRAINS À BÂTIR COMPLÈTE ===\n');
console.log('📋 Ce script combine :');
console.log('   1. PA → NON_VIABILISE + VIABILISE');
console.log('   2. PC sans PA → VIABILISE (construction) + RENOVATION\n');

// ==================== FONCTIONS DE TÉLÉCHARGEMENT ====================

// Fonction pour suivre les redirections et télécharger
function downloadWithRedirect(url, outputPath, fileName = '') {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        const followRedirect = (currentUrl, depth = 0) => {
            if (depth > 10) {
                reject(new Error('Trop de redirections'));
                return;
            }
            
            const request = protocol.get(currentUrl, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                    const redirectUrl = response.headers.location;
                    if (fileName) console.log(`   ↪️  Redirection vers: ${redirectUrl}`);
                    followRedirect(redirectUrl, depth + 1);
                    return;
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                const file = fs.createWriteStream(outputPath);
                let downloaded = 0;
                const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                
                response.on('data', (chunk) => {
                    file.write(chunk);
                    downloaded += chunk.length;
                    if (totalSize > 0) {
                        const percent = ((downloaded / totalSize) * 100).toFixed(1);
                        process.stdout.write(`\r   📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB (${percent}%)`);
                    } else {
                        process.stdout.write(`\r   📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
                    }
                });
                
                response.on('end', () => {
                    file.end();
                    console.log(`\n   ✅ ${fileName || 'Téléchargement'} terminé\n`);
                    resolve();
                });
                
                response.on('error', reject);
            });
            
            request.on('error', reject);
        };
        
        followRedirect(url);
    });
}

// Fonction pour obtenir l'URL de téléchargement depuis l'API data.gouv.fr
function getDownloadUrl(apiUrl) {
    return new Promise((resolve, reject) => {
        console.log(`   🔍 Accès à l'API: ${apiUrl}`);
        
        const requestOptions = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ParcellePlus/1.0)',
                'Accept': 'application/json'
            },
            maxRedirects: 10
        };
        
        const followRedirect = (currentUrl, depth = 0) => {
            if (depth > 10) {
                reject(new Error('Trop de redirections'));
                return;
            }
            
            https.get(currentUrl, requestOptions, (response) => {
                // Suivre les redirections
                if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                    const redirectUrl = response.headers.location;
                    console.log(`   ↪️  Redirection ${depth + 1} vers: ${redirectUrl}`);
                    followRedirect(redirectUrl, depth + 1);
                    return;
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`Erreur HTTP ${response.statusCode} lors de l'accès à l'API`));
                    return;
                }
                
                const contentType = response.headers['content-type'] || '';
                console.log(`   📋 Content-Type: ${contentType}`);
                
                // Si c'est directement un fichier CSV ou autre fichier, retourner l'URL actuelle
                if (contentType.includes('text/csv') || 
                    contentType.includes('application/octet-stream') ||
                    contentType.includes('application/zip') ||
                    contentType.includes('application/gzip') ||
                    currentUrl.includes('.csv') ||
                    currentUrl.includes('.zip') ||
                    currentUrl.includes('.gz')) {
                    console.log(`   ✅ URL directe vers fichier: ${currentUrl}`);
                    resolve(currentUrl);
                    return;
                }
                
                // Sinon, essayer de parser comme JSON
                let data = '';
                response.on('data', (chunk) => {
                    data += chunk.toString();
                });
                
                response.on('end', () => {
                    try {
                        // Nettoyer la réponse : enlever les caractères de contrôle et les espaces en début/fin
                        data = data.trim();
                        
                        // Vérifier si la réponse est vide
                        if (!data || data.length === 0) {
                            reject(new Error('Réponse vide de l\'API'));
                            return;
                        }
                        
                        // Vérifier si c'est du CSV au lieu de JSON (commence par des guillemets ou des lettres)
                        if (data.startsWith('"') || data.startsWith('REG_') || data.startsWith('DEP_') || data.match(/^[A-Z_]+;/)) {
                            console.log(`   ⚠️  Réponse semble être du CSV, pas du JSON. URL actuelle: ${currentUrl}`);
                            resolve(currentUrl);
                            return;
                        }
                        
                        // Si la réponse commence par un point-virgule ou autre caractère invalide, essayer de le retirer
                        if (data.startsWith(';') || data.startsWith(')') || data.startsWith('(')) {
                            // Peut-être du JSONP, essayer d'extraire le JSON
                            const jsonMatch = data.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                data = jsonMatch[0];
                            } else {
                                // Retirer les caractères invalides au début
                                data = data.replace(/^[;()\s]+/, '');
                            }
                        }
                        
                        // Logger les premières lignes pour debug
                        console.log(`   📥 Réponse reçue (${data.length} chars)`);
                        if (data.length < 500) {
                            console.log(`   Contenu: ${data.substring(0, Math.min(200, data.length))}...`);
                        }
                        
                        const json = JSON.parse(data);
                        
                        // Chercher l'URL dans différentes structures possibles
                        if (json.url) {
                            console.log(`   ✅ URL trouvée: ${json.url}`);
                            resolve(json.url);
                        } else if (json.resources && json.resources.length > 0) {
                            // Chercher la ressource avec l'extension .csv
                            const csvResource = json.resources.find(r => r.url && (r.url.includes('.csv') || r.format === 'csv'));
                            if (csvResource) {
                                console.log(`   ✅ Ressource CSV trouvée: ${csvResource.url}`);
                                resolve(csvResource.url);
                            } else {
                                console.log(`   ✅ Première ressource trouvée: ${json.resources[0].url}`);
                                resolve(json.resources[0].url);
                            }
                        } else if (json.data && json.data.url) {
                            console.log(`   ✅ URL dans data: ${json.data.url}`);
                            resolve(json.data.url);
                        } else if (json.download_url) {
                            console.log(`   ✅ download_url trouvée: ${json.download_url}`);
                            resolve(json.download_url);
                        } else {
                            console.error(`   ❌ Structure JSON inattendue. Clés disponibles: ${Object.keys(json).join(', ')}`);
                            if (json.resources) {
                                console.error(`   Ressources disponibles: ${JSON.stringify(json.resources.map(r => ({ title: r.title, url: r.url, format: r.format })), null, 2)}`);
                            }
                            reject(new Error('URL de téléchargement non trouvée dans la réponse API'));
                        }
                    } catch (err) {
                        // Si l'erreur de parsing JSON et que l'URL semble pointer vers un fichier, utiliser l'URL directement
                        if (currentUrl.includes('.csv') || currentUrl.includes('.zip') || currentUrl.includes('.gz') || 
                            currentUrl.includes('datafiles') || currentUrl.includes('download')) {
                            console.log(`   ⚠️  Erreur parsing JSON mais URL semble être un fichier direct: ${currentUrl}`);
                            resolve(currentUrl);
                            return;
                        }
                        
                        console.error(`   ❌ Erreur parsing JSON: ${err.message}`);
                        console.error(`   Position de l'erreur: ${err.message.match(/position (\d+)/)?.[1] || 'inconnue'}`);
                        console.error(`   Caractères autour de l'erreur:`);
                        const pos = parseInt(err.message.match(/position (\d+)/)?.[1] || '10');
                        console.error(`   ${data.substring(Math.max(0, pos - 50), pos + 50)}`);
                        console.error(`   Réponse complète (premiers 200 chars):`);
                        console.error(`   ${data.substring(0, 200)}`);
                        reject(new Error(`Erreur parsing JSON: ${err.message}`));
                    }
                });
                
                response.on('error', reject);
            }).on('error', (err) => {
                reject(new Error(`Erreur lors du téléchargement: ${err.message}`));
            });
        };
        
        followRedirect(apiUrl, 0);
    });
}

// Télécharger PA et PC
async function telechargerPAPC() {
    console.log('📋 PARTIE 1/3 : Fichiers PA et PC\n');
    console.log('─────────────────────────────────────────────────────────\n');
    
    const paExists = fs.existsSync(FILE_PA) && fs.statSync(FILE_PA).size > 0;
    const pcExists = fs.existsSync(FILE_PC) && fs.statSync(FILE_PC).size > 0;
    
    if (paExists && pcExists) {
        console.log('✅ Fichiers PA et PC déjà présents\n');
        console.log(`   - ${path.basename(FILE_PA)} (${(fs.statSync(FILE_PA).size / 1024 / 1024).toFixed(1)} MB)`);
        console.log(`   - ${path.basename(FILE_PC)} (${(fs.statSync(FILE_PC).size / 1024 / 1024).toFixed(1)} MB)\n`);
        return;
    }
    
    if (!paExists) {
        console.log('📥 Téléchargement fichier PA...\n');
        const downloadUrl = await getDownloadUrl(URL_PA);
        await downloadWithRedirect(downloadUrl, FILE_PA, 'PA');
    } else {
        console.log(`✅ ${path.basename(FILE_PA)} déjà présent\n`);
    }
    
    if (!pcExists) {
        console.log('📥 Téléchargement fichier PC...\n');
        const downloadUrl = await getDownloadUrl(URL_PC);
        await downloadWithRedirect(downloadUrl, FILE_PC, 'PC');
    } else {
        console.log(`✅ ${path.basename(FILE_PC)} déjà présent\n`);
    }
}

// Télécharger DVF
async function telechargerDVF() {
    console.log('\n📋 PARTIE 2/3 : Fichiers DVF\n');
    console.log('─────────────────────────────────────────────────────────\n');
    
    if (!fs.existsSync(DVF_DIR)) {
        fs.mkdirSync(DVF_DIR, { recursive: true });
    }
    
    console.log('📂 Vérification des fichiers DVF...\n');
    
    const fichiersManquants = [];
    
    for (const annee of ANNEES_DVF) {
        const fichier = path.join(DVF_DIR, `dvf_${annee}.csv`);
        if (!fs.existsSync(fichier) || fs.statSync(fichier).size === 0) {
            fichiersManquants.push(annee);
            console.log(`   ⚠️  dvf_${annee}.csv manquant`);
        } else {
            const size = fs.statSync(fichier).size;
            console.log(`   ✅ dvf_${annee}.csv présent (${(size / 1024 / 1024).toFixed(1)} MB)`);
        }
    }
    
    if (fichiersManquants.length === 0) {
        console.log('\n✅ Tous les fichiers DVF sont présents\n');
        return;
    }
    
    console.log(`\n📥 Téléchargement de ${fichiersManquants.length} fichier(s) DVF manquant(s)...\n`);
    
    for (const annee of fichiersManquants) {
        try {
            await telechargerDVFAnnee(annee);
            // La normalisation sera faite après tous les téléchargements dans normaliserTousLesDVF()
        } catch (err) {
            console.error(`   ❌ Erreur téléchargement ${annee}: ${err.message}\n`);
        }
    }
    
    console.log('\n✅ Tous les téléchargements DVF terminés\n');
}

async function telechargerDVFAnnee(annee) {
    return new Promise((resolve, reject) => {
        const outputFile = path.join(DVF_DIR, `dvf_${annee}.csv`);
        
        if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0) {
            console.log(`   ✅ dvf_${annee}.csv déjà présent`);
            resolve();
            return;
        }
        
        console.log(`   📥 Téléchargement DVF ${annee}...`);
        
        let url;
        let extension;
        
        if (annee === 2025) {
            // Pour 2025, utiliser l'API data.gouv.fr pour obtenir l'URL réelle
            url = 'https://www.data.gouv.fr/api/1/datasets/r/4d741143-8331-4b59-95c2-3b24a7bdbe3c';
            extension = '.txt.zip';
            // Résoudre l'URL via l'API avant de télécharger
            return getDownloadUrl(url).then(downloadUrl => {
                return new Promise((resolve, reject) => {
                    const makeRequest = (requestUrl) => {
                        https.get(requestUrl, (response) => {
                            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                                const redirectUrl = response.headers.location;
                                console.log(`   ↪️  Redirection vers: ${redirectUrl}`);
                                return makeRequest(redirectUrl);
                            }
                            
                            if (response.statusCode !== 200) {
                                reject(new Error(`Erreur HTTP ${response.statusCode} pour ${annee}`));
                                return;
                            }
                            
                            const chunks = [];
                            let downloaded = 0;
                            const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                            
                            response.on('data', (chunk) => {
                                chunks.push(chunk);
                                downloaded += chunk.length;
                                if (totalSize > 0) {
                                    const percent = ((downloaded / totalSize) * 100).toFixed(1);
                                    process.stdout.write(`\r   📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB (${percent}%)`);
                                } else {
                                    process.stdout.write(`\r   📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
                                }
                            });
                            
                            response.on('end', () => {
                                const data = Buffer.concat(chunks);
                                console.log(`\n   📦 Décompression ZIP...`);
                                const tempZip = path.join(DVF_DIR, `temp_${annee}.zip`);
                                fs.writeFileSync(tempZip, data);
                                
                                try {
                                    const zipEscaped = tempZip.replace(/'/g, "''").replace(/\\/g, '/');
                                    const dirEscaped = DVF_DIR.replace(/'/g, "''").replace(/\\/g, '/');
                                    
                                    execSync(`powershell -Command "Expand-Archive -Path '${zipEscaped}' -DestinationPath '${dirEscaped}' -Force"`, {
                                        stdio: 'ignore'
                                    });
                                    
                                    let txtFile = path.join(DVF_DIR, `valeursfoncieres-${annee}.txt`);
                                    if (!fs.existsSync(txtFile)) {
                                        const fichiersTxt = fs.readdirSync(DVF_DIR)
                                            .filter(f => f.endsWith('.txt') && !f.startsWith('temp_'))
                                            .map(f => path.join(DVF_DIR, f));
                                        
                                        if (fichiersTxt.length === 0) {
                                            throw new Error(`Aucun fichier .txt trouvé après décompression`);
                                        }
                                        
                                        txtFile = fichiersTxt[0];
                                        console.log(`   📄 Fichier trouvé: ${path.basename(txtFile)}`);
                                    }
                                    
                                    fs.renameSync(txtFile, outputFile);
                                    fs.unlinkSync(tempZip);
                                    
                                    const size = fs.statSync(outputFile).size;
                                    console.log(`   ✅ dvf_${annee}.csv créé (${(size / 1024 / 1024).toFixed(1)} MB)`);
                                    
                                    // La normalisation sera faite après tous les téléchargements
                                    resolve();
                                } catch (err) {
                                    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
                                    reject(new Error(`Erreur décompression ZIP: ${err.message}`));
                                }
                            });
                            
                            response.on('error', reject);
                        }).on('error', reject);
                    };
                    
                    makeRequest(downloadUrl);
                });
            }).catch(reject);
        } else if (annee >= 2020 && annee <= 2024) {
            // Pour 2020-2024, utiliser les URLs directes de files.data.gouv.fr
            // Format: https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/full.csv.gz
            url = `https://files.data.gouv.fr/geo-dvf/latest/csv/${annee}/full.csv.gz`;
            
            const makeRequest = (requestUrl) => {
                https.get(requestUrl, (response) => {
                    if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                        const redirectUrl = response.headers.location;
                        console.log(`   ↪️  Redirection vers: ${redirectUrl}`);
                        return makeRequest(redirectUrl);
                    }
                    
                    if (response.statusCode !== 200) {
                        reject(new Error(`Erreur HTTP ${response.statusCode} pour DVF ${annee} - URL: ${requestUrl}`));
                        return;
                    }
                    
                    console.log(`   📦 Décompression GZIP...`);
                    const gunzip = zlib.createGunzip();
                    const writeStream = fs.createWriteStream(outputFile);
                    let downloaded = 0;
                    let decompressed = 0;
                    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                    
                    response.on('data', (chunk) => {
                        downloaded += chunk.length;
                        if (totalSize > 0) {
                            const percent = ((downloaded / totalSize) * 100).toFixed(1);
                            process.stdout.write(`\r   📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB (${percent}%)`);
                        } else {
                            process.stdout.write(`\r   📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
                        }
                    });
                    
                    gunzip.on('data', (chunk) => {
                        decompressed += chunk.length;
                    });
                    
                    response.pipe(gunzip).pipe(writeStream);
                    
                    writeStream.on('finish', () => {
                        const size = fs.statSync(outputFile).size;
                        console.log(`\n   ✅ dvf_${annee}.csv créé (${(size / 1024 / 1024).toFixed(1)} MB)`);
                        
                        // La normalisation sera faite après tous les téléchargements
                        resolve();
                    });
                    
                    writeStream.on('error', reject);
                    gunzip.on('error', reject);
                    response.on('error', reject);
                }).on('error', reject);
            };
            
            makeRequest(url);
            return;
        } else {
            // Pour 2014-2019, utiliser data.cquest.org
            let dossier;
            if (annee <= 2018) {
                dossier = '201904';
                extension = '.txt';
            } else if (annee === 2019) {
                // Pour 2019, utiliser le dossier 202404
                dossier = '202404';
                extension = '.txt';
            } else {
                dossier = '201904';
                extension = '.txt';
            }
            
            url = `https://data.cquest.org/dgfip_dvf/${dossier}/valeursfoncieres-${annee}${extension}`;
        }
        
        const makeRequest = (requestUrl) => {
            https.get(requestUrl, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                    const redirectUrl = response.headers.location;
                    console.log(`   ↪️  Redirection vers: ${redirectUrl}`);
                    return makeRequest(redirectUrl);
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`Erreur HTTP ${response.statusCode} pour DVF ${annee} - URL: ${requestUrl}`));
                    return;
                }
                
                const chunks = [];
                let downloaded = 0;
                const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                
                response.on('data', (chunk) => {
                    chunks.push(chunk);
                    downloaded += chunk.length;
                    if (totalSize > 0) {
                        const percent = ((downloaded / totalSize) * 100).toFixed(1);
                        process.stdout.write(`\r   📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB (${percent}%)`);
                    } else {
                        process.stdout.write(`\r   📥 ${(downloaded / 1024 / 1024).toFixed(1)} MB`);
                    }
                });
                
                response.on('end', () => {
                    const data = Buffer.concat(chunks);
                    const isZip = extension === '.txt.zip' || (data[0] === 0x50 && data[1] === 0x4B);
                    
                    if (isZip) {
                        console.log(`\n   📦 Décompression ZIP...`);
                        const tempZip = path.join(DVF_DIR, `temp_${annee}.zip`);
                        fs.writeFileSync(tempZip, data);
                        
                        try {
                            const zipEscaped = tempZip.replace(/'/g, "''").replace(/\\/g, '/');
                            const dirEscaped = DVF_DIR.replace(/'/g, "''").replace(/\\/g, '/');
                            
                            execSync(`powershell -Command "Expand-Archive -Path '${zipEscaped}' -DestinationPath '${dirEscaped}' -Force"`, {
                                stdio: 'ignore'
                            });
                            
                            let txtFile = path.join(DVF_DIR, `valeursfoncieres-${annee}.txt`);
                            if (!fs.existsSync(txtFile)) {
                                const fichiersTxt = fs.readdirSync(DVF_DIR)
                                    .filter(f => f.endsWith('.txt') && !f.startsWith('temp_'))
                                    .map(f => path.join(DVF_DIR, f));
                                
                                if (fichiersTxt.length === 0) {
                                    throw new Error(`Aucun fichier .txt trouvé après décompression`);
                                }
                                
                                txtFile = fichiersTxt[0];
                                console.log(`   📄 Fichier trouvé: ${path.basename(txtFile)}`);
                            }
                            
                            // Renommer le fichier .txt en .csv directement
                            fs.renameSync(txtFile, outputFile);
                            fs.unlinkSync(tempZip);
                            
                            const size = fs.statSync(outputFile).size;
                            console.log(`   ✅ dvf_${annee}.csv créé (${(size / 1024 / 1024).toFixed(1)} MB)`);
                            
                            // La normalisation sera faite après tous les téléchargements
                            resolve();
                        } catch (err) {
                            if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
                            reject(new Error(`Erreur décompression ZIP: ${err.message}`));
                        }
                    } else {
                        // Sauvegarder directement en CSV sans compression
                        fs.writeFileSync(outputFile, data);
                        const size = fs.statSync(outputFile).size;
                        console.log(`\n   ✅ dvf_${annee}.csv créé (${(size / 1024 / 1024).toFixed(1)} MB)`);
                        
                        // La normalisation sera faite après tous les téléchargements
                        resolve();
                    }
                });
                
                response.on('error', reject);
            }).on('error', reject);
        };
        
        makeRequest(url);
    });
}

// Fonction pour détecter le séparateur d'un fichier CSV
function detecterSeparateur(filePath) {
    try {
        const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
        const countPipe = (firstLine.match(/\|/g) || []).length;
        const countComma = (firstLine.match(/,/g) || []).length;
        
        if (countPipe > countComma && countPipe > 5) {
            return '|';
        }
        if (countComma > countPipe && countComma > 5) {
            return ',';
        }
        return '|'; // Par défaut
    } catch (err) {
        return '|';
    }
}

// Mapping des colonnes anciennes vers nouvelles (format uniforme)
const COLUMN_MAPPING = {
    // Format ancien (français avec espaces) → Format moderne (minuscules avec underscores)
    'Code departement': 'code_departement',
    'Code commune': 'code_commune',
    'Commune': 'nom_commune',
    'No disposition': 'numero_disposition',
    'Date mutation': 'date_mutation',
    'Nature mutation': 'nature_mutation',
    'Valeur fonciere': 'valeur_fonciere',
    'No voie': 'adresse_numero',
    'B/T/Q': 'adresse_suffixe',
    'Type de voie': 'type_voie',
    'Code voie': 'adresse_code_voie',
    'Voie': 'adresse_nom_voie',
    'Code postal': 'code_postal',
    'Prefixe de section': 'prefixe_de_section',
    'Section': 'section',
    'No plan': 'numero_plan',
    'No Volume': 'numero_volume',
    '1er lot': 'lot1_numero',
    'Surface Carrez du 1er lot': 'lot1_surface_carrez',
    '2eme lot': 'lot2_numero',
    'Surface Carrez du 2eme lot': 'lot2_surface_carrez',
    '3eme lot': 'lot3_numero',
    'Surface Carrez du 3eme lot': 'lot3_surface_carrez',
    '4eme lot': 'lot4_numero',
    'Surface Carrez du 4eme lot': 'lot4_surface_carrez',
    '5eme lot': 'lot5_numero',
    'Surface Carrez du 5eme lot': 'lot5_surface_carrez',
    'Nombre de lots': 'nombre_lots',
    'Code type local': 'code_type_local',
    'Type local': 'type_local',
    'Identifiant local': 'identifiant_local',
    'Surface reelle bati': 'surface_reelle_bati',
    'Nombre pieces principales': 'nombre_pieces_principales',
    'Nature culture': 'nature_culture',
    'Nature culture speciale': 'nature_culture_speciale',
    'Surface terrain': 'surface_terrain',
    'latitude': 'latitude',
    'longitude': 'longitude',
    'lat': 'latitude',
    'lon': 'longitude'
};

// Fonction pour échapper les valeurs CSV
function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// Fonction pour vérifier si un fichier DVF est déjà normalisé
function estDejaNormalise(filePath) {
    try {
        const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
        
        // Vérifier le séparateur (doit être une virgule)
        if (!firstLine.includes(',')) {
            return false;
        }
        
        // Vérifier que les colonnes sont en minuscules avec underscores (pas d'espaces, pas de majuscules)
        const colonnes = firstLine.split(',');
        
        // Liste des colonnes normalisées attendues (noms normalisés ET noms alternatifs acceptables)
        const colonnesNormaliseesAttendues = [
            'id_mutation', 'date_mutation', 'valeur_fonciere', 'code_departement',
            'code_commune', 'nom_commune', 'id_parcelle', 'section_cadastrale',
            'numero_disposition', 'nature_mutation', 'surface_terrain', 'surface_reelle_bati'
        ];
        
        let colonnesNormaliseesTrouvees = 0;
        let toutesEnMinuscules = true;
        let colonnesAvecEspacesOuMajuscules = 0;
        
        for (const col of colonnes) {
            const colClean = col.trim().replace(/"/g, '');
            if (!colClean) continue; // Ignorer les colonnes vides
            
            const colLower = colClean.toLowerCase();
            
            // Vérifier que le nom de la colonne est en minuscules avec underscores (pas d'espaces, pas de majuscules)
            // Pour l'en-tête, on prend toute la colonne (pas de valeurs dans l'en-tête)
            // Si la colonne contient des espaces ou des majuscules dans le nom, ce n'est pas normalisé
            if (colClean.includes(' ') || (colClean !== colLower && /[A-Z]/.test(colClean))) {
                colonnesAvecEspacesOuMajuscules++;
                // Si plus de 2 colonnes avec espaces/majuscules, ce n'est probablement pas normalisé
                if (colonnesAvecEspacesOuMajuscules > 2) {
                    toutesEnMinuscules = false;
                    break;
                }
            }
            
            // Vérifier si c'est une colonne normalisée attendue (nom normalisé ou alternatif acceptable)
            // On accepte les correspondances exactes ou les préfixes
            const estColonneConnue = colonnesNormaliseesAttendues.some(attendu => {
                return colLower === attendu || 
                       colLower.startsWith(attendu + '_') || 
                       attendu.startsWith(colLower) ||
                       colLower.includes(attendu);
            });
            
            if (estColonneConnue) {
                colonnesNormaliseesTrouvees++;
            }
        }
        
        // Si toutes les colonnes sont en minuscules avec underscores ET qu'on trouve au moins 5 colonnes connues,
        // le fichier est probablement déjà normalisé (même avec des noms alternatifs comme numero_disposition)
        // OU si on trouve au moins 7 colonnes connues (fichier très probablement normalisé)
        // OU si on trouve au moins 5 colonnes connues et moins de 3 colonnes avec espaces/majuscules (tolérance)
        // OU si on trouve les colonnes clés id_mutation, date_mutation, valeur_fonciere (fichier normalisé)
        const aColonnesCles = firstLine.toLowerCase().includes('id_mutation') && 
                              firstLine.toLowerCase().includes('date_mutation') && 
                              firstLine.toLowerCase().includes('valeur_fonciere');
        
        const estNormalise = (toutesEnMinuscules && colonnesNormaliseesTrouvees >= 5) || 
                             colonnesNormaliseesTrouvees >= 7 ||
                             (colonnesNormaliseesTrouvees >= 5 && colonnesAvecEspacesOuMajuscules <= 2) ||
                             (aColonnesCles && colonnesNormaliseesTrouvees >= 3);
        
        return estNormalise;
    } catch (err) {
        return false;
    }
}

// 🧹 Fonction simple : enlever tous les " du fichier
async function nettoyerGuillemetsDVF(filePath) {
    return new Promise((resolve, reject) => {
        // Vérifier si le fichier contient des guillemets avant de nettoyer
        try {
            const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
            if (!firstLine.includes('"')) {
                // Pas de guillemets, fichier déjà nettoyé
                resolve();
                return;
            }
        } catch (err) {
            // En cas d'erreur, continuer le nettoyage
        }
        
        console.log(`   🧹 Nettoyage de ${path.basename(filePath)}...`);
        
        const readline = require('readline');
        const tempFile = filePath + '.tmp';
        const writeStream = fs.createWriteStream(tempFile);
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });
        
        let count = 0;
        
        rl.on('line', (line) => {
            // Remplacer " par rien
            const cleanedLine = line.replace(/"/g, '');
            writeStream.write(cleanedLine + '\n');
            count++;
            
            if (count % 500000 === 0) {
                process.stdout.write(`\r      → ${count.toLocaleString()} lignes...`);
            }
        });
        
        rl.on('close', () => {
            writeStream.end();
            
            writeStream.on('finish', () => {
                // Remplacer l'original
                fs.unlinkSync(filePath);
                fs.renameSync(tempFile, filePath);
                
                console.log(`\r   ✅ ${count.toLocaleString()} lignes nettoyées`);
                resolve();
            });
            
            writeStream.on('error', reject);
        });
        
        rl.on('error', reject);
    });
}

// Fonction pour normaliser un fichier DVF (convertir au format uniforme) - Version streaming optimisée
function normaliserFichierDVF(filePath) {
    return new Promise((resolve, reject) => {
        // Vérifier si le fichier est déjà normalisé AVANT de commencer tout traitement
        if (estDejaNormalise(filePath)) {
            console.log(`   ⏭️  ${path.basename(filePath)} déjà normalisé, ignoré`);
            resolve();
            return;
        }
        
        console.log(`   🔄 Normalisation du fichier ${path.basename(filePath)}...`);
        
        // Log du contenu AVANT normalisation (sans charger tout le fichier)
        const rlAvant = require('readline').createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });
        
        const avantLines = [];
        let lineCountAvant = 0;
        
        rlAvant.on('line', (line) => {
            if (lineCountAvant < 2) {
                avantLines.push(line);
                lineCountAvant++;
            }
            if (lineCountAvant === 2) {
                rlAvant.close();
            }
        });
        
        return new Promise((resolvePrelim) => {
            rlAvant.on('close', () => {
                if (avantLines.length >= 2) {
                    console.log(`   🔍 AVANT normalisation ligne 1: "${avantLines[0].substring(0, 80)}..."`);
                    console.log(`   🔍 AVANT normalisation ligne 2: "${avantLines[1].substring(0, 80)}..."`);
                }
                resolvePrelim();
            });
            
            rlAvant.on('error', () => {
                resolvePrelim(); // Continue même en cas d'erreur
            });
        }).then(() => {
        
        const separator = detecterSeparateur(filePath);
        const tempFile = filePath + '.tmp';
        
        // Première passe : collecter toutes les colonnes possibles
        const allColumnsSet = new Set();
        let firstPassCount = 0;
        
        const firstPass = new Promise((resolveFirst, rejectFirst) => {
            fs.createReadStream(filePath)
                .pipe(csv({ separator, skipLinesWithError: true }))
                .on('data', (row) => {
                    const normalizedRow = {};
                    for (const [oldKey] of Object.entries(row)) {
                        const newKey = COLUMN_MAPPING[oldKey] || oldKey.toLowerCase().replace(/\s+/g, '_');
                        allColumnsSet.add(newKey);
                    }
                    firstPassCount++;
                    if (firstPassCount % 50000 === 0) {
                        process.stdout.write(`\r      → Première passe: ${firstPassCount} lignes analysées...`);
                    }
                })
                .on('end', resolveFirst)
                .on('error', rejectFirst);
        });
        
        firstPass.then(() => {
            const columns = Array.from(allColumnsSet).sort();
            const writeStream = fs.createWriteStream(tempFile, { encoding: 'utf8' });
            
            // Écrire l'en-tête (sans escapeCSV qui ajouterait des guillemets)
            writeStream.write(columns.join(',') + '\n');
            
            let count = 0;
            
            // Deuxième passe : normaliser et écrire
            fs.createReadStream(filePath)
                .pipe(csv({ separator, skipLinesWithError: true }))
                .on('data', (row) => {
                    const normalizedRow = {};
                    
                    for (const [oldKey, value] of Object.entries(row)) {
                        const newKey = COLUMN_MAPPING[oldKey] || oldKey.toLowerCase().replace(/\s+/g, '_');
                        normalizedRow[newKey] = value;
                    }
                    
                    // Construire id_parcelle si manquant
                    if (!normalizedRow.id_parcelle && (normalizedRow.code_departement || normalizedRow.code_commune)) {
                        const dept = (normalizedRow.code_departement || '').trim().padStart(2, '0');
                        const comm = (normalizedRow.code_commune || '').trim().padStart(3, '0');
                        const prefixe = (normalizedRow.prefixe_de_section || normalizedRow.prefixe_section || '000').trim().padStart(3, '0');
                        const section = (normalizedRow.section || '').trim().toUpperCase();
                        const numero = (normalizedRow.numero_plan || normalizedRow.no_plan || '').trim().padStart(4, '0');
                        
                        if (dept.length === 2 && comm.length === 3 && section && numero.length === 4) {
                            let sectionNorm = section;
                            if (sectionNorm.length === 1) {
                                sectionNorm = '0' + sectionNorm;
                            }
                            sectionNorm = sectionNorm.padStart(2, '0').substring(0, 2);
                            normalizedRow.id_parcelle = dept + comm + prefixe + sectionNorm + numero;
                        }
                    }
                    
                    // Écrire la ligne normalisée (sans escapeCSV qui ajouterait des guillemets)
                    const values = columns.map(col => normalizedRow[col] || '');
                    writeStream.write(values.join(',') + '\n');
                    
                    count++;
                    
                    if (count % 100000 === 0) {
                        process.stdout.write(`\r      → ${count} lignes normalisées...`);
                    }
                })
                .on('end', () => {
                    writeStream.end();
                    
                    writeStream.on('finish', () => {
                        try {
                            // Vérifier que le fichier temporaire existe
                            if (!fs.existsSync(tempFile)) {
                                throw new Error(`Fichier temporaire ${tempFile} non trouvé`);
                            }
                            
                            const tempSize = fs.statSync(tempFile).size;
                            const origSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
                            
                            console.log(`\n   📊 Remplacement: ${origSize} bytes → ${tempSize} bytes`);
                            
                            // Remplacer le fichier original
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
                            fs.renameSync(tempFile, filePath);
                            
                            // Vérifier que le remplacement a réussi
                            if (!fs.existsSync(filePath)) {
                                throw new Error(`Échec du remplacement de ${path.basename(filePath)}`);
                            }
                            
                            // Vérifier le contenu du fichier après normalisation (sans charger tout le fichier)
                            const rlVerifNorm = require('readline').createInterface({
                                input: fs.createReadStream(filePath),
                                crlfDelay: Infinity
                            });
                            
                            const verifNormLines = [];
                            rlVerifNorm.on('line', (line) => {
                                if (verifNormLines.length < 2) {
                                    verifNormLines.push(line);
                                }
                                if (verifNormLines.length === 2) {
                                    rlVerifNorm.close();
                                }
                            });
                            
                            rlVerifNorm.on('close', () => {
                                console.log(`   ✅ ${count} lignes normalisées - Fichier remplacé`);
                                if (verifNormLines.length >= 2) {
                                    console.log(`   🔍 Vérif ligne 1 après normalisation: "${verifNormLines[0].substring(0, 80)}..."`);
                                    console.log(`   🔍 Vérif ligne 2 après normalisation: "${verifNormLines[1].substring(0, 80)}..."\n`);
                                }
                                resolve();
                            });
                            
                            rlVerifNorm.on('error', reject);
                        } catch (err) {
                            console.error(`\n   ❌ Erreur remplacement fichier: ${err.message}\n`);
                            reject(err);
                        }
                    });
                    
                    writeStream.on('error', (err) => {
                        console.error(`\n   ❌ Erreur écriture: ${err.message}\n`);
                        reject(err);
                    });
                })
                .on('error', (err) => {
                    writeStream.destroy();
                    if (fs.existsSync(tempFile)) {
                        fs.unlinkSync(tempFile);
                    }
                    reject(err);
                });
        }).catch(reject);
        }); // Fermeture du .then()
    });
}

// Normaliser tous les fichiers DVF existants
async function normaliserTousLesDVF() {
    console.log('\n📋 Normalisation des fichiers DVF au format uniforme...\n');
    console.log('─────────────────────────────────────────────────────────\n');
    
    if (!fs.existsSync(DVF_DIR)) {
        console.log('   ⚠️  Dossier dvf_data non trouvé\n');
        return;
    }
    
    const fichiers = fs.readdirSync(DVF_DIR)
        .filter(f => f.startsWith('dvf_') && f.endsWith('.csv'))
        .map(f => path.join(DVF_DIR, f));
    
    if (fichiers.length === 0) {
        console.log('   ⚠️  Aucun fichier DVF à normaliser\n');
        return;
    }
    
    console.log(`   📂 ${fichiers.length} fichier(s) à normaliser\n`);
    
    for (const fichier of fichiers) {
        try {
            // Vérifier si le fichier est déjà normalisé AVANT tout traitement
            if (estDejaNormalise(fichier)) {
                console.log(`   ⏭️  ${path.basename(fichier)} déjà normalisé, ignoré\n`);
                continue;
            }
            
            // 🧹 Étape 1 : Nettoyer les guillemets (DVF 2021+)
            await nettoyerGuillemetsDVF(fichier);
            
            // Vérifier à nouveau si le fichier est normalisé APRÈS nettoyage
            // (le nettoyage peut avoir révélé que le fichier était déjà normalisé)
            if (estDejaNormalise(fichier)) {
                console.log(`   ⏭️  ${path.basename(fichier)} déjà normalisé après nettoyage, ignoré\n`);
                continue;
            }
            
            // 🔄 Étape 2 : Normaliser le format
            await normaliserFichierDVF(fichier);
        } catch (err) {
            console.error(`   ❌ Erreur normalisation ${path.basename(fichier)}: ${err.message}\n`);
        }
    }
    
    console.log('✅ Normalisation terminée\n');
}

// Télécharger DFI
async function telechargerDFI() {
    console.log('\n📋 PARTIE 3/3 : Fichiers DFI\n');
    console.log('─────────────────────────────────────────────────────────\n');
    
    const fichiersDFI = fs.existsSync(DFI_DIR) 
        ? fs.readdirSync(DFI_DIR).filter(f => f.startsWith('dfiano-dep') && f.endsWith('.txt'))
        : [];
    
    if (fichiersDFI.length > 0) {
        console.log(`✅ ${fichiersDFI.length} fichier(s) DFI déjà présent(s)\n`);
        return;
    }
    
    if (!fs.existsSync(DFI_DIR)) {
        fs.mkdirSync(DFI_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    console.log('📥 Téléchargement archive 1/2 (départements 2A à 580)...\n');
    await downloadWithRedirect(URL_ZIP, ZIP_FILE, 'Archive 1');
    
    console.log('📥 Téléchargement archive 2/2 (départements 590 à 976)...\n');
    await downloadWithRedirect(URL_7Z, FILE_7Z, 'Archive 2');
    
    const format1 = detecterFormat(ZIP_FILE);
    const format2 = detecterFormat(FILE_7Z);
    
    console.log(`\n📦 Extraction archive 1/2 (format: ${format1.toUpperCase()})...\n`);
    const extractDir1 = path.join(TEMP_DIR, 'extracted_1');
    if (!fs.existsSync(extractDir1)) {
        fs.mkdirSync(extractDir1, { recursive: true });
    }
    
    let success1 = false;
    if (format1 === 'zip') {
        success1 = extraireZIP(ZIP_FILE, extractDir1);
    } else if (format1 === '7z') {
        success1 = extraire7Z(ZIP_FILE, extractDir1);
    }
    
    if (!success1) {
        throw new Error('Échec extraction archive 1');
    }
    
    console.log(`\n📦 Extraction archive 2/2 (format: ${format2.toUpperCase()})...\n`);
    const extractDir2 = path.join(TEMP_DIR, 'extracted_2');
    if (!fs.existsSync(extractDir2)) {
        fs.mkdirSync(extractDir2, { recursive: true });
    }
    
    let success2 = false;
    if (format2 === 'zip') {
        success2 = extraireZIP(FILE_7Z, extractDir2);
    } else if (format2 === '7z') {
        success2 = extraire7Z(FILE_7Z, extractDir2);
    }
    
    if (!success2) {
        console.log('⚠️  Archive 2 non décompressée, continuation avec archive 1 uniquement...\n');
    }
    
    console.log('📋 Décompression fichiers .txt.zip...\n');
    decompresserTxtZip(extractDir1);
    if (success2) {
        decompresserTxtZip(extractDir2);
    }
    
    console.log('📋 Organisation des fichiers...\n');
    const deplaces1 = deplacerFichiersTXT(extractDir1);
    let deplaces2 = 0;
    if (success2) {
        deplaces2 = deplacerFichiersTXT(extractDir2);
    }
    
    const totalDeplaces = deplaces1 + deplaces2;
    if (totalDeplaces === 0) {
        console.log('⚠️  Aucun fichier DFI déplacé vers dvf_data. Vérifiez les répertoires d\'extraction.\n');
        console.log(`   📂 Répertoire extraction 1: ${extractDir1}\n`);
        if (success2) {
            console.log(`   📂 Répertoire extraction 2: ${extractDir2}\n`);
        }
    } else {
        console.log(`✅ ${totalDeplaces} fichier(s) DFI déplacé(s) vers ${DFI_DIR}\n`);
    }
    
    console.log('🧹 Nettoyage...\n');
    try {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        console.log('✅ Fichiers temporaires supprimés\n');
    } catch (err) {
        console.log(`⚠️  Impossible de supprimer ${TEMP_DIR}: ${err.message}\n`);
    }
}

function detecterFormat(filePath) {
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    
    const magic = buffer.toString('hex');
    if (magic.startsWith('504b')) return 'zip';
    if (magic === '377abcaf') return '7z';
    return 'unknown';
}

function extraireZIP(zipPath, outputDir) {
    console.log(`   📦 Décompression ZIP...`);
    try {
        const zipEscaped = zipPath.replace(/'/g, "''").replace(/\\/g, '/');
        const outputEscaped = outputDir.replace(/'/g, "''").replace(/\\/g, '/');
        
        execSync(`powershell -Command "Expand-Archive -Path '${zipEscaped}' -DestinationPath '${outputEscaped}' -Force"`, {
            stdio: 'inherit'
        });
        
        console.log(`   ✅ ZIP décompressé\n`);
        return true;
    } catch (err) {
        console.error(`   ❌ Erreur décompression ZIP: ${err.message}\n`);
        return false;
    }
}

function extraire7Z(file7z, outputDir) {
    console.log(`   📦 Décompression 7Z...`);
    
    // Essayer différentes commandes 7z possibles
    const commands7z = ['7z', '7za', '7zr', 'p7zip'];
    
    for (const cmd of commands7z) {
        try {
            // Vérifier si la commande existe
            execSync(`which ${cmd}`, { stdio: 'ignore' });
            // Essayer d'extraire
            execSync(`${cmd} x "${file7z}" -o"${outputDir}" -y`, { stdio: 'inherit' });
            console.log(`   ✅ 7Z décompressé avec ${cmd}\n`);
            return true;
        } catch (err) {
            // Continuer avec la commande suivante
            continue;
        }
    }
    
    // Si aucune commande 7z n'a fonctionné, essayer Python
    console.log(`   💡 7-Zip non trouvé, tentative avec Python...`);
    
    const pythonCommands = ['python3', 'python'];
    
    for (const pythonCmd of pythonCommands) {
        try {
            // Vérifier si Python existe
            execSync(`which ${pythonCmd}`, { stdio: 'ignore' });
            
            const pythonScript = `
import py7zr
import sys
import os

archive_path = sys.argv[1]
output_dir = sys.argv[2]

os.makedirs(output_dir, exist_ok=True)

with py7zr.SevenZipFile(archive_path, mode='r') as archive:
    archive.extractall(path=output_dir)
    
print("Extraction terminée")
`;
            
            const scriptPath = path.join(TEMP_DIR, 'extract_7z.py');
            fs.writeFileSync(scriptPath, pythonScript);
            
            execSync(`${pythonCmd} "${scriptPath}" "${file7z}" "${outputDir}"`, { stdio: 'inherit' });
            
            fs.unlinkSync(scriptPath);
            console.log(`   ✅ 7Z décompressé avec ${pythonCmd}\n`);
            return true;
        } catch (pyErr) {
            // Continuer avec la commande suivante
            continue;
        }
    }
    
    // Si tout a échoué, donner des instructions
    console.error(`\n   ❌ Impossible de décompresser le fichier 7Z\n`);
    console.error(`   📋 Pour installer 7-Zip sur Linux, exécutez :\n`);
    console.error(`      sudo apt-get update && sudo apt-get install -y p7zip-full\n`);
    console.error(`   📋 Ou pour Python avec py7zr :\n`);
    console.error(`      pip3 install py7zr\n`);
    console.error(`   💡 Ensuite, relancez le script.\n`);
    return false;
}

function decompresserTxtZip(sourceDir) {
    function trouverFichiersZip(dir) {
        const fichiers = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                fichiers.push(...trouverFichiersZip(fullPath));
            } else if (entry.isFile() && entry.name.endsWith('.txt.zip') && entry.name.startsWith('dfiano-dep')) {
                fichiers.push(fullPath);
            }
        }
        
        return fichiers;
    }
    
    const fichiersZip = trouverFichiersZip(sourceDir);
    
    if (fichiersZip.length === 0) {
        return 0;
    }
    
    console.log(`   📄 ${fichiersZip.length} fichier(s) .txt.zip trouvé(s), décompression...`);
    
    let decompresses = 0;
    let erreurs = 0;
    
    for (const fichierZip of fichiersZip) {
        const dirZip = path.dirname(fichierZip);
        const nomFichier = path.basename(fichierZip);
        const nomSansZip = nomFichier.replace('.zip', '');
        const fichierTxtAttendu = path.join(dirZip, nomSansZip);
        
        // Vérifier si le fichier .txt existe déjà (déjà décompressé)
        if (fs.existsSync(fichierTxtAttendu)) {
            decompresses++;
            continue;
        }
        
        let success = false;
        
        // Méthode 1 : Essayer avec 7zip (méthode principale pour les fichiers DFI)
        const commands7z = ['7z', '7za', '7zr', 'p7zip'];
        
        for (const cmd of commands7z) {
            try {
                // Vérifier si la commande existe
                execSync(`which ${cmd}`, { stdio: 'ignore' });
                // Extraire avec 7zip
                execSync(`${cmd} x "${fichierZip}" -o"${dirZip}" -y`, {
                    stdio: 'pipe'
                });
                if (fs.existsSync(fichierTxtAttendu)) {
                    success = true;
                    break;
                }
            } catch (err) {
                // Continuer avec la commande suivante
                continue;
            }
        }
        
        // Méthode 2 : Si 7zip échoue, essayer avec Python py7zr
        if (!success) {
            const pythonCommands = ['python3', 'python'];
            for (const pythonCmd of pythonCommands) {
                try {
                    execSync(`which ${pythonCmd}`, { stdio: 'ignore' });
                    
                    const pythonScript = `
import py7zr
import sys
import os

archive_path = sys.argv[1]
output_dir = sys.argv[2]

os.makedirs(output_dir, exist_ok=True)

with py7zr.SevenZipFile(archive_path, mode='r') as archive:
    archive.extractall(path=output_dir)
`;
                    const tempScript = path.join(dirZip, 'extract_temp.py');
                    fs.writeFileSync(tempScript, pythonScript);
                    
                    execSync(`${pythonCmd} "${tempScript}" "${fichierZip}" "${dirZip}"`, {
                        stdio: 'pipe'
                    });
                    
                    if (fs.existsSync(fichierTxtAttendu)) {
                        success = true;
                    }
                    
                    // Nettoyer le script temporaire
                    if (fs.existsSync(tempScript)) {
                        fs.unlinkSync(tempScript);
                    }
                    
                    if (success) break;
                } catch (err) {
                    // Continuer avec la commande suivante
                    continue;
                }
            }
        }
        
        // Méthode 3 : Fallback avec unzip (au cas où c'est un vrai ZIP)
        if (!success) {
            try {
                execSync(`unzip -q -o "${fichierZip}" -d "${dirZip}"`, {
                    stdio: 'pipe'
                });
                if (fs.existsSync(fichierTxtAttendu)) {
                    success = true;
                }
            } catch (err) {
                // Ignorer
            }
        }
        
        if (success) {
            // Supprimer le fichier .zip seulement si la décompression a réussi
            try {
                fs.unlinkSync(fichierZip);
            } catch (err) {
                // Ignorer si suppression échoue
            }
            decompresses++;
            
            if (decompresses % 10 === 0) {
                process.stdout.write(`\r   📦 ${decompresses}/${fichiersZip.length} fichiers décompressés...`);
            }
        } else {
            erreurs++;
            console.error(`\n      ⚠️  Impossible de décompresser ${nomFichier}`);
        }
    }
    
    if (decompresses > 0) {
        console.log(`\r   ✅ ${decompresses} fichier(s) .txt.zip décompressé(s)`);
        if (erreurs > 0) {
            console.log(`   ⚠️  ${erreurs} fichier(s) en erreur\n`);
        } else {
            console.log('');
        }
    } else if (erreurs > 0) {
        console.log(`\n   ❌ Aucun fichier décompressé (${erreurs} erreur(s))\n`);
    }
    
    return decompresses;
}

function deplacerFichiersTXT(sourceDir) {
    function parcourirDossier(dir) {
        const fichiers = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                fichiers.push(...parcourirDossier(fullPath));
            } else if (entry.isFile() && entry.name.endsWith('.txt') && entry.name.startsWith('dfiano-dep')) {
                fichiers.push(fullPath);
            }
        }
        
        return fichiers;
    }
    
    // Debug : lister tous les fichiers dans le répertoire source
    if (!fs.existsSync(sourceDir)) {
        console.log(`   ⚠️  Répertoire source non trouvé: ${sourceDir}\n`);
        return 0;
    }
    
    const fichiersTXT = parcourirDossier(sourceDir);
    
    // Debug : lister quelques fichiers trouvés
    if (fichiersTXT.length === 0) {
        console.log(`   ⚠️  Aucun fichier .txt trouvé dans ${sourceDir}`);
        // Lister les fichiers présents pour debug (fonction récursive)
        try {
            function listerFichiersRecursif(dir, baseDir = '') {
                const fichiers = [];
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    const relPath = path.join(baseDir, entry.name);
                    if (entry.isDirectory()) {
                        fichiers.push(...listerFichiersRecursif(fullPath, relPath));
                    } else if (entry.isFile()) {
                        fichiers.push(relPath);
                    }
                }
                return fichiers;
            }
            const allFiles = listerFichiersRecursif(sourceDir);
            const txtFiles = allFiles.filter(f => f.endsWith('.txt') && !f.endsWith('.txt.zip'));
            const zipFiles = allFiles.filter(f => f.endsWith('.txt.zip'));
            if (txtFiles.length > 0) {
                console.log(`   📄 Fichiers .txt trouvés (non dfiano-dep): ${txtFiles.slice(0, 5).join(', ')}${txtFiles.length > 5 ? '...' : ''}`);
            }
            if (zipFiles.length > 0) {
                console.log(`   📦 Fichiers .txt.zip trouvés: ${zipFiles.slice(0, 5).join(', ')}${zipFiles.length > 5 ? '...' : ''}`);
            }
            if (txtFiles.length === 0 && zipFiles.length === 0) {
                console.log(`   📂 Contenu du répertoire: ${fs.readdirSync(sourceDir).slice(0, 10).join(', ')}${fs.readdirSync(sourceDir).length > 10 ? '...' : ''}`);
            }
        } catch (err) {
            console.log(`   ⚠️  Erreur lecture répertoire: ${err.message}`);
        }
        console.log('');
        return 0;
    }
    
    console.log(`   📄 ${fichiersTXT.length} fichier(s) .txt trouvé(s)`);
    if (fichiersTXT.length > 0) {
        console.log(`   📋 Exemple: ${path.basename(fichiersTXT[0])}`);
    }
    
    // S'assurer que le répertoire de destination existe
    if (!fs.existsSync(DFI_DIR)) {
        fs.mkdirSync(DFI_DIR, { recursive: true });
        console.log(`   📁 Répertoire créé: ${DFI_DIR}`);
    }
    
    let deplaces = 0;
    for (const fichier of fichiersTXT) {
        const nomFichier = path.basename(fichier);
        const destPath = path.join(DFI_DIR, nomFichier);
        
        try {
            if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
            }
            
            fs.copyFileSync(fichier, destPath);
            deplaces++;
            
            if (deplaces % 10 === 0) {
                process.stdout.write(`\r   📦 ${deplaces}/${fichiersTXT.length} fichiers déplacés...`);
            }
        } catch (err) {
            console.error(`\n   ❌ Erreur copie ${nomFichier}: ${err.message}`);
        }
    }
    
    console.log(`\r   ✅ ${deplaces} fichier(s) déplacé(s) vers ${DFI_DIR}\n`);
    
    return deplaces;
}

// Charger les données DFI dans la base de données (via base temporaire pour performance)
async function chargerDFIDansBase() {
    console.log('\n📋 Chargement des données DFI dans la base...\n');
    console.log('─────────────────────────────────────────────────────────\n');
    
    const fichiersDFI = fs.existsSync(DFI_DIR) 
        ? fs.readdirSync(DFI_DIR).filter(f => f.startsWith('dfiano-dep') && f.endsWith('.txt'))
        : [];
    
    if (fichiersDFI.length === 0) {
        console.log('⚠️  Aucun fichier DFI trouvé. Le chargement DFI sera ignoré.\n');
        return;
    }
    
    console.log(`📂 ${fichiersDFI.length} fichier(s) DFI trouvé(s)\n`);
    
    // Vérifier si la table existe déjà et est remplie dans la base principale
    let dbMain;
    try {
        dbMain = new Database(DB_PA);
        const existing = dbMain.prepare(`
            SELECT COUNT(*) as count 
            FROM sqlite_master 
            WHERE type='table' AND name='dfi_lotissements'
        `).get();
        
        if (existing.count > 0) {
            const rows = dbMain.prepare('SELECT COUNT(*) as count FROM dfi_lotissements').get();
            if (rows.count > 0) {
                console.log(`✅ Table DFI déjà remplie avec ${rows.count} enregistrements\n`);
                dbMain.close();
                return;
            }
        }
        dbMain.close();
    } catch (err) {
        console.error(`❌ Erreur vérification base principale: ${err.message}\n`);
        return;
    }
    
    // Créer une base temporaire pour le chargement (plus rapide)
    const DB_TEMP_DIR = path.join(__dirname, '..', 'database');
    const DB_TEMP = path.join(DB_TEMP_DIR, 'dfi_temp.db');
    
    // Créer le répertoire s'il n'existe pas
    if (!fs.existsSync(DB_TEMP_DIR)) {
        fs.mkdirSync(DB_TEMP_DIR, { recursive: true });
        console.log(`📁 Répertoire créé : ${DB_TEMP_DIR}\n`);
    }
    
    console.log('📋 Création base temporaire DFI (optimisée pour insertion)...\n');
    
    // Supprimer l'ancienne base temp si elle existe
    if (fs.existsSync(DB_TEMP)) {
        fs.unlinkSync(DB_TEMP);
    }
    
    let dbTemp;
    try {
        dbTemp = new Database(DB_TEMP);
        // Optimisations maximales pour insertion rapide
        dbTemp.pragma('journal_mode = OFF'); // Pas de journal pendant insertion
        dbTemp.pragma('synchronous = OFF'); // Pas de synchronisation (plus rapide)
        dbTemp.pragma('cache_size = -128000'); // 128MB cache
        dbTemp.pragma('temp_store = MEMORY'); // Tables temporaires en mémoire
        dbTemp.pragma('mmap_size = 268435456'); // 256MB mmap
    } catch (err) {
        console.error(`❌ Erreur création base temporaire: ${err.message}\n`);
        return;
    }
    
    // Créer la table SANS index (on les créera après insertion)
    console.log('📋 Création table temporaire (sans index pour performance)...\n');
    
    dbTemp.exec(`
        CREATE TABLE dfi_lotissements_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_dfi TEXT NOT NULL,
            code_departement TEXT,
            code_commune TEXT,
            prefixe_section TEXT,
            nature_dfi TEXT,
            nature_libelle TEXT,
            date_validation TEXT,
            num_lot_analyse TEXT,
            parcelles_meres TEXT,
            parcelles_filles TEXT,
            nb_parcelles_meres INTEGER DEFAULT 0,
            nb_parcelles_filles INTEGER DEFAULT 0
        )
    `);
    
    console.log('✅ Table temporaire créée (sans index)\n');
    
    // Préparer la requête d'insertion dans la base temporaire
    const insertStmt = dbTemp.prepare(`
        INSERT INTO dfi_lotissements_temp (
            id_dfi, code_departement, code_commune, prefixe_section,
            nature_dfi, nature_libelle, date_validation, num_lot_analyse,
            parcelles_meres, parcelles_filles, nb_parcelles_meres, nb_parcelles_filles
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Batch insert optimisé (par lots de 10000 - plus gros car pas d'index)
    const insertMany = dbTemp.transaction((dfiList) => {
        for (const dfi of dfiList) {
            insertStmt.run(
                dfi.idDFI,
                dfi.dept,
                dfi.comm,
                dfi.prefixeSection,
                dfi.nature,
                dfi.natureLibelle,
                dfi.date,
                dfi.numLot,
                dfi.parcellesMeres.join(';'),
                dfi.parcellesFilles.join(';'),
                dfi.parcellesMeres.length,
                dfi.parcellesFilles.length
            );
        }
    });
    
    // Dictionnaire des natures DFI
    const natureLibelle = {
        '1': 'arpentage',
        '2': 'croquis conservation',
        '4': 'remaniement',
        '5': 'arpentage numérique',
        '6': 'lotissement numérique',
        '7': 'lotissement',
        '8': 'rénovation'
    };
    
    // Fonction pour charger un fichier DFI avec barre de progression
    function chargerFichierDFI(fichierPath, fileName, fileIndex, totalFiles) {
        return new Promise((resolve, reject) => {
            const dfiData = new Map();
            let ligneCount = 0;
            let totalLignes = 0;
            
            // Estimer le nombre total de lignes (approximatif)
            try {
                const stats = fs.statSync(fichierPath);
                // Estimation : ~100 octets par ligne en moyenne
                totalLignes = Math.floor(stats.size / 100);
            } catch (err) {
                totalLignes = 0;
            }
            
            const stream = fs.createReadStream(fichierPath, { encoding: 'utf8' })
                .pipe(csv({ 
                    separator: ';',
                    skipEmptyLines: true,
                    skipLinesWithError: true,
                    headers: false
                }));
            
            stream.on('data', (row) => {
                ligneCount++;
                
                try {
                    const valeurs = Object.values(row).filter(v => v && String(v).trim());
                    
                    if (valeurs.length < 10) return;
                    
                    const dept = valeurs[0]?.trim();
                    const comm = valeurs[1]?.trim();
                    const prefixeSection = valeurs[2]?.trim();
                    const idDFI = valeurs[3]?.trim();
                    const natureDFI = valeurs[4]?.trim();
                    const dateValidation = valeurs[5]?.trim();
                    const numLot = valeurs[8]?.trim();
                    const typeLigne = valeurs[9]?.trim();
                    
                    const parcelles = valeurs.slice(10)
                        .filter(p => p && String(p).trim())
                        .map(p => {
                            const parcelle = String(p).trim();
                            const match = parcelle.match(/^([A-Z]{1,2})(\d+)$/i);
                            if (match) {
                                const [, section, numero] = match;
                                const numeroClean = String(parseInt(numero, 10));
                                return section.toUpperCase() + numeroClean;
                            }
                            return parcelle.toUpperCase();
                        })
                        .filter(p => p && p.length >= 3);
                    
                    if (!idDFI || !typeLigne) return;
                    
                    if (!['1', '2', '5', '6', '7'].includes(natureDFI)) return;
                    
                    const key = `${idDFI}-${dept}-${comm}`;
                    if (!dfiData.has(key)) {
                        dfiData.set(key, {
                            idDFI: idDFI,
                            dept: dept,
                            comm: comm,
                            prefixeSection: prefixeSection,
                            nature: natureDFI,
                            natureLibelle: natureLibelle[natureDFI] || 'inconnu',
                            date: dateValidation,
                            numLot: numLot,
                            parcellesMeres: [],
                            parcellesFilles: []
                        });
                    }
                    
                    const dfi = dfiData.get(key);
                    
                    if (typeLigne === '1') {
                        dfi.parcellesMeres.push(...parcelles);
                    } else if (typeLigne === '2') {
                        dfi.parcellesFilles.push(...parcelles);
                    }
                    
                } catch (err) {
                    // Ignorer les erreurs de parsing
                }
                
                // Afficher la barre de progression toutes les 10000 lignes
                if (ligneCount % 10000 === 0) {
                    const barreLength = 20;
                    let filled = 0;
                    let empty = barreLength;
                    let pourcentage = 0;
                    
                    if (totalLignes > 0) {
                        pourcentage = Math.min(100, Math.round((ligneCount / totalLignes) * 100));
                        filled = Math.max(0, Math.min(barreLength, Math.round((ligneCount / totalLignes) * barreLength)));
                        empty = Math.max(0, barreLength - filled);
                    }
                    
                    const barre = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
                    process.stdout.write(`\r      [${barre}] ${pourcentage}% - ${ligneCount.toLocaleString()} lignes, ${dfiData.size} DFI`);
                }
            });
            
            stream.on('end', () => {
                // Afficher la barre complète
                const barre = '█'.repeat(20);
                process.stdout.write(`\r      [${barre}] 100% - ${ligneCount.toLocaleString()} lignes analysées\n`);
                
                const dfiList = Array.from(dfiData.values());
                const dfiValides = dfiList.filter(dfi => 
                    dfi.parcellesMeres.length > 0 && dfi.parcellesFilles.length > 0
                );
                
                try {
                    process.stdout.write(`      💾 Insertion de ${dfiValides.length} DFI valides...`);
                    insertMany(dfiValides);
                    process.stdout.write(` ✅\n`);
                    resolve(dfiValides.length);
                } catch (err) {
                    process.stdout.write(` ❌\n`);
                    reject(err);
                }
            });
            
            stream.on('error', reject);
        });
    }
    
    // Fonction pour afficher une barre de progression
    function afficherBarreProgression(current, total, prefix = '') {
        const barreLength = 30;
        let filled = 0;
        let empty = barreLength;
        let pourcentage = 0;
        
        if (total > 0 && current >= 0) {
            pourcentage = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
            filled = Math.max(0, Math.min(barreLength, Math.round((current / total) * barreLength)));
            empty = Math.max(0, barreLength - filled);
        }
        
        const barre = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
        process.stdout.write(`\r${prefix}[${barre}] ${pourcentage}% (${current}/${total})`);
    }
    
    // Charger tous les fichiers DFI séquentiellement (optimisé)
    let totalDFI = 0;
    const startTime = Date.now();
    
    console.log('\n📊 Progression du chargement DFI :\n');
    
    for (let i = 0; i < fichiersDFI.length; i++) {
        const fichier = fichiersDFI[i];
        const fichierPath = path.join(DFI_DIR, fichier);
        const fileStartTime = Date.now();
        
        // Afficher la barre de progression globale
        afficherBarreProgression(i, fichiersDFI.length, '   ');
        console.log(`\n   📄 ${i + 1}/${fichiersDFI.length} : ${fichier}...`);
        
        try {
            const count = await chargerFichierDFI(fichierPath, fichier, i, fichiersDFI.length);
            totalDFI += count;
            const fileDuration = ((Date.now() - fileStartTime) / 1000).toFixed(1);
            console.log(`      ⏱️  Temps: ${fileDuration}s`);
        } catch (err) {
            console.error(`\n      ❌ Erreur: ${err.message}`);
        }
    }
    
    // Afficher la barre de progression finale (100%)
    afficherBarreProgression(fichiersDFI.length, fichiersDFI.length, '   ');
    console.log('\n');
    
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`⏱️  Temps total de chargement DFI : ${totalDuration}s`);
    console.log(`📊 Total : ${totalDFI} DFI chargés dans la base temporaire\n`);
    
    // Fermer la base temporaire
    dbTemp.close();
    
    // Copier les données de la base temporaire vers la base principale
    console.log('📋 Copie des données vers la base principale...\n');
    const copyStartTime = Date.now();
    
    try {
        // Rouvrir les deux bases
        dbTemp = new Database(DB_TEMP);
        dbMain = new Database(DB_PA);
        
        // Activer WAL sur la base principale
        dbMain.pragma('journal_mode = WAL');
        dbMain.pragma('synchronous = NORMAL');
        
        // Créer la table dans la base principale avec index
        console.log('   📋 Création table principale avec index...');
        dbMain.exec(`
            DROP TABLE IF EXISTS dfi_lotissements;
            
            CREATE TABLE dfi_lotissements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                id_dfi TEXT NOT NULL,
                code_departement TEXT,
                code_commune TEXT,
                prefixe_section TEXT,
                nature_dfi TEXT,
                nature_libelle TEXT,
                date_validation TEXT,
                num_lot_analyse TEXT,
                parcelles_meres TEXT,
                parcelles_filles TEXT,
                nb_parcelles_meres INTEGER DEFAULT 0,
                nb_parcelles_filles INTEGER DEFAULT 0,
                UNIQUE(id_dfi, code_departement, code_commune)
            )
        `);
        
        // Copier les données (sans index d'abord pour rapidité)
        console.log('   💾 Copie des données...');
        const tempPath = DB_TEMP.replace(/\\/g, '/');
        dbMain.exec(`ATTACH DATABASE '${tempPath}' AS temp_db`);
        
        const copyStmt = dbMain.prepare(`
            INSERT OR REPLACE INTO dfi_lotissements 
            SELECT * FROM temp_db.dfi_lotissements_temp
        `);
        
        const copyTransaction = dbMain.transaction(() => {
            copyStmt.run();
        });
        
        copyTransaction();
        
        // Détacher la base temporaire
        dbMain.exec('DETACH DATABASE temp_db');
        
        // Créer les index APRÈS insertion (beaucoup plus rapide)
        console.log('   📊 Création des index...');
        dbMain.exec(`
            CREATE INDEX idx_dfi_parcelles_meres ON dfi_lotissements(parcelles_meres);
            CREATE INDEX idx_dfi_parcelles_filles ON dfi_lotissements(parcelles_filles);
            CREATE INDEX idx_dfi_nature ON dfi_lotissements(nature_dfi);
            CREATE INDEX idx_dfi_commune ON dfi_lotissements(code_departement, code_commune);
        `);
        
        const copyDuration = ((Date.now() - copyStartTime) / 1000).toFixed(1);
        console.log(`   ✅ Copie terminée en ${copyDuration}s\n`);
        
        // Statistiques
        const stats = dbMain.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(nb_parcelles_meres) as total_meres,
                SUM(nb_parcelles_filles) as total_filles
            FROM dfi_lotissements
        `).get();
        
        console.log('📊 Statistiques DFI:\n');
        console.log(`   Total DFI lotissements: ${stats.total || 0}`);
        console.log(`   Total parcelles mères: ${stats.total_meres || 0}`);
        console.log(`   Total parcelles filles: ${stats.total_filles || 0}\n`);
        
        // Supprimer la base temporaire
        dbTemp.close();
        dbMain.close();
        if (fs.existsSync(DB_TEMP)) {
            fs.unlinkSync(DB_TEMP);
        }
        
        console.log('✅ Chargement DFI terminé !\n');
    } catch (err) {
        console.error(`❌ Erreur lors de la copie: ${err.message}\n`);
        if (dbTemp) dbTemp.close();
        if (dbMain) dbMain.close();
        // Garder la base temp en cas d'erreur pour debug
    }
}

// ÉTAPE 0 : Télécharger toutes les données (PA, PC, DVF, DFI)
async function telechargerToutesDonnees() {
    console.log('═'.repeat(60));
    console.log('📥 ÉTAPE 0 : Vérification et téléchargement de toutes les données (PA, PC, DVF, DFI)...\n');
    
    try {
        await telechargerPAPC();
        await telechargerDVF();
        // Normaliser tous les fichiers DVF au format uniforme
        await normaliserTousLesDVF();
        await telechargerDFI();
        // Charger les DFI dans la base de données
        await chargerDFIDansBase();
        
        console.log('═══════════════════════════════════════════════════════════\n');
        console.log('✅ TOUS LES TÉLÉCHARGEMENTS ET NORMALISATIONS TERMINÉS !\n');
    } catch (err) {
        throw new Error(`Erreur lors du téléchargement: ${err.message}`);
    }
}

telechargerToutesDonnees()
    .then(() => {
    console.log('═'.repeat(60));
    console.log('📊 ÉTAPE 1/3 : Création base avec PA...\n');
    
    if (!fs.existsSync(SCRIPT_PA)) {
        console.error('❌ Erreur : create-terrains-batir-V3.js non trouvé !');
        process.exit(1);
    }
    
    const processPA = spawn('node', ['--max-old-space-size=4096', SCRIPT_PA], {
        stdio: 'inherit',
        cwd: __dirname
    });
    
    processPA.on('error', (err) => {
        console.error('❌ Erreur lors du lancement du script PA:', err);
        process.exit(1);
    });
    
    processPA.on('close', (codePA) => {
        if (codePA !== 0) {
            console.error(`❌ Erreur lors de l'exécution du script PA (code ${codePA})`);
            process.exit(codePA);
        }
        
        console.log('\n✅ Base PA créée avec succès !\n');
        console.log('═'.repeat(60));
        console.log('📊 ÉTAPE 2/3 : Création base avec PC sans PA...\n');
        
        // ÉTAPE 2 : Exécuter le script PC
        if (!fs.existsSync(SCRIPT_PC)) {
            console.error('❌ Erreur : create-terrains-pc-sans-pa-V2.js non trouvé !');
            process.exit(1);
        }
        
        const processPC = spawn('node', ['--max-old-space-size=4096', SCRIPT_PC], {
            stdio: 'inherit',
            cwd: __dirname
        });
        
        processPC.on('close', (codePC) => {
            if (codePC !== 0) {
                console.error(`❌ Erreur lors de l'exécution du script PC (code ${codePC})`);
                process.exit(codePC);
            }
            
            console.log('\n✅ Base PC créée avec succès !\n');
            console.log('═'.repeat(60));
            console.log('📊 ÉTAPE 3/3 : Fusion des bases...\n');
            
            // ÉTAPE 3 : Fusionner les deux bases
            fusionnerBases();
        });
        
        processPC.on('error', (err) => {
            console.error('❌ Erreur lors du lancement du script PC:', err);
            process.exit(1);
        });
    });
})
.catch(err => {
    console.error('❌ Erreur lors du téléchargement des données:', err);
    process.exit(1);
});

function fusionnerBases() {
    // Vérifier que les deux bases existent
    if (!fs.existsSync(DB_PA)) {
        console.error('❌ Erreur : terrains_batir.db non trouvé !');
        process.exit(1);
    }
    
    if (!fs.existsSync(DB_PC)) {
        console.error('❌ Erreur : terrains_pc_sans_pa.db non trouvé !');
        process.exit(1);
    }
    
    // Supprimer l'ancienne base unifiée si elle existe
    if (fs.existsSync(DB_UNIFIE)) {
        fs.unlinkSync(DB_UNIFIE);
        console.log('   🗑️  Ancienne base unifiée supprimée\n');
    }
    
    // Créer la nouvelle base unifiée
    const dbUnifie = new Database(DB_UNIFIE);
    dbUnifie.pragma('journal_mode = WAL');
    
    console.log('   📊 Création de la structure...');
    
    // Créer la table avec la structure simplifiée
    dbUnifie.exec(`
        CREATE TABLE terrains_batir (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            valeur_fonciere REAL,
            surface_totale REAL,
            surface_reelle_bati REAL,
            prix_m2 REAL,
            date_mutation TEXT,
            latitude REAL,
            longitude REAL,
            nom_commune TEXT,
            type_terrain TEXT
        );
        
        CREATE INDEX idx_coords ON terrains_batir(latitude, longitude);
        CREATE INDEX idx_date ON terrains_batir(date_mutation);
        CREATE INDEX idx_type_terrain ON terrains_batir(type_terrain);
        CREATE INDEX idx_commune ON terrains_batir(nom_commune);
    `);
    
    console.log('   ✅ Structure créée\n');
    
    // Attacher la base PA et copier les données
    console.log('   📥 Import des données PA...');
    // Convertir le chemin Windows pour SQLite (backslashes vers forward slashes)
    const dbPaPath = DB_PA.replace(/\\/g, '/');
    dbUnifie.exec(`ATTACH DATABASE '${dbPaPath}' AS db_pa`);
    
    // Lister toutes les tables disponibles pour debug
    const allTables = dbUnifie.prepare(`
        SELECT name FROM db_pa.sqlite_master 
        WHERE type='table'
        ORDER BY name
    `).all();
    console.log(`   🔍 Tables disponibles dans la base PA : ${allTables.map(t => t.name).join(', ')}`);
    
    // Vérifier que la table existe
    const tableExists = dbUnifie.prepare(`
        SELECT name FROM db_pa.sqlite_master 
        WHERE type='table' AND name='terrains_batir'
    `).get();
    
    // Si la table finale n'existe pas, vérifier si terrains_batir_temp existe
    if (!tableExists) {
        const tempTableExists = dbUnifie.prepare(`
            SELECT name FROM db_pa.sqlite_master 
            WHERE type='table' AND name='terrains_batir_temp'
        `).get();
        
        if (tempTableExists) {
            console.log('   ⚠️  Table terrains_batir non trouvée, mais terrains_batir_temp existe.');
            console.log('   🔧 Création de la table finale depuis terrains_batir_temp...');
            
            // Créer la table finale dans la base PA depuis terrains_batir_temp
            dbUnifie.exec(`
                CREATE TABLE db_pa.terrains_batir (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    valeur_fonciere REAL,
                    surface_totale REAL,
                    surface_reelle_bati REAL,
                    prix_m2 REAL,
                    date_mutation TEXT,
                    latitude REAL,
                    longitude REAL,
                    nom_commune TEXT,
                    type_terrain TEXT,
                    id_pa TEXT
                );
            `);
            
            // Copier les données depuis terrains_batir_temp vers terrains_batir
            dbUnifie.exec(`
                INSERT INTO db_pa.terrains_batir (
                    valeur_fonciere, surface_totale, surface_reelle_bati, prix_m2,
                    date_mutation, latitude, longitude, nom_commune, type_terrain, id_pa
                )
                SELECT 
                    MAX(valeur_fonciere) as valeur_fonciere,
                    SUM(surface_totale) as surface_totale,
                    SUM(surface_reelle_bati) as surface_reelle_bati,
                    MAX(valeur_fonciere) / SUM(surface_totale) as prix_m2,
                    MIN(date_mutation) as date_mutation,
                    AVG(latitude) as latitude,
                    AVG(longitude) as longitude,
                    MAX(nom_commune) as nom_commune,
                    CASE 
                        WHEN est_terrain_viabilise = 0 THEN 'NON_VIABILISE'
                        WHEN est_terrain_viabilise = 1 THEN 'VIABILISE'
                        ELSE NULL
                    END as type_terrain,
                    id_pa
                FROM db_pa.terrains_batir_temp
                WHERE id_pa IS NOT NULL
                GROUP BY id_mutation, est_terrain_viabilise, id_pa;
            `);
            
            console.log('   ✅ Table terrains_batir créée depuis terrains_batir_temp');
        } else {
            console.error('   ❌ Erreur : Table terrains_batir non trouvée dans la base PA !');
            console.error('   ❌ Table terrains_batir_temp non trouvée non plus.');
            dbUnifie.exec('DETACH DATABASE db_pa');
            dbUnifie.close();
            process.exit(1);
        }
    }
    
    dbUnifie.exec(`
        INSERT INTO terrains_batir (
            valeur_fonciere, surface_totale, surface_reelle_bati, prix_m2,
            date_mutation, latitude, longitude, nom_commune, type_terrain
        )
        SELECT 
            valeur_fonciere, 
            surface_totale, 
            surface_reelle_bati, 
            prix_m2,
            date_mutation, 
            latitude, 
            longitude, 
            nom_commune,
            type_terrain
        FROM db_pa.terrains_batir;
    `);
    
    const statsPA = dbUnifie.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN type_terrain = 'NON_VIABILISE' THEN 1 ELSE 0 END) as non_viabilises,
            SUM(CASE WHEN type_terrain = 'VIABILISE' THEN 1 ELSE 0 END) as viabilises
        FROM terrains_batir
    `).get();
    
    dbUnifie.exec(`DETACH DATABASE db_pa`);
    
    console.log(`   ✅ ${statsPA.total} transactions PA importées`);
    console.log(`      - NON_VIABILISE : ${statsPA.non_viabilises}`);
    console.log(`      - VIABILISE : ${statsPA.viabilises}\n`);
    
    // Attacher la base PC et copier les données
    console.log('   📥 Import des données PC...');
    // Convertir le chemin Windows pour SQLite
    const dbPcPath = DB_PC.replace(/\\/g, '/');
    dbUnifie.exec(`ATTACH DATABASE '${dbPcPath}' AS db_pc`);
    
    dbUnifie.exec(`
        INSERT INTO terrains_batir (
            valeur_fonciere, surface_totale, surface_reelle_bati, prix_m2,
            date_mutation, latitude, longitude, nom_commune, type_terrain
        )
        SELECT 
            valeur_fonciere, 
            surface_totale, 
            surface_reelle_bati, 
            prix_m2,
            date_mutation, 
            latitude, 
            longitude, 
            nom_commune,
            type_terrain
        FROM db_pc.terrains_pc_sans_pa;
    `);
    
    const statsPC = dbUnifie.prepare(`
        SELECT 
            COUNT(*) as total_pc,
            SUM(CASE WHEN type_terrain = 'VIABILISE' THEN 1 ELSE 0 END) as viabilises_pc,
            SUM(CASE WHEN type_terrain = 'RENOVATION' THEN 1 ELSE 0 END) as renovations
        FROM terrains_batir
        WHERE id > ?
    `).get(statsPA.total);
    
    dbUnifie.exec(`DETACH DATABASE db_pc`);
    
    console.log(`   ✅ ${statsPC.total_pc} transactions PC importées`);
    console.log(`      - VIABILISE (construction) : ${statsPC.viabilises_pc}`);
    console.log(`      - RENOVATION : ${statsPC.renovations}\n`);
    
    // Statistiques finales
    const statsFinal = dbUnifie.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN type_terrain = 'NON_VIABILISE' THEN 1 ELSE 0 END) as non_viabilises,
            SUM(CASE WHEN type_terrain = 'VIABILISE' THEN 1 ELSE 0 END) as viabilises,
            SUM(CASE WHEN type_terrain = 'RENOVATION' THEN 1 ELSE 0 END) as renovations
        FROM terrains_batir
    `).get();
    
    console.log('═'.repeat(60));
    console.log('\n✅ FUSION TERMINÉE AVEC SUCCÈS !\n');
    console.log('📈 STATISTIQUES FINALES :');
    console.log(`   Total transactions : ${statsFinal.total}`);
    console.log(`   - NON_VIABILISE (achat lotisseur) : ${statsFinal.non_viabilises}`);
    console.log(`   - VIABILISE (lot vendu + construction) : ${statsFinal.viabilises}`);
    console.log(`   - RENOVATION : ${statsFinal.renovations}`);
    console.log('');
    console.log('📊 STRUCTURE SIMPLIFIÉE (10 colonnes) :');
    console.log('   id, valeur_fonciere, surface_totale, surface_reelle_bati, prix_m2,');
    console.log('   date_mutation, latitude, longitude, nom_commune, type_terrain');
    console.log('');
    console.log('═'.repeat(60));
    console.log(`\n✅ Base de données unifiée : ${DB_UNIFIE}\n`);
    
    dbUnifie.close();
}
