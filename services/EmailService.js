const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Logo PNG en base64 (généré depuis app_logo.svg)
// Pour régénérer : ouvrir raspberry-pi-server/scripts/create-png-base64.html dans un navigateur
const LOGO_PNG_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

class EmailService {
    constructor() {
        // Configuration SMTP (à adapter selon votre fournisseur d'email)
        // Pour Gmail, utilisez un "App Password" au lieu du mot de passe normal
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false, // true pour 465, false pour autres ports
            auth: {
                user: process.env.SMTP_USER || 'votre-email@gmail.com',
                pass: process.env.SMTP_PASS || 'votre-mot-de-passe-app'
            }
        });
        
        // URL de base de l'application (pour les liens de confirmation)
        // Utiliser l'IP avec le port si configuré, sinon le domaine
        this.baseUrl = process.env.BASE_URL || process.env.DOMAIN_URL || 'http://149.202.33.164:3000';
        
        // Si BASE_URL n'est pas configuré et qu'on utilise l'IP par défaut, l'utiliser telle quelle
        if (!process.env.BASE_URL && !process.env.DOMAIN_URL) {
        }
    }
    
    /**
     * Génère un token de confirmation d'email
     */
    generateVerificationToken() {
        return crypto.randomBytes(32).toString('hex');
    }
    
    /**
     * Envoie un email de confirmation d'inscription
     */
    async sendVerificationEmail(email, username, verificationToken) {
        try {
            // Utiliser un deep link Android pour ouvrir directement l'app (ne révèle pas l'IP)
            const deepLinkUrl = `parcelleplus://verify-email?token=${verificationToken}`;
            // URL web de secours (utilise toujours le domaine, pas l'IP)
            const webUrl = `${this.baseUrl}/api/auth/verify-email?token=${verificationToken}`;
            
            const mailOptions = {
                from: `"ParcellePlus" <${process.env.SMTP_USER || 'noreply@parcelle-plus.fr'}>`,
                to: email,
                subject: 'Confirmez votre adresse email - ParcellePlus',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #2196F3 0%, #42A5F5 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                            .logo { width: 80px; height: 80px; margin: 0 auto 15px; display: block; }
                            .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                            .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <img src="${LOGO_PNG_BASE64}" alt="ParcellePlus Logo" class="logo" />
                                <h1>ParcellePlus</h1>
                            </div>
                            <div class="content">
                                <h2>Bienvenue ${username} !</h2>
                                <p>Merci de vous être inscrit sur ParcellePlus.</p>
                                <p>Pour activer votre compte, veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous :</p>
                                <div style="text-align: center;">
                                    <a href="${deepLinkUrl}" class="button">Confirmer mon email</a>
                                </div>
                                <p><small>Si l'application ParcellePlus est installée sur votre appareil, le lien s'ouvrira automatiquement dans l'app.</small></p>
                                <p>Ou copiez-collez ce lien dans votre navigateur :</p>
                                <p style="word-break: break-all; color: #2196F3;">${webUrl}</p>
                                <p><strong>Ce lien expire dans 24 heures.</strong></p>
                                <p>Si vous n'avez pas créé de compte sur ParcellePlus, vous pouvez ignorer cet email.</p>
                            </div>
                            <div class="footer">
                                <p>© ${new Date().getFullYear()} ParcellePlus - Tous droits réservés</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `,
                text: `
                    Bienvenue ${username} !
                    
                    Merci de vous être inscrit sur ParcellePlus.
                    
                    Pour activer votre compte, veuillez confirmer votre adresse email en visitant ce lien :
                    ${webUrl}
                    
                    Si l'application ParcellePlus est installée, vous pouvez également utiliser le lien depuis l'app.
                    
                    Ce lien expire dans 24 heures.
                    
                    Si vous n'avez pas créé de compte sur ParcellePlus, vous pouvez ignorer cet email.
                `
            };
            
            const info = await this.transporter.sendMail(mailOptions);
            return true;
        } catch (error) {
            console.error(`❌ Erreur envoi email à ${email}:`, error.message);
            // Ne pas faire échouer l'inscription si l'email échoue
            // L'utilisateur pourra demander un nouvel email plus tard
            return false;
        }
    }
    
    /**
     * Envoie un email de réinitialisation de mot de passe
     */
    async sendPasswordResetEmail(email, username, resetToken) {
        try {
            // Utiliser un deep link Android pour ouvrir directement l'app (ne révèle pas l'IP)
            const resetUrl = `parcelleplus://reset-password?token=${resetToken}`;
            // URL web de secours (utilise toujours le domaine, pas l'IP)
            const webUrl = `${this.baseUrl}/api/auth/reset-password?token=${resetToken}`;
            
            const mailOptions = {
                from: `"ParcellePlus" <${process.env.SMTP_USER || 'noreply@parcelle-plus.fr'}>`,
                to: email,
                subject: 'Réinitialisation de votre mot de passe - ParcellePlus',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #2196F3 0%, #42A5F5 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                            .logo { width: 80px; height: 80px; margin: 0 auto 15px; display: block; }
                            .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                            .button { display: inline-block; background: #FF9800; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <img src="${LOGO_PNG_BASE64}" alt="ParcellePlus Logo" class="logo" />
                                <h1>ParcellePlus</h1>
                            </div>
                            <div class="content">
                                <h2>Réinitialisation de mot de passe</h2>
                                <p>Bonjour ${username},</p>
                                <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
                                <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
                                <div style="text-align: center;">
                                    <a href="${webUrl}" class="button">Réinitialiser mon mot de passe</a>
                                </div>
                                <p>Ou copiez-collez ce lien dans votre navigateur :</p>
                                <p style="word-break: break-all; color: #2196F3;">${webUrl}</p>
                                <p><small>Si l'application ParcellePlus est installée sur votre appareil, le lien s'ouvrira automatiquement dans l'app.</small></p>
                                <p><strong>Ce lien expire dans 1 heure.</strong></p>
                                <p>Si vous n'avez pas demandé de réinitialisation, ignorez cet email.</p>
                            </div>
                            <div class="footer">
                                <p>© ${new Date().getFullYear()} ParcellePlus - Tous droits réservés</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };
            
            const info = await this.transporter.sendMail(mailOptions);
            return true;
        } catch (error) {
            console.error(`❌ Erreur envoi email de réinitialisation à ${email}:`, error.message);
            return false;
        }
    }
    
    /**
     * Envoie un email de vérification pour signature électronique
     */
    async sendSignatureVerificationEmail(email, userName, offerId, verificationToken) {
        try {
            // Utiliser un lien web qui redirige vers le deep link Android
            // Cela fonctionne mieux dans les emails que le deep link direct
            const webUrl = `${this.baseUrl}/api/offers/${offerId}/verify-signature-email?token=${verificationToken}`;
            
            const mailOptions = {
                from: `"ParcellePlus" <${process.env.SMTP_USER || 'noreply@parcelle-plus.fr'}>`,
                to: email,
                subject: 'Vérification email pour signature électronique - ParcellePlus',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                            .logo { width: 80px; height: 80px; margin: 0 auto 15px; display: block; }
                            .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                            .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <img src="${LOGO_PNG_BASE64}" alt="ParcellePlus Logo" class="logo" />
                                <h1>ParcellePlus</h1>
                            </div>
                            <div class="content">
                                <h2>Vérification d'email pour signature</h2>
                                <p>Bonjour ${userName},</p>
                                <p>Vous avez demandé à signer électroniquement une proposition sur ParcellePlus.</p>
                                <p>Pour confirmer votre adresse email et procéder à la signature, veuillez cliquer sur le bouton ci-dessous :</p>
                                <div style="text-align: center;">
                                    <a href="${webUrl}" class="button" style="display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Vérifier mon email</a>
                                </div>
                                <p><small>Si l'application ParcellePlus est installée sur votre appareil, le lien s'ouvrira automatiquement dans l'app.</small></p>
                                <p>Ou copiez-collez ce lien dans votre navigateur :</p>
                                <p style="word-break: break-all; color: #2196F3;">${webUrl}</p>
                                <p><strong>Ce lien expire dans 1 heure.</strong></p>
                                <p>Si vous n'avez pas demandé cette vérification, ignorez cet email.</p>
                            </div>
                            <div class="footer">
                                <p>© ${new Date().getFullYear()} ParcellePlus - Tous droits réservés</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `,
                text: `
                    Bonjour ${userName},
                    
                    Vous avez demandé à signer électroniquement une proposition sur ParcellePlus.
                    
                    Pour confirmer votre adresse email et procéder à la signature, veuillez visiter ce lien :
                    ${webUrl}
                    
                    Si l'application ParcellePlus est installée, vous pouvez également utiliser le lien depuis l'app.
                    
                    Ce lien expire dans 1 heure.
                    
                    Si vous n'avez pas demandé cette vérification, ignorez cet email.
                `
            };
            
            const info = await this.transporter.sendMail(mailOptions);
            return true;
        } catch (error) {
            console.error(`❌ Erreur envoi email vérification signature à ${email}:`, error.message);
            return false;
        }
    }
}

module.exports = EmailService;

