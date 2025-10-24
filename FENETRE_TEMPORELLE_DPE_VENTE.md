# Fenêtre temporelle DPE-Vente (6 mois)

## 🎯 **Règle avec fenêtre temporelle** :

> **Si le nouveau DPE a été fait dans les 6 mois après la vente, on peut l'associer. Si c'est plus de 6 mois, il ne faut pas l'inclure.**

## 🔍 **Logique détaillée** :

### **Scénario 1** : DPE dans les 6 mois après vente ✅
```csv
# Vente : 2024/03/15
# DPE : 2024/05/10 (1 mois et 25 jours après)
# Résultat : ASSOCIER le DPE à la vente
```

### **Scénario 2** : DPE plus de 6 mois après vente ❌
```csv
# Vente : 2024/03/15
# DPE : 2024/12/20 (9 mois et 5 jours après)
# Résultat : NE PAS associer le DPE à la vente
```

### **Scénario 3** : DPE avant la vente ✅
```csv
# Vente : 2024/03/15
# DPE : 2023/10/21 (4 mois et 24 jours avant)
# Résultat : ASSOCIER le DPE à la vente (pas de limite temporelle pour les DPE antérieurs)
```

## 🔧 **Implémentation SQL** :

### **Logique de sélection avec fenêtre temporelle** :
```sql
SELECT dpe.classe_dpe 
FROM temp_bdnb_dpe dpe
WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
  AND ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10
  AND (
      -- DPE avant la vente : toujours valide
      dpe.date_etablissement_dpe <= dvf_bdnb_complete.date_mutation
      OR
      -- DPE après la vente : seulement si dans les 6 mois
      (dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
       AND julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180)
  )
ORDER BY 
  CASE 
    -- Si DPE après la vente (dans les 6 mois) : prendre le plus récent
    WHEN dpe.date_etablissement_dpe > dvf_bdnb_complete.date_mutation 
    THEN dpe.date_etablissement_dpe DESC
    -- Si DPE avant la vente : prendre le plus ancien (pas de rénovation depuis)
    ELSE dpe.date_etablissement_dpe ASC
  END,
  ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati)
LIMIT 1
```

### **Calcul de la fenêtre temporelle** :
```sql
-- Calculer la différence en jours
julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180

-- 180 jours = 6 mois (approximation)
-- 1 mois = 30 jours
-- 6 mois = 180 jours
```

## 📊 **Exemples concrets** :

### **Test 1** : Vente 2024/03/15, DPE 2024/05/10
```sql
-- Vente : 2024/03/15
-- DPE : 2024/05/10
-- Différence : 56 jours (1.9 mois)
-- Résultat : ✅ ASSOCIER (dans les 6 mois)
```

### **Test 2** : Vente 2024/03/15, DPE 2024/12/20
```sql
-- Vente : 2024/03/15
-- DPE : 2024/12/20
-- Différence : 280 jours (9.3 mois)
-- Résultat : ❌ NE PAS associer (plus de 6 mois)
```

### **Test 3** : Vente 2024/03/15, DPE 2023/10/21
```sql
-- Vente : 2024/03/15
-- DPE : 2023/10/21
-- Différence : -145 jours (4.8 mois avant)
-- Résultat : ✅ ASSOCIER (DPE antérieur, pas de limite)
```

## 🧪 **Tests disponibles** :

### **Script de test** :
```bash
node test-fenetre-temporelle.js
```

**Fonctionnalités** :
- ✅ Test des différents scénarios temporels
- ✅ Validation de la fenêtre de 6 mois
- ✅ Calcul des différences en jours et mois
- ✅ Vérification des DPE disponibles par bâtiment

## 📈 **Avantages** :

### **Précision** :
- ✅ **DPE contextuel** : Seulement les DPE pertinents
- ✅ **Fenêtre temporelle** : Évite les DPE trop anciens
- ✅ **Logique métier** : Respecte la réalité des rénovations

### **Robustesse** :
- ✅ **Gestion des cas limites** : DPE antérieurs sans limite
- ✅ **Calcul précis** : Différence en jours exacte
- ✅ **Performance** : Requêtes optimisées

## ⚙️ **Paramètres configurables** :

### **Fenêtre temporelle** :
```sql
-- 6 mois = 180 jours
julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 180

-- 3 mois = 90 jours
julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 90

-- 12 mois = 365 jours
julianday(dpe.date_etablissement_dpe) - julianday(dvf_bdnb_complete.date_mutation) <= 365
```

### **Seuil de surface** :
```sql
-- 10 m² de tolérance
ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 10

-- 5 m² de tolérance (plus strict)
ABS(dpe.surface_habitable_logement - dvf_bdnb_complete.surface_reelle_bati) < 5
```

## 🚀 **Prochaines étapes** :

1. **Tester** la logique avec le script fourni
2. **Valider** la fenêtre temporelle de 6 mois
3. **Ajuster** les paramètres si nécessaire
4. **Déployer** sur le serveur

---

**Note** : Cette fenêtre temporelle garantit que seuls les DPE pertinents (dans les 6 mois après vente) sont associés aux transactions, améliorant la précision et la pertinence des données ! 🔥
