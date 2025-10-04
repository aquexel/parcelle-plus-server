#!/usr/bin/env node

const UserService = require('./services/UserService');
const fs = require('fs');
const path = require('path');

console.log('🔍 Diagnostic UserService ParcellePlus');
console.log('=====================================\n');

async function runDiagnostic() {
    console.log('1. Vérification des dépendances...');
    
    try {
        const bcrypt = require('bcrypt');
        console.log('✅ bcrypt disponible');
    } catch (error) {
        console.log('❌ bcrypt manquant:', error.message);
        return;
    }
    
    try {
        const sqlite3 = require('sqlite3');
        console.log('✅ sqlite3 disponible');
    } catch (error) {
        console.log('❌ sqlite3 manquant:', error.message);
        return;
    }
    
    console.log('\n2. Vérification répertoire database...');
    const dbDir = path.join(__dirname, 'database');
    
    if (!fs.existsSync(dbDir)) {
        console.log('⚠️ Répertoire database manquant. Création...');
        try {
            fs.mkdirSync(dbDir, { recursive: true });
            console.log('✅ Répertoire database créé');
        } catch (error) {
            console.log('❌ Erreur création répertoire:', error.message);
            return;
        }
    } else {
        console.log('✅ Répertoire database existe');
    }
    
    console.log('\n3. Test UserService...');
    let userService;
    
    try {
        userService = new UserService();
        console.log('✅ UserService initialisé');
        
        // Attendre l'initialisation de la DB
        await new Promise(resolve => setTimeout(resolve, 2000));
        
    } catch (error) {
        console.log('❌ Erreur initialisation UserService:', error.message);
        console.log('Stack:', error.stack);
        return;
    }
    
    console.log('\n4. Test inscription utilisateur...');
    
    const testUser = {
        username: 'test_diagnostic',
        email: 'test@diagnostic.com',
        password: 'test123456',
        fullName: 'Test Diagnostic',
        userType: 'buyer'
    };
    
    try {
        const newUser = await userService.registerUser(testUser);
        console.log('✅ Inscription réussie:', newUser);
        
        console.log('\n5. Test connexion utilisateur...');
        const loginResult = await userService.loginUser(testUser.username, testUser.password);
        console.log('✅ Connexion réussie:', {
            username: loginResult.username,
            userType: loginResult.userType,
            hasToken: !!loginResult.token
        });
        
    } catch (error) {
        console.log('❌ Erreur test utilisateur:', error.message);
        console.log('Stack:', error.stack);
    }
    
    console.log('\n6. Nettoyage...');
    try {
        await userService.close();
        console.log('✅ Base de données fermée');
    } catch (error) {
        console.log('⚠️ Erreur fermeture DB:', error.message);
    }
    
    console.log('\n✅ Diagnostic terminé');
}

runDiagnostic().catch(error => {
    console.error('❌ Erreur diagnostic:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
}); 