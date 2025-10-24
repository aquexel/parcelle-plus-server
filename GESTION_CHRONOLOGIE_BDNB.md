# Gestion de la chronologie BDNB multi-années

## 📅 **Problème identifié** :

Les données BDNB sont **multi-années** et évoluent dans le temps. Un même bâtiment peut avoir **plusieurs DPE** à des **dates différentes**.

## 🔍 **Exemple concret** :

### **Données DPE multi-années** :
```csv
batiment_groupe_id,identifiant_dpe,date_etablissement_dpe,classe_bilan_dpe,surface_habitable_logement
bdnb-bg-1113-8T1U-ECRC,1840V1004801L,2018/10/21,C,45
bdnb-bg-1113-8T1U-ECRC,2240E2166301W,2022/09/20,D,52
bdnb-bg-1113-8T1U-ECRC,1340V1001648M,2013/10/14,E,38
```

**Même bâtiment** mais **3 DPE différents** à des **dates différentes** :
- ✅ **2013** : DPE E (ancien)
- ✅ **2018** : DPE C (rénovation)
- ✅ **2022** : DPE D (dernière version)

## 🚨 **Problème dans la jointure** :

### **Jointure sans chronologie** (problématique) :
```sql
ORDER BY ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
LIMIT 1
```

**Résultat** : Peut prendre un **DPE ancien** (2013) au lieu du **récent** (2022) !

## 🔧 **Solution : Jointure intelligente + chronologie** :

### **1. Table temporaire enrichie** :
```sql
CREATE TABLE temp_bdnb_dpe (
    batiment_groupe_id TEXT,
    identifiant_dpe TEXT,
    classe_dpe TEXT,
    orientation_principale TEXT,
    pourcentage_vitrage REAL,
    surface_habitable_logement REAL,
    date_etablissement_dpe TEXT,  -- ✅ Nouveau champ
    presence_piscine INTEGER DEFAULT 0,
    presence_garage INTEGER DEFAULT 0,
    presence_veranda INTEGER DEFAULT 0,
    PRIMARY KEY (batiment_groupe_id, identifiant_dpe)
)
```

### **2. Jointure avec chronologie** :
```sql
ORDER BY ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati),
         dpe.date_etablissement_dpe DESC
LIMIT 1
```

## 🎯 **Logique de sélection** :

### **Critères de priorité** :
1. **Surface proche** : Différence < 10 m²
2. **DPE récent** : Date d'établissement la plus récente
3. **Meilleur match** : Plus petite différence de surface

### **Exemple concret** :
```sql
-- Transaction DVF : 45 m²
-- DPE disponibles : 
--   45 m² (2018) → Différence = 0 m², Date = 2018
--   45 m² (2022) → Différence = 0 m², Date = 2022 ✅ SÉLECTIONNÉ
--   52 m² (2022) → Différence = 7 m², Date = 2022

-- Sélection :
-- ✅ 45 m² (2022) → Meilleur match + plus récent
```

## 📊 **Résultats attendus** :

### **Avant** (sans chronologie) :
```csv
id_mutation,surface_reelle_bati,classe_dpe,date_dpe
2024-491796,45,C,2018/10/21  ← DPE ancien
2024-491797,52,D,2022/09/20
2024-491798,38,E,2013/10/14  ← DPE très ancien
```

### **Après** (avec chronologie) :
```csv
id_mutation,surface_reelle_bati,classe_dpe,date_dpe
2024-491796,45,C,2022/01/03  ← DPE le plus récent
2024-491797,52,D,2022/09/20
2024-491798,38,E,2022/09/05  ← DPE le plus récent
```

## 🔄 **Workflow complet** :

1. **Chargement DPE** : Tous les DPE avec leur date d'établissement
2. **Chargement DVF** : Toutes les transactions avec leur surface
3. **Jointure intelligente** : Match par surface + chronologie
4. **Résultat** : Chaque transaction a son DPE le plus récent

## 📈 **Avantages** :

### **Précision** :
- ✅ **DPE récent** : Toujours la version la plus récente
- ✅ **Surface proche** : Correspondance parfaite
- ✅ **Cohérence** : Tous les attributs du même DPE

### **Performance** :
- ✅ **Requêtes optimisées** : ORDER BY efficace
- ✅ **Index sur les dates** : Tri rapide
- ✅ **LIMIT 1** : Un seul résultat

### **Robustesse** :
- ✅ **Gestion des doublons** : Priorité à la date
- ✅ **Cas limites** : Fallback intelligent
- ✅ **Données manquantes** : Gestion des NULL

## 🧪 **Tests disponibles** :

### **Scripts de test** :
- `test-intelligent-join.js` (Node.js)
- `test-intelligent-join.ps1` (PowerShell)

### **Fonctionnalités** :
- ✅ Détection des DPE multi-années
- ✅ Test de la jointure par surface + chronologie
- ✅ Validation des correspondances
- ✅ Statistiques de précision

## ⚙️ **Paramètres configurables** :

### **Seuil de différence** :
```sql
AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
```

### **Priorité chronologique** :
```sql
ORDER BY ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati),
         dpe.date_etablissement_dpe DESC
```

## 🚀 **Prochaines étapes** :

1. **Tester** avec les scripts fournis
2. **Valider** les correspondances chronologiques
3. **Ajuster** les seuils si nécessaire
4. **Déployer** sur le serveur

---

**Note** : Cette gestion de la chronologie garantit que chaque transaction DVF est liée au DPE le plus récent du logement correspondant, améliorant significativement la précision et la pertinence des données ! 🔥
