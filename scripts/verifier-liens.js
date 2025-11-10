const https = require('https');
const http = require('http');

// Toutes les URLs à vérifier
const URLs = {
    'PA': 'https://www.data.gouv.fr/api/1/datasets/r/9db13a09-72a9-4871-b430-13872b4890b3',
    'PC': 'https://www.data.gouv.fr/api/1/datasets/r/65a9e264-7a20-46a9-9d98-66becb817bc3',
    'DVF 2025': 'https://www.data.gouv.fr/api/1/datasets/r/4d741143-8331-4b59-95c2-3b24a7bdbe3c',
    'DVF 2024': 'https://files.data.gouv.fr/geo-dvf/latest/csv/2024/full.csv.gz',
    'DVF 2023': 'https://files.data.gouv.fr/geo-dvf/latest/csv/2023/full.csv.gz',
    'DVF 2020': 'https://files.data.gouv.fr/geo-dvf/latest/csv/2020/full.csv.gz',
    'DFI ZIP': 'https://data.economie.gouv.fr/api/datasets/1.0/documents-de-filiation-informatises-dfi-des-parcelles/attachments/documents_de_filiation_informatises_situation_juillet_2025_dept_2a0a_dept_580_zip/',
    'DFI 7Z': 'https://data.economie.gouv.fr/api/datasets/1.0/documents-de-filiation-informatises-dfi-des-parcelles/attachments/documents_de_filiation_informatises_situation_juillet_2025_dept_590_a_dept_976_7z/'
};

// URLs alternatives à tester
const URLs_ALT = {
    'PA alt': 'https://www.data.gouv.fr/api/1/datasets/9db13a09-72a9-4871-b430-13872b4890b3/',
    'PC alt': 'https://www.data.gouv.fr/api/1/datasets/65a9e264-7a20-46a9-9d98-66becb817bc3/',
    'DVF 2025 alt': 'https://www.data.gouv.fr/api/1/datasets/4d741143-8331-4b59-95c2-3b24a7bdbe3c/'
};

