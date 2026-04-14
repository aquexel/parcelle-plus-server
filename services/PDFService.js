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
                const doc = new PDFDocument({ margin: 30 }); // Marges réduites

                const stream = fs.createWriteStream(filepath);
                doc.pipe(stream);

                // En-tête
                doc.fontSize(16)
                   .fillColor('#2E7D32')
                   .text('ACCORD DE PRINCIPE', { align: 'center' })
                   .moveDown(0.3);

                doc.fontSize(11)
                   .fillColor('#424242')
                   .text('Acceptation mutuelle d\'une proposition de transaction immobilière', { align: 'center' })
                   .moveDown(0.3);

                doc.fontSize(9)
                   .fillColor('#000000')
                   .text(`Document généré le ${new Date().toLocaleDateString('fr-FR')}`, { align: 'center' })
                   .moveDown(0.8);

                // Section Annonce
                doc.fontSize(12)
                   .fillColor('#1565C0')
                   .text('DÉTAILS DE L\'ANNONCE', { underline: true })
                   .moveDown(0.3);

                doc.fontSize(9)
                   .fillColor('#000000')
                   .text(`Titre: ${announcement.title || 'Non spécifié'}`, { continued: false })
                   .text(`Description: ${(announcement.description || 'Non spécifiée').substring(0, 100)}${(announcement.description && announcement.description.length > 100) ? '...' : ''}`)
                   .moveDown(0.5);

                // Informations du bien
                doc.fontSize(12)
                   .fillColor('#1565C0')
                   .text('CARACTÉRISTIQUES DU BIEN', { underline: true })
                   .moveDown(0.3);

                const details = [];
                details.push(`Localisation: ${announcement.commune || 'Non spécifiée'} (${announcement.code_insee || 'N/A'})`);
                
                // Déterminer le type de bien et afficher la surface appropriée
                const announcementType = (announcement.type || '').toUpperCase();
                const isAppartement = announcementType === 'APPARTEMENT';
                const isMaisonSeule = announcementType === 'MAISON_SEULE';
                const isMaisonTerrain = announcementType === 'MAISON_TERRAIN';
                const isTerrain = announcementType === 'TERRAIN';
                
                if (isAppartement) {
                    // Pour un appartement : afficher surface habitable (surface_maison en priorité, sinon surface)
                    const surfaceHabitable = announcement.surface_maison || announcement.surface;
                    if (surfaceHabitable) {
                        details.push(`Surface habitable: ${surfaceHabitable.toFixed(2)} m²`);
                    }
                } else if (isMaisonSeule) {
                    // Pour une maison seule : afficher surface habitable
                    const surfaceHabitable = announcement.surface_maison || announcement.surface;
                    if (surfaceHabitable) {
                        details.push(`Surface habitable: ${surfaceHabitable.toFixed(2)} m²`);
                    }
                } else if (isMaisonTerrain) {
                    // Pour maison avec terrain : afficher surface terrain et surface maison séparément
                    if (announcement.surface_maison && announcement.surface) {
                        const surfaceTerrain = announcement.surface - announcement.surface_maison;
                        if (surfaceTerrain > 0) {
                            details.push(`Surface terrain: ${surfaceTerrain.toFixed(2)} m²`);
                        }
                        details.push(`Surface maison: ${announcement.surface_maison.toFixed(2)} m²`);
                    } else if (announcement.surface_maison) {
                        details.push(`Surface maison: ${announcement.surface_maison.toFixed(2)} m²`);
                    } else if (announcement.surface) {
                        details.push(`Surface terrain: ${announcement.surface.toFixed(2)} m²`);
                    }
                } else if (isTerrain) {
                    // Pour un terrain : afficher surface terrain
                    if (announcement.surface) {
                        details.push(`Surface terrain: ${announcement.surface.toFixed(2)} m²`);
                    }
                } else {
                    // Type non spécifié : utiliser surface générique
                    if (announcement.surface) {
                        details.push(`Surface: ${announcement.surface.toFixed(2)} m²`);
                    }
                    if (announcement.surface_maison) {
                        details.push(`Surface maison: ${announcement.surface_maison.toFixed(2)} m²`);
                    }
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

                doc.fontSize(9)
                   .fillColor('#000000')
                   .text(details.join(' | '), { lineGap: 2 })
                   .moveDown(0.5);

                // Section Prix
                doc.fontSize(12)
                   .fillColor('#1565C0')
                   .text('CONDITIONS FINANCIÈRES', { underline: true })
                   .moveDown(0.3);

                doc.fontSize(9)
                   .fillColor('#000000')
                   .text(`Prix initial: ${offer.original_price.toFixed(2)} € | Prix proposé et accepté: ${offer.proposed_price.toFixed(2)} € | Différence: ${(offer.proposed_price - offer.original_price).toFixed(2)} €`)
                   .moveDown(0.5);

                if (offer.proposed_surface && offer.proposed_surface !== announcement.surface) {
                    doc.fontSize(9)
                       .text(`Surface proposée: ${offer.proposed_surface.toFixed(2)} m² (différente de l'originale)`)
                       .moveDown(0.3);
                }

                // Section Signatures
                doc.fontSize(12)
                   .fillColor('#1565C0')
                   .text('SIGNATURES ÉLECTRONIQUES', { underline: true })
                   .moveDown(0.3);

                const buyerSignature = signatures.find(s => s.signature_type === 'buyer');
                const sellerSignature = signatures.find(s => s.signature_type === 'seller');

                if (buyerSignature) {
                    doc.fontSize(8)
                       .fillColor('#000000')
                       .text(`Acheteur: ${buyerSignature.user_name} | Email: ${buyerSignature.user_email} | Signé le: ${new Date(buyerSignature.signature_timestamp).toLocaleString('fr-FR')}`)
                       .moveDown(0.3);
                }

                if (sellerSignature) {
                    doc.fontSize(8)
                       .fillColor('#000000')
                       .text(`Vendeur: ${sellerSignature.user_name} | Email: ${sellerSignature.user_email} | Signé le: ${new Date(sellerSignature.signature_timestamp).toLocaleString('fr-FR')}`)
                       .moveDown(0.3);
                }

                // Message de la proposition si présent
                if (offer.message) {
                    doc.fontSize(12)
                       .fillColor('#1565C0')
                       .text('MESSAGE ASSOCIÉ', { underline: true })
                       .moveDown(0.3);

                    doc.fontSize(8)
                       .fillColor('#000000')
                       .text(offer.message.substring(0, 200) + (offer.message.length > 200 ? '...' : ''), { align: 'justify', lineGap: 2 })
                       .moveDown(0.5);
                }

                // Pied de page - Section juridique avec articles de loi (version compacte)
                const currentY = doc.y;
                const pageHeight = doc.page.height;
                const marginBottom = 30;
                const footerHeight = 130; // Hauteur réduite pour le pied de page
                const availableSpace = pageHeight - currentY - marginBottom;
                
                // Calculer la position du pied de page pour qu'il tienne sur la page
                const footerStartY = pageHeight - footerHeight - marginBottom;
                doc.y = footerStartY - 5;
                
                doc.moveTo(30, footerStartY)
                   .lineTo(doc.page.width - 30, footerStartY)
                   .stroke();

                // Version ultra-compacte du pied de page
                let yOffset = 4;
                
                doc.fontSize(7)
                   .fillColor('#2E7D32')
                   .text('DISPOSITIONS JURIDIQUES', 
                         30, footerStartY + yOffset, { align: 'center', width: doc.page.width - 60 });
                yOffset += 8;

                doc.fontSize(5)
                   .fillColor('#424242')
                   .text('Nature:', 30, footerStartY + yOffset, { width: doc.page.width - 60 });
                yOffset += 6;

                doc.fontSize(5)
                   .fillColor('#757575')
                   .text('Accord préliminaire fixant les éléments essentiels (bien, prix). Peut constituer un contrat si conditions Code civil art. 1108 remplies.', 
                         30, footerStartY + yOffset, { align: 'left', width: doc.page.width - 60, lineGap: 1 });
                yOffset += 12;

                doc.fontSize(5)
                   .fillColor('#424242')
                   .text('Force obligatoire:', 30, footerStartY + yOffset, { width: doc.page.width - 60 });
                yOffset += 6;

                doc.fontSize(5)
                   .fillColor('#757575')
                   .text('Art. 1134 C. civ.: conventions légalement formées = force de loi. Exécution de bonne foi (art. 1134 al. 3).', 
                         30, footerStartY + yOffset, { align: 'left', width: doc.page.width - 60, lineGap: 1 });
                yOffset += 10;

                doc.fontSize(5)
                   .fillColor('#424242')
                   .text('Transfert de propriété:', 30, footerStartY + yOffset, { width: doc.page.width - 60 });
                yOffset += 6;

                doc.fontSize(5)
                   .fillColor('#757575')
                   .text('Art. 1582 C. civ.: vente parfaite dès accord sur chose et prix. Art. 1583: pas de transfert immédiat. IMPORTANT: Formalisation via compromis puis acte authentique notarié requis (art. 1588-1589).', 
                         30, footerStartY + yOffset, { align: 'left', width: doc.page.width - 60, lineGap: 1 });
                yOffset += 12;

                doc.fontSize(5)
                   .fillColor('#424242')
                   .text('Signature électronique:', 30, footerStartY + yOffset, { width: doc.page.width - 60 });
                yOffset += 6;

                doc.fontSize(5)
                   .fillColor('#757575')
                   .text('Art. 1366-1367 C. civ.: écrit électronique = même force probante que papier. Signature identifie auteur et manifeste consentement.', 
                         30, footerStartY + yOffset, { align: 'left', width: doc.page.width - 60, lineGap: 1 });
                yOffset += 10;

                doc.fontSize(5)
                   .fillColor('#424242')
                   .text('Formalisation:', 30, footerStartY + yOffset, { width: doc.page.width - 60 });
                yOffset += 6;

                doc.fontSize(5)
                   .fillColor('#757575')
                   .text('Obligation négocier de bonne foi pour compromis puis acte authentique (art. 1104, 1135 C. civ.).', 
                         30, footerStartY + yOffset, { align: 'left', width: doc.page.width - 60, lineGap: 1 });
                yOffset += 8;

                doc.fontSize(6)
                   .fillColor('#2E7D32')
                   .text(`Référence: ${offer.id}`, 
                         30, footerStartY + yOffset, { align: 'center', width: doc.page.width - 60 });

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
