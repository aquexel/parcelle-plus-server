/**
 * Génère un PDF d'exemple « accord de principe » (même moteur que le serveur).
 * Usage : node scripts/generate-sample-accord-principe-pdf.js
 * Sortie : pdfs/exemple-accord-de-principe-parcelleplus.pdf
 */
const path = require('path');
const fs = require('fs');

const PDFService = require('../services/PDFService');

const outName = 'exemple-accord-de-principe-parcelleplus.pdf';
const outDir = path.join(__dirname, '..', 'pdfs');
const outPath = path.join(outDir, outName);

const offer = {
    id: 'sample-offer-demo-001',
    original_price: 285000,
    proposed_price: 272000,
    proposed_surface: null,
    message: 'Proposition ferme suite à visite du 12 avril.',
};

const announcement = {
    title: 'Maison T5 avec jardin — Dax',
    description: 'Belle maison rénovée, garage double, quartier calme proche commodités.',
    commune: 'Dax',
    code_insee: '40100',
    type: 'MAISON_TERRAIN',
    surface: 450,
    surface_maison: 128,
    nombre_pieces: 5,
    orientation: 'Sud',
    luminosite: 7.5,
    classe_dpe: 'C',
};

const ts = new Date('2026-04-15T14:30:00').toISOString();

const signatures = [
    {
        signature_type: 'buyer',
        user_name: 'acheteur_demo',
        user_email: 'acheteur.exemple@email.fr',
        prenom: 'Camille',
        nom: 'Dupont',
        date_naissance: '1988-06-22',
        adresse: '12 rue des Lilas, 40100 Dax',
        email_verified: 1,
        signature_timestamp: ts,
    },
    {
        signature_type: 'seller',
        user_name: 'vendeur_demo',
        user_email: 'vendeur.exemple@email.fr',
        prenom: 'Jean-Marc',
        nom: 'Lafont',
        date_naissance: '1972-03-10',
        adresse: '8 avenue du Parc, 40100 Dax',
        email_verified: 1,
        signature_timestamp: ts,
    },
];

async function main() {
    const pdfService = new PDFService();
    const generatedPath = await pdfService.generateContractPDF(offer, announcement, signatures);
    fs.copyFileSync(generatedPath, outPath);
    console.log('OK:', outPath);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