function testUrl(name, url) {
    return new Promise((resolve) => {
        const protocol = url.startsWith('https') ? https : http;
        const timeout = 10000; // 10 secondes
        
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🔍 Test: ${name}`);
        console.log(`📍 URL: ${url}`);
        console.log(`${'='.repeat(70)}`);
        
        const req = protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ParcellePlus/1.0)',
                'Accept': 'application/json'
            },
            timeout: timeout
        }, (response) => {
            let data = '';
            let redirectCount = 0;
            
            const followRedirect = (currentUrl, depth = 0) => {
                if (depth > 5) {
                    console.log(`   ⚠️  Trop de redirections (${depth})`);
                    resolve({ name, url, status: 'ERROR', error: 'Trop de redirections' });
                    return;
                }
                
                const req2 = protocol.get(currentUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; ParcellePlus/1.0)',
                        'Accept': 'application/json'
                    },
                    timeout: timeout
                }, (response2) => {
                    if (response2.statusCode === 301 || response2.statusCode === 302 || 
                        response2.statusCode === 307 || response2.statusCode === 308) {
                        console.log(`   ↪️  Redirection ${depth + 1}: ${response2.headers.location}`);
                        followRedirect(response2.headers.location, depth + 1);
                        return;
                    }
                    
                    processResponse(response2, currentUrl);
                });
                
                req2.on('error', (err) => {
                    console.log(`   ❌ Erreur réseau: ${err.message}`);
                    resolve({ name, url, status: 'ERROR', error: err.message });
                });
                
                req2.on('timeout', () => {
                    console.log(`   ⏱️  Timeout`);
                    req2.destroy();
                    resolve({ name, url, status: 'TIMEOUT' });
                });
            };
            
            const processResponse = (res, finalUrl) => {
                console.log(`   ✅ Status: ${res.statusCode} ${res.statusMessage}`);
                console.log(`   📋 Content-Type: ${res.headers['content-type'] || 'non spécifié'}`);
                console.log(`   📏 Content-Length: ${res.headers['content-length'] || 'non spécifié'}`);
                
                if (res.statusCode !== 200) {
                    resolve({ name, url, status: 'ERROR', error: `HTTP ${res.statusCode}` });
                    return;
                }
                
                res.on('data', (chunk) => {
                    data += chunk.toString();
                });
                
                res.on('end', () => {
                    console.log(`   📦 Taille réponse: ${data.length} caractères`);
                    
                    // Essayer de parser en JSON si c'est une API
                    if (finalUrl.includes('/api/')) {
                        try {
                            const json = JSON.parse(data);
                            console.log(`   ✅ JSON valide`);
                            console.log(`   🔑 Clés principales: ${Object.keys(json).join(', ')}`);
                            
                            if (json.resources && json.resources.length > 0) {
                                console.log(`   📦 ${json.resources.length} ressource(s) trouvée(s):`);
                                json.resources.slice(0, 3).forEach((r, i) => {
                                    console.log(`      ${i + 1}. ${r.title || r.name || 'Sans titre'}`);
                                    console.log(`         Format: ${r.format || 'non spécifié'}`);
                                    console.log(`         URL: ${r.url || 'non spécifié'}`);
                                });
                            }
                            
                            if (json.url) {
                                console.log(`   🔗 URL directe: ${json.url}`);
                            }
                            
                            resolve({ name, url, status: 'OK', json });
                        } catch (err) {
                            console.log(`   ⚠️  Pas de JSON valide: ${err.message}`);
                            console.log(`   📄 Premiers 200 chars: ${data.substring(0, 200)}`);
                            resolve({ name, url, status: 'OK', raw: data.substring(0, 500) });
                        }
                    } else {
                        // C'est probablement un fichier binaire
                        console.log(`   📄 Type: Fichier binaire`);
                        console.log(`   ✅ URL accessible`);
                        resolve({ name, url, status: 'OK', size: data.length });
                    }
                });
            };
            
            if (response.statusCode === 301 || response.statusCode === 302 || 
                response.statusCode === 307 || response.statusCode === 308) {
                console.log(`   ↪️  Redirection vers: ${response.headers.location}`);
                followRedirect(response.headers.location, 0);
            } else {
                processResponse(response, url);
            }
        });
        
        req.on('error', (err) => {
            console.log(`   ❌ Erreur: ${err.message}`);
            resolve({ name, url, status: 'ERROR', error: err.message });
        });
        
        req.on('timeout', () => {
            console.log(`   ⏱️  Timeout`);
            req.destroy();
            resolve({ name, url, status: 'TIMEOUT' });
        });
    });
}

async function testAll() {
    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║          VÉRIFICATION DES LIENS API ET TÉLÉCHARGEMENTS              ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
    
    const results = [];
    
    // Tester les URLs principales
    for (const [name, url] of Object.entries(URLs)) {
        const result = await testUrl(name, url);
        results.push(result);
        await new Promise(resolve => setTimeout(resolve, 500)); // Pause entre les requêtes
    }
    
    // Tester les URLs alternatives
    console.log(`\n\n${'═'.repeat(70)}`);
    console.log('TESTS DES URLs ALTERNATIVES');
    console.log(`${'═'.repeat(70)}\n`);
    
    for (const [name, url] of Object.entries(URLs_ALT)) {
        const result = await testUrl(name, url);
        results.push(result);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Résumé
    console.log(`\n\n╔══════════════════════════════════════════════════════════════════════╗`);
    console.log('║                          RÉSUMÉ DES TESTS                            ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
    
    const ok = results.filter(r => r.status === 'OK').length;
    const errors = results.filter(r => r.status === 'ERROR').length;
    const timeouts = results.filter(r => r.status === 'TIMEOUT').length;
    
    console.log(`✅ URLs fonctionnelles: ${ok}`);
    console.log(`❌ URLs en erreur: ${errors}`);
    console.log(`⏱️  Timeouts: ${timeouts}\n`);
    
    if (errors > 0 || timeouts > 0) {
        console.log('📋 Détails des problèmes:\n');
        results.forEach(r => {
            if (r.status !== 'OK') {
                console.log(`   ${r.name}: ${r.status} - ${r.error || 'Timeout'}`);
            }
        });
    }
}

testAll().catch(console.error);

