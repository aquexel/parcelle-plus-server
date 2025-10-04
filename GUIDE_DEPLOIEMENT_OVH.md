# 🚀 Guide de Déploiement OVH - ParcellePlus

## 📋 Prérequis

### 1. Commande du serveur OVH
- **Recommandé** : VPS Value (6-8€/mois)
- **OS** : Ubuntu 22.04 LTS
- **Région** : France (Gravelines ou Strasbourg)

### 2. Nom de domaine (optionnel mais recommandé)
- Chez OVH ou autre registrar
- Exemple : `parcelle-plus.votre-domaine.com`

## 🛠️ Installation Automatique

### Étape 1 : Connexion au serveur
```bash
# Connexion à votre serveur OVH
ssh ubuntu@149.202.33.164
```

### Étape 2 : Téléchargement et déploiement
```bash
# Cloner le projet
git clone https://github.com/aquexel/parcelle-plus-server.git
cd parcelle-plus-server

# Rendre le script exécutable
chmod +x deploy-ovh.sh

# Lancer le déploiement automatique
./deploy-ovh.sh
```

**⏱️ Durée estimée : 5-10 minutes**

## 🔧 Configuration Post-Installation

### 1. Configuration du domaine (si vous en avez un)
```bash
# Modifier la configuration Nginx
nano /etc/nginx/sites-available/parcelle-plus

# Remplacer "server_name _;" par "server_name votre-domaine.com;"
# Puis redémarrer Nginx
systemctl restart nginx

# Installer le certificat SSL gratuit
certbot --nginx -d votre-domaine.com
```

### 2. Test de l'installation
```bash
# Vérifier que l'API fonctionne
curl http://localhost:3000/api/health

# Vérifier le status PM2
sudo -u parcelle pm2 status

# Voir les logs
sudo -u parcelle pm2 logs parcelle-plus
```

## 📱 Mise à jour de l'application Android

### Modifier l'URL dans ParcellePlusApiService.kt
```kotlin
companion object {
    // Remplacez par votre domaine ou IP
    private const val PRODUCTION_BASE_URL = "https://votre-domaine.com"
    // Ou si pas de domaine : "http://149.202.33.164"
}
```

## 🔄 Commandes de Gestion

### Gestion de l'application
```bash
# Redémarrer l'application
sudo -u parcelle pm2 restart parcelle-plus

# Voir les logs en temps réel
sudo -u parcelle pm2 logs parcelle-plus --lines 50

# Arrêter l'application
sudo -u parcelle pm2 stop parcelle-plus

# Démarrer l'application
sudo -u parcelle pm2 start parcelle-plus
```

### Gestion du serveur
```bash
# Redémarrer Nginx
systemctl restart nginx

# Voir les logs Nginx
tail -f /var/log/nginx/parcelle-plus_access.log
tail -f /var/log/nginx/parcelle-plus_error.log

# Vérifier l'état du pare-feu
ufw status
```

### Sauvegarde
```bash
# Sauvegarde manuelle
/usr/local/bin/backup-parcelle.sh

# Voir les sauvegardes
ls -la /backup/parcelle-plus/

# Restaurer une sauvegarde de base de données
sqlite3 /opt/parcelle-plus/database/parcelle_chat.db ".restore /backup/parcelle-plus/db_YYYYMMDD_HHMMSS.db"
```

## 🔒 Sécurité

### Changement du mot de passe root
```bash
passwd root
```

### Configuration SSH (recommandé)
```bash
# Créer un utilisateur admin
adduser admin
usermod -aG sudo admin

# Désactiver la connexion root SSH (après avoir testé avec l'utilisateur admin)
nano /etc/ssh/sshd_config
# Modifier : PermitRootLogin no
systemctl restart ssh
```

### Surveillance des logs
```bash
# Voir les tentatives de connexion
tail -f /var/log/auth.log

# Voir les bans Fail2Ban
fail2ban-client status sshd
```

## 📊 Monitoring

### Ressources système
```bash
# CPU et mémoire
htop

# Espace disque
df -h

# Processus Node.js
ps aux | grep node
```

### Performance de l'application
```bash
# Statistiques PM2
sudo -u parcelle pm2 monit

# Logs détaillés
sudo -u parcelle pm2 logs parcelle-plus --timestamp
```

## 🆘 Dépannage

### L'application ne démarre pas
```bash
# Vérifier les logs PM2
sudo -u parcelle pm2 logs parcelle-plus

# Vérifier la base de données
ls -la /opt/parcelle-plus/database/

# Recréer la base de données si nécessaire
cd /opt/parcelle-plus
sudo -u parcelle node create_clean_db.js
```

### Nginx ne fonctionne pas
```bash
# Tester la configuration
nginx -t

# Voir les logs d'erreur
tail -f /var/log/nginx/error.log

# Redémarrer Nginx
systemctl restart nginx
```

### Problème de certificat SSL
```bash
# Renouveler le certificat
certbot renew

# Tester le renouvellement
certbot renew --dry-run
```

## 📈 Mise à jour de l'application

### Mise à jour du code
```bash
cd /opt/parcelle-plus
git pull origin main
sudo -u parcelle npm install --production
sudo -u parcelle pm2 restart parcelle-plus
```

### Mise à jour du système
```bash
apt update && apt upgrade -y
systemctl restart nginx
```

## 💰 Coûts estimés

- **VPS Value OVH** : ~6-8€/mois
- **Nom de domaine** : ~10€/an (optionnel)
- **Certificat SSL** : Gratuit (Let's Encrypt)

**Total : ~6-8€/mois + domaine**

## 📞 Support

En cas de problème :
1. Vérifiez les logs : `sudo -u parcelle pm2 logs parcelle-plus`
2. Vérifiez Nginx : `tail -f /var/log/nginx/parcelle-plus_error.log`
3. Vérifiez l'état des services : `systemctl status nginx`

---

**🎉 Félicitations ! Votre serveur ParcellePlus est maintenant hébergé de manière professionnelle sur OVH !**


