# 🚀 Commandes Serveur OVH - Déploiement DPE

## 📋 Prérequis
- Serveur OVH : `149.202.33.164`
- Accès SSH configuré
- Git installé sur le serveur

---

## 🔧 Déploiement Initial

### 1️⃣ Connexion SSH au serveur
```bash
ssh utilisateur@149.202.33.164
```

### 2️⃣ Navigation vers le dossier du projet
```bash
cd /chemin/vers/parcelle-plus-server
```

### 3️⃣ Pull des dernières modifications GitHub
```bash
git pull origin main
```

### 4️⃣ Installation des dépendances Node.js (si nouvelles)
```bash
npm install
```

### 5️⃣ Rendre les scripts exécutables
```bash
chmod +x download-bdnb-data.sh
chmod +x update-dpe-database.sh
chmod +x setup-dpe-cron.sh
chmod +x deploy-dpe-ovh.sh
```

### 6️⃣ Lancer le déploiement complet
```bash
bash deploy-dpe-ovh.sh
```
**⏱️ Durée estimée :** 15-30 minutes (téléchargement + traitement)

### 7️⃣ Redémarrer PM2
```bash
pm2 restart parcelle-plus-server
pm2 save
```

### 8️⃣ Vérifier les logs
```bash
pm2 logs parcelle-plus-server --lines 50
```

---

## 🔄 Mise à jour Semestrielle (Manuelle)

### Exécution manuelle
```bash
cd /chemin/vers/parcelle-plus-server
bash update-dpe-database.sh 40
pm2 restart parcelle-plus-server
```

---

## ⏰ Configuration CRON (Automatique)

### Activation des mises à jour automatiques
```bash
cd /chemin/vers/parcelle-plus-server
bash setup-dpe-cron.sh
```

**📅 Planification automatique :**
- 1er février à 3h00
- 1er septembre à 3h00

### Vérifier les tâches cron
```bash
crontab -l
```

### Voir les logs de mise à jour
```bash
tail -f logs/dpe_update.log
```

---

## 🔍 Vérifications

### 1️⃣ Vérifier la base DPE
```bash
ls -lh database/dpe_bdnb.db
```

### 2️⃣ Compter les enregistrements
```bash
sqlite3 database/dpe_bdnb.db "SELECT COUNT(*) FROM dvf_avec_dpe;"
```

### 3️⃣ Tester l'API DPE
```bash
curl -X POST http://localhost:3000/api/dvf/estimate-with-dpe \
  -H "Content-Type: application/json" \
  -d '{"lat": 43.7102, "lng": -1.0495, "surface": 100, "propertyType": "appartement", "dpe": "C", "rooms": 3}'
```

### 4️⃣ Statut PM2
```bash
pm2 status
pm2 monit
```

---

## 🗄️ Gestion des Sauvegardes

### Lister les sauvegardes
```bash
ls -lh backups/
```

### Restaurer une sauvegarde
```bash
cp backups/dpe_bdnb_backup_YYYYMMDD_HHMMSS.db database/dpe_bdnb.db
pm2 restart parcelle-plus-server
```

### Nettoyer les anciennes sauvegardes (> 6 mois)
```bash
find backups/ -name "dpe_bdnb_backup_*.db" -mtime +180 -delete
```

---

## 🧹 Nettoyage

### Supprimer les données BDNB temporaires
```bash
rm -rf bdnb_data/
```

### Nettoyer les logs
```bash
> logs/dpe_update.log
```

---

## ⚠️ En cas d'erreur

### 1️⃣ Vérifier les logs Node.js
```bash
pm2 logs parcelle-plus-server --err --lines 100
```

### 2️⃣ Redémarrer le service
```bash
pm2 restart parcelle-plus-server
```

### 3️⃣ Relancer la mise à jour manuellement
```bash
bash update-dpe-database.sh 40
```

### 4️⃣ Restaurer la sauvegarde
```bash
cp backups/dpe_bdnb_backup_$(ls -t backups/ | head -1) database/dpe_bdnb.db
```

---

## 📊 Monitoring

### Voir l'utilisation CPU/Mémoire
```bash
pm2 monit
```

### Espace disque
```bash
df -h
du -sh database/
du -sh bdnb_data/
```

---

## 🔐 Sécurité

### Permissions
```bash
chmod 600 database/dpe_bdnb.db
chown www-data:www-data database/dpe_bdnb.db
```

---

## 📞 Support

En cas de problème :
1. Vérifier les logs : `pm2 logs`
2. Vérifier la base : `ls -lh database/`
3. Tester l'API : `curl localhost:3000/health`
4. Consulter GitHub : https://github.com/aquexel/parcelle-plus-server

---

**Dernière mise à jour :** $(date +%Y-%m-%d)

