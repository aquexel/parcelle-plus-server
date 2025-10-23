#!/bin/bash

#############################################
# 🔧 CORRECTION RAPIDE DPE - Test des modifications
#############################################

PROJECT_DIR="${1:-/opt/parcelle-plus}"
CSV_DIR="$PROJECT_DIR/bdnb_data/csv"
DB_FILE="$PROJECT_DIR/database/dvf_avec_dpe_et_annexes_enhanced.db"

echo "🔧 === CORRECTION RAPIDE DPE ==="
echo "📂 Répertoire projet : $PROJECT_DIR"
echo ""

cd "$PROJECT_DIR"

# Vérifier que les fichiers CSV existent
if [ ! -d "$CSV_DIR" ]; then
    echo "❌ Dossier CSV introuvable : $CSV_DIR"
    echo "💡 Exécutez d'abord : bash update-dvf-dpe-database.sh"
    exit 1
fi

# Vérifier le fichier DPE spécifique
DPE_FILE="$CSV_DIR/batiment_groupe_dpe_representatif_logement.csv"
if [ ! -f "$DPE_FILE" ]; then
    echo "❌ Fichier DPE introuvable : $DPE_FILE"
    echo "💡 Vérifiez que l'extraction s'est bien passée"
    exit 1
fi

echo "✅ Fichier DPE trouvé : $(du -h "$DPE_FILE" | cut -f1)"
echo ""

# Afficher les premières lignes pour vérifier la structure
echo "📋 Structure du fichier DPE :"
head -n 3 "$DPE_FILE" | cut -d',' -f1-5
echo ""

# Vérifier que batiment_groupe_id est bien présent
if head -n 1 "$DPE_FILE" | grep -q "batiment_groupe_id"; then
    echo "✅ Colonne batiment_groupe_id trouvée"
else
    echo "❌ Colonne batiment_groupe_id manquante"
    echo "📋 Colonnes disponibles :"
    head -n 1 "$DPE_FILE"
    exit 1
fi

# Vérifier que classe_dpe est bien présent
if head -n 1 "$DPE_FILE" | grep -q "classe_dpe"; then
    echo "✅ Colonne classe_dpe trouvée"
else
    echo "❌ Colonne classe_dpe manquante"
    echo "📋 Colonnes disponibles :"
    head -n 1 "$DPE_FILE"
    exit 1
fi

echo ""
echo "🏗️ Création de la base avec les corrections..."

# Supprimer l'ancienne base
if [ -f "$DB_FILE" ]; then
    echo "🗑️ Suppression ancienne base..."
    rm -f "$DB_FILE"
fi

# Créer la nouvelle base
NODE_OPTIONS="--max-old-space-size=4096" node create-dvf-dpe-annexes-db-enhanced.js "$CSV_DIR"

if [ $? -ne 0 ]; then
    echo "❌ Erreur lors de la création"
    exit 1
fi

if [ ! -f "$DB_FILE" ]; then
    echo "❌ Base non créée"
    exit 1
fi

echo ""
echo "✅ Base créée : $(du -h "$DB_FILE" | cut -f1)"
echo ""

# Tester la liaison DPE
echo "🔍 Test de liaison DPE..."
node test-dpe-linking.js

echo ""
echo "✅ === CORRECTION TERMINÉE ==="
