# 📊 Méthodologie d'estimation avec pondération DPE

## 🎯 Objectif

Affiner l'estimation d'un bien immobilier en tenant compte de sa **classe énergétique (DPE)** par rapport aux transactions comparables.

---

## 🧮 Principe de base

Au lieu d'appliquer des coefficients arbitraires (+10% pour A, -10% pour G), on **observe les écarts réels de prix** entre les différentes classes DPE dans les transactions du secteur.

---

## 📝 Exemple concret étape par étape

### **Contexte**
Un utilisateur veut estimer un **appartement de 80m²** avec **DPE D** à **Mont-de-Marsan (40)**.

---

### **ÉTAPE 1 : Collecte des transactions**

Recherche dans un rayon de **1km** :

| # | Prix | Surface | Prix/m² | DPE | Date | Distance |
|---|------|---------|---------|-----|------|----------|
| 1 | 280 000€ | 100m² | **2 800€/m²** | **C** | 2023-11 | 350m |
| 2 | 250 000€ | 100m² | **2 500€/m²** | **E** | 2023-09 | 580m |
| 3 | 300 000€ | 100m² | **3 000€/m²** | **B** | 2023-10 | 420m |
| 4 | 220 000€ | 100m² | **2 200€/m²** | **G** | 2022-12 | 920m |
| 5 | 270 000€ | 100m² | **2 700€/m²** | **D** | 2023-08 | 680m |
| 6 | 240 000€ | 100m² | **2 400€/m²** | **F** | 2023-07 | 740m |
| 7 | 265 000€ | 100m² | **2 650€/m²** | **D** | 2022-11 | 810m |
| 8 | 285 000€ | 100m² | **2 850€/m²** | **C** | 2023-06 | 650m |
| 9 | 310 000€ | 95m² | **3 263€/m²** | **A** | 2023-05 | 890m |

**Résultat** : 9 transactions trouvées, toutes avec DPE connu ✅

---

### **ÉTAPE 2 : Calcul du prix médian par classe DPE**

Regroupement par classe :

| Classe DPE | Transactions | Prix/m² observés | **Prix médian** |
|------------|--------------|------------------|-----------------|
| **A** | 1 | 3 263 | **3 263€/m²** |
| **B** | 1 | 3 000 | **3 000€/m²** |
| **C** | 2 | 2 800, 2 850 | **2 825€/m²** |
| **D** | 2 | 2 700, 2 650 | **2 675€/m²** |
| **E** | 1 | 2 500 | **2 500€/m²** |
| **F** | 1 | 2 400 | **2 400€/m²** |
| **G** | 1 | 2 200 | **2 200€/m²** |

---

### **ÉTAPE 3 : Calcul des écarts entre classes adjacentes**

| Transition | Calcul | Écart observé |
|------------|--------|---------------|
| **A → B** | (3000 - 3263) / 3263 | **-8.1%** |
| **B → C** | (2825 - 3000) / 3000 | **-5.8%** |
| **C → D** | (2675 - 2825) / 2825 | **-5.3%** |
| **D → E** | (2500 - 2675) / 2675 | **-6.5%** |
| **E → F** | (2400 - 2500) / 2500 | **-4.0%** |
| **F → G** | (2200 - 2400) / 2400 | **-8.3%** |

📊 **Écart moyen** : **-6.3% par classe**

💡 **Interprétation** : Dans ce secteur, chaque classe DPE inférieure vaut environ **6.3% de moins** que la classe supérieure.

---

### **ÉTAPE 4 : Ajustement vers le DPE cible (D)**

Le bien à estimer a un **DPE D**, on ajuste donc chaque transaction vers D :

#### **Transaction avec DPE C (meilleur que D)**
```
Prix observé : 2 800€/m²
Facteur d'ajustement : C → D = -5.3%
Prix ajusté = 2 800€ × (1 - 0.053) = 2 800€ × 0.947 = 2 652€/m²
```

#### **Transaction avec DPE E (moins bon que D)**
```
Prix observé : 2 500€/m²
Facteur d'ajustement : E → D = +6.5% (inverse)
Prix ajusté = 2 500€ × (1 + 0.065) = 2 500€ × 1.065 = 2 663€/m²
```

#### **Transaction avec DPE G (2 classes en-dessous de D)**
```
Prix observé : 2 200€/m²
Facteurs cumulés :
  G → F : +8.3%
  F → E : +4.0%
  E → D : +6.5%
Facteur total = 1.083 × 1.040 × 1.065 = 1.199
Prix ajusté = 2 200€ × 1.199 = 2 638€/m²
```

---

### **ÉTAPE 5 : Tableau récapitulatif des ajustements**

| # | DPE | Prix/m² original | Ajustement | Prix/m² ajusté vers D |
|---|-----|------------------|------------|-----------------------|
| 1 | C | 2 800€/m² | -5.3% | **2 652€/m²** |
| 2 | E | 2 500€/m² | +6.5% | **2 663€/m²** |
| 3 | B | 3 000€/m² | -10.8% | **2 676€/m²** |
| 4 | G | 2 200€/m² | +19.9% | **2 638€/m²** |
| 5 | D | 2 700€/m² | 0% | **2 700€/m²** ⭐ |
| 6 | F | 2 400€/m² | +10.6% | **2 654€/m²** |
| 7 | D | 2 650€/m² | 0% | **2 650€/m²** ⭐ |
| 8 | C | 2 850€/m² | -5.3% | **2 699€/m²** |
| 9 | A | 3 263€/m² | -18.1% | **2 672€/m²** |

