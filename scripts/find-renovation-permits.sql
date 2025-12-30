-- 🔍 SCRIPT SQL POUR TROUVER LES PERMIS DE CONSTRUIRE AVEC RÉNOVATION
-- 
-- Les permis de rénovation sont identifiés par :
-- - type_terrain = 'RENOVATION' dans terrains_pc_sans_pa
-- - Ou NATURE_PROJET_COMPLETEE = '2' / NATURE_PROJET_DECLAREE = '2' dans les PC
--
-- Base de données : terrains_pc_sans_pa.db ou terrains_batir_complet.db

-- ═══════════════════════════════════════════════════════════
-- 1. PERMIS DE RÉNOVATION DANS terrains_pc_sans_pa.db
-- ═══════════════════════════════════════════════════════════

-- Compter les permis de rénovation
SELECT 
    COUNT(*) as total_renovations,
    SUM(CASE WHEN surface_reelle_bati > 0 THEN 1 ELSE 0 END) as avec_bati,
    SUM(CASE WHEN surface_totale > 0 THEN 1 ELSE 0 END) as avec_terrain,
    AVG(valeur_fonciere) as prix_moyen,
    AVG(surface_reelle_bati) as surface_bati_moyenne,
    AVG(surface_totale) as surface_terrain_moyenne,
    AVG(prix_m2) as prix_m2_moyen
FROM terrains_pc_sans_pa
WHERE type_terrain = 'RENOVATION';

-- Lister les permis de rénovation avec détails
SELECT 
    id,
    id_parcelle,
    id_mutation,
    valeur_fonciere,
    surface_totale,
    surface_reelle_bati,
    prix_m2,
    date_mutation,
    nom_commune,
    code_commune,
    code_departement,
    latitude,
    longitude,
    type_terrain
FROM terrains_pc_sans_pa
WHERE type_terrain = 'RENOVATION'
ORDER BY date_mutation DESC
LIMIT 100;

-- Statistiques par département
SELECT 
    code_departement,
    COUNT(*) as nb_renovations,
    AVG(valeur_fonciere) as prix_moyen,
    AVG(surface_reelle_bati) as surface_bati_moyenne,
    AVG(prix_m2) as prix_m2_moyen
FROM terrains_pc_sans_pa
WHERE type_terrain = 'RENOVATION'
GROUP BY code_departement
ORDER BY nb_renovations DESC;

-- Statistiques par commune
SELECT 
    code_commune,
    nom_commune,
    COUNT(*) as nb_renovations,
    AVG(valeur_fonciere) as prix_moyen,
    AVG(surface_reelle_bati) as surface_bati_moyenne
FROM terrains_pc_sans_pa
WHERE type_terrain = 'RENOVATION'
GROUP BY code_commune, nom_commune
HAVING nb_renovations >= 5
ORDER BY nb_renovations DESC
LIMIT 50;

-- ═══════════════════════════════════════════════════════════
-- 2. PERMIS DE RÉNOVATION DANS terrains_batir_complet.db
-- ═══════════════════════════════════════════════════════════

-- Si la base complète existe, chercher aussi dedans
SELECT 
    COUNT(*) as total_renovations,
    AVG(valeur_fonciere) as prix_moyen,
    AVG(surface_reelle_bati) as surface_bati_moyenne
FROM terrains_batir_complet
WHERE type_terrain = 'RENOVATION';

-- ═══════════════════════════════════════════════════════════
-- 3. EXPORT DES PERMIS DE RÉNOVATION (CSV)
-- ═══════════════════════════════════════════════════════════

-- Pour exporter en CSV avec sqlite3 :
-- sqlite3 -header -csv terrains_pc_sans_pa.db "SELECT * FROM terrains_pc_sans_pa WHERE type_terrain = 'RENOVATION'" > renovations.csv

