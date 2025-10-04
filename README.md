# 🏠 ParcellePlus Server

Serveur backend pour l'application mobile ParcellePlus - Plateforme de gestion immobilière.

## 🚀 Déploiement Rapide sur OVH

### Installation Automatique
```bash
# Connexion au serveur
ssh ubuntu@149.202.33.164

# Clonage et déploiement
git clone https://github.com/aquexel/parcelle-plus-server.git
cd parcelle-plus-server
chmod +x deploy-ovh.sh
sudo ./deploy-ovh.sh
```

**⏱️ Temps d'installation : 5-10 minutes**

## 📋 Fonctionnalités

- ✅ **API REST** complète pour l'application mobile
- ✅ **Authentification** utilisateur sécurisée
- ✅ **Gestion des annonces** immobilières
- ✅ **Messagerie** intégrée
- ✅ **Base de données SQLite** performante
- ✅ **Sécurité** renforcée (Rate limiting, CORS, Helmet)
- ✅ **SSL gratuit** avec Let's Encrypt
- ✅ **Sauvegarde automatique** quotidienne
- ✅ **Monitoring** et logs détaillés

## 🛠️ Technologies

- **Backend** : Node.js + Express.js
- **Base de données** : SQLite3
- **Process Manager** : PM2
- **Reverse Proxy** : Nginx
- **Sécurité** : Fail2Ban, UFW, Helmet
- **SSL** : Let's Encrypt (Certbot)

## 📖 Documentation

- [Guide de Déploiement Complet](./GUIDE_DEPLOIEMENT_OVH.md)
- [API Documentation](#api-endpoints)

## 🔧 API Endpoints

### Authentification
- `POST /api/auth/register` - Inscription utilisateur
- `POST /api/auth/login` - Connexion utilisateur

### Annonces (Polygones)
- `GET /api/polygons/user/:userId` - Annonces d'un utilisateur
- `GET /api/polygons/public` - Annonces publiques
- `POST /api/polygons` - Créer une annonce

### Messagerie
- `GET /api/messages/:roomId` - Messages d'une conversation
- `POST /api/messages` - Envoyer un message

### Système
- `GET /api/health` - État du serveur

## 🔄 Gestion du Serveur

### Commandes PM2
```bash
# Status de l'application
sudo -u parcelle pm2 status

# Logs en temps réel
sudo -u parcelle pm2 logs parcelle-plus

# Redémarrer l'application
sudo -u parcelle pm2 restart parcelle-plus

# Arrêter l'application
sudo -u parcelle pm2 stop parcelle-plus
```

### Mise à jour
```bash
cd /opt/parcelle-plus
sudo ./update-server.sh
```

### Sauvegarde
```bash
# Sauvegarde manuelle
sudo /usr/local/bin/backup-parcelle.sh

# Les sauvegardes automatiques se font à 2h du matin
```

## 🔒 Sécurité

- **Rate Limiting** : 100 req/15min (5 pour auth)
- **CORS** configuré pour les domaines autorisés
- **Helmet** pour les headers de sécurité
- **Fail2Ban** contre les attaques par force brute
- **UFW Firewall** configuré (SSH + HTTP/HTTPS)
- **SSL/TLS** avec certificats Let's Encrypt

## 📊 Monitoring

### Logs
- **Application** : `sudo -u parcelle pm2 logs parcelle-plus`
- **Nginx** : `tail -f /var/log/nginx/parcelle-plus_*.log`
- **Système** : `tail -f /var/log/syslog`

### Ressources
```bash
# CPU et mémoire
htop

# Espace disque
df -h

# Processus
ps aux | grep node
```

## 🆘 Dépannage

### L'application ne démarre pas
```bash
# Vérifier les logs
sudo -u parcelle pm2 logs parcelle-plus

# Recréer la base de données
cd /opt/parcelle-plus
sudo -u parcelle node create_clean_db.js
```

### Problème Nginx
```bash
# Tester la configuration
sudo nginx -t

# Redémarrer Nginx
sudo systemctl restart nginx
```

### Certificat SSL
```bash
# Renouveler le certificat
sudo certbot renew

# Test de renouvellement
sudo certbot renew --dry-run
```

## 📞 Support

- **Repository** : [GitHub Issues](https://github.com/aquexel/parcelle-plus-server/issues)
- **Documentation** : [Guide Complet](./GUIDE_DEPLOIEMENT_OVH.md)

## 📄 Licence

MIT License - Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

**🎉 Serveur ParcellePlus - Hébergement professionnel sur OVH**