#!/bin/bash

#############################################
# 🚀 CRÉATION RAPIDE BASE DE DONNÉES
# Script simple pour utiliser les CSV existants
#############################################

PROJECT_DIR="${1:-/opt/parcelle-plus}"
CSV_DIR="$PROJECT_DIR/bdnb_data/csv"
DB_FILE="$PROJECT_DIR/database/dvf_avec_dpe_et_annexes_enhanced.db"

echo "🚀 === CRÉATION RAPIDE BASE DE DONNÉES ==="
echo ""
echo "📂 Répertoire projet : $PROJECT_DIR"
echo "📁 Dossier CSV : $CSV_DIR"
echo "💾 Base de données : $DB_FILE"
echo ""

cd "$PROJECT_DIR"

# Vérifier que Node.js est installé
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé"
    echo "💡 Installation : sudo apt update && sudo apt install nodejs npm"
    exit 1
fi

# Vérifier que le répertoire CSV existe
if [ ! -d "$CSV_DIR" ]; then
    echo "❌ Répertoire CSV introuvable : $CSV_DIR"
    echo "💡 Assurez-vous que les fichiers CSV sont présents"
    exit 1
fi

# Vérifier les fichiers CSV nécessaires
REQUIRED_FILES=(
    "batiment_groupe.csv"
    "batiment_groupe_dpe_representatif_logement.csv"
    "batiment_groupe_dvf_open_representatif.csv"
    "rel_batiment_groupe_parcelle.csv"
    "parcelle.csv"
)

echo "🔍 Vérification des fichiers CSV :"
ALL_PRESENT=true
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$CSV_DIR/$file" ]; then
        SIZE=$(du -h "$CSV_DIR/$file" | cut -f1)
        echo "   ✅ $file ($SIZE)"
    else
        echo "   ❌ $file - MANQUANT"
        ALL_PRESENT=false
    fi
done

if [ "$ALL_PRESENT" != "true" ]; then
    echo ""
    echo "❌ Tous les fichiers CSV ne sont pas présents"
    echo "💡 Utilisez d'abord le script update-dvf-dpe-database.sh pour télécharger les données"
    exit 1
fi

echo ""
echo "✅ Tous les fichiers CSV sont présents"
echo ""

# Créer le répertoire database s'il n'existe pas
mkdir -p "$(dirname "$DB_FILE")"

# Installer les dépendances Node.js si nécessaire
if [ ! -d "node_modules" ]; then
    echo "📦 Installation des dépendances Node.js..."
    npm install better-sqlite3 csv-parser proj4
    echo ""
fi

# Lancer le script de création
echo "🏗️  Lancement de la création de la base de données..."
echo "   ⏳ Cela peut prendre 5-15 minutes selon la taille des données"
echo ""

node raspberry-pi-server/create-database-from-csv.js "$CSV_DIR"

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 === CRÉATION RÉUSSIE ==="
    echo "📊 Base de données : $DB_FILE"
    echo "📁 Fichiers CSV utilisés : $CSV_DIR"
    echo ""
    echo "✅ Prêt pour utilisation !"
else
    echo ""
    echo "❌ Erreur lors de la création de la base de données"
    exit 1
fi


