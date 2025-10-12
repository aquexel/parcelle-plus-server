#!/bin/bash

#############################################
# 🔄 MISE À JOUR BASE DVF + DPE + ANNEXES
# Script simple et robuste
#############################################

PROJECT_DIR="${1:-/opt/parcelle-plus}"
BDNB_URL="https://www.data.gouv.fr/api/1/datasets/r/ad4bb2f6-0f40-46d2-a636-8d2604532f74"
BDNB_DIR="$PROJECT_DIR/bdnb_data"
BDNB_ARCHIVE="$BDNB_DIR/bdnb_france.tar.gz"
CSV_DIR="$BDNB_DIR/csv"
DB_FILE="$PROJECT_DIR/database/dvf_avec_dpe_et_annexes.db"

echo "🔄 === MISE À JOUR BASE DVF + DPE + ANNEXES ==="
echo ""
echo "📂 Répertoire projet : $PROJECT_DIR"
echo "💾 Base de données : $DB_FILE"
echo ""

cd "$PROJECT_DIR"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📥 ÉTAPE 1/4 : Téléchargement
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 ÉTAPE 1/4 : Téléchargement données BDNB"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

mkdir -p "$BDNB_DIR"

if [ -f "$BDNB_ARCHIVE" ]; then
    echo "✅ Archive déjà présente"
    SIZE=$(du -h "$BDNB_ARCHIVE" | cut -f1)
    echo "   Taille : $SIZE"
else
    echo "📥 Téléchargement de toute la France (~35 GB)"
    echo "⚠️  Cela peut prendre 15-40 minutes"
    echo ""
    
    wget --progress=bar:force \
         -O "$BDNB_ARCHIVE" \
         "$BDNB_URL"
    
    if [ ! -f "$BDNB_ARCHIVE" ]; then
        echo "❌ Erreur : Téléchargement échoué"
        exit 1
    fi
    
    SIZE=$(du -h "$BDNB_ARCHIVE" | cut -f1)
    echo ""
    echo "✅ Archive téléchargée : $SIZE"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 2/4 : Extraction
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 2/4 : Extraction des fichiers nécessaires"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "🗑️  Nettoyage ancien dossier CSV..."
sudo rm -rf "$CSV_DIR"
sudo mkdir -p "$CSV_DIR"

# Liste des fichiers à extraire
declare -a FILES=(
    "batiment_groupe.csv"
    "batiment_groupe_dpe_representatif_logement.csv"
    "batiment_groupe_dvf_open_representatif.csv"
    "rel_batiment_groupe_parcelle.csv"
    "rel_parcelle_sitadel.csv"
    "sitadel.csv"
)

TOTAL=${#FILES[@]}
EXTRACTED=0

for i in "${!FILES[@]}"; do
    FILE="${FILES[$i]}"
    NUM=$((i + 1))
    
    echo "[$NUM/$TOTAL] 📦 $FILE"
    
    # Extraire le fichier (structure: ./csv/fichier.csv → enlever ./ et csv/)
    EXTRACT_OUTPUT=$(sudo tar -xzf "$BDNB_ARCHIVE" "./csv/$FILE" --strip-components=2 -C "$CSV_DIR" 2>&1)
    EXTRACT_EXIT=$?
    
    # Vérifier si extrait
    if [ -f "$CSV_DIR/$FILE" ]; then
        SIZE=$(du -h "$CSV_DIR/$FILE" | cut -f1)
        echo "        ✅ $SIZE"
        ((EXTRACTED++))
    else
        echo "        ❌ Échec extraction (exit: $EXTRACT_EXIT)"
        if [ -n "$EXTRACT_OUTPUT" ]; then
            echo "        Erreur: $EXTRACT_OUTPUT"
        fi
    fi
    
    echo ""
done

echo "📊 Résultat : $EXTRACTED/$TOTAL fichiers extraits"
echo ""

if [ $EXTRACTED -eq 0 ]; then
    echo "❌ Aucun fichier extrait, abandon"
    exit 1
fi

if [ $EXTRACTED -lt $TOTAL ]; then
    echo "⚠️  Certains fichiers manquants, mais on continue..."
    echo ""
fi

# Supprimer l'archive immédiatement pour libérer 36G
if [ -f "$BDNB_ARCHIVE" ]; then
    echo "🗑️  Suppression archive (36G)..."
    sudo rm -f "$BDNB_ARCHIVE"
    echo "✅ Archive supprimée - 36G libérés"
    echo ""
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🏗️  ÉTAPE 3/4 : Création de la base
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️  ÉTAPE 3/4 : Création de la base de données"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -f "$DB_FILE" ]; then
    echo "🗑️  Suppression ancienne base..."
    rm -f "$DB_FILE"
fi

mkdir -p "$(dirname "$DB_FILE")"

echo "⏳ Création en cours (10-30 minutes selon serveur)..."
echo ""

NODE_OPTIONS="--max-old-space-size=4096" node create-dvf-dpe-annexes-db.js "$CSV_DIR"

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Erreur lors de la création"
    exit 1
fi

if [ ! -f "$DB_FILE" ]; then
    echo "❌ Base non créée"
    exit 1
fi

DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
echo ""
echo "✅ Base créée : $DB_SIZE"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🧹 ÉTAPE 4/4 : Nettoyage
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 ÉTAPE 4/4 : Nettoyage automatique"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CSV_SIZE=$(du -sh "$CSV_DIR" 2>/dev/null | cut -f1 || echo "0")

echo "💾 Nettoyage CSV ($CSV_SIZE)..."
echo ""

# Supprimer CSV
if [ -d "$CSV_DIR" ]; then
    echo "🗑️  Suppression CSV..."
    sudo rm -rf "$CSV_DIR"
    echo "✅ CSV supprimés"
fi

# Supprimer dossier si vide
if [ -d "$BDNB_DIR" ] && [ -z "$(ls -A "$BDNB_DIR")" ]; then
    sudo rmdir "$BDNB_DIR"
    echo "✅ Dossier bdnb_data supprimé"
fi

echo ""
echo "💡 CSV nettoyés (archive déjà supprimée)"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ✅ FIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ MISE À JOUR TERMINÉE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Base : $DB_FILE ($DB_SIZE)"
echo ""
echo "🎯 Prochaines étapes :"
echo "   1. pm2 restart parcelle-server"
echo "   2. Tester l'API"
echo ""

# Afficher statistiques si sqlite3 disponible
if command -v sqlite3 &> /dev/null; then
    echo "📈 Statistiques :"
    sqlite3 "$DB_FILE" <<EOF
SELECT 'Transactions: ' || COUNT(*) FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec DPE: ' || SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) || ' (' || ROUND(100.0 * SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec piscine: ' || SUM(presence_piscine) || ' (' || ROUND(100.0 * SUM(presence_piscine) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec garage: ' || SUM(presence_garage) || ' (' || ROUND(100.0 * SUM(presence_garage) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec véranda: ' || SUM(presence_veranda) || ' (' || ROUND(100.0 * SUM(presence_veranda) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
EOF
    echo ""
fi

echo "✅ Script terminé avec succès !"
