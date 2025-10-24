# Logique chronologique DPE-Vente

## 🎯 **Règle chronologique** :

> **Si le DPE a été fait avant la date de vente, et qu'il n'y a pas eu de vente depuis, il faut garder l'ancien DPE.**

## 🔍 **Logique détaillée** :

### **Scénario 1** : DPE après la vente
```csv
# DPE disponibles
batiment_groupe_id,date_etablissement_dpe,classe_dpe
bdnb-bg-1113,2018/10/21,C
bdnb-bg-1113,2022/09/20,D

# Vente
id_mutation,date_mutation,valeur_fonciere
2024-491796,2024/03/15,120000

# Résultat : Prendre DPE D (2022) car plus récent que la vente (2024)
```

### **Scénario 2** : DPE avant la vente (pas de rénovation)
```csv
# DPE disponibles
batiment_groupe_id,date_etablissement_dpe,classe_dpe
bdnb-bg-1113,2018/10/21,C

# Vente
id_mutation,date_mutation,valeur_fonciere
2024-491796,2024/03/15,120000

# Résultat : Garder DPE C (2018) car antérieur à la vente (2024)
```

### **Scénario 3** : DPE avant ET après la vente
```csv
# DPE disponibles
batiment_groupe_id,date_etablissement_dpe,classe_dpe
bdnb-bg-1113,2018/10/21,C
bdnb-bg-1113,2022/09/20,D
bdnb-bg-1113,2025/01/15,B

# Vente
id_mutation,date_mutation,valeur_fonciere
2024-491796,2024/03/15,120000

# Résultat : Prendre DPE B (2025) car plus récent que la vente (2024)
```

## 🔧 **Implémentation SQL** :

### **Logique de sélection** :
```sql
SELECT dpe.classe_dpe 
FROM temp_bdnb_dpe dpe
WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
ORDER BY 
  CASE 
    -- Si DPE après la vente : prendre le plus récent
    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
    THEN dpe.date_etablissement_dpe DESC
    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
    ELSE dpe.date_etablissement_dpe ASC
  END,
  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
LIMIT 1
```

### **Alternative avec COALESCE** :
```sql
COALESCE(
    -- DPE le plus récent après la vente
    (SELECT dpe.classe_dpe 
     FROM temp_bdnb_dpe dpe
     WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
       AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
       AND dpe.date_etablissement_dpe > dvf.date_mutation
     ORDER BY dpe.date_etablissement_dpe DESC
     LIMIT 1),
    -- DPE le plus ancien avant la vente (si pas de DPE après)
    (SELECT dpe.classe_dpe 
     FROM temp_bdnb_dpe dpe
     WHERE dpe.batiment_groupe_id = dvf.batiment_groupe_id
       AND ABS(dpe.surface_habitable_logement - dvf.surface_reelle_bati) < 10
       AND dpe.date_etablissement_dpe <= dvf.date_mutation
     ORDER BY dpe.date_etablissement_dpe DESC
     LIMIT 1)
) as dpe_final
```

## 📊 **Exemples concrets** :

### **Test 1** : Vente 2024, DPE 2018 et 2022
```sql
-- Vente : 2024/03/15
-- DPE disponibles : 2018/10/21 (C), 2022/09/20 (D)
-- Résultat : DPE D (2022) car plus récent que la vente
```

### **Test 2** : Vente 2024, DPE 2018 seulement
```sql
-- Vente : 2024/03/15
-- DPE disponibles : 2018/10/21 (C)
-- Résultat : DPE C (2018) car antérieur à la vente
```

### **Test 3** : Vente 2020, DPE 2018, 2022, 2025
```sql
-- Vente : 2020/11/10
-- DPE disponibles : 2018/10/21 (C), 2022/09/20 (D), 2025/01/15 (B)
-- Résultat : DPE B (2025) car plus récent que la vente
```

## 🧪 **Tests disponibles** :

### **Script de test** :
```bash
node test-chronologie-dpe-vente.js
```

**Fonctionnalités** :
- ✅ Test des différents scénarios chronologiques
- ✅ Validation de la logique de sélection
- ✅ Vérification des DPE disponibles par bâtiment
- ✅ Simulation des cas limites

## 📈 **Avantages** :

### **Précision** :
- ✅ **DPE contextuel** : Adapté à la chronologie des ventes
- ✅ **Logique métier** : Respecte la réalité des rénovations
- ✅ **Cohérence** : Tous les attributs du même DPE

### **Robustesse** :
- ✅ **Gestion des cas limites** : Pas de DPE après vente
- ✅ **Fallback intelligent** : DPE avant vente si nécessaire
- ✅ **Performance** : Requêtes optimisées

## 🚀 **Prochaines étapes** :

1. **Tester** la logique avec le script fourni
2. **Valider** les scénarios chronologiques
3. **Implémenter** dans le script principal
4. **Déployer** sur le serveur

---

**Note** : Cette logique chronologique garantit que chaque transaction DVF utilise le DPE le plus approprié selon la chronologie des ventes et des rénovations ! 🔥
