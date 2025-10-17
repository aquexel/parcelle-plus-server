# 🏗️ Architecture complète DVF + DPE

## 📂 Structure des données

```
raspberry-pi-server/
│
├── database/
│   ├── parcelle_chat.db          ← Base principale
│   │   ├── users                  (utilisateurs)
│   │   ├── announcements          (annonces)
│   │   ├── messages               (messagerie)
│   │   └── dvf_local              (DVF sans DPE)
│   │
│   └── dpe_bdnb.db               ← Base DPE (NOUVELLE) ⭐
│       └── dvf_avec_dpe           (~64k transactions Landes)
│           ├── batiment_groupe_id
│           ├── valeur_fonciere
│           ├── date_mutation
│           ├── surface_bati_maison
│           ├── surface_bati_appartement
│           ├── nb_pieces
│           ├── prix_m2_local
│           ├── classe_dpe          ⭐ (A-G)
│           ├── conso_energie       (kWh/m²/an)
│           ├── annee_construction
│           ├── latitude
│           └── longitude
│
├── services/
│   └── DVFWithDPEService.js      ← Calcul pondération DPE
│
├── enrich_dvf_with_dpe.js        ← Script d'import BDNB
│
└── METHODOLOGIE_DPE.md           ← Documentation complète
```

---

## 🔄 Flux d'estimation avec DPE

```
┌─────────────────────────────────────────────────────┐
│  1. UTILISATEUR                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ Estimation appartement 80m², DPE D           │  │
│  │ Localisation: 43.8971, -0.4987 (Mont-de-M.) │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼ HTTP POST /api/dvf/estimate-with-dpe
┌─────────────────────────────────────────────────────┐
│  2. SERVEUR NODE.JS                                 │
│  ┌──────────────────────────────────────────────┐  │
│  │ DVFWithDPEService.estimateWithDPE()          │  │
│  │                                               │  │
│  │ a) Recherche transactions rayon 1km          │  │
│  │    SELECT * FROM dpe_bdnb.dvf_avec_dpe       │  │
│  │    WHERE distance < 1000                     │  │
│  │    AND classe_dpe IS NOT NULL                │  │
│  │                                               │  │
│  │    → 9 transactions trouvées                 │  │
│  │                                               │  │
│  │ b) Calcul prix médian par classe DPE         │  │
│  │    A: 3263€/m² (1 txn)                       │  │
│  │    B: 3000€/m² (1 txn)                       │  │
│  │    C: 2825€/m² (2 txn)                       │  │
│  │    D: 2675€/m² (2 txn) ← CIBLE               │  │
│  │    E: 2500€/m² (1 txn)                       │  │
│  │    F: 2400€/m² (1 txn)                       │  │
│  │    G: 2200€/m² (1 txn)                       │  │
│  │                                               │  │
│  │ c) Calcul écarts entre classes               │  │
│  │    A→B: -8.1%    D→E: -6.5%                  │  │
│  │    B→C: -5.8%    E→F: -4.0%                  │  │
│  │    C→D: -5.3%    F→G: -8.3%                  │  │
│  │                                               │  │
│  │ d) Ajustement transactions vers DPE D        │  │
│  │    Txn C (2800€) → 2652€ (-5.3%)             │  │
│  │    Txn E (2500€) → 2663€ (+6.5%)             │  │
│  │    Txn G (2200€) → 2638€ (+19.9%)            │  │
│  │    Txn D (2700€) → 2700€ (0%)                │  │
│  │    ...                                        │  │
│  │                                               │  │
│  │ e) Médiane des prix ajustés                  │  │
│  │    [2638, 2650, 2652, 2654, 2663,            │  │
│  │     2672, 2676, 2699, 2700]                  │  │
│  │            ↓                                  │  │
│  │    MÉDIANE = 2668€/m²                        │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼ JSON Response
┌─────────────────────────────────────────────────────┐
│  3. APPLICATION ANDROID                             │
│  ┌──────────────────────────────────────────────┐  │
│  │ 💰 ESTIMATION TOTALE                         │  │
│  │ ━━━━━━━━━━━━━━━━━                           │  │
│  │                                               │  │
│  │ Prix total : 213 440€                        │  │
│  │ Prix/m² : 2 668€/m² (DPE D)                  │  │
│  │ Fiabilité : 100%                             │  │
│  │ 📊 Transactions : 9 (9 avec DPE)             │  │
│  │                                               │  │
│  │ 📊 DISTRIBUTION DPE                          │  │
│  │ ━━━━━━━━━━━━━━━━━                           │  │
│  │ 🟢 Classe A : 1 transaction                  │  │
│  │ 🟢 Classe B : 1 transaction                  │  │
│  │ 🟡 Classe C : 2 transactions                 │  │
│  │ 🟡 Classe D : 2 transactions ⭐              │  │
│  │ 🟠 Classe E : 1 transaction                  │  │
│  │ 🔴 Classe F : 1 transaction                  │  │
│  │ 🔴 Classe G : 1 transaction                  │  │
│  │                                               │  │
│  │ [🔍 Voir les transactions]                   │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 🎯 Formule de calcul

### **Ajustement d'une transaction**

```
Prix ajusté = Prix original × Facteur d'ajustement

