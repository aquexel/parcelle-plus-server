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
        // Utiliser le domaine pour éviter d'exposer l'adresse IP
        // Par défaut, utiliser le domaine parcelle-plus.fr
        this.baseUrl = process.env.BASE_URL || process.env.DOMAIN_URL || 'https://parcelle-plus.fr';
        
        // Si BASE_URL contient une IP (format http://IP:port), utiliser le domaine par défaut
        if (this.baseUrl.match(/^https?:\/\/\d+\.\d+\.\d+\.\d+/)) {
            console.log('⚠️ BASE_URL contient une adresse IP, utilisation du domaine par défaut pour les emails');
            this.baseUrl = 'https://parcelle-plus.fr';
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
                                <img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4NCjxzdmcgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHZpZXdCb3g9IjAgMCAxMDggMTA4IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPg0KICAgIDwhLS0gRm9uZCBkw6lncmFkw6kgdmVydCBjbGFpciAtLT4NCiAgICA8ZGVmcz4NCiAgICAgICAgPHJhZGlhbEdyYWRpZW50IGlkPSJiZ0dyYWRpZW50IiBjeD0iNTAlIiBjeT0iNTAlIiByPSI1NSUiPg0KICAgICAgICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6I0U4RjVFODtzdG9wLW9wYWNpdHk6MSIgLz4NCiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6I0YxRjhFOTtzdG9wLW9wYWNpdHk6MSIgLz4NCiAgICAgICAgPC9yYWRpYWxHcmFkaWVudD4NCiAgICA8L2RlZnM+DQogICAgDQogICAgPCEtLSBGb25kIC0tPg0KICAgIDxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiBmaWxsPSJ1cmwoI2JnR3JhZGllbnQpIi8+DQogICAgDQogICAgPCEtLSBNb3RpZnMgZGUgcGFyY2VsbGVzIHN1YnRpbHMgLS0+DQogICAgPHJlY3QgeD0iMjAiIHk9IjIwIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzRDQUY1MCIgc3Ryb2tlLXdpZHRoPSIwLjUiIG9wYWNpdHk9IjAuMSIvPg0KICAgIDxyZWN0IHg9IjY4IiB5PSI2OCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSJub25lIiBzdHJva2U9IiM0Q0FGNTAiIHN0cm9rZS13aWR0aD0iMC41IiBvcGFjaXR5PSIwLjEiLz4NCiAgICANCiAgICA8IS0tIENlcmNsZSBleHTDqXJpZXVyIGdyaXMgZm9uY8OpIC0tPg0KICAgIDxjaXJjbGUgY3g9IjU0IiBjeT0iNTQiIHI9IjQ1IiBmaWxsPSJub25lIiBzdHJva2U9IiM0MjQyNDIiIHN0cm9rZS13aWR0aD0iNiIvPg0KICAgIA0KICAgIDwhLS0gQ29udG91ciBibGFuYyAtLT4NCiAgICA8Y2lyY2xlIGN4PSI1NCIgY3k9IjU0IiByPSI0MiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjMiLz4NCiAgICANCiAgICA8IS0tIENlcmNsZSBwcmluY2lwYWwgdmVydCAtLT4NCiAgICA8Y2lyY2xlIGN4PSI1NCIgY3k9IjU0IiByPSI0MCIgZmlsbD0iIzRDQUY1MCIvPg0KICAgIA0KICAgIDwhLS0gU2lnbmUgIisiIGVuIGJsYW5jIGF1IGNlbnRyZSAtLT4NCiAgICA8cGF0aCBkPSJNNTAsNDIgTDU4LDQyIEw1OCw1MCBMNjYsNTAgTDY2LDU4IEw1OCw1OCBMNTgsNjYgTDUwLDY2IEw1MCw1OCBMNDIsNTggTDQyLDUwIEw1MCw1MCBaIiBmaWxsPSIjRkZGRkZGIi8+DQogICAgDQogICAgPCEtLSBCb3JkdXJlIGR1IGNlcmNsZSB2ZXJ0IC0tPg0KICAgIDxjaXJjbGUgY3g9IjU0IiBjeT0iNTQiIHI9IjQwIiBmaWxsPSJub25lIiBzdHJva2U9IiMyRTdEMzIiIHN0cm9rZS13aWR0aD0iMiIvPg0KPC9zdmc+DQoNCg0KDQoNCg0K" alt="ParcellePlus Logo" class="logo" />
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
                                <img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4NCjxzdmcgd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiIHZpZXdCb3g9IjAgMCAxMDggMTA4IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPg0KICAgIDwhLS0gRm9uZCBkw6lncmFkw6kgdmVydCBjbGFpciAtLT4NCiAgICA8ZGVmcz4NCiAgICAgICAgPHJhZGlhbEdyYWRpZW50IGlkPSJiZ0dyYWRpZW50IiBjeD0iNTAlIiBjeT0iNTAlIiByPSI1NSUiPg0KICAgICAgICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6I0U4RjVFODtzdG9wLW9wYWNpdHk6MSIgLz4NCiAgICAgICAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6I0YxRjhFOTtzdG9wLW9wYWNpdHk6MSIgLz4NCiAgICAgICAgPC9yYWRpYWxHcmFkaWVudD4NCiAgICA8L2RlZnM+DQogICAgDQogICAgPCEtLSBGb25kIC0tPg0KICAgIDxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiBmaWxsPSJ1cmwoI2JnR3JhZGllbnQpIi8+DQogICAgDQogICAgPCEtLSBNb3RpZnMgZGUgcGFyY2VsbGVzIHN1YnRpbHMgLS0+DQogICAgPHJlY3QgeD0iMjAiIHk9IjIwIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzRDQUY1MCIgc3Ryb2tlLXdpZHRoPSIwLjUiIG9wYWNpdHk9IjAuMSIvPg0KICAgIDxyZWN0IHg9IjY4IiB5PSI2OCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSJub25lIiBzdHJva2U9IiM0Q0FGNTAiIHN0cm9rZS13aWR0aD0iMC41IiBvcGFjaXR5PSIwLjEiLz4NCiAgICANCiAgICA8IS0tIENlcmNsZSBleHTDqXJpZXVyIGdyaXMgZm9uY8OpIC0tPg0KICAgIDxjaXJjbGUgY3g9IjU0IiBjeT0iNTQiIHI9IjQ1IiBmaWxsPSJub25lIiBzdHJva2U9IiM0MjQyNDIiIHN0cm9rZS13aWR0aD0iNiIvPg0KICAgIA0KICAgIDwhLS0gQ29udG91ciBibGFuYyAtLT4NCiAgICA8Y2lyY2xlIGN4PSI1NCIgY3k9IjU0IiByPSI0MiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjMiLz4NCiAgICANCiAgICA8IS0tIENlcmNsZSBwcmluY2lwYWwgdmVydCAtLT4NCiAgICA8Y2lyY2xlIGN4PSI1NCIgY3k9IjU0IiByPSI0MCIgZmlsbD0iIzRDQUY1MCIvPg0KICAgIA0KICAgIDwhLS0gU2lnbmUgIisiIGVuIGJsYW5jIGF1IGNlbnRyZSAtLT4NCiAgICA8cGF0aCBkPSJNNTAsNDIgTDU4LDQyIEw1OCw1MCBMNjYsNTAgTDY2LDU4IEw1OCw1OCBMNTgsNjYgTDUwLDY2IEw1MCw1OCBMNDIsNTggTDQyLDUwIEw1MCw1MCBaIiBmaWxsPSIjRkZGRkZGIi8+DQogICAgDQogICAgPCEtLSBCb3JkdXJlIGR1IGNlcmNsZSB2ZXJ0IC0tPg0KICAgIDxjaXJjbGUgY3g9IjU0IiBjeT0iNTQiIHI9IjQwIiBmaWxsPSJub25lIiBzdHJva2U9IiMyRTdEMzIiIHN0cm9rZS13aWR0aD0iMiIvPg0KPC9zdmc+DQoNCg0KDQoNCg0K" alt="ParcellePlus Logo" class="logo" />
                                <h1>ParcellePlus</h1>
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

