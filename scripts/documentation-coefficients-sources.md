# Documentation : Sources des Coefficients de Revalorisation VLF

## 📚 Sources principales pour les coefficients manquants (2013-2021)

### 1. **UNPI - Observatoire national des taxes foncières** ✅
   - **URL**: https://unpi.org/files/UNPI-Observatoire_national_des_taxes_foncieres-Oct2025.pdf
   - **Contenu**: Tableau historique complet des coefficients de revalorisation de 1981 à 2024
   - **Fiabilité**: Très fiable - Référence les lois de finances annuelles
   - **Méthode**: Les pourcentages publiés sont convertis en coefficients multiplicatifs
     - Exemple: +1.8% → 1.018, +0.9% → 1.009, +0.4% → 1.004

### 2. **Brochure IDL DGFiP (Ministère des Finances)** ✅
   - **URL**: https://www.impots.gouv.fr/www2/fichiers/documentation/brochure/idl/
   - **Fichiers disponibles**: 
     - `idl_2025.pdf`
     - `idl_2024.pdf`
     - `idl_2020.pdf`
     - Et d'autres années
   - **Contenu**: Tableaux complets des coefficients par année, avec également les coefficients départementaux de 1980
   - **Fiabilité**: Source officielle gouvernementale

### 3. **BOFIP (Bulletin Officiel des Finances Publiques)**
   - **URL**: https://bofip.impots.gouv.fr/bofip/975-PGP.html
   - **Tableau 1981-2012**: https://bofip.impots.gouv.fr/bofip/975-PGP.html/identifiant%3DBOI-IF-TFB-20-20-20-20-20121210
   - **Contenu**: Documentation officielle, tableau des coefficients 1981-2012
   - **Note**: Pour 2013-2021, se référer aux lois de finances annuelles ou à l'UNPI

### 4. **Lois de finances annuelles (Légifrance)**
   - **Base légale**: Article 1518 bis du Code général des impôts
   - **Méthode**: Les coefficients sont fixés chaque année par la loi de finances
   - **Recherche**: site:legifrance.gouv.fr "loi de finances" "article 1518 bis" [année] "coefficient revalorisation"

## 📊 Coefficients trouvés (2013-2021)

Les coefficients suivants ont été extraits du tableau historique de l'UNPI :

| Année | Pourcentage | Coefficient | Source |
|-------|-------------|-------------|--------|
| 2013 | +1.8% | **1.018** | UNPI (référence loi finances 2013) |
| 2014 | +0.9% | **1.009** | UNPI (référence loi finances 2014) |
| 2015 | +0.9% | **1.009** | UNPI (référence loi finances 2015) |
| 2016 | +1.0% | **1.01** | UNPI (référence loi finances 2016) |
| 2017 | +0.4% | **1.004** | UNPI (référence loi finances 2017) |
| 2018 | +1.2% | **1.012** | UNPI (référence loi finances 2018, basé IPCH) |
| 2019 | +2.2% | **1.022** | UNPI (référence loi finances 2019, basé IPCH) |
| 2020 | +1.2% | **1.012** | UNPI (référence loi finances 2020, basé IPCH) |
| 2021 | +0.2% | **1.002** | UNPI (référence loi finances 2021, basé IPCH) |

## 🔍 Vérification recommandée

Pour une vérification absolue des coefficients 2013-2021, il est recommandé de :

1. **Consulter les brochures IDL officielles** :
   - Télécharger `idl_2024.pdf` ou `idl_2025.pdf` depuis impots.gouv.fr
   - Vérifier le tableau historique des coefficients

2. **Consulter les lois de finances** :
   - Chercher chaque loi de finances annuelle (2013-2021) sur Légifrance
   - Rechercher l'article 1518 bis qui fixe le coefficient

3. **Vérifier l'IPCH INSEE** (pour 2018-2021) :
   - Les coefficients depuis 2018 sont basés sur l'IPCH de novembre de l'année précédente
   - URL INSEE: https://www.insee.fr/fr/statistiques/serie/001759397

## ⚠️ Note importante

Les coefficients trouvés dans le tableau de l'UNPI sont cohérents avec :
- Les pourcentages publiés dans les observatoires
- Les tendances observées (faibles revalorisations 2014-2017, puis hausse 2019-2023)
- La méthode IPCH appliquée depuis 2018

Cependant, **pour une utilisation professionnelle ou fiscale**, il est fortement recommandé de vérifier ces valeurs auprès des sources officielles (DGFiP, lois de finances).
