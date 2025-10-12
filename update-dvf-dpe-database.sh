#!/bin/bash

#############################################
# 🔄 MISE À JOUR BASE DVF + DPE + ANNEXES
# 
# Script complet qui :
# 1. Télécharge les données BDNB
# 2. Extrait uniquement les fichiers nécessaires
# 3. Crée la base de données enrichie
# 4. Nettoie les fichiers temporaires
#############################################

set -e

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
# 📥 ÉTAPE 1/4 : Téléchargement des données BDNB
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 ÉTAPE 1/4 : Téléchargement données BDNB"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Créer le dossier BDNB
mkdir -p "$BDNB_DIR"

# Supprimer l'ancienne archive si elle existe
if [ -f "$BDNB_ARCHIVE" ]; then
    echo "🗑️  Suppression de l'ancienne archive..."
    rm -f "$BDNB_ARCHIVE"
fi

echo "📥 Téléchargement de toute la France (~35 GB)"
echo "⚠️  Cela peut prendre 15-40 minutes selon votre connexion"
echo ""

# Fonction pour afficher une barre de progression
show_progress() {
    local percent=$1
    local width=50
    local filled=$((width * percent / 100))
    local empty=$((width - filled))
    
    printf "\r["
    printf "%${filled}s" | tr ' ' '█'
    printf "%${empty}s" | tr ' ' '░'
    printf "] %3d%%" "$percent"
}

# Télécharger avec wget et barre de progression visuelle
echo "⏳ Téléchargement en cours..."
echo ""

wget --progress=dot:giga \
     -O "$BDNB_ARCHIVE" \
     "$BDNB_URL" 2>&1 | \
     while IFS= read -r line; do
         # Extraire le pourcentage
         if [[ $line =~ ([0-9]+)% ]]; then
             percent="${BASH_REMATCH[1]}"
             show_progress "$percent"
         fi
     done

echo ""
echo ""

# Vérifier que le fichier a été téléchargé
if [ ! -f "$BDNB_ARCHIVE" ]; then
    echo "❌ Erreur : Téléchargement échoué"
    exit 1
fi

SIZE=$(du -h "$BDNB_ARCHIVE" | cut -f1)
echo "✅ Archive téléchargée : $SIZE"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 2/4 : Extraction ciblée des fichiers
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 2/4 : Extraction ciblée des fichiers"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Nettoyer l'ancien dossier CSV
if [ -d "$CSV_DIR" ]; then
    echo "🗑️  Suppression des anciens CSV..."
    rm -rf "$CSV_DIR"
fi

mkdir -p "$CSV_DIR"

# Liste des fichiers nécessaires
FILES_TO_EXTRACT=(
    "batiment_groupe.csv"
    "batiment_groupe_dpe_representatif_logement.csv"
    "batiment_groupe_dvf_open_representatif.csv"
    "rel_batiment_groupe_parcelle.csv"
    "rel_parcelle_sitadel.csv"
    "sitadel.csv"
)

echo "📋 Fichiers à extraire :"
for file in "${FILES_TO_EXTRACT[@]}"; do
    echo "  - $file"
done
echo ""

