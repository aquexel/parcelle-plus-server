const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PDFService {
    constructor() {
        // Créer le dossier pdfs s'il n'existe pas
        this.pdfsDir = path.join(__dirname, '..', 'pdfs');
        if (!fs.existsSync(this.pdfsDir)) {
            fs.mkdirSync(this.pdfsDir, { recursive: true });
        }
    }

    /**
     * Génère un PDF de contrat signé pour une proposition acceptée
     * @param {Object} offer - L'offre acceptée
     * @param {Object} announcement - L'annonce associée
     * @param {Array} signatures - Les signatures (buyer et seller)
     * @returns {Promise<string>} - Le chemin du fichier PDF généré
     */
    async generateContractPDF(offer, announcement, signatures) {
        return new Promise((resolve, reject) => {
            try {
                const filename = `contrat_${offer.id}_${Date.now()}.pdf`;
                const filepath = path.join(this.pdfsDir, filename);
                const doc = new PDFDocument({ margin: 50 });

                const stream = fs.createWriteStream(filepath);
                doc.pipe(stream);

                // En-tête
                doc.fontSize(20)
                   .fillColor('#2E7D32')
                   .text('CONTRAT DE VENTE', { align: 'center' })
                   .moveDown();

                doc.fontSize(12)
                   .fillColor('#000000')
                   .text(`Document généré le ${new Date().toLocaleDateString('fr-FR')}`, { align: 'center' })
                   .moveDown(2);

                // Section Annonce
                doc.fontSize(16)
                   .fillColor('#1565C0')
                   .text('📋 DÉTAILS DE L\'ANNONCE', { underline: true })
                   .moveDown();

                doc.fontSize(11)
                   .fillColor('#000000')
                   .text(`Titre: ${announcement.title || 'Non spécifié'}`, { continued: false })
                   .text(`Description: ${announcement.description || 'Non spécifiée'}`)
                   .moveDown();

                // Informations du bien
                doc.fontSize(14)
                   .fillColor('#1565C0')
                   .text('🏠 CARACTÉRISTIQUES DU BIEN', { underline: true })
                   .moveDown();

                const details = [];
                details.push(`📍 Localisation: ${announcement.commune || 'Non spécifiée'} (${announcement.code_insee || 'N/A'})`);
                
                if (announcement.surface) {
                    details.push(`📐 Surface: ${announcement.surface.toFixed(2)} m²`);
                }
                
                if (announcement.surface_maison) {
                    details.push(`🏡 Surface maison: ${announcement.surface_maison.toFixed(2)} m²`);
                }
                
                if (announcement.nombre_pieces) {
                    details.push(`🚪 Nombre de pièces: ${announcement.nombre_pieces}`);
                }
                
                if (announcement.type) {
                    details.push(`📋 Type: ${announcement.type}`);
                }
                
                if (announcement.orientation) {
                    details.push(`🧭 Orientation: ${announcement.orientation}`);
                }
                
                if (announcement.luminosite) {
                    details.push(`💡 Luminosité: ${announcement.luminosite}`);
                }
                
                if (announcement.classe_dpe) {
                    details.push(`⚡ Classe DPE: ${announcement.classe_dpe}`);
                }

                doc.fontSize(11)
                   .fillColor('#000000')
                   .text(details.join('\n'))
                   .moveDown();

                // Section Prix
                doc.fontSize(14)
                   .fillColor('#1565C0')
                   .text('💰 CONDITIONS FINANCIÈRES', { underline: true })
                   .moveDown();

                doc.fontSize(11)
                   .fillColor('#000000')
                   .text(`Prix initial: ${offer.original_price.toFixed(2)} €`, { continued: false })
                   .text(`Prix proposé et accepté: ${offer.proposed_price.toFixed(2)} €`, { continued: false })
                   .text(`Différence: ${(offer.proposed_price - offer.original_price).toFixed(2)} €`)
                   .moveDown();

                if (offer.proposed_surface && offer.proposed_surface !== announcement.surface) {
                    doc.text(`Surface proposée: ${offer.proposed_surface.toFixed(2)} m² (différente de l'originale)`)
                       .moveDown();
                }

                // Section Signatures
                doc.fontSize(14)
                   .fillColor('#1565C0')
                   .text('✍️ SIGNATURES ÉLECTRONIQUES', { underline: true })
                   .moveDown();

                const buyerSignature = signatures.find(s => s.signature_type === 'buyer');
                const sellerSignature = signatures.find(s => s.signature_type === 'seller');

                if (buyerSignature) {
                    doc.fontSize(11)
                       .fillColor('#000000')
                       .text(`👤 Acheteur: ${buyerSignature.user_name}`, { continued: false })
                       .text(`📧 Email: ${buyerSignature.user_email}`, { continued: false })
                       .text(`⏰ Signé le: ${new Date(buyerSignature.signature_timestamp).toLocaleString('fr-FR')}`)
                       .moveDown();
                }

                if (sellerSignature) {
                    doc.fontSize(11)
                       .fillColor('#000000')
                       .text(`🏠 Vendeur: ${sellerSignature.user_name}`, { continued: false })
                       .text(`📧 Email: ${sellerSignature.user_email}`, { continued: false })
                       .text(`⏰ Signé le: ${new Date(sellerSignature.signature_timestamp).toLocaleString('fr-FR')}`)
                       .moveDown();
                }

                // Message de la proposition si présent
                if (offer.message) {
                    doc.fontSize(14)
                       .fillColor('#1565C0')
                       .text('💬 MESSAGE ASSOCIÉ', { underline: true })
                       .moveDown();

                    doc.fontSize(11)
                       .fillColor('#000000')
                       .text(offer.message, { align: 'justify' })
                       .moveDown();
                }

                // Pied de page
                doc.moveTo(50, doc.page.height - 100)
                   .lineTo(doc.page.width - 50, doc.page.height - 100)
                   .stroke();

                doc.fontSize(8)
                   .fillColor('#757575')
                   .text('Ce document a été généré électroniquement et possède une valeur légale.', 
                         50, doc.page.height - 90, { align: 'center', width: doc.page.width - 100 });

                doc.fontSize(8)
                   .fillColor('#757575')
                   .text(`ID du contrat: ${offer.id}`, 
                         50, doc.page.height - 70, { align: 'center', width: doc.page.width - 100 });

                doc.end();

                stream.on('finish', () => {
                    console.log(`✅ PDF généré: ${filepath}`);
                    resolve(filepath);
                });

                stream.on('error', (error) => {
                    console.error('❌ Erreur génération PDF:', error);
                    reject(error);
                });

            } catch (error) {
                console.error('❌ Erreur création PDF:', error);
                reject(error);
            }
        });
    }
}

module.exports = PDFService;
