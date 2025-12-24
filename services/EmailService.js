const crypto = require('crypto');
const nodemailer = require('nodemailer');

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
        // Utiliser le domaine si disponible, sinon utiliser BASE_URL ou localhost
        this.baseUrl = process.env.BASE_URL || process.env.DOMAIN_URL || 'https://parcelle-plus.fr';
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
            // URL web de secours (utiliser le domaine si disponible, sinon BASE_URL)
            const webUrl = this.baseUrl.includes('://') && !this.baseUrl.match(/^\d+\.\d+\.\d+\.\d+/) 
                ? `${this.baseUrl}/api/auth/verify-email?token=${verificationToken}`
                : `https://parcelle-plus.fr/api/auth/verify-email?token=${verificationToken}`;
            
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
                            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                            .button { display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>🏠 ParcellePlus</h1>
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
            console.log(`✅ Email de confirmation envoyé à ${email}:`, info.messageId);
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
            // Utiliser un deep link Android pour ouvrir directement l'app
            const resetUrl = `parcelleplus://reset-password?token=${resetToken}`;
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
                            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                            .button { display: inline-block; background: #FF9800; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>🏠 ParcellePlus</h1>
                            </div>
                            <div class="content">
                                <h2>Réinitialisation de mot de passe</h2>
                                <p>Bonjour ${username},</p>
                                <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
                                <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
                                <div style="text-align: center;">
                                    <a href="${resetUrl}" class="button">Réinitialiser mon mot de passe</a>
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
            console.log(`✅ Email de réinitialisation envoyé à ${email}:`, info.messageId);
            return true;
        } catch (error) {
            console.error(`❌ Erreur envoi email de réinitialisation à ${email}:`, error.message);
            return false;
        }
    }
}

module.exports = EmailService;

