#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🛠️ Script de correction Base de Données ParcellePlus');
console.log('===================================================\n');

function fixDatabase() {
    console.log('1. Vérification et création du répertoire database...');
    
    const dbDir = path.join(__dirname, 'database');
    
    if (!fs.existsSync(dbDir)) {
        console.log('⚠️ Répertoire database manquant. Création...');
        try {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log('✅ Répertoire database créé:', dbDir);
        } catch (error) {
            console.log('❌ Erreur création répertoire:', error.message);
            return false;
        }
    } else {
        console.log('✅ Répertoire database existe déjà');
    }
    
    console.log('\n2. Vérification des permissions...');
    try {
        const testFile = path.join(dbDir, 'test-write.txt');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log('✅ Permissions d\'écriture OK');
    } catch (error) {
        console.log('❌ Erreur permissions:', error.message);
        return false;
    }
    
    console.log('\n3. Création du fichier .gitkeep...');
    try {
        const gitkeepFile = path.join(dbDir, '.gitkeep');
        if (!fs.existsSync(gitkeepFile)) {
            fs.writeFileSync(gitkeepFile, '# Fichier pour maintenir le répertoire database dans git\n');
            console.log('✅ Fichier .gitkeep créé');
        }
    } catch (error) {
        console.log('⚠️ Erreur création .gitkeep:', error.message);
    }
    
    console.log('\n4. Listing du répertoire database...');
    try {
        const files = fs.readdirSync(dbDir);
        console.log('📁 Contenu:', files.length > 0 ? files : 'Répertoire vide');
    } catch (error) {
        console.log('❌ Erreur lecture répertoire:', error.message);
    }
    
    console.log('\n✅ Correction terminée !');
    console.log('💡 Vous pouvez maintenant redémarrer le serveur: node server.js');
    
    return true;
}

if (fixDatabase()) {
    process.exit(0);
} else {
    process.exit(1);
} 