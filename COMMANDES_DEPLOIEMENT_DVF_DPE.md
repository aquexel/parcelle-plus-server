# 🚀 COMMANDES DÉPLOIEMENT DVF + DPE + ANNEXES

## 📋 Prérequis

- Archive BDNB téléchargée : `bdnb_france.tar.gz` (~35 GB)
- Espace disque disponible : ~40 GB (extraction temporaire)
- Node.js installé
- PM2 installé

---

## 🔧 ÉTAPE 1 : Connexion au serveur

```bash
ssh ubuntu@VOTRE_IP_SERVEUR
```

---

## 📦 ÉTAPE 2 : Mise à jour du code

```bash
cd /opt/parcelle-plus
sudo -u parcelle git pull origin main
```

---

## 📥 ÉTAPE 3 : Installation des dépendances

```bash
cd /opt/parcelle-plus
npm install
```

**Nouvelles dépendances ajoutées :**
- `better-sqlite3` : Base SQLite performante
- `proj4` : Conversion Lambert 93 → WGS84

---

## 🗄️ ÉTAPE 4 : Création de la base de données

### ⭐ Option A : Mise à jour complète automatique (recommandé)

```bash
cd /opt/parcelle-plus
bash update-dvf-dpe-database.sh
```

Ce script fait **TOUT** :
1. ✅ Télécharge les données BDNB (~35 GB)
2. ✅ Extrait les 6 fichiers CSV nécessaires
3. ✅ Crée la base de données SQLite
4. ✅ Nettoie les fichiers temporaires

**Temps estimé total :** 30-60 minutes (téléchargement + traitement)

---

### Option B : Si l'archive est déjà téléchargée

```bash
cd /opt/parcelle-plus
bash deploy-dvf-dpe-annexes.sh
```

Ce script va :
1. Extraire les 6 fichiers CSV nécessaires du tar.gz existant
2. Créer la base de données SQLite avec toutes les caractéristiques
3. Proposer de nettoyer les fichiers temporaires

**Temps estimé :** 15-30 minutes selon la puissance du serveur

---

### Option C : Étape par étape (débogage)

#### 4.1. Extraction des fichiers ciblés

```bash
cd /opt/parcelle-plus
bash extract-bdnb-targeted.sh bdnb_data/bdnb_france.tar.gz bdnb_data/csv
```

**Fichiers extraits :**
- `batiment_groupe.csv` (~9 GB) : Géométrie des bâtiments
- `batiment_groupe_dpe_representatif_logement.csv` (~650 MB) : Données DPE
- `batiment_groupe_dvf_open_representatif.csv` : Prix DVF
- `rel_parcelle_sitadel.csv` : Liaison parcelle ↔ permis
- `sitadel.csv` : Annexes (piscine, garage, véranda, abri)

#### 4.2. Création de la base

```bash
cd /opt/parcelle-plus
node create-dvf-dpe-annexes-db.js bdnb_data/csv
```

**Base créée :** `/opt/parcelle-plus/database/dvf_avec_dpe_et_annexes.db`

---

## 🧹 ÉTAPE 5 : Nettoyage (optionnel)

### Supprimer les fichiers CSV extraits (~10 GB libérés)

```bash
rm -rf /opt/parcelle-plus/bdnb_data/csv
```

### Supprimer l'archive BDNB (~35 GB libérés)

```bash
rm -f /opt/parcelle-plus/bdnb_data/bdnb_france.tar.gz
```

⚠️ **Attention :** Si vous supprimez l'archive, il faudra la re-télécharger pour les mises à jour semestrielles.

---

## 🔌 ÉTAPE 6 : Intégrer la route API

### 6.1. Modifier `server.js`

Ajouter la route dans `server.js` :

```javascript
// Route DVF avec DPE et annexes
const dvfWithFeaturesRoute = require('./routes/dvfWithFeaturesRoute');
app.get('/api/dvf/search-with-features', dvfWithFeaturesRoute);
```

### 6.2. Redémarrer PM2

```bash
pm2 restart parcelle-server
pm2 logs parcelle-server
```

---

## ✅ ÉTAPE 7 : Vérification

### 7.1. Vérifier la base de données

```bash
sqlite3 /opt/parcelle-plus/database/dvf_avec_dpe_et_annexes.db

# Dans SQLite
SELECT COUNT(*) FROM dvf_avec_dpe_et_annexes;
SELECT COUNT(*) FROM dvf_avec_dpe_et_annexes WHERE classe_dpe IS NOT NULL;
SELECT COUNT(*) FROM dvf_avec_dpe_et_annexes WHERE presence_piscine = 1;
.exit
```

### 7.2. Tester l'API

```bash
# Test basique (remplacer par votre IP)
curl "http://localhost:3000/api/dvf/search-with-features?lat=43.6108&lon=-1.3619&radius=500&type_bien=maison"
```

**Réponse attendue :**
```json
{
  "success": true,
  "count": 45,
  "radius_used": 500,
  "transactions": [...],
  "statistics": {
    "avg_prix_m2_bati": 2450,
    "median_prix_m2_bati": 2380,
    "count_with_piscine": 12
  }
}
```

---

## 🔄 ÉTAPE 8 : Mise à jour semestrielle (février & septembre)

### Méthode simple (tout-en-un)

```bash
cd /opt/parcelle-plus
bash update-dvf-dpe-database.sh
pm2 restart parcelle-server
```

**C'est tout !** Le script :
- ✅ Télécharge automatiquement les nouvelles données
- ✅ Supprime l'ancienne base
- ✅ Recrée la base avec les nouvelles données
- ✅ Propose de nettoyer les fichiers temporaires

---

### Méthode manuelle (si archive déjà téléchargée)

```bash
cd /opt/parcelle-plus

# 1. Supprimer l'ancienne base
rm -f database/dvf_avec_dpe_et_annexes.db

# 2. Recréer la base
bash deploy-dvf-dpe-annexes.sh

# 3. Redémarrer PM2
pm2 restart parcelle-server
```

---

## 📊 Statistiques attendues (toute la France)

- **Transactions totales :** ~5-10 millions
- **Avec DPE :** ~40-50%
- **Avec piscine :** ~5-8%
- **Avec garage :** ~30-40%

---

## 🐛 Dépannage

### Erreur : "Archive BDNB introuvable"

```bash
# Vérifier que l'archive existe
ls -lh /opt/parcelle-plus/bdnb_data/bdnb_france.tar.gz

# Si manquante, la télécharger
bash download-bdnb-data.sh
```

### Erreur : "Fichier CSV manquant"

```bash
# Vérifier les fichiers extraits
ls -lh /opt/parcelle-plus/bdnb_data/csv/

# Si manquants, relancer l'extraction
bash extract-bdnb-targeted.sh
```

### Erreur : "Database locked"

```bash
# Fermer toutes les connexions SQLite
pkill sqlite3

# Vérifier que PM2 n'accède pas à la base
pm2 stop parcelle-server

# Relancer la création
node create-dvf-dpe-annexes-db.js
```

### Erreur mémoire : "JavaScript heap out of memory"

```bash
# Augmenter la mémoire Node.js
NODE_OPTIONS="--max-old-space-size=4096" node create-dvf-dpe-annexes-db.js
```

---

## 📞 Support

En cas de problème, vérifier :
1. ✅ Espace disque disponible : `df -h`
2. ✅ Logs PM2 : `pm2 logs parcelle-server`
3. ✅ Intégrité de l'archive : `tar -tzf bdnb_france.tar.gz | head`
4. ✅ Permissions : `ls -l database/`

---

**Bon déploiement ! 🚀**

