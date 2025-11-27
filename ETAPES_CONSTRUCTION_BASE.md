# 📊 Étapes de Construction de la Base de Données `terrains_batir.db`

## Vue d'ensemble

Le script `create-terrains-batir-V3.js` construit une base de données SQLite contenant les terrains à bâtir associés aux Permis d'Aménager (PA), en croisant les données DVF (Demandes de Valeurs Foncières) avec les PA.

---

## 🔄 ÉTAPE 0 : Chargement des parcelles cadastrales

**Objectif** : Créer une base de données dédiée pour les parcelles cadastrales

- **Fichier source** : `parcelle.csv`
- **Base de données** : `parcelles.db`
- **Table créée** : `parcelle`
- **Colonnes** :
  - `parcelle_id` (PRIMARY KEY)
  - `geom_parcelle` (géométrie)
  - `s_geom_parcelle` (superficie)
  - `code_departement_insee`
  - `code_commune_insee`
  - ⚠️ **Note** : Pas de colonne `nom_commune` dans cette table
- **Index créés** : `idx_parcelle_commune` sur `code_commune_insee`
- **Utilisation** : 
  - Enrichissement des coordonnées GPS (centroïde depuis `geom_parcelle`)
  - Enrichissement des superficies (depuis `s_geom_parcelle`)
- **Note** : Le nom de commune est enrichi depuis `v_commune_2025.csv` via le code INSEE, pas depuis cette table (voir ÉTAPE 4.1)

---

## 📥 ÉTAPE 1 : Chargement des données DVF

**Objectif** : Charger toutes les transactions DVF directement dans `terrains_batir_temp`

- **Fichiers sources** : `dvf_*.csv` dans `dvf_data/`
- **Table créée** : `terrains_batir_temp`
- **Colonnes** :
  - `id_parcelle` (ex: "40088000BL0056")
  - `id_mutation`
  - `valeur_fonciere`
  - `surface_totale`
  - `surface_reelle_bati`
  - `date_mutation`
  - `code_departement` (✅ **extrait directement depuis la DVF**, 2 chiffres)
  - `code_commune` (✅ **code INSEE reconstruit depuis code_departement + code_commune DVF**, 5 chiffres)
  - `section_cadastrale`
  - `parcelle_suffixe` (ex: "000BL0056")
  - `nom_commune` (✅ **extrait directement depuis la DVF**)
  - `prix_m2` (calculé ou NULL)
  - `est_terrain_viabilise` (0 ou 1)
  - `id_pa` (NULL initialement)
- **Construction du code INSEE** :
  - La DVF contient `code_departement` (2 chiffres) et `code_commune` (3 chiffres)
  - Le code INSEE complet (5 chiffres) est reconstruit : `code_departement` (2) + `code_commune` (3) = code INSEE
  - Exemple : Département "40" + Commune "088" = Code INSEE "40088"
  - Ce code INSEE est stocké dans la colonne `code_commune` de `terrains_batir_temp`
  - Il peut aussi être extrait des 5 premiers caractères de `id_parcelle` (méthode alternative)
- **Optimisation** : Chargement direct sans table intermédiaire (économie ~14 GB)
- **Déduplication** : Effectuée pendant le chargement (une parcelle = une ligne max)
- **Résultat** : ~4-6M lignes (au lieu de 36M sans déduplication)

---

## ⚡ ÉTAPE 2 : Création des index sur `terrains_batir_temp`

**Objectif** : Optimiser les jointures et recherches futures

