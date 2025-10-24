# Gestion des multiples DPE par bâtiment

## 🏢 **Problème identifié**

Un bâtiment peut avoir **plusieurs DPE** (un par logement), mais notre script original ne gérait pas cette situation correctement.

## 🔍 **Structure des données BDNB**

### **Fichier DPE** (`batiment_groupe_dpe_representatif_logement.csv`) :
```csv
batiment_groupe_id,identifiant_dpe,classe_bilan_dpe,...
bdnb-bg-1113-8T1U-ECRC,1840V1004801L,C,...
bdnb-bg-1113-8T1U-ECRC,2240E2166301W,D,...
bdnb-bg-1113-8T1U-ECRC,1340V1001648M,E,...
```

**Même bâtiment** (`bdnb-bg-1113-8T1U-ECRC`) mais **3 DPE différents** :
- ✅ **3 identifiants DPE** distincts
- ✅ **3 classes DPE** différentes (C, D, E)
- ✅ **3 logements** différents

## 🚨 **Problème dans le script original**

### **Table temporaire** :
```sql
CREATE TABLE temp_bdnb_dpe (
    batiment_groupe_id TEXT PRIMARY KEY,  -- ❌ Clé primaire unique
    classe_dpe TEXT,
    ...
)
```

### **Insertion** :
```sql
INSERT OR IGNORE INTO temp_bdnb_dpe VALUES (?, ?, ?, ?, ?, ?, ?)
```

**Résultat** : Seul le **premier DPE** est conservé, les autres sont ignorés !

## 🔧 **Solution implémentée**

### **1. Table temporaire corrigée** :
```sql
CREATE TABLE temp_bdnb_dpe (
    batiment_groupe_id TEXT,
    identifiant_dpe TEXT,
    classe_dpe TEXT,
    orientation_principale TEXT,
    pourcentage_vitrage REAL,
    presence_piscine INTEGER DEFAULT 0,
    presence_garage INTEGER DEFAULT 0,
    presence_veranda INTEGER DEFAULT 0,
    PRIMARY KEY (batiment_groupe_id, identifiant_dpe)  -- ✅ Clé composite
)
```

### **2. Insertion corrigée** :
```sql
INSERT OR IGNORE INTO temp_bdnb_dpe VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```

**Résultat** : **Tous les DPE** sont conservés !

### **3. Requêtes avec LIMIT 1** :
```sql
UPDATE dvf_bdnb_complete 
SET classe_dpe = (
    SELECT dpe.classe_dpe 
    FROM temp_bdnb_dpe dpe
    WHERE dpe.batiment_groupe_id = dvf_bdnb_complete.batiment_groupe_id
    LIMIT 1  -- ✅ Prend le premier DPE trouvé
)
```

## 📊 **Impact sur les données**

### **Avant** :
- ❌ **1 DPE** par bâtiment (le premier trouvé)
- ❌ **Données perdues** pour les autres logements
- ❌ **Statistiques faussées**

### **Après** :
- ✅ **Tous les DPE** conservés dans la table temporaire
- ✅ **Premier DPE** utilisé pour la jointure (logique cohérente)
- ✅ **Données complètes** disponibles

## 🎯 **Logique de sélection**

### **Pourquoi LIMIT 1 ?**
1. **Cohérence** : Un bâtiment = un DPE représentatif
2. **Simplicité** : Évite la complexité de la sélection multiple
3. **Performance** : Requêtes plus rapides

### **Alternative possible** :
```sql
-- Prendre le DPE le plus récent
SELECT classe_dpe 
FROM temp_bdnb_dpe dpe
WHERE dpe.batiment_groupe_id = ?
ORDER BY identifiant_dpe DESC
LIMIT 1
```

## 🧪 **Tests disponibles**

### **Script Node.js** :
```bash
node test-multiple-dpe.js
```

### **Script PowerShell** :
```powershell
.\test-multiple-dpe.ps1
```

**Fonctionnalités** :
- ✅ Détection des bâtiments avec plusieurs DPE
- ✅ Test de la logique LIMIT 1
- ✅ Statistiques générales
- ✅ Validation de la structure des données

## 🔄 **Workflow complet**

1. **Chargement** : Tous les DPE sont chargés dans `temp_bdnb_dpe`
2. **Jointure** : Chaque transaction DVF est liée à un bâtiment
3. **Sélection** : Le premier DPE du bâtiment est utilisé
4. **Résultat** : Données cohérentes et complètes

## 📈 **Bénéfices**

- ✅ **Données complètes** : Tous les DPE sont conservés
- ✅ **Cohérence** : Un bâtiment = un DPE représentatif
- ✅ **Performance** : Requêtes optimisées
- ✅ **Maintenabilité** : Code plus robuste

## 🚀 **Prochaines étapes**

1. **Tester** avec les scripts fournis
2. **Valider** les statistiques DPE
3. **Déployer** sur le serveur
4. **Monitorer** les performances

---

**Note** : Cette correction améliore significativement la qualité des données DPE en gérant correctement la réalité des bâtiments multi-logements ! 🔥
