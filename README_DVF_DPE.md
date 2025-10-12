# 🗄️ Base de données DVF + DPE + ANNEXES

## 🚀 Utilisation rapide

### Première installation ou mise à jour complète

```bash
cd /opt/parcelle-plus
bash update-dvf-dpe-database.sh
pm2 restart parcelle-server
```

**C'est tout !** Le script va :
1. Télécharger les données BDNB (~35 GB)
2. Extraire les 6 fichiers nécessaires
3. Créer la base de données SQLite
4. Nettoyer automatiquement les fichiers temporaires

⏱️ **Durée totale** : 30-60 minutes

---

## 📊 Contenu de la base

La base `dvf_avec_dpe_et_annexes.db` contient :

- ✅ **Transactions immobilières** (DVF)
  - Prix, surfaces, dates, nombre de pièces
  - Localisation GPS (WGS84)
  
- ✅ **Performance énergétique** (DPE)
  - Classes DPE (A à G)
  
- ✅ **Annexes** (SITADEL)
  - Piscine 🏊
  - Garage 🚗
  - Véranda 🏡

---

## 🔗 API

### Rechercher des transactions

```bash
curl "http://localhost:3000/api/dvf/search-with-features?lat=43.6108&lon=-1.3619&radius=500&type_bien=maison"
```

### Paramètres disponibles

| Paramètre | Description | Exemple |
|-----------|-------------|---------|
| `lat`, `lon` | Coordonnées GPS | `lat=43.6108&lon=-1.3619` |
| `radius` | Rayon de recherche (m) | `radius=800` |
| `type_bien` | Type de bien | `type_bien=maison` |
| `months_back` | Mois en arrière | `months_back=36` |
| `classe_dpe` | Filtrer par DPE | `classe_dpe=A,B,C` |
| `avec_piscine` | 1=avec, 0=sans | `avec_piscine=1` |
| `avec_garage` | 1=avec, 0=sans | `avec_garage=1` |
| `avec_veranda` | 1=avec, 0=sans | `avec_veranda=1` |

### Exemple de réponse

```json
{
  "success": true,
  "count": 45,
  "transactions": [
    {
      "id_mutation": "2024-123456",
      "valeur_fonciere": 285000,
      "surface_bati_maison": 120,
      "surface_terrain": 650,
      "nb_pieces": 4,
      "latitude": 43.6095,
      "longitude": -1.3605,
      "distance_meters": 187,
      "classe_dpe": "C",
      "presence_piscine": 1,
      "presence_garage": 1,
      "presence_veranda": 0,
      "prix_m2_bati": 2375
    }
  ],
  "statistics": {
    "avg_prix_m2_bati": 2450,
    "median_prix_m2_bati": 2380,
    "count_with_piscine": 12,
    "count_with_garage": 34,
    "count_with_veranda": 8
  }
}
```

---

## 🔄 Mise à jour semestrielle

Les données BDNB sont mises à jour en **février** et **septembre**.

### Automatique (recommandé)

Configurer le cron :

```bash
cd /opt/parcelle-plus
bash setup-dpe-cron.sh
```

La mise à jour se fera automatiquement le 1er février et le 1er septembre à 3h du matin.

### Manuelle

```bash
cd /opt/parcelle-plus
bash update-dvf-dpe-database.sh
pm2 restart parcelle-server
```

---

## 📁 Structure des fichiers

```
/opt/parcelle-plus/
├── bdnb_data/
│   ├── bdnb_france.tar.gz     (35 GB - archive téléchargée)
│   └── csv/                    (10 GB - fichiers extraits, supprimables)
├── database/
│   └── dvf_avec_dpe_et_annexes.db  (1-3 GB - base finale)
├── update-dvf-dpe-database.sh  (script tout-en-un)
├── create-dvf-dpe-annexes-db.js  (génère la base)
└── routes/
    └── dvfWithFeaturesRoute.js  (API)
```

---

## 🛠️ Dépannage

### Erreur mémoire

```bash
# Augmenter la mémoire Node.js
NODE_OPTIONS="--max-old-space-size=8192" bash update-dvf-dpe-database.sh
```

### Base de données corrompue

```bash
# Supprimer et recréer
rm -f /opt/parcelle-plus/database/dvf_avec_dpe_et_annexes.db
bash update-dvf-dpe-database.sh
```

### Vérifier la base

```bash
sqlite3 /opt/parcelle-plus/database/dvf_avec_dpe_et_annexes.db

SELECT COUNT(*) FROM dvf_avec_dpe_et_annexes;
SELECT COUNT(*) FROM dvf_avec_dpe_et_annexes WHERE classe_dpe IS NOT NULL;
SELECT COUNT(*) FROM dvf_avec_dpe_et_annexes WHERE presence_piscine = 1;
.exit
```

---

## 📖 Documentation complète

- [API_DVF_DPE_ANNEXES.md](./API_DVF_DPE_ANNEXES.md) - Documentation API
- [COMMANDES_DEPLOIEMENT_DVF_DPE.md](./COMMANDES_DEPLOIEMENT_DVF_DPE.md) - Guide déploiement

---

## 📊 Statistiques attendues

Pour toute la France :
- **Transactions totales** : 5-10 millions
- **Avec DPE** : ~40-50%
- **Avec piscine** : ~5-8%
- **Avec garage** : ~30-40%
- **Avec véranda** : ~3-5%

