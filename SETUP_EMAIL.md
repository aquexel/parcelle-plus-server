# Configuration Email pour ParcellePlus

## Domaine : parcelle-plus.fr

### Option 1 : Utiliser OVH (si le domaine est chez OVH)

1. **Créer une adresse email** :
   - Connectez-vous à votre espace OVH
   - Allez dans "Emails" → "Créer une adresse email"
   - Créez : `noreply@parcelle-plus.fr`
   - Définissez un mot de passe sécurisé

2. **Configuration sur le serveur** :
```bash
cd /opt/parcelle-plus

# Créer le fichier .env
cat > .env << EOF
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=587
SMTP_USER=noreply@parcelle-plus.fr
SMTP_PASS=votre-mot-de-passe-ovh
BASE_URL=http://149.202.33.164:3000
EOF

# Installer dotenv
npm install

# Redémarrer PM2
pm2 restart parcelle-plus
pm2 save
```

### Option 2 : Utiliser Zoho Mail (Gratuit)

1. **Créer un compte** :
   - Allez sur https://www.zoho.com/mail/
   - Créez un compte gratuit
   - Ajoutez votre domaine `parcelle-plus.fr`
   - Vérifiez le domaine (ajout de records DNS)
   - Créez `noreply@parcelle-plus.fr`

2. **Configuration sur le serveur** :
```bash
cd /opt/parcelle-plus

cat > .env << EOF
SMTP_HOST=smtp.zoho.com
SMTP_PORT=587
SMTP_USER=noreply@parcelle-plus.fr
SMTP_PASS=votre-mot-de-passe-zoho
BASE_URL=http://149.202.33.164:3000
EOF

npm install
pm2 restart parcelle-plus
```

### Option 3 : Utiliser Gmail Workspace (Payant ~6€/mois)

1. **Créer un compte Gmail Workspace** :
   - Allez sur https://workspace.google.com/
   - Créez un compte pour `parcelle-plus.fr`
   - Créez `noreply@parcelle-plus.fr`

2. **Créer un mot de passe d'application** :
   - Allez sur https://myaccount.google.com/apppasswords
   - Créez un mot de passe d'application pour "Mail"
   - Copiez le mot de passe (16 caractères)

3. **Configuration sur le serveur** :
```bash
cd /opt/parcelle-plus

cat > .env << EOF
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@parcelle-plus.fr
SMTP_PASS=votre-mot-de-passe-app-16-caracteres
BASE_URL=http://149.202.33.164:3000
EOF

npm install
pm2 restart parcelle-plus
```

## Vérification

Pour tester que l'email fonctionne :

1. **Créer un compte utilisateur** via l'API ou l'application
2. **Vérifier les logs** :
```bash
pm2 logs parcelle-plus | grep -i email
```

3. **Vérifier que l'email est envoyé** :
   - Vous devriez voir : `✅ Email de confirmation envoyé à ...`
   - L'utilisateur devrait recevoir un email depuis `noreply@parcelle-plus.fr`

## Important

- Le fichier `.env` ne doit **PAS** être commité dans Git (il est dans `.gitignore`)
- Gardez le mot de passe SMTP sécurisé
- Pour la production, utilisez `BASE_URL=https://parcelle-plus.fr` (si vous avez un certificat SSL)

## En cas de problème

Si l'email ne fonctionne pas :
- Vérifiez les logs : `pm2 logs parcelle-plus`
- Vérifiez que le fichier `.env` existe et contient les bonnes valeurs
- Testez la connexion SMTP manuellement
- L'inscription fonctionnera même si l'email échoue (non bloquant)