Facteur d'ajustement = (Prix médian DPE cible) / (Prix médian DPE transaction)

Ou si médiane non disponible :

Facteur d'ajustement = ∏ (1 + écart classe i → classe i+1)
```

### **Exemple : Transaction DPE G vers DPE D**

```
Transaction : 2 200€/m² (DPE G)
Cible : DPE D

Chemin : G → F → E → D

Facteur = (1 + écart G→F) × (1 + écart F→E) × (1 + écart E→D)
        = (1 + 0.083) × (1 + 0.040) × (1 + 0.065)
        = 1.083 × 1.040 × 1.065
        = 1.199

Prix ajusté = 2 200€ × 1.199 = 2 638€/m²
```

---

## 📊 Comparaison des méthodes

| Aspect | Sans DPE | Avec DPE pondéré |
|--------|----------|------------------|
| **Transactions utilisées** | Toutes (9) | Avec DPE (9) |
| **Prix médian brut** | 2 575€/m² | - |
| **Ajustement** | Aucun | Vers DPE D |
| **Prix médian ajusté** | - | 2 668€/m² |
| **Estimation 80m²** | 206 000€ | 213 440€ |
| **Écart** | - | **+7 440€ (+3.6%)** |
| **Fiabilité** | 90% | 100% |

---

## 🚀 Mise en production

### **1. Import des données DPE (une fois)**

```bash
cd raspberry-pi-server
node enrich_dvf_with_dpe.js
```

**Résultat** : Création de `database/dpe_bdnb.db` avec ~64k transactions enrichies

### **2. Route API à ajouter dans server.js**

```javascript
const DVFWithDPEService = require('./services/DVFWithDPEService');

app.post('/api/dvf/estimate-with-dpe', async (req, res) => {
    const { latitude, longitude, dpe_cible, type_filtre, rayon_metres } = req.body;
    
    try {
        const result = await DVFWithDPEService.estimateWithDPE(
            latitude,
            longitude,
            dpe_cible,
            type_filtre,
            rayon_metres || 1000,
            24 // 24 mois
        );
        
        res.json(result);
    } catch (error) {
        console.error('Erreur estimation DPE:', error);
        res.status(500).json({ error: error.message });
    }
});
```

### **3. Modification Android (MainActivity.kt)**

Ajouter un champ DPE dans l'interface :

```kotlin
// Spinner pour sélectionner le DPE
val dpeSpinner = Spinner(this).apply {
    adapter = ArrayAdapter(
        this@MainActivity,
        android.R.layout.simple_spinner_item,
        arrayOf("Non renseigné", "A", "B", "C", "D", "E", "F", "G")
    )
}

// Lors du calcul DVF
val dpeSelectionne = dpeSpinner.selectedItem.toString()
val dpeCible = if (dpeSelectionne == "Non renseigné") null else dpeSelectionne

launchDVFCalculationWithDPE(surface, lat, lng, dpeCible)
```

---

## 📈 Évolution future

### **Phase 1 (Actuelle)**
- ✅ Base DPE département 40
- ✅ Pondération par classe DPE
- ✅ API serveur

### **Phase 2**
- 🔄 Ajout autres départements (64, 33, 47...)
- 🔄 Cache Android pour mode hors-ligne
- 🔄 Affichage graphique distribution DPE

### **Phase 3**
- 🔮 Prédiction DPE si non fourni (ML)
- 🔮 Estimation coût rénovation énergétique
- 🔮 Impact DPE sur délai de vente

---

## 📋 Checklist déploiement

- [ ] Télécharger données BDNB département 40
- [ ] Exécuter `enrich_dvf_with_dpe.js`
- [ ] Vérifier création `dpe_bdnb.db` (~15-20 MB)
- [ ] Ajouter route API `/api/dvf/estimate-with-dpe`
- [ ] Tester avec Postman/curl
- [ ] Modifier interface Android (spinner DPE)
- [ ] Compiler et tester APK
- [ ] Déployer sur serveur OVH
- [ ] Mettre à jour documentation utilisateur

---

*Architecture finalisée - ParcellePlus v2.0 avec DPE*



