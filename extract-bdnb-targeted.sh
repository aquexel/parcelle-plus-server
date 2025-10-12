#!/bin/bash

#############################################
# 📦 EXTRACTION CIBLÉE DES FICHIERS BDNB
# Extrait UNIQUEMENT les fichiers nécessaires
# pour la base DVF+DPE+ANNEXES
#############################################

set -e

BDNB_ARCHIVE="${1:-bdnb_data/bdnb_france.tar.gz}"
OUTPUT_DIR="${2:-bdnb_data/csv}"

# Vérifier que l'archive existe
if [ ! -f "$BDNB_ARCHIVE" ]; then
    echo "❌ Archive non trouvée : $BDNB_ARCHIVE"
    exit 1
fi

echo "📦 === EXTRACTION CIBLÉE BDNB ==="
echo "Archive : $BDNB_ARCHIVE"
echo "Destination : $OUTPUT_DIR"
echo ""

# Créer le dossier de sortie
mkdir -p "$OUTPUT_DIR"

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

# Extraire chaque fichier individuellement
for file in "${FILES_TO_EXTRACT[@]}"; do
    echo "⏳ Extraction de $file..."
    
    # Trouver le chemin complet dans l'archive
    FULL_PATH=$(tar -tzf "$BDNB_ARCHIVE" | grep -m1 "/$file$" || echo "")
    
    if [ -z "$FULL_PATH" ]; then
        echo "⚠️  $file introuvable dans l'archive, recherche alternative..."
        # Essayer sans le slash initial
        FULL_PATH=$(tar -tzf "$BDNB_ARCHIVE" | grep -m1 "$file$" || echo "")
    fi
    
    if [ -n "$FULL_PATH" ]; then
        # Extraire vers le dossier de sortie
        tar -xzf "$BDNB_ARCHIVE" -C "$OUTPUT_DIR" --strip-components=2 "$FULL_PATH" 2>/dev/null || \
        tar -xzf "$BDNB_ARCHIVE" -C "$OUTPUT_DIR" --strip-components=1 "$FULL_PATH" 2>/dev/null || \
        tar -xzf "$BDNB_ARCHIVE" "$FULL_PATH" && mv "$FULL_PATH" "$OUTPUT_DIR/" 2>/dev/null
        
        if [ -f "$OUTPUT_DIR/$file" ]; then
            SIZE=$(du -h "$OUTPUT_DIR/$file" | cut -f1)
            echo "✅ $file extrait ($SIZE)"
        else
            echo "⚠️  $file : extraction partielle"
        fi
    else
        echo "❌ $file introuvable dans l'archive"
    fi
    echo ""
done

# Vérification finale
echo "📊 === RÉSUMÉ ==="
EXTRACTED=0
for file in "${FILES_TO_EXTRACT[@]}"; do
    if [ -f "$OUTPUT_DIR/$file" ]; then
        SIZE=$(du -h "$OUTPUT_DIR/$file" | cut -f1)
        LINES=$(wc -l < "$OUTPUT_DIR/$file" 2>/dev/null || echo "?")
        echo "✅ $file : $SIZE, $LINES lignes"
        ((EXTRACTED++))
    else
        echo "❌ $file : MANQUANT"
    fi
done

echo ""
echo "📦 $EXTRACTED/${#FILES_TO_EXTRACT[@]} fichiers extraits avec succès"

if [ $EXTRACTED -eq ${#FILES_TO_EXTRACT[@]} ]; then
    echo "✅ Extraction complète réussie !"
    exit 0
else
    echo "⚠️  Certains fichiers sont manquants"
    exit 1
fi