- **Mode journal** : `DELETE` (pour économiser l'espace disque)
- **Index créés** :
  1. `idx_temp_departement` sur `code_departement`
  2. `idx_temp_commune_section` sur `code_commune, section_cadastrale`
  3. `idx_temp_commune_section_suffixe` sur `code_commune, section_cadastrale, parcelle_suffixe`
  4. `idx_temp_mutation` sur `id_mutation`
  5. `idx_temp_pa` sur `id_pa`
- **Durée estimée** : 6-12 minutes
- **Checkpoint** : Après chaque index pour libérer l'espace

---

## 📊 ÉTAPE 3 : Création de la vue agrégée par mutation

**Objectif** : Agréger les transactions par `id_mutation` (une mutation = plusieurs parcelles)

- **Table créée** : `terrains_batir_deduplique` (copie des données dédupliquées)
- **Table créée** : `mutations_aggregees`
- **Colonnes agrégées** :
  - `id_mutation`
  - `surface_totale_aggregee` (SOMME)
  - `valeur_totale` (MAX)
  - `date_mutation` (MIN)
  - `code_departement`
  - `nom_commune` (MIN)
  - `section_cadastrale` (MIN)
  - `code_commune` (MIN)
- **Index créés** :
  - `idx_mutations_agg_id` sur `id_mutation`
  - `idx_mutations_agg_date` sur `date_mutation`
- **Résultat** : ~4-6M mutations agrégées

---

## 📋 ÉTAPE 4 : Chargement des Permis d'Aménager (PA)

**Objectif** : Charger et traiter les PA depuis le fichier CSV

### 4.1 : Explosion des parcelles PA

- **Fichier source** : `Liste-des-permis-damenager.2025-10.csv`
- **Table créée** : `pa_parcelles_temp`
- **Colonnes** :
  - `num_pa`
  - `code_commune_dfi` (3 derniers chiffres du code INSEE pour DFI)
  - `code_commune_dvf` (✅ **code INSEE pour jointure DVF**, 5 chiffres)
  - `code_insee` (code INSEE complet du PA, pour enrichissement depuis `v_commune_2025.csv`)
  - `nom_commune` (enrichi depuis `v_commune_2025.csv`)
  - `section`
  - `parcelle_normalisee` (ex: "BL0056" avec padding à 4 chiffres)
  - `superficie`
  - `date_auth`
- **Traitement** :
  - Extraction des sections et numéros de parcelles depuis les colonnes du PA
  - Normalisation des numéros (padding à 4 chiffres)
- **Index créés** :
  - `idx_pa_parcelles_commune` sur `code_commune_dfi, parcelle_normalisee`
  - `idx_pa_parcelles_section` sur `code_commune_dvf, section`

### 4.2 : Recherche achats lotisseurs sur parcelles mères

**Objectif** : Trouver les transactions DVF correspondant aux parcelles mères du PA (ACHAT AVANT DIVISION)

- **Table créée** : `achats_lotisseurs_meres`
- **Colonnes** :
  - `num_pa`
  - `id_mutation`
  - `date_mutation`
  - `date_auth`
  - `superficie`
  - `surface_totale_aggregee`
- **Critères de jointure** :
  - `code_commune` (DVF) = `code_commune_dvf` (PA) ✅ **Utilisation du code INSEE uniquement**
  - `nom_commune` (DVF) = `nom_commune` (PA) (si disponible)
  - `section_cadastrale` (DVF) = `section` (PA)
  - `parcelle_suffixe` (DVF) = `'000' || parcelle_normalisee` (PA)
- **Calcul du rang** : `ROW_NUMBER() OVER (PARTITION BY num_pa ORDER BY date_mutation)` pour prendre la première transaction chronologiquement
- **Mise à jour** : `terrains_batir_temp.est_terrain_viabilise = 0` et `id_pa` pour les transactions trouvées

### 4.3 : Association PA → DFI → Parcelles filles

**Objectif** : Pour les PA sans transaction mère, trouver les parcelles filles via la DFI

- **Table créée** : `pa_filles_temp`
- **Colonnes** :
  - `num_pa`
  - `code_commune_dvf` (✅ **code INSEE pour jointure DVF**, 5 chiffres)
  - `code_insee` (code INSEE complet du PA, pour enrichissement depuis `v_commune_2025.csv`)
  - `nom_commune` (enrichi depuis `v_commune_2025.csv`)
  - `section`
  - `parcelle_fille`
  - `parcelle_fille_suffixe` (ex: "000BL0056")
  - `superficie`
  - `date_auth`
- **Traitement** :
  - Recherche dans `dfi_indexed` des relations mère-fille
  - Extraction des 3 derniers chiffres du code INSEE pour la recherche DFI
- **Index créé** : `idx_pa_filles_commune_section_suffixe` sur `code_commune_dvf, section, parcelle_fille_suffixe`

### 4.3.5 : Enrichissement des superficies depuis la table parcelle

**Objectif** : Compléter les superficies manquantes depuis `parcelles.db`

- **Source** : Table `parcelle` dans `parcelles.db`
- **Mise à jour** : `pa_filles_temp.superficie` si NULL ou 0
- **Jointure** : Via `parcelle_id` (reconstruction depuis `code_commune_dvf + parcelle_fille_suffixe`)

### 4.4 : Recherche achats lotisseurs sur parcelles filles

**Objectif** : Trouver les transactions DVF correspondant aux parcelles filles (ACHAT AVANT DIVISION)

- **Table créée** : `achats_lotisseurs_filles`
- **Critères de jointure** :
  - `code_commune` (DVF) = `code_commune_dvf` (PA) ✅ **Utilisation du code INSEE uniquement**
  - `nom_commune` (DVF) = `nom_commune` (PA) (si disponible)
  - `section_cadastrale` (DVF) = `section` (PA)
  - `parcelle_suffixe` (DVF) = `parcelle_fille_suffixe` (PA)
  - Jointure avec `pa_filles_temp`
- **Calcul du rang** : Première transaction chronologiquement par PA
- **Mise à jour** : `terrains_batir_temp.est_terrain_viabilise = 0` et `id_pa`

### 4.5 : Association lots vendus (viabilisés)

**Objectif** : Associer toutes les autres transactions sur parcelles filles (LOTS VENDUS)

- **Table créée** : `parcelle_pa_map` (mapping parcelle → PA)
- **Mise à jour** : `terrains_batir_temp.est_terrain_viabilise = 1` et `id_pa`
- **Critères** : Toutes les transactions sur parcelles filles qui n'ont pas déjà un `id_pa`
- **Résultat** : Tous les lots vendus après viabilisation

---

## 📍 ÉTAPE 5 : Enrichissement des coordonnées GPS

**Objectif** : Ajouter les coordonnées GPS depuis la table `parcelle`

- **Source** : Table `parcelle` dans `parcelles.db`
- **Méthode** : Extraction du centroïde depuis `geom_parcelle` (géométrie WKT)
- **Mise à jour** : `terrains_batir_temp.latitude` et `longitude`
- **Jointure** : Via `id_parcelle` (reconstruction depuis les colonnes de `terrains_batir_temp`)

---

## 🎯 ÉTAPE 6 : Création de la table finale simplifiée

**Objectif** : Créer la table finale `terrains_batir` avec structure simplifiée

- **Table créée** : `terrains_batir`
- **Colonnes** :
  - `id` (PRIMARY KEY AUTOINCREMENT)
  - `valeur_fonciere` (MAX par mutation)
  - `surface_totale` (SOMME par mutation)
  - `surface_reelle_bati` (SOMME par mutation)
  - `prix_m2` (recalculé : `valeur_fonciere / surface_totale`)
  - `date_mutation` (MIN par mutation)
  - `latitude` (MOYENNE par mutation)
  - `longitude` (MOYENNE par mutation)
  - `nom_commune` (MAX par mutation)
  - `type_terrain` ('NON_VIABILISE' ou 'VIABILISE')
  - `id_pa`
- **Agrégation** : Par `id_mutation, est_terrain_viabilise, id_pa`
- **Filtres** :
  - Seulement les transactions avec `id_pa IS NOT NULL`
  - Seulement les transactions avec coordonnées GPS (`latitude IS NOT NULL`)
- **Index créés** :
  - `idx_coords` sur `latitude, longitude`
  - `idx_date` sur `date_mutation`
  - `idx_type_terrain` sur `type_terrain`
  - `idx_commune` sur `nom_commune`
  - `idx_pa` sur `id_pa`
- **Nettoyage** : Suppression de `terrains_batir_temp` après copie
- **Mode journal** : Réactivation du WAL pour la table finale

---

## 📈 Résultat final

La base `terrains_batir.db` contient :
- **Transactions** : Toutes les transactions DVF associées à un PA
- **Types** :
  - `NON_VIABILISE` : Achats lotisseurs (parcelles mères ou filles avant division)
  - `VIABILISE` : Lots vendus après viabilisation
- **Couverture** : ~70-75% des PA avec parcelles filles
- **Géolocalisation** : Toutes les transactions ont des coordonnées GPS

---

## 🔄 Script complet (`create-terrains-batir-complet.js`)

Le script complet orchestre :
1. **Téléchargement** des données (DVF, DFI, PA, PC)
2. **ÉTAPE 1/3** : Exécution de `create-terrains-batir-V3.js` (base avec PA)
3. **ÉTAPE 2/3** : Exécution de `create-terrains-pc-sans-pa-V2.js` (base avec PC sans PA)
4. **ÉTAPE 3/3** : Fusion des deux bases en `terrains_batir_complet.db`

---

## ⚙️ Optimisations

1. **Espace disque** : Chargement direct sans table intermédiaire (économie ~14 GB)
2. **Mode journal** : `DELETE` pendant l'indexation pour éviter les fichiers WAL volumineux
3. **Déduplication** : Effectuée pendant le chargement CSV
4. **Traitement par batch** : Par commune pour éviter les jointures massives
5. **Checkpoints réguliers** : Pour libérer l'espace disque temporaire

