const http = require('http');
const WebSocket = require('ws');

const SERVER_URL = 'http://192.168.1.10:3000';
const WEBSOCKET_URL = 'ws://192.168.1.10:3000';

console.log('🧪 === TESTS SERVEUR PARCELLE PLUS ===');
console.log(`🔗 URL serveur: ${SERVER_URL}`);
console.log(`🔗 WebSocket: ${WEBSOCKET_URL}`);

// Test 1: Santé du serveur
async function testHealth() {
    return new Promise((resolve, reject) => {
        console.log('\n1️⃣ Test de santé du serveur...');
        
        const req = http.get(`${SERVER_URL}/api/health`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    console.log('✅ Serveur en fonctionnement');
                    console.log(`   Status: ${response.status}`);
                    console.log(`   Uptime: ${Math.round(response.uptime)}s`);
                    console.log(`   Connexions: ${response.connections}`);
                    resolve(true);
                } catch (error) {
                    console.log('❌ Erreur parsing réponse santé:', error.message);
                    reject(false);
                }
            });
        });
        
        req.on('error', (error) => {
            console.log('❌ Erreur connexion serveur:', error.message);
            reject(false);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ Timeout connexion serveur');
            req.destroy();
            reject(false);
        });
    });
}

// Test 2: API Polygones
async function testPolygonsAPI() {
    return new Promise((resolve, reject) => {
        console.log('\n2️⃣ Test API Polygones...');
        
        const req = http.get(`${SERVER_URL}/api/polygons`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const polygons = JSON.parse(data);
                    console.log('✅ API Polygones fonctionne');
                    console.log(`   Nombre de polygones: ${polygons.length}`);
                    resolve(true);
                } catch (error) {
                    console.log('❌ Erreur parsing polygones:', error.message);
                    reject(false);
                }
            });
        });
        
        req.on('error', (error) => {
            console.log('❌ Erreur API polygones:', error.message);
            reject(false);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ Timeout API polygones');
            req.destroy();
            reject(false);
        });
    });
}

// Test 3: API Messages
async function testMessagesAPI() {
    return new Promise((resolve, reject) => {
        console.log('\n3️⃣ Test API Messages...');
        
        const req = http.get(`${SERVER_URL}/api/messages`, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const messages = JSON.parse(data);
                    console.log('✅ API Messages fonctionne');
                    console.log(`   Nombre de messages: ${messages.length}`);
                    resolve(true);
                } catch (error) {
                    console.log('❌ Erreur parsing messages:', error.message);
                    reject(false);
                }
            });
        });
        
        req.on('error', (error) => {
            console.log('❌ Erreur API messages:', error.message);
            reject(false);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ Timeout API messages');
            req.destroy();
            reject(false);
        });
    });
}

// Test 4: WebSocket
async function testWebSocket() {
    return new Promise((resolve, reject) => {
        console.log('\n4️⃣ Test WebSocket...');
        
        const ws = new WebSocket(WEBSOCKET_URL);
        let connected = false;
        
        const timeout = setTimeout(() => {
            if (!connected) {
                console.log('❌ Timeout connexion WebSocket');
                ws.close();
                reject(false);
            }
        }, 5000);
        
        ws.on('open', () => {
            connected = true;
            clearTimeout(timeout);
            console.log('✅ WebSocket connecté');
            
            // Envoyer un ping
            ws.send(JSON.stringify({ type: 'ping' }));
        });
        
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                console.log(`   Message reçu: ${message.type}`);
                
                if (message.type === 'welcome') {
                    console.log(`   Client ID: ${message.clientId}`);
                } else if (message.type === 'pong') {
                    console.log('✅ Ping-pong fonctionne');
                    ws.close();
                    resolve(true);
                }
            } catch (error) {
                console.log('❌ Erreur parsing message WebSocket:', error.message);
            }
        });
        
        ws.on('error', (error) => {
            console.log('❌ Erreur WebSocket:', error.message);
            reject(false);
        });
        
        ws.on('close', () => {
            console.log('🔌 WebSocket fermé');
            if (connected) {
                resolve(true);
            }
        });
    });
}

// Test 5: Création d'un polygone
async function testCreatePolygon() {
    return new Promise((resolve, reject) => {
        console.log('\n5️⃣ Test création polygone...');
        
        const testPolygon = {
            userId: 'test-user',
            title: 'Terrain de test',
            description: 'Polygone créé par le script de test',
            coordinates: [
                { lat: 43.7102, lng: -1.0578 },
                { lat: 43.7103, lng: -1.0579 },
                { lat: 43.7104, lng: -1.0577 },
                { lat: 43.7102, lng: -1.0578 }
            ],
            surface: 1200,
            commune: 'Dax',
            codeInsee: '40088',
            price: 85000,
            status: 'available'
        };
        
        const postData = JSON.stringify(testPolygon);
        
        const options = {
            hostname: '192.168.1.10',
            port: 3000,
            path: '/api/polygons',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (res.statusCode === 201) {
                        console.log('✅ Polygone créé avec succès');
                        console.log(`   ID: ${response.id}`);
                        console.log(`   Surface: ${response.surface}m²`);
                        resolve(true);
                    } else {
                        console.log(`❌ Erreur création polygone: ${res.statusCode}`);
                        reject(false);
                    }
                } catch (error) {
                    console.log('❌ Erreur parsing réponse création:', error.message);
                    reject(false);
                }
            });
        });
        
        req.on('error', (error) => {
            console.log('❌ Erreur création polygone:', error.message);
            reject(false);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ Timeout création polygone');
            req.destroy();
            reject(false);
        });
        
        req.write(postData);
        req.end();
    });
}

// Exécuter tous les tests
async function runAllTests() {
    console.log('🚀 Démarrage des tests...\n');
    
    const tests = [
        { name: 'Santé du serveur', fn: testHealth },
        { name: 'API Polygones', fn: testPolygonsAPI },
        { name: 'API Messages', fn: testMessagesAPI },
        { name: 'WebSocket', fn: testWebSocket },
        { name: 'Création polygone', fn: testCreatePolygon }
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
        try {
            await test.fn();
            passed++;
        } catch (error) {
            failed++;
        }
    }
    
    console.log('\n🎯 === RÉSULTATS DES TESTS ===');
    console.log(`✅ Tests réussis: ${passed}`);
    console.log(`❌ Tests échoués: ${failed}`);
    console.log(`📊 Taux de réussite: ${Math.round((passed / tests.length) * 100)}%`);
    
    if (failed === 0) {
        console.log('\n🎉 Tous les tests sont passés ! Le serveur fonctionne parfaitement.');
    } else {
        console.log('\n⚠️  Certains tests ont échoué. Vérifiez les logs du serveur.');
    }
}

// Démarrer les tests
runAllTests().catch(console.error); 