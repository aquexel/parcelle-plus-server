# 📡 API DVF + DPE + ANNEXES

## 🎯 Objectif

Fournir à l'application Android les transactions immobilières enrichies avec :
- Prix et caractéristiques DVF
- DPE (classe énergétique)
- Annexes SITADEL (piscine, garage, véranda, abri)
- Coordonnées GPS

L'application effectue ensuite l'**algorithme de régression comparative** localement.

---

## 🗄️ Structure de la base

### Table : `dvf_avec_dpe_et_annexes`

| Colonne | Type | Description |
|---------|------|-------------|
| `id_mutation` | TEXT | Identifiant unique de la mutation |
| `id_parcelle` | TEXT | Identifiant cadastral de la parcelle |
| `batiment_groupe_id` | TEXT | Identifiant BDNB du bâtiment |
| `valeur_fonciere` | REAL | Prix de vente (€) |
| `date_mutation` | TEXT | Date de la transaction (YYYY-MM-DD) |
| `surface_bati_maison` | REAL | Surface bâtie maison (m²) |
| `surface_bati_appartement` | REAL | Surface bâtie appartement (m²) |
| `surface_terrain` | REAL | Surface terrain (m²) |
| `nb_pieces` | INTEGER | Nombre de pièces |
| `latitude` | REAL | Latitude GPS (WGS84) |
| `longitude` | REAL | Longitude GPS (WGS84) |
| `code_departement` | TEXT | Code département (2 chiffres) |
| `classe_dpe` | TEXT | Classe DPE (A à G) |
| `presence_piscine` | INTEGER | 1 si piscine, 0 sinon |
| `presence_garage` | INTEGER | 1 si garage, 0 sinon |
| `presence_veranda` | INTEGER | 1 si véranda, 0 sinon |
| `date_permis_annexes` | TEXT | Date du permis de construire des annexes |
| `type_bien` | TEXT | Type : `maison`, `appartement`, `terrain`, `maison_avec_terrain` |
| `prix_m2_bati` | REAL | Prix/m² bâti calculé |
| `prix_m2_terrain` | REAL | Prix/m² terrain calculé |

---

## 📡 Route API

### `GET /api/dvf/search-with-features`

Recherche des transactions dans un rayon autour d'un point GPS.

#### Paramètres de requête

| Paramètre | Type | Obligatoire | Description |
|-----------|------|-------------|-------------|
| `lat` | float | ✅ | Latitude du point de recherche |
| `lon` | float | ✅ | Longitude du point de recherche |
| `radius` | integer | ❌ | Rayon de recherche en mètres (défaut: 500) |
| `type_bien` | string | ❌ | Filtrer par type : `maison`, `appartement`, `terrain` |
| `months_back` | integer | ❌ | Nombre de mois en arrière (défaut: 24) |
| `min_surface` | float | ❌ | Surface minimale bâtie (m²) |
| `max_surface` | float | ❌ | Surface maximale bâtie (m²) |
| `classe_dpe` | string | ❌ | Filtrer par classe DPE (ex: "A,B,C") |
| `avec_piscine` | boolean | ❌ | 1 pour uniquement piscine, 0 pour sans piscine |
| `avec_garage` | boolean | ❌ | 1 pour uniquement garage, 0 pour sans garage |
| `avec_veranda` | boolean | ❌ | 1 pour uniquement véranda, 0 pour sans véranda |
| `limit` | integer | ❌ | Nombre max de résultats (défaut: 100) |

#### Exemple de requête

```bash
GET /api/dvf/search-with-features?lat=43.6108&lon=-1.3619&radius=800&type_bien=maison&months_back=36
```

#### Réponse JSON