EXTRACTED=0
TOTAL=${#FILES_TO_EXTRACT[@]}

for i in "${!FILES_TO_EXTRACT[@]}"; do
    file="${FILES_TO_EXTRACT[$i]}"
    file_num=$((i + 1))
    
    echo "[$file_num/$TOTAL] 📦 $file"
    echo -n "      "
    
    # Trouver le chemin complet dans l'archive
    FULL_PATH=$(tar -tzf "$BDNB_ARCHIVE" 2>/dev/null | grep -m1 "/$file$" || echo "")
    
    if [ -z "$FULL_PATH" ]; then
        # Essayer sans le slash initial
        FULL_PATH=$(tar -tzf "$BDNB_ARCHIVE" 2>/dev/null | grep -m1 "$file$" || echo "")
    fi
    
    if [ -n "$FULL_PATH" ]; then
        # Animation d'extraction
        for j in {1..3}; do
            echo -ne "⏳"
            sleep 0.2
        done
        
        # Extraire le fichier
        tar -xzf "$BDNB_ARCHIVE" -C "$CSV_DIR" --strip-components=2 "$FULL_PATH" 2>/dev/null || \
        tar -xzf "$BDNB_ARCHIVE" -C "$CSV_DIR" --strip-components=1 "$FULL_PATH" 2>/dev/null || \
        (tar -xzf "$BDNB_ARCHIVE" "$FULL_PATH" && mv "$FULL_PATH" "$CSV_DIR/" 2>/dev/null)
        
        if [ -f "$CSV_DIR/$file" ]; then
            SIZE=$(du -h "$CSV_DIR/$file" | cut -f1)
            LINES=$(wc -l < "$CSV_DIR/$file" 2>/dev/null || echo "?")
            echo -ne "\r      ✅ $SIZE, $LINES lignes\n"
            ((EXTRACTED++))
        else
            echo -ne "\r      ⚠️  Extraction partielle ou échec\n"
        fi
    else
        echo -ne "\r      ❌ Introuvable dans l'archive\n"
    fi
    echo ""
done

echo ""
echo "📊 $EXTRACTED/${#FILES_TO_EXTRACT[@]} fichiers extraits"
echo ""

if [ $EXTRACTED -ne ${#FILES_TO_EXTRACT[@]} ]; then
    echo "⚠️  Certains fichiers sont manquants, la création de la base peut échouer"
    read -p "Voulez-vous continuer malgré tout ? (o/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[OoYy]$ ]]; then
        echo "❌ Abandon"
        exit 1
    fi
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🏗️  ÉTAPE 3/4 : Création de la base de données
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️  ÉTAPE 3/4 : Création de la base de données"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Supprimer l'ancienne base si elle existe
if [ -f "$DB_FILE" ]; then
    echo "🗑️  Suppression de l'ancienne base..."
    rm -f "$DB_FILE"
fi

# Créer le dossier database si nécessaire
mkdir -p "$(dirname "$DB_FILE")"

# Lancer le script Node.js
echo "⏳ Création de la base (peut prendre 10-30 minutes)..."
echo ""

NODE_OPTIONS="--max-old-space-size=4096" node create-dvf-dpe-annexes-db.js "$CSV_DIR"

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Erreur lors de la création de la base"
    exit 1
fi

echo ""

# Vérifier que la base a été créée
if [ ! -f "$DB_FILE" ]; then
    echo "❌ Erreur : Base de données non créée"
    exit 1
fi

DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
echo "✅ Base de données créée : $DB_SIZE"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🧹 ÉTAPE 4/4 : Nettoyage automatique
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 ÉTAPE 4/4 : Nettoyage automatique"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Calculer l'espace occupé avant nettoyage
CSV_SIZE=$(du -sh "$CSV_DIR" 2>/dev/null | cut -f1 || echo "?")
ARCHIVE_SIZE=$(du -sh "$BDNB_ARCHIVE" 2>/dev/null | cut -f1 || echo "?")

echo "💾 Espace disque avant nettoyage :"
echo "  - Archive BDNB : $ARCHIVE_SIZE"
echo "  - CSV extraits : $CSV_SIZE"
echo "  - Base de données : $DB_SIZE"
echo ""

# Supprimer automatiquement les CSV
if [ -d "$CSV_DIR" ]; then
    echo "🗑️  Suppression des CSV extraits ($CSV_SIZE)..."
    rm -rf "$CSV_DIR"
    echo "✅ CSV supprimés"
fi

echo ""

# Supprimer automatiquement l'archive
if [ -f "$BDNB_ARCHIVE" ]; then
    echo "🗑️  Suppression de l'archive BDNB ($ARCHIVE_SIZE)..."
    rm -f "$BDNB_ARCHIVE"
    echo "✅ Archive supprimée"
fi

# Supprimer le dossier bdnb_data s'il est vide
if [ -d "$BDNB_DIR" ] && [ -z "$(ls -A "$BDNB_DIR")" ]; then
    rmdir "$BDNB_DIR"
    echo "✅ Dossier bdnb_data supprimé (vide)"
fi

echo ""
echo "💡 Fichiers temporaires supprimés pour libérer ~45 GB"
echo "⚠️  Prochaine mise à jour : re-téléchargement complet nécessaire"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ MISE À JOUR TERMINÉE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Base de données : $DB_FILE ($DB_SIZE)"
echo ""
echo "🎯 Prochaines étapes :"
echo "   1. Redémarrer le serveur : pm2 restart parcelle-server"
echo "   2. Tester l'API : curl http://localhost:3000/api/dvf/search-with-features?lat=48.8566&lon=2.3522&radius=500"
echo ""

# Afficher les statistiques de la base
echo "📈 Statistiques de la base :"
sqlite3 "$DB_FILE" <<EOF
SELECT 
    'Total transactions: ' || COUNT(*) as stat FROM dvf_avec_dpe_et_annexes
UNION ALL
SELECT 
    'Avec DPE: ' || SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) || ' (' || 
    ROUND(100.0 * SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) || '%)'
    FROM dvf_avec_dpe_et_annexes
UNION ALL
SELECT 
    'Avec piscine: ' || SUM(presence_piscine) || ' (' || 
    ROUND(100.0 * SUM(presence_piscine) / COUNT(*), 1) || '%)'
    FROM dvf_avec_dpe_et_annexes
UNION ALL
SELECT 
    'Avec garage: ' || SUM(presence_garage) || ' (' || 
    ROUND(100.0 * SUM(presence_garage) / COUNT(*), 1) || '%)'
    FROM dvf_avec_dpe_et_annexes
UNION ALL
SELECT 
    'Avec véranda: ' || SUM(presence_veranda) || ' (' || 
    ROUND(100.0 * SUM(presence_veranda) / COUNT(*), 1) || '%)'
    FROM dvf_avec_dpe_et_annexes;
EOF

echo ""
echo "✅ Script terminé avec succès !"