---

### **ÉTAPE 6 : Calcul de la médiane ajustée**

Prix ajustés triés :
```
[2 638, 2 650, 2 652, 2 654, 2 663, 2 672, 2 676, 2 699, 2 700]
                              ↑
                           MÉDIANE
```

**Prix médian ajusté** = **(2 663 + 2 672) / 2** = **2 668€/m²**

---

### **ÉTAPE 7 : Estimation finale**

```
Bien à estimer :
- Surface : 80m²
- DPE : D
- Prix/m² médian ajusté : 2 668€/m²

💰 PRIX TOTAL ESTIMÉ = 80m² × 2 668€/m² = 213 440€
```

---

## 📊 Comparaison avec estimation classique

### **Sans pondération DPE**
Médiane brute de toutes les transactions : **(2 500 + 2 650) / 2** = **2 575€/m²**
Estimation : **80m² × 2 575€/m²** = **206 000€**

### **Avec pondération DPE (D)**
Médiane ajustée : **2 668€/m²**
Estimation : **80m² × 2 668€/m²** = **213 440€**

### **Écart**
**+7 440€** (+3.6%) grâce à la prise en compte du DPE

---

## 🎯 Cas particuliers

### **Cas 1 : Pas assez de transactions avec DPE**
Si moins de **3 transactions** ont un DPE connu :
- ⚠️ Calcul classique sans pondération
- Message : *"Calcul sans pondération DPE (données insuffisantes)"*

### **Cas 2 : DPE non fourni par l'utilisateur**
Si l'utilisateur ne connaît pas le DPE :
- ⚠️ Calcul classique sans pondération
- Suggestion : *"Pour une estimation plus précise, renseignez le DPE du bien"*

### **Cas 3 : Une seule classe DPE manquante**
Si aucune transaction n'a un DPE intermédiaire :
```
Transactions : A (3200€), C (2800€), E (2500€)
Manque : B, D

Calcul de l'écart B manquant :
  Écart A→C = -12.5% (2 sauts)
  Écart par saut = -12.5% / 2 = -6.25%
  Donc A→B ≈ -6.25%
```

### **Cas 4 : Écart par défaut**
Si aucune donnée n'est disponible pour calculer un écart :
- 📊 Écart par défaut : **-6% par classe** (moyenne nationale observée)

---

## 📈 Fiabilité de l'estimation

La fiabilité est calculée selon :
```
Fiabilité = min(100, 
    (nbTransactionsAvecDPE / 15) × 100 × 
    (nbClassesDPEDifferentes / 7)
)
```

### **Exemples**
- **15 transactions** avec **7 classes DPE** différentes : **100% de fiabilité** ✅
- **10 transactions** avec **4 classes DPE** : **(10/15) × (4/7) × 100** = **38% de fiabilité** ⚠️
- **5 transactions** avec **2 classes DPE** : **(5/15) × (2/7) × 100** = **10% de fiabilité** 🔴

---

## 🔄 Mise à jour des données

### **Fréquence**
- 📅 **Annuelle** : nouvelles données BDNB publiées chaque année
- 🔄 Script : `enrich_dvf_with_dpe.js`

### **Multi-départements**
Pour étendre à d'autres départements :
```bash
# Télécharger les données BDNB pour le département 64 (Pyrénées-Atlantiques)
node enrich_dvf_with_dpe.js --department=64

# Créer une base par département
database/
  ├── dpe_dep40.db  (Landes)
  ├── dpe_dep64.db  (Pyrénées-Atlantiques)
  └── dpe_dep33.db  (Gironde)
```

---

## 🚀 Utilisation dans l'API

### **Endpoint**
```
POST /api/dvf/estimate-with-dpe
```

### **Payload**
```json
{
  "latitude": 43.8971,
  "longitude": -0.4987,
  "dpe_cible": "D",
  "type_filtre": "appartement",
  "rayon_metres": 1000,
  "mois_periode": 24
}
```

### **Réponse**
```json
{
  "prixMoyenM2": 2668,
  "prixMedianM2": 2668,
  "nbTransactions": 9,
  "nbAvecDPE": 9,
  "fiabilite": 100,
  "distributionDPE": {
    "A": 1, "B": 1, "C": 2, "D": 2, "E": 1, "F": 1, "G": 1
  },
  "medianParClasse": {
    "A": 3263, "B": 3000, "C": 2825, "D": 2675, "E": 2500, "F": 2400, "G": 2200
  },
  "message": "Estimation avec pondération DPE D"
}
```

---

## 📚 Références

- **BDNB** : Base Nationale du Bâtiment (CSTB + ADEME)
- **DVF** : Demande de Valeurs Foncières (DGFiP)
- **DPE** : Diagnostic de Performance Énergétique (depuis 2021)
- **Algorithme** : Médiane pondérée avec ajustement multi-critères

---

## ✅ Avantages de cette méthode

| Avantage | Description |
|----------|-------------|
| **Précision** | Utilise les écarts réels du marché local, pas de coefficients nationaux |
| **Adaptabilité** | S'adapte à chaque secteur géographique |
| **Transparence** | Chaque ajustement est traçable et justifiable |
| **Fiabilité** | Indicateur de confiance basé sur le volume de données |
| **Évolutif** | Amélioration automatique avec plus de transactions DPE |

---

*Document créé le 12 octobre 2025*



