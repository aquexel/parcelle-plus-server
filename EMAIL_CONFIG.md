# Configuration de l'envoi d'emails

Pour activer l'envoi d'emails de confirmation lors de l'inscription, vous devez configurer les variables d'environnement suivantes :

## Variables d'environnement requises

Créez un fichier `.env` à la racine du dossier `raspberry-pi-server` avec les variables suivantes :

```env
# Configuration SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-app

# URL de base de l'application (pour les liens de confirmation)
# Utiliser un domaine pour éviter d'exposer l'adresse IP
# L'application utilisera automatiquement le domaine si disponible
BASE_URL=https://parcelle-plus.fr
# Ou pour un sous-domaine API :
# BASE_URL=https://api.parcelle-plus.fr

# Alternative : utiliser DOMAIN_URL (prioritaire si défini)
# DOMAIN_URL=https://parcelle-plus.fr
```

## Configuration Gmail

Si vous utilisez Gmail :

1. Activez l'authentification à deux facteurs sur votre compte Gmail
2. Générez un "Mot de passe d'application" :
   - Allez dans les paramètres de votre compte Google
   - Sécurité → Validation en 2 étapes → Mots de passe des applications
   - Créez un nouveau mot de passe d'application
   - Utilisez ce mot de passe dans `SMTP_PASS` (pas votre mot de passe Gmail normal)

## Autres fournisseurs SMTP

### Outlook/Hotmail
```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=votre-email@outlook.com
SMTP_PASS=votre-mot-de-passe
```

### SendGrid
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=votre-api-key-sendgrid
```

### Mailgun
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@votre-domaine.mailgun.org
SMTP_PASS=votre-mot-de-passe-mailgun
```

## Installation des dépendances

Assurez-vous d'avoir installé les packages Node.js nécessaires :

```bash
npm install nodemailer bcryptjs
```

## Test de l'envoi d'email

L'envoi d'email est non-bloquant : si l'email ne peut pas être envoyé, l'inscription réussit quand même. L'utilisateur pourra demander un renvoi de l'email de confirmation plus tard.

## Routes API

- `POST /api/auth/register` - Inscription (envoie automatiquement l'email de confirmation)
- `GET /api/auth/verify-email?token=XXX` - Vérification de l'email via le token
- `POST /api/auth/resend-verification` - Renvoyer l'email de confirmation

