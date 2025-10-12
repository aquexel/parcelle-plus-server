#!/bin/bash
# Script pour télécharger les données BDNB (Base Nationale du Bâtiment) - FRANCE ENTIÈRE
# Usage: ./download-bdnb-data.sh

set -e  # Arrêt en cas d'erreur

# Configuration
DATA_DIR="/opt/parcelle-plus/data"
BDNB_DIR="$DATA_DIR/bdnb_csv"
TEMP_DIR="/tmp/bdnb_download"

echo "🚀 === TÉLÉCHARGEMENT DONNÉES BDNB - FRANCE ENTIÈRE ==="
echo "📂 Destination : $BDNB_DIR"
echo ""

# Créer les dossiers nécessaires
mkdir -p "$DATA_DIR"
mkdir -p "$TEMP_DIR"

# URL de téléchargement BDNB - FRANCE ENTIÈRE (data.gouv.fr)
BDNB_URL="https://www.data.gouv.fr/api/1/datasets/r/ad4bb2f6-0f40-46d2-a636-8d2604532f74"

echo "📥 Téléchargement des données BDNB France entière..."
echo "URL : $BDNB_URL"
echo "⚠️ Fichier volumineux (~plusieurs GB), le téléchargement peut prendre 15-30 minutes"
echo ""

# Vérifier si wget ou curl est disponible
if command -v wget &> /dev/null; then
    DOWNLOAD_CMD="wget -O"
elif command -v curl &> /dev/null; then
    DOWNLOAD_CMD="curl -L -o"
else
    echo "❌ Erreur : wget ou curl requis"
    exit 1
fi

# Télécharger l'archive
ZIP_FILE="$TEMP_DIR/bdnb_france.zip"
echo "⏳ Téléchargement en cours..."
echo "💡 Astuce : utilisez 'screen' ou 'tmux' pour éviter les interruptions"
echo ""

# Téléchargement avec barre de progression
if command -v wget &> /dev/null; then
    wget --progress=bar:force -O "$ZIP_FILE" "$BDNB_URL"
    DOWNLOAD_STATUS=$?
elif command -v curl &> /dev/null; then
    curl -# -L -o "$ZIP_FILE" "$BDNB_URL"
    DOWNLOAD_STATUS=$?
fi

if [ $DOWNLOAD_STATUS -eq 0 ] && [ -f "$ZIP_FILE" ]; then
    echo "✅ Téléchargement terminé"
else
    echo "❌ Erreur lors du téléchargement"
    echo "💡 Vérifiez que l'URL est correcte ou téléchargez manuellement depuis :"
    echo "   https://www.data.gouv.fr/fr/datasets/base-nationale-des-batiments/"
    exit 1
fi

# Vérifier la taille du fichier
FILE_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
echo "📦 Taille du fichier : $FILE_SIZE"

# Décompresser l'archive
echo ""
echo "📦 Décompression des données..."
rm -rf "$BDNB_DIR"
mkdir -p "$BDNB_DIR"

if command -v unzip &> /dev/null; then
    unzip -q "$ZIP_FILE" -d "$TEMP_DIR"
else
    echo "❌ Erreur : unzip requis"
    echo "Installation: sudo apt-get install unzip"
    exit 1
fi

# Déplacer les fichiers CSV
CSV_DIR=$(find "$TEMP_DIR" -type d -name "csv" | head -n 1)
if [ -d "$CSV_DIR" ]; then
    mv "$CSV_DIR"/* "$BDNB_DIR/"
    echo "✅ Fichiers CSV extraits dans $BDNB_DIR"
else
    echo "❌ Erreur : dossier CSV non trouvé dans l'archive"
    exit 1
fi

# Compter les fichiers CSV
CSV_COUNT=$(ls -1 "$BDNB_DIR"/*.csv 2>/dev/null | wc -l)
echo "📊 $CSV_COUNT fichiers CSV extraits"

# Afficher les fichiers importants
echo ""
echo "📋 Fichiers clés extraits :"
if [ -f "$BDNB_DIR/batiment_groupe_dvf_open_representatif.csv" ]; then
    SIZE=$(du -h "$BDNB_DIR/batiment_groupe_dvf_open_representatif.csv" | cut -f1)
    LINES=$(wc -l < "$BDNB_DIR/batiment_groupe_dvf_open_representatif.csv")
    echo "  ✅ batiment_groupe_dvf_open_representatif.csv ($SIZE, $LINES lignes)"
fi

if [ -f "$BDNB_DIR/batiment_groupe_dpe_representatif_logement.csv" ]; then
    SIZE=$(du -h "$BDNB_DIR/batiment_groupe_dpe_representatif_logement.csv" | cut -f1)
    LINES=$(wc -l < "$BDNB_DIR/batiment_groupe_dpe_representatif_logement.csv")
    echo "  ✅ batiment_groupe_dpe_representatif_logement.csv ($SIZE, $LINES lignes)"
fi

if [ -f "$BDNB_DIR/batiment_groupe_adresse.csv" ]; then
    SIZE=$(du -h "$BDNB_DIR/batiment_groupe_adresse.csv" | cut -f1)
    LINES=$(wc -l < "$BDNB_DIR/batiment_groupe_adresse.csv")
    echo "  ✅ batiment_groupe_adresse.csv ($SIZE, $LINES lignes)"
fi

# Nettoyer les fichiers temporaires
echo ""
echo "🧹 Nettoyage des fichiers temporaires..."
rm -rf "$TEMP_DIR"
echo "✅ Nettoyage terminé"

# Afficher l'espace disque utilisé
echo ""
echo "💾 Espace disque utilisé :"
du -sh "$BDNB_DIR"

echo ""
echo "✅ === TÉLÉCHARGEMENT TERMINÉ ==="
echo ""
echo "📝 Prochaine étape :"
echo "   cd /opt/parcelle-plus"
echo "   node enrich_dvf_with_dpe.js $BDNB_DIR"
echo ""
echo "💡 Ou pour un département spécifique :"
echo "   node enrich_dvf_with_dpe.js $BDNB_DIR 40  # Pour les Landes"
echo ""