```json
{
  "success": true,
  "count": 45,
  "radius_used": 800,
  "filters": {
    "type_bien": "maison",
    "months_back": 36
  },
  "transactions": [
    {
      "id_mutation": "2024-123456",
      "valeur_fonciere": 285000,
      "date_mutation": "2023-06-15",
      "surface_bati_maison": 120,
      "surface_terrain": 650,
      "nb_pieces": 4,
      "latitude": 43.6095,
      "longitude": -1.3605,
      "distance_meters": 187,
      "classe_dpe": "C",
      "classe_ges": "B",
      "conso_energie": 145.2,
      "presence_piscine": 1,
      "presence_garage": 1,
      "presence_veranda": 0,
      "presence_abri_jardin": 0,
      "type_bien": "maison_avec_terrain",
      "prix_m2_bati": 2375,
      "prix_m2_terrain": 438
    },
    // ... autres transactions
  ],
  "statistics": {
    "avg_prix_m2_bati": 2450,
    "median_prix_m2_bati": 2380,
    "avg_surface_bati": 115,
    "count_with_dpe": 38,
    "count_with_piscine": 12,
    "count_with_garage": 34,
    "count_with_veranda": 8
  }
}
```

---

## 🧮 Algorithme de régression (côté Android)

L'application Android reçoit les transactions et effectue :

### 1. **Filtrage par similarité**
```kotlin
val similar = transactions.filter { t ->
    // Même type de bien
    t.type_bien == targetProperty.type_bien &&
    
    // Surface ±20%
    abs(t.surface_bati - targetProperty.surface_bati) / targetProperty.surface_bati < 0.2 &&
    
    // Distance < 500m
    t.distance_meters < 500
}
```

### 2. **Groupement par profil structurel**
```kotlin
// Grouper par caractéristiques structurelles (sans DPE/annexes)
val groups = similar.groupBy { 
    "${(it.surface_bati / 20).roundToInt() * 20}_${it.nb_pieces}"
}
```

### 3. **Calcul des impacts par comparaison**
```kotlin
// Impact piscine : comparer avec/sans piscine dans chaque groupe
val impactPiscine = groups.map { group ->
    val avecPiscine = group.filter { it.presence_piscine == 1 }.map { it.prix_m2_bati }
    val sansPiscine = group.filter { it.presence_piscine == 0 }.map { it.prix_m2_bati }
    
    if (avecPiscine.isNotEmpty() && sansPiscine.isNotEmpty()) {
        avecPiscine.median() - sansPiscine.median()
    } else null
}.filterNotNull().median() ?: 0.0
```

### 4. **Estimation finale**
```kotlin
val prixBase = similar.map { it.prix_m2_bati }.median()

val prixAjuste = prixBase +
    impactPiscine * (if (targetProperty.presence_piscine) 1 else 0) +
    impactGarage * (if (targetProperty.presence_garage) 1 else 0) +
    impactVeranda * (if (targetProperty.presence_veranda) 1 else 0) +
    impactDPE[targetProperty.classe_dpe]

val estimationFinale = prixAjuste * targetProperty.surface_bati
```

---

## 📊 Formule de distance GPS

Pour calculer la distance entre deux points GPS (formule de Haversine) :

```kotlin
fun calculateDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val R = 6371000.0 // Rayon de la Terre en mètres
    
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    
    val a = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
            sin(dLon / 2).pow(2)
    
    val c = 2 * atan2(sqrt(a), sqrt(1 - a))
    
    return R * c // Distance en mètres
}
```

---

## 🔐 Sécurité

- ✅ Limite de 100 résultats par défaut (éviter surcharge)
- ✅ Timeout de 30 secondes
- ✅ Validation des coordonnées GPS (France métropolitaine)
- ✅ Rate limiting : 60 requêtes / minute / IP

---

## 📦 Déploiement

```bash
# Sur le serveur OVH
cd /opt/parcelle-plus

# 1. Extraire les fichiers BDNB ciblés
sudo bash extract-bdnb-targeted.sh

# 2. Créer la base de données
sudo bash deploy-dvf-dpe-annexes.sh

# 3. Implémenter la route API dans server.js
# (voir exemple ci-dessous)

# 4. Redémarrer PM2
pm2 restart parcelle-server
```

---

## 🚀 Prochaines étapes

1. ✅ Implémenter la route API `/api/dvf/search-with-features` dans `server.js`
2. ⏳ Modifier l'application Android pour :
   - Appeler cette API au lieu de la DVF locale uniquement
   - Implémenter l'algorithme de régression comparative
   - Afficher les impacts détaillés (piscine: +15k€, garage: +8k€, etc.)
3. ⏳ Tests de performance avec différents rayons de recherche

---

**Temps de réponse attendu :** < 500ms pour 100 transactions dans un rayon de 1km

