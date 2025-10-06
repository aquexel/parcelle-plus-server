#!/usr/bin/env node

/**
 * Script pour corriger l'instanciation des services dans server.js
 * Corrige le bug où les classes ne sont pas instanciées avec 'new'
 */

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');

console.log('🔧 Correction de l\'instanciation des services dans server.js');
console.log('=============================================================');

// Lire le contenu actuel
let content = fs.readFileSync(serverPath, 'utf8');

// Pattern à rechercher
const oldPattern = `// Import des services
const userService = require('./services/UserService');
const polygonService = require('./services/PolygonService');
const messageService = require('./services/MessageService');`;

// Nouveau pattern avec instanciation correcte
const newPattern = `// Import des services
const UserService = require('./services/UserService');
const PolygonService = require('./services/PolygonService');
const MessageService = require('./services/MessageService');

// Instancier les services
const userService = new UserService();
const polygonService = new PolygonService();
const messageService = new MessageService();`;

// Vérifier si le pattern existe
if (content.includes(oldPattern)) {
    console.log('✅ Pattern trouvé, correction en cours...');
    content = content.replace(oldPattern, newPattern);
    
    // Écrire le fichier corrigé
    fs.writeFileSync(serverPath, content, 'utf8');
    console.log('✅ server.js corrigé avec succès !');
    console.log('');
    console.log('📋 Modifications :');
    console.log('   - UserService : maintenant instancié avec "new"');
    console.log('   - PolygonService : maintenant instancié avec "new"');
    console.log('   - MessageService : maintenant instancié avec "new"');
} else if (content.includes('const userService = new UserService()')) {
    console.log('✅ server.js est déjà corrigé, aucune modification nécessaire.');
} else {
    console.log('⚠️  Pattern non trouvé dans server.js');
    console.log('Le fichier pourrait avoir une structure différente.');
}

console.log('');
console.log('🚀 Pour appliquer les changements, redémarrez le serveur :');
console.log('   pm2 restart parcelle-plus');

