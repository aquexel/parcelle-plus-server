const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const MARGIN = 48;
const LOGO_SIZE = 46;

class PDFService {
    constructor() {
        this.pdfsDir = path.join(__dirname, '..', 'pdfs');
        if (!fs.existsSync(this.pdfsDir)) {
            fs.mkdirSync(this.pdfsDir, { recursive: true });
        }
        this.assetsDir = path.join(__dirname, '..', 'assets');
        this.logoPngPath = path.join(this.assetsDir, 'parcelleplus-logo.png');
    }

    /**
     * Logo type app (app_logo.svg) dessiné en vectoriel — PDFKit ne charge pas le SVG.
     */
    drawVectorAppLogo(doc, x, y, size) {
        const u = size / 108;
        const cx = x + 54 * u;
        const cy = y + 54 * u;
        const rOut = 45 * u;
        const rGreen = 40 * u;

        doc.save();
        doc.lineWidth(Math.max(1.2, 5 * u));
        doc.circle(cx, cy, rOut).strokeColor('#424242').stroke();
        doc.lineWidth(Math.max(0.8, 3 * u));
        doc.circle(cx, cy, rGreen + 1.2 * u).strokeColor('#FFFFFF').stroke();
        doc.lineWidth(Math.max(0.8, 2 * u));
        doc.circle(cx, cy, rGreen).fillColor('#4CAF50').strokeColor('#2E7D32').fillAndStroke();

        doc.fillColor('#FFFFFF');
        const bar = 8 * u;
        const arm = 16 * u;
        doc.rect(cx - bar / 2, cy - arm / 2, bar, arm).fill();
        doc.rect(cx - arm / 2, cy - bar / 2, arm, bar).fill();
        doc.restore();
    }

