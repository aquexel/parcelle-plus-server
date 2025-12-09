#!/usr/bin/env node

/**
 * Script de diagnostic : Vérifier les PA de 2019 sur Dax
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const PA_FILE = path.join(__dirname, '..', 'Liste-des-permis-damenager.2025-10.csv');

console.log('🔍 DIAGNOSTIC PA 2019 - DAX\n');

if (!fs.existsSync(PA_FILE)) {
    console.error('❌ Fichier PA non trouvé:', PA_FILE);
    process.exit(1);
}

const fileSize = fs.statSync(PA_FILE).size;
console.log(`📄 Fichier PA: ${path.basename(PA_FILE)}`);
console.log(`📏 Taille: ${(fileSize / 1024 / 1024).toFixed(1)} MB\n`);

// Détecter le séparateur
function detecterSeparateur(filePath) {
    try {
        const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
        if (firstLine.includes(';')) return ';';
        if (firstLine.includes(',')) return ',';
        if (firstLine.includes('|')) return '|';
        return ',';
    } catch (err) {
        return ',';
    }
}

const separator = detecterSeparateur(PA_FILE);
console.log(`🔧 Séparateur détecté: "${separator}"\n`);

let countTotal = 0;
let countDax = 0;
let countDax2019 = 0;
const paDax2019 = [];

console.log('📊 Analyse du fichier PA...\n');

fs.createReadStream(PA_FILE)
    .pipe(csv({ separator, skipLinesWithError: true }))
    .on('data', (row) => {
        countTotal++;
        
        // Afficher les colonnes de la première ligne
        if (countTotal === 1) {
            const columns = Object.keys(row);
            console.log(`📋 Colonnes détectées (${columns.length}):`);
            console.log(`   ${columns.slice(0, 10).join(', ')}...\n`);
        }
        
        // Vérifier si c'est Dax (code commune commence par 40088)
        const comm = row.COMM || '';
        const nomCommune = (row.NOM_COMMUNE || '').toUpperCase();
        const dateAuth = row.DATE_REELLE_AUTORISATION || '';
        
        // Dax = commune 40088
        if (comm.startsWith('40088') || nomCommune.includes('DAX')) {
            countDax++;
            
            // Vérifier si c'est 2019
            if (dateAuth.includes('2019')) {
                countDax2019++;
                paDax2019.push({
                    num_pa: row.NUM_PA,
                    date_auth: dateAuth,
                    comm: comm,
                    nom_commune: nomCommune,
                    superficie: row.SUPERFICIE_TERRAIN || '0',
                    lieu_dit: row.ADR_LIEUDIT_TER || '',
                    voie: row.ADR_LIBVOIE_TER || ''
                });
            }
        }
        
        // Progression
        if (countTotal % 10000 === 0) {
            process.stdout.write(`\r   → ${countTotal.toLocaleString()} PA analysés...`);
        }
    })
    .on('end', () => {
        console.log(`\r   ✅ ${countTotal.toLocaleString()} PA analysés\n`);
        
        console.log('📊 RÉSULTATS:\n');
        console.log(`   • Total PA France: ${countTotal.toLocaleString()}`);
        console.log(`   • Total PA Dax: ${countDax.toLocaleString()}`);
        console.log(`   • Total PA Dax 2019: ${countDax2019.toLocaleString()}\n`);
        
        if (countDax2019 > 0) {
            console.log(`✅ ${countDax2019} PA trouvés sur Dax en 2019:\n`);
            paDax2019.forEach((pa, i) => {
                console.log(`   ${i + 1}. PA ${pa.num_pa}`);
                console.log(`      → Date: ${pa.date_auth}`);
                console.log(`      → Commune: ${pa.comm} (${pa.nom_commune})`);
                console.log(`      → Superficie: ${pa.superficie} m²`);
                console.log(`      → Lieu-dit: ${pa.lieu_dit || 'N/A'}`);
                console.log(`      → Voie: ${pa.voie || 'N/A'}`);
                console.log('');
            });
        } else {
            console.log('⚠️  Aucun PA trouvé sur Dax en 2019\n');
            console.log('💡 Vérifications suggérées:');
            console.log('   1. Le fichier PA contient-il des données de 2019?');
            console.log('   2. Le code commune 40088 est-il correct pour Dax?');
            console.log('   3. Y a-t-il des PA sur Dax pour d\'autres années?\n');
            
            // Chercher PA Dax autres années
            console.log('🔍 Recherche PA Dax sur autres années...\n');
            
            fs.createReadStream(PA_FILE)
                .pipe(csv({ separator, skipLinesWithError: true }))
                .on('data', (row) => {
                    const comm = row.COMM || '';
                    const nomCommune = (row.NOM_COMMUNE || '').toUpperCase();
                    const dateAuth = row.DATE_REELLE_AUTORISATION || '';
                    
                    if (comm.startsWith('40088') || nomCommune.includes('DAX')) {
                        const annee = dateAuth.substring(0, 4);
                        console.log(`   • PA ${row.NUM_PA} - ${dateAuth} (${annee}) - ${nomCommune}`);
                    }
                })
                .on('end', () => {
                    console.log('\n✅ Recherche terminée\n');
                });
        }
    })
    .on('error', (err) => {
        console.error('❌ Erreur:', err.message);
        process.exit(1);
    });

