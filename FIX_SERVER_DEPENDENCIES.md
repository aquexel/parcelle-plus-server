# Correction de l'erreur MODULE_NOT_FOUND sur le serveur

## Problème
Le serveur redémarre en boucle avec l'erreur :
```
Error: Cannot find module 'bcryptjs'
```

## Solution

### 1. Se connecter au serveur
```bash
ssh ubuntu@149.202.33.164
```

### 2. Aller dans le répertoire du serveur
```bash
cd /opt/parcelle-plus
```

### 3. Vérifier que package.json est présent
```bash
ls -la package.json
```

Si le fichier n'existe pas, le créer ou le récupérer depuis GitHub :
```bash
# Option 1: Récupérer depuis GitHub
git pull origin main

# Option 2: Créer le fichier manuellement (voir contenu ci-dessous)
```

### 4. Installer les dépendances
```bash
npm install
```

Cela installera toutes les dépendances nécessaires :
- `bcryptjs` (pour le hachage des mots de passe)
- `nodemailer` (pour l'envoi d'emails)
- `express`, `cors`, `morgan` (serveur web)
- `ws` (WebSocket)
- `better-sqlite3` (base de données)
- `uuid` (génération d'identifiants)
- `csv-parser` (traitement CSV)

### 5. Redémarrer le serveur avec PM2
```bash
pm2 restart parcelle-plus
```

### 6. Vérifier les logs
```bash
pm2 logs parcelle-plus --lines 50
```

Le serveur devrait maintenant démarrer correctement.

## Vérification

Pour vérifier que toutes les dépendances sont installées :
```bash
cd /opt/parcelle-plus
npm list --depth=0
```

Vous devriez voir :
- bcryptjs
- nodemailer
- express
- cors
- morgan
- uuid
- ws
- better-sqlite3
- csv-parser

## Si l'erreur persiste

1. Vérifier que Node.js est à jour :
```bash
node --version  # Doit être >= 18.0.0
```

2. Nettoyer et réinstaller :
```bash
cd /opt/parcelle-plus
rm -rf node_modules package-lock.json
npm install
pm2 restart parcelle-plus
```

3. Vérifier les permissions :
```bash
ls -la /opt/parcelle-plus
chown -R ubuntu:ubuntu /opt/parcelle-plus
```

