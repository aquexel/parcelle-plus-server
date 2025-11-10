const https = require('https');

// URLs à tester
const URL_PA = 'https://www.data.gouv.fr/api/1/datasets/r/9db13a09-72a9-4871-b430-13872b4890b3';
const URL_PC = 'https://www.data.gouv.fr/api/1/datasets/r/65a9e264-7a20-46a9-9d98-66becb817bc3';

// URLs alternatives possibles
const URL_PA_ALT = 'https://www.data.gouv.fr/api/1/datasets/9db13a09-72a9-4871-b430-13872b4890b3/';
const URL_PC_ALT = 'https://www.data.gouv.fr/api/1/datasets/65a9e264-7a20-46a9-9d98-66becb817bc3/';

function testUrl(url, name) {
    return new Promise((resolve, reject) => {
        console.log(`\n🔍 Test de ${name}: ${url}\n`);
        
        https.get(url, (response) => {
            let data = '';
            
            // Suivre les redirections
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                console.log(`   ↪️  Redirection vers: ${response.headers.location}`);
                return testUrl(response.headers.location, name).then(resolve).catch(reject);
            }
            
            console.log(`   Status: ${response.statusCode}`);
            console.log(`   Content-Type: ${response.headers['content-type']}`);
            
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            
            response.on('data', (chunk) => {
                data += chunk.toString();
            });
            
            response.on('end', () => {
                console.log(`   Taille réponse: ${data.length} caractères`);
                console.log(`   Premiers 500 caractères:`);
                console.log(`   ${data.substring(0, 500)}`);
                console.log(`   \n   Derniers 200 caractères:`);
                console.log(`   ${data.substring(Math.max(0, data.length - 200))}`);
                
                // Essayer de parser en JSON
                try {
                    const json = JSON.parse(data);
                    console.log(`   ✅ JSON valide`);
                    console.log(`   Clés principales: ${Object.keys(json).join(', ')}`);
                    
                    if (json.resources) {
                        console.log(`   📦 ${json.resources.length} ressource(s) trouvée(s)`);
                        json.resources.forEach((r, i) => {
                            console.log(`      ${i + 1}. ${r.title || r.name || 'Sans titre'} - ${r.url || 'Pas d\'URL'}`);
                        });
                    }
                    
                    if (json.url) {
                        console.log(`   🔗 URL directe: ${json.url}`);
                    }
                    
                    resolve({ url, json, raw: data });
                } catch (err) {
                    console.log(`   ❌ Erreur parsing JSON: ${err.message}`);
                    console.log(`   Caractères suspects autour de la position 10:`);
                    console.log(`   ${data.substring(0, 50)}`);
                    reject(err);
                }
            });
            
            response.on('error', reject);
        }).on('error', reject);
    });
}

async function testAll() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('TEST DES URLs API DATA.GOUV.FR');
    console.log('═══════════════════════════════════════════════════════════');
    
    try {
        await testUrl(URL_PA, 'PA (format /r/)');
    } catch (err) {
        console.error(`   ❌ Erreur: ${err.message}`);
    }
    
    try {
        await testUrl(URL_PA_ALT, 'PA (format alternatif)');
    } catch (err) {
        console.error(`   ❌ Erreur: ${err.message}`);
    }
    
    try {
        await testUrl(URL_PC, 'PC (format /r/)');
    } catch (err) {
        console.error(`   ❌ Erreur: ${err.message}`);
    }
    
    try {
        await testUrl(URL_PC_ALT, 'PC (format alternatif)');
    } catch (err) {
        console.error(`   ❌ Erreur: ${err.message}`);
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('TESTS TERMINÉS');
    console.log('═══════════════════════════════════════════════════════════\n');
}

testAll().catch(console.error);

