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
     * Génère un PDF d'accord de principe signé pour une proposition acceptée
     * @param {Object} offer - L'offre acceptée
     * @param {Object} announcement - L'annonce associée
     * @param {Array} signatures - Les signatures (buyer et seller)
     * @returns {Promise<string>} - Le chemin du fichier PDF généré
     */
    async generateContractPDF(offer, announcement, signatures) {
        return new Promise((resolve, reject) => {
            try {
                const filename = `accord_principe_${offer.id}_${Date.now()}.pdf`;
                const filepath = path.join(this.pdfsDir, filename);
                const doc = new PDFDocument({ margin: 50 });

                const stream = fs.createWriteStream(filepath);
                doc.pipe(stream);

                // En-tête
                doc.fontSize(20)
                   .fillColor('#2E7D32')
                   .text('ACCORD DE PRINCIPE', { align: 'center' })
                   .moveDown();

                doc.fontSize(14)
                   .fillColor('#424242')
                   .text('Acceptation mutuelle d\'une proposition de transaction immobilière', { align: 'center' })
                   .moveDown();

                doc.fontSize(12)
                   .fillColor('#000000')
                   .text(`Document généré le ${new Date().toLocaleDateString('fr-FR')}`, { align: 'center' })
                   .moveDown(2);

                // Section Annonce
                doc.fontSize(16)
                   .fillColor('#1565C0')
                   .text('DÉTAILS DE L\'ANNONCE', { underline: true })
                   .moveDown();

                doc.fontSize(11)
                   .fillColor('#000000')
                   .text(`Titre: ${announcement.title || 'Non spécifié'}`, { continued: false })
                   .text(`Description: ${announcement.description || 'Non spécifiée'}`)
                   .moveDown();

                // Informations du bien
                doc.fontSize(14)
                   .fillColor('#1565C0')
                   .text('CARACTÉRISTIQUES DU BIEN', { underline: true })
                   .moveDown();

                const details = [];
                details.push(`Localisation: ${announcement.commune || 'Non spécifiée'} (${announcement.code_insee || 'N/A'})`);
                
                if (announcement.surface) {
                    details.push(`Surface: ${announcement.surface.toFixed(2)} m²`);
                }
                
                if (announcement.surface_maison) {
                    details.push(`Surface maison: ${announcement.surface_maison.toFixed(2)} m²`);
                }
                
                if (announcement.nombre_pieces) {
                    details.push(`Nombre de pièces: ${announcement.nombre_pieces}`);
                }
                
                if (announcement.type) {
                    details.push(`Type: ${announcement.type}`);
                }
                
                if (announcement.orientation) {
                    details.push(`Orientation: ${announcement.orientation}`);
                }
                
                if (announcement.luminosite) {
                    details.push(`Luminosité: ${announcement.luminosite}`);
                }
                
                if (announcement.classe_dpe) {
                    details.push(`Classe DPE: ${announcement.classe_dpe}`);
                }

                doc.fontSize(11)
                   .fillColor('#000000')
                   .text(details.join('\n'))
                   .moveDown();

                // Section Prix
                doc.fontSize(14)
                   .fillColor('#1565C0')
                   .text('CONDITIONS FINANCIÈRES', { underline: true })
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
                   .text('SIGNATURES ÉLECTRONIQUES', { underline: true })
                   .moveDown();

                const buyerSignature = signatures.find(s => s.signature_type === 'buyer');
                const sellerSignature = signatures.find(s => s.signature_type === 'seller');

                if (buyerSignature) {
                    doc.fontSize(11)
                       .fillColor('#000000')
                       .text(`Acheteur: ${buyerSignature.user_name}`, { continued: false })
                       .text(`Email: ${buyerSignature.user_email}`, { continued: false })
                       .text(`Signé le: ${new Date(buyerSignature.signature_timestamp).toLocaleString('fr-FR')}`)
                       .moveDown();
                }

                if (sellerSignature) {
                    doc.fontSize(11)
                       .fillColor('#000000')
                       .text(`Vendeur: ${sellerSignature.user_name}`, { continued: false })
                       .text(`Email: ${sellerSignature.user_email}`, { continued: false })
                       .text(`Signé le: ${new Date(sellerSignature.signature_timestamp).toLocaleString('fr-FR')}`)
                       .moveDown();
                }

                // Message de la proposition si présent
                if (offer.message) {
                    doc.fontSize(14)
                       .fillColor('#1565C0')
                       .text('MESSAGE ASSOCIÉ', { underline: true })
                       .moveDown();

                    doc.fontSize(11)
                       .fillColor('#000000')
                       .text(offer.message, { align: 'justify' })
                       .moveDown();
                }

                // Pied de page - Section juridique avec articles de loi
                const footerStartY = doc.page.height - 210;
                
                doc.moveTo(50, footerStartY)
                   .lineTo(doc.page.width - 50, footerStartY)
                   .stroke();

                doc.fontSize(9)
                   .fillColor('#2E7D32')
                   .text('DISPOSITIONS JURIDIQUES ET RÉFÉRENCES LÉGALES', 
                         50, footerStartY + 5, { align: 'center', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#424242')
                   .text('Nature de l\'accord:', 
                         50, footerStartY + 18, { continued: false, width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('Cet accord de principe constitue un engagement préliminaire entre les parties, fixant certains', 
                         50, footerStartY + 27, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('éléments essentiels (bien, prix) d\'un contrat futur. Il peut constituer un contrat en lui-même', 
                         50, footerStartY + 34, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('s\'il remplit les conditions du Code civil (art. 1108 : consentement, capacité, objet licite et certain).', 
                         50, footerStartY + 41, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#424242')
                   .text('Force obligatoire:', 
                         50, footerStartY + 52, { continued: false, width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('Conformément à l\'article 1134 du Code civil, les conventions légalement formées tiennent lieu de loi à ceux', 
                         50, footerStartY + 61, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('qui les ont faites. Elles doivent être exécutées de bonne foi (art. 1134, al. 3).', 
                         50, footerStartY + 68, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#424242')
                   .text('Absence de transfert de propriété:', 
                         50, footerStartY + 79, { continued: false, width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('Selon l\'article 1582 du Code civil, la vente est parfaite dès que les parties sont convenues de la chose et du prix.', 
                         50, footerStartY + 88, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('Cependant, conformément à l\'article 1583, l\'accord de principe ne transfère pas immédiatement la propriété.', 
                         50, footerStartY + 95, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#424242')
                   .text('IMPORTANT : Cet accord de principe devra être formalisé par un compromis de vente établi chez un notaire.', 
                         50, footerStartY + 102, { align: 'left', width: doc.page.width - 100, underline: false });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('Le transfert définitif de propriété nécessitera ensuite un acte authentique de vente chez un notaire,', 
                         50, footerStartY + 109, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('conformément à l\'article 1589 du Code civil relatif aux promesses de vente et à l\'article 1588 concernant', 
                         50, footerStartY + 116, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('les ventes d\'immeubles qui requièrent un acte authentique.', 
                         50, footerStartY + 123, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#424242')
                   .text('Signature électronique:', 
                         50, footerStartY + 134, { continued: false, width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('Conformément à l\'article 1366 du Code civil, l\'écrit électronique a la même force probante que l\'écrit sur support papier.', 
                         50, footerStartY + 143, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('L\'article 1367 prévoit que la signature électronique identifie son auteur et manifeste son consentement aux obligations', 
                         50, footerStartY + 150, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('résultant de l\'acte auquel elle s\'attache.', 
                         50, footerStartY + 157, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#424242')
                   .text('Obligation de négocier et formalisation:', 
                         50, footerStartY + 168, { continued: false, width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('Les parties s\'engagent à négocier de bonne foi en vue de conclure un compromis de vente chez un notaire,', 
                         50, footerStartY + 177, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('puis un acte authentique de vente définitif, conformément aux articles 1104 et 1135 du Code civil relatifs', 
                         50, footerStartY + 184, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(7)
                   .fillColor('#757575')
                   .text('à la bonne foi dans les contrats.', 
                         50, footerStartY + 191, { align: 'left', width: doc.page.width - 100 });

                doc.fontSize(8)
                   .fillColor('#2E7D32')
                   .text(`Référence: ${offer.id}`, 
                         50, footerStartY + 200, { align: 'center', width: doc.page.width - 100 });

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