    drawHeaderLogoAndTitle(doc) {
        const top = MARGIN;
        const left = MARGIN;
        let headerBottom = top + LOGO_SIZE;

        if (fs.existsSync(this.logoPngPath)) {
            try {
                doc.image(this.logoPngPath, left, top, { width: LOGO_SIZE, height: LOGO_SIZE });
            } catch {
                this.drawVectorAppLogo(doc, left, top, LOGO_SIZE);
            }
        } else {
            this.drawVectorAppLogo(doc, left, top, LOGO_SIZE);
        }

        const titleX = left + LOGO_SIZE + 14;
        const titleWidth = doc.page.width - titleX - MARGIN;
        const subtitle =
            'Acceptation mutuelle d’une proposition de transaction immobilière (plateforme ParcellePlus).';
        doc.font('Times-Bold').fontSize(13).fillColor('#000000');
        doc.text('ACCORD DE PRINCIPE', titleX, top + 4, { width: titleWidth, align: 'left' });
        doc.font('Times-Italic').fontSize(9).fillColor('#333333');
        doc.text(subtitle, titleX, top + 22, { width: titleWidth, align: 'left', lineGap: 1 });
        const titleBlockEnd = top + 22 + doc.heightOfString(subtitle, { width: titleWidth, lineGap: 1 });
        headerBottom = Math.max(headerBottom, titleBlockEnd);
        doc.y = headerBottom + 18;
        doc.x = MARGIN;

        doc.moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).strokeColor('#000000').lineWidth(0.5).stroke();
        doc.moveDown(0.6);
    }

    buildBienAddressLine(announcement) {
        const parts = [];
        if (announcement.commune) parts.push(announcement.commune);
        if (announcement.code_insee) parts.push(`code INSEE ${announcement.code_insee}`);
        const loc = parts.join(', ');
        if (announcement.title) {
            return loc ? `${announcement.title} — ${loc}` : String(announcement.title);
        }
        return loc || '— (localisation non renseignée)';
    }

    buildDesignationBien(announcement) {
        const announcementType = (announcement.type || '').toUpperCase();
        const phrases = [];
        const isAppartement = announcementType === 'APPARTEMENT';
        const isMaisonSeule = announcementType === 'MAISON_SEULE';
        const isMaisonTerrain = announcementType === 'MAISON_TERRAIN';
        const isTerrain = announcementType === 'TERRAIN';

        if (announcement.type) phrases.push(`Nature : ${announcement.type}.`);

        if (isAppartement) {
            const sh = announcement.surface_maison || announcement.surface;
            if (sh) phrases.push(`Surface habitable d’environ ${Number(sh).toFixed(2)} m².`);
        } else if (isMaisonSeule) {
            const sh = announcement.surface_maison || announcement.surface;
            if (sh) phrases.push(`Surface habitable d’environ ${Number(sh).toFixed(2)} m².`);
        } else if (isMaisonTerrain) {
            if (announcement.surface_maison && announcement.surface) {
                const st = announcement.surface - announcement.surface_maison;
                if (st > 0) phrases.push(`Terrain d’environ ${st.toFixed(2)} m².`);
                phrases.push(`Construction d’environ ${announcement.surface_maison.toFixed(2)} m².`);
            } else if (announcement.surface_maison) {
                phrases.push(`Construction d’environ ${announcement.surface_maison.toFixed(2)} m².`);
            } else if (announcement.surface) {
                phrases.push(`Terrain d’environ ${announcement.surface.toFixed(2)} m².`);
            }
        } else if (isTerrain && announcement.surface) {
            phrases.push(`Terrain d’environ ${Number(announcement.surface).toFixed(2)} m².`);
        } else {
            if (announcement.surface) phrases.push(`Surface (terrain ou ensemble) d’environ ${Number(announcement.surface).toFixed(2)} m².`);
            if (announcement.surface_maison) {
                phrases.push(`Surface de construction d’environ ${Number(announcement.surface_maison).toFixed(2)} m².`);
            }
        }

        if (announcement.nombre_pieces) phrases.push(`Nombre de pièces principales : ${announcement.nombre_pieces}.`);
        if (announcement.orientation) phrases.push(`Orientation : ${announcement.orientation}.`);
        if (announcement.luminosite != null) phrases.push(`Luminosité (indicatif) : ${announcement.luminosite}.`);
        if (announcement.classe_dpe) phrases.push(`Classe DPE (indicatif) : ${announcement.classe_dpe}.`);

        const desc = (announcement.description || '').trim();
        if (desc) {
            const short = desc.length > 400 ? `${desc.slice(0, 400)}…` : desc;
            phrases.push(`Descriptif : ${short}`);
        }

        return phrases.join(' ');
    }

    ensureSpaceForFooter(doc, footerHeight, marginBottom) {
        const minY = doc.page.height - marginBottom - footerHeight;
        if (doc.y > minY - 12) {
            doc.addPage();
            doc.x = MARGIN;
            doc.y = MARGIN;
        }
    }

    writeFooter(doc, offer, footerHeight, marginBottom) {
        const footerStartY = doc.page.height - marginBottom - footerHeight;
        doc.moveTo(MARGIN, footerStartY).lineTo(doc.page.width - MARGIN, footerStartY).strokeColor('#000000').lineWidth(0.4).stroke();

        let y = footerStartY + 6;
        const w = doc.page.width - 2 * MARGIN;

        doc.font('Times-Bold').fontSize(7).fillColor('#000000').text('MENTIONS JURIDIQUES (RAPPEL)', MARGIN, y, { width: w, align: 'center' });
        y += 10;

        const blocks = [
            'Nature : accord de principe fixant les éléments essentiels (désignation du bien, prix). Peut constituer un contrat si les conditions de l’article 1108 du Code civil sont remplies.',
            'Force obligatoire : articles 1134 et suivants du Code civil — exécution de bonne foi.',
            'Propriété : articles 1582 et suivants du Code civil — la vente n’est définitive qu’après acte authentique notarié (articles 1588 et 1589).',
            'Écrit et signature électronique : articles 1366 et 1367 du Code civil.',
            'Les parties s’engagent à poursuivre les négociations de bonne foi en vue d’un compromis puis d’un acte authentique.',
        ];

        doc.font('Times-Roman').fontSize(5.5).fillColor('#222222');
        for (const t of blocks) {
            doc.text(t, MARGIN, y, { width: w, align: 'justify', lineGap: 1 });
            y += doc.heightOfString(t, { width: w, lineGap: 1 }) + 3;
        }

        doc.font('Times-Italic').fontSize(6).fillColor('#000000').text(`Référence dossier : ${offer.id}`, MARGIN, footerStartY + footerHeight - 10, { width: w, align: 'center' });
    }

    /**
     * @returns {Promise<string>}
     */
    async generateContractPDF(offer, announcement, signatures) {
        return new Promise((resolve, reject) => {
            try {
                const filename = `accord_principe_${offer.id}_${Date.now()}.pdf`;
                const filepath = path.join(this.pdfsDir, filename);
                const doc = new PDFDocument({
                    margin: MARGIN,
                    size: 'A4',
                    info: { Title: 'Accord de principe — ParcellePlus', Author: 'ParcellePlus' },
                });

                const stream = fs.createWriteStream(filepath);
                doc.pipe(stream);

                const buyerSignature = signatures.find((s) => s.signature_type === 'buyer');
                const sellerSignature = signatures.find((s) => s.signature_type === 'seller');

                const nbsp = (v, fallback = '________________________________________________') => {
                    const s = v != null && String(v).trim() !== '' ? String(v).trim() : '';
                    return s || fallback;
                };
                const formatDateNaissance = (raw) => {
                    if (raw == null || String(raw).trim() === '') return null;
                    const s = String(raw).trim();
                    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
                    return s;
                };

                const nomComplet = (sig) => {
                    if (!sig) return '';
                    const p = sig.prenom != null && String(sig.prenom).trim() ? String(sig.prenom).trim() : '';
                    const n = sig.nom != null && String(sig.nom).trim() ? String(sig.nom).trim() : '';
                    return [p, n].filter(Boolean).join(' ');
                };

                this.drawHeaderLogoAndTitle(doc);

                doc.font('Times-Roman').fontSize(10).fillColor('#000000');

                doc.text('ENTRE LES SOUSSIGNÉS,', { align: 'left' });
                doc.moveDown(0.6);

                doc.font('Times-Roman').text('D’une part :', { continued: false });
                doc.moveDown(0.25);
                doc.font('Times-Bold').text('Le Vendeur :');
                doc.font('Times-Roman');
                doc.text(`Nom : ${nbsp(nomComplet(sellerSignature))}`);
                doc.text(`Adresse : ${nbsp(sellerSignature && sellerSignature.adresse)}`);
                if (sellerSignature) {
                    doc.font('Times-Italic').fontSize(8.5).fillColor('#333333');
                    doc.text(
                        `Né(e) le : ${formatDateNaissance(sellerSignature.date_naissance) || '…………………………'} — E-mail : ${nbsp(sellerSignature.user_email)} — Compte : ${nbsp(sellerSignature.user_name)}`
                    );
                    doc.font('Times-Roman').fontSize(10).fillColor('#000000');
                }
                doc.moveDown(0.7);

                doc.text('Et d’autre part :', { continued: false });
                doc.moveDown(0.25);
                doc.font('Times-Bold').text('L’Acquéreur :');
                doc.font('Times-Roman');
                doc.text(`Nom : ${nbsp(nomComplet(buyerSignature))}`);
                doc.text(`Adresse : ${nbsp(buyerSignature && buyerSignature.adresse)}`);
                if (buyerSignature) {
                    doc.font('Times-Italic').fontSize(8.5).fillColor('#333333');
                    doc.text(
                        `Né(e) le : ${formatDateNaissance(buyerSignature.date_naissance) || '…………………………'} — E-mail : ${nbsp(buyerSignature.user_email)} — Compte : ${nbsp(buyerSignature.user_name)}`
                    );
                    doc.font('Times-Roman').fontSize(10).fillColor('#000000');
                }
                doc.moveDown(0.9);

                doc.font('Times-Bold').text('IL A ÉTÉ CONVENU CE QUI SUIT :', { align: 'center' });
                doc.moveDown(0.7);

                doc.font('Times-Bold').text('1. Objet');
                doc.font('Times-Roman').moveDown(0.25);
                doc.text(
                    'Le vendeur déclare son intention de vendre le bien immobilier désigné ci-après, sous réserve de la conclusion d’un compromis de vente puis d’un acte authentique de vente devant notaire.',
                    { align: 'justify', lineGap: 2 }
                );
                doc.moveDown(0.35);
                doc.font('Times-Roman').text('Désignation et situation du bien :', { continued: true });
                doc.font('Times-Bold').text(` ${this.buildBienAddressLine(announcement)}`, { lineGap: 2 });
                doc.font('Times-Roman');
                doc.moveDown(0.8);

                doc.font('Times-Bold').text('2. Désignation sommaire du bien');
                doc.font('Times-Roman').moveDown(0.25);
                doc.text(this.buildDesignationBien(announcement), { align: 'justify', lineGap: 2 });
                doc.moveDown(0.8);

                doc.font('Times-Bold').text('3. Prix');
                doc.font('Times-Roman').moveDown(0.25);
                doc.text(
                    `Le prix figurant dans l’annonce était de ${offer.original_price.toFixed(2)} €. Les parties conviennent d’un prix de ${offer.proposed_price.toFixed(2)} € (${(offer.proposed_price - offer.original_price).toFixed(2)} € par rapport au prix affiché).`,
                    { align: 'justify', lineGap: 2 }
                );
                if (offer.proposed_surface && offer.proposed_surface !== announcement.surface) {
                    doc.moveDown(0.3);
                    doc.text(
                        `Il est en outre fait mention d’une surface proposée de ${offer.proposed_surface.toFixed(2)} m², distincte de la surface initialement portée à l’annonce.`,
                        { align: 'justify', lineGap: 2 }
                    );
                }
                doc.moveDown(0.8);

                doc.font('Times-Bold').text('4. Suite à donner à l’accord');
                doc.font('Times-Roman').moveDown(0.25);
                doc.text(
                    'Les parties s’engagent à poursuivre de bonne foi les négociations en vue de la signature d’un compromis de vente, puis d’un acte authentique de vente. Elles reconnaissent que le présent accord ne vaut pas transfert de propriété et ne se substitue pas aux formalités notariées.',
                    { align: 'justify', lineGap: 2 }
                );
                doc.moveDown(0.8);

                doc.font('Times-Bold').text('5. Modalités de formation du présent écrit');
                doc.font('Times-Roman').moveDown(0.25);
                doc.text(
                    'Le présent document est établi à la suite de signatures électroniques recueillies sur l’application ParcellePlus, après identification des comptes et vérification des adresses de courrier électronique lorsque celle-ci a été effectuée.',
                    { align: 'justify', lineGap: 2 }
                );
                doc.moveDown(0.45);

                const writeSignAudit = (label, sig) => {
                    if (!sig) return;
                    doc.font('Times-Bold').fontSize(9).text(`${label}`);
                    doc.font('Times-Roman').fontSize(9);
                    const ev = sig.email_verified === 1 || sig.email_verified === '1';
                    doc.text(`E-mail vérifié avant signature : ${ev ? 'oui' : 'non'}.`);
                    if (sig.signature_timestamp) {
                        doc.text(`Date et heure (serveur) : ${new Date(sig.signature_timestamp).toLocaleString('fr-FR')}.`);
                    } else {
                        doc.text('Date et heure (serveur) : non renseignée.');
                    }
                    doc.moveDown(0.35);
                };
                writeSignAudit('Mentions relatives au vendeur', sellerSignature);
                writeSignAudit('Mentions relatives à l’acquéreur', buyerSignature);
                doc.font('Times-Roman').fontSize(10);
                doc.moveDown(0.4);

                if (offer.message) {
                    doc.font('Times-Bold').text('6. Déclarations complémentaires');
                    doc.font('Times-Roman').moveDown(0.25);
                    const msg = offer.message.length > 600 ? `${offer.message.slice(0, 600)}…` : offer.message;
                    doc.text(msg, { align: 'justify', lineGap: 2 });
                    doc.moveDown(0.6);
                }

                doc.font('Times-Roman').fontSize(9).fillColor('#000000');
                doc.text(`Fait sur la plateforme ParcellePlus, le ${new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' })}.`, {
                    align: 'left',
                    lineGap: 2,
                });
                doc.moveDown(0.5);
                doc.font('Times-Italic').fontSize(8).text(
                    'Les parties déclarent avoir pris connaissance des mentions juridiques figurant en pied de page.',
                    { lineGap: 2 }
                );

                const footerH = 118;
                const marginBot = 36;
                this.ensureSpaceForFooter(doc, footerH, marginBot);
                this.writeFooter(doc, offer, footerH, marginBot);

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
