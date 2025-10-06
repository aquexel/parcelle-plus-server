#!/usr/bin/env node

/**
 * Script de création d'une base de données propre pour ParcellePlus
 * Crée toutes les tables nécessaires et ajoute des utilisateurs de test
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Configuration
const DB_DIR = path.join(__dirname, 'database');
const DB_PATH = path.join(DB_DIR, 'parcelle_business.db');

console.log('🗄️  Création d\'une base de données propre pour ParcellePlus');
console.log('=======================================================');

// Créer le répertoire database s'il n'existe pas
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    console.log('📁 Répertoire database créé');
}

// Supprimer l'ancienne base si elle existe
if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('🗑️  Ancienne base de données supprimée');
}

// Créer une nouvelle base de données
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Erreur lors de la création de la base:', err.message);
        process.exit(1);
    }
    console.log('✅ Nouvelle base de données créée');
});

// Fonction pour exécuter une requête SQL
function runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

// Création des tables
async function createTables() {
    try {
        console.log('📋 Création des tables...');

        // Table users
        await runQuery(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                firstName TEXT,
                lastName TEXT,
                phone TEXT,
                address TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Table users créée');

        // Table polygons (avec TOUTES les colonnes nécessaires)
        await runQuery(`
            CREATE TABLE IF NOT EXISTS polygons (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                coordinates TEXT NOT NULL,
                price REAL NOT NULL,
                surface REAL NOT NULL,
                commune TEXT NOT NULL,
                code_insee TEXT NOT NULL,
                status TEXT DEFAULT 'available',
                is_public INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        `);
        console.log('✅ Table polygons créée avec colonnes : title, description, is_public, created_at, updated_at');

        // Table rooms
        await runQuery(`
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                polygonId TEXT NOT NULL,
                buyerId TEXT NOT NULL,
                sellerId TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (polygonId) REFERENCES polygons (id),
                FOREIGN KEY (buyerId) REFERENCES users (id),
                FOREIGN KEY (sellerId) REFERENCES users (id)
            )
        `);
        console.log('✅ Table rooms créée');

        // Table messages
        await runQuery(`
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                roomId TEXT NOT NULL,
                senderId TEXT NOT NULL,
                content TEXT NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (roomId) REFERENCES rooms (id),
                FOREIGN KEY (senderId) REFERENCES users (id)
            )
        `);
        console.log('✅ Table messages créée');

    } catch (error) {
        console.error('❌ Erreur lors de la création des tables:', error.message);
        throw error;
    }
}

// Insertion des utilisateurs de test
async function insertTestUsers() {
    try {
        console.log('👥 Insertion des utilisateurs de test...');

        const testUsers = [
            {
                id: uuidv4(),
                username: 'testuser1',
                email: 'test1@parcelle-plus.com',
                password: 'testpass123',
                firstName: 'Jean',
                lastName: 'Dupont',
                phone: '0123456789',
                address: '123 Rue de la Paix, Paris'
            },
            {
                id: uuidv4(),
                username: 'testuser2',
                email: 'test2@parcelle-plus.com',
                password: 'testpass123',
                firstName: 'Marie',
                lastName: 'Martin',
                phone: '0987654321',
                address: '456 Avenue des Champs, Lyon'
            },
            {
                id: uuidv4(),
                username: 'testuser3',
                email: 'test3@parcelle-plus.com',
                password: 'testpass123',
                firstName: 'Pierre',
                lastName: 'Durand',
                phone: '0147258369',
                address: '789 Boulevard Saint-Germain, Marseille'
            },
            {
                id: uuidv4(),
                username: 'testuser4',
                email: 'test4@parcelle-plus.com',
                password: 'testpass123',
                firstName: 'Sophie',
                lastName: 'Leroy',
                phone: '0369258147',
                address: '321 Rue de Rivoli, Toulouse'
            }
        ];

        for (const user of testUsers) {
            await runQuery(`
                INSERT INTO users (id, username, email, password, firstName, lastName, phone, address)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [user.id, user.username, user.email, user.password, user.firstName, user.lastName, user.phone, user.address]);
            
            console.log(`✅ Utilisateur ${user.username} créé`);
        }

    } catch (error) {
        console.error('❌ Erreur lors de l\'insertion des utilisateurs:', error.message);
        throw error;
    }
}

// Insertion d'exemples de polygones
async function insertTestPolygons() {
    try {
        console.log('🏠 Insertion d\'exemples d\'annonces...');

        // Récupérer les IDs des utilisateurs de test
        const users = await new Promise((resolve, reject) => {
            db.all('SELECT id, username FROM users', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (users.length === 0) {
            console.log('⚠️  Aucun utilisateur trouvé, pas d\'annonces créées');
            return;
        }

        const now = new Date().toISOString();

        const testPolygons = [
            {
                id: uuidv4(),
                user_id: users[0].id,
                title: 'Terrain constructible Paris 1er',
                description: 'Magnifique terrain en plein cœur de Paris, proche de toutes commodités.',
                coordinates: JSON.stringify([
                    [48.8566, 2.3522], [48.8566, 2.3532], [48.8576, 2.3532], [48.8576, 2.3522]
                ]),
                price: 250000,
                surface: 100,
                commune: 'Paris 1er',
                code_insee: '75101',
                status: 'available',
                is_public: 1,
                created_at: now,
                updated_at: now
            },
            {
                id: uuidv4(),
                user_id: users[1].id,
                title: 'Parcelle Lyon 2e - Idéal investissement',
                description: 'Belle parcelle à Lyon, quartier recherché. Viabilisé et prêt à construire.',
                coordinates: JSON.stringify([
                    [45.7640, 4.8357], [45.7640, 4.8367], [45.7650, 4.8367], [45.7650, 4.8357]
                ]),
                price: 180000,
                surface: 80,
                commune: 'Lyon 2e',
                code_insee: '69382',
                status: 'available',
                is_public: 1,
                created_at: now,
                updated_at: now
            },
            {
                id: uuidv4(),
                user_id: users[0].id,
                title: 'Grand terrain Marseille',
                description: 'Terrain spacieux avec vue sur la mer. Opportunité rare !',
                coordinates: JSON.stringify([
                    [43.2965, 5.3698], [43.2965, 5.3708], [43.2975, 5.3708], [43.2975, 5.3698]
                ]),
                price: 320000,
                surface: 150,
                commune: 'Marseille',
                code_insee: '13055',
                status: 'available',
                is_public: 1,
                created_at: now,
                updated_at: now
            }
        ];

        for (const polygon of testPolygons) {
            await runQuery(`
                INSERT INTO polygons (
                    id, user_id, title, description, coordinates, price, surface, 
                    commune, code_insee, status, is_public, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                polygon.id, polygon.user_id, polygon.title, polygon.description, 
                polygon.coordinates, polygon.price, polygon.surface, polygon.commune, 
                polygon.code_insee, polygon.status, polygon.is_public, 
                polygon.created_at, polygon.updated_at
            ]);
            
            console.log(`✅ Annonce créée : "${polygon.title}" à ${polygon.commune}`);
        }

    } catch (error) {
        console.error('❌ Erreur lors de l\'insertion des polygones:', error.message);
        throw error;
    }
}

// Fonction principale
async function main() {
    try {
        await createTables();
        await insertTestUsers();
        await insertTestPolygons();

        console.log('\n🎉 Base de données créée avec succès !');
        console.log('📊 Résumé :');
        
        // Compter les enregistrements
        const userCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const polygonCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM polygons', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        console.log(`   - ${userCount} utilisateurs créés`);
        console.log(`   - ${polygonCount} annonces créées`);
        console.log(`   - Base de données : ${DB_PATH}`);
        
        console.log('\n🔑 Comptes de test :');
        console.log('   - testuser1 / testpass123');
        console.log('   - testuser2 / testpass123');
        console.log('   - testuser3 / testpass123');
        console.log('   - testuser4 / testpass123');

    } catch (error) {
        console.error('\n❌ Erreur lors de la création de la base:', error.message);
        process.exit(1);
    } finally {
        db.close((err) => {
            if (err) {
                console.error('❌ Erreur lors de la fermeture de la base:', err.message);
            } else {
                console.log('\n✅ Connexion à la base fermée');
            }
        });
    }
}

// Exécution du script
if (require.main === module) {
    main();
}

module.exports = { main };
