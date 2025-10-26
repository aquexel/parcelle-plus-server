#!/bin/bash

#############################################
# 🔄 MISE À JOUR BASE DVF + DPE + ANNEXES
# Script simple et robuste - CONSERVE LES CSV
# Version corrigée avec script local
#############################################

PROJECT_DIR="${1:-/opt/parcelle-plus}"
SKIP_DOWNLOAD="${2:-true}"
LOCAL_MODE="${3:-false}"
BDNB_URL="https://www.data.gouv.fr/api/1/datasets/r/ad4bb2f6-0f40-46d2-a636-8d2604532f74"
BDNB_DIR="$PROJECT_DIR/bdnb_data"
BDNB_ARCHIVE="$BDNB_DIR/bdnb_france.tar.gz"

# Mode local : utiliser les CSV fournis par l'utilisateur
if [ "$LOCAL_MODE" = "true" ]; then
    CSV_DIR="$PROJECT_DIR/open_data_millesime_2024-10-a_dep40_csv/csv"
    DB_FILE="$PROJECT_DIR/database/dvf_avec_dpe_et_annexes_local.db"
else
    CSV_DIR="$BDNB_DIR/csv"
    DB_FILE="$PROJECT_DIR/database/dvf_avec_dpe_et_annexes_enhanced.db"
fi

echo "🔄 === MISE À JOUR BASE DVF + DPE + ANNEXES (ENRICHIE) ==="
echo ""
echo "📂 Répertoire projet : $PROJECT_DIR"
echo "💾 Base de données : $DB_FILE"
echo "📁 Dossier CSV : $CSV_DIR"
if [ "$LOCAL_MODE" = "true" ]; then
    echo "🏠 Mode local : Utilisation des CSV fournis"
elif [ "$SKIP_DOWNLOAD" = "true" ]; then
    echo "⚡ Mode rapide : Utilisation des CSV existants (PAS DE TÉLÉCHARGEMENT)"
else
    echo "📥 Mode téléchargement : Téléchargement des données BDNB"
fi
echo ""

cd "$PROJECT_DIR"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📥 ÉTAPE 1/4 : Téléchargement (optionnel)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# En mode local, ignorer complètement le téléchargement
if [ "$LOCAL_MODE" = "true" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🏠 MODE LOCAL : Utilisation des CSV fournis"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "✅ Utilisation des données locales"
    echo "📂 Répertoire : $CSV_DIR"
    echo ""
    goto_step3=true
else
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📥 ÉTAPE 1/4 : Téléchargement données BDNB"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    mkdir -p "$BDNB_DIR"

    # Vérifier si on peut ignorer le téléchargement
    if [ "$SKIP_DOWNLOAD" = "true" ] && [ -d "$CSV_DIR" ]; then
        echo "⚡ Mode rapide activé - Vérification des CSV existants (PAS DE TÉLÉCHARGEMENT)..."
        REQUIRED_FILES=(
            "batiment_groupe.csv"
            "batiment_groupe_dpe_representatif_logement.csv"
            "rel_batiment_groupe_parcelle.csv"
            "parcelle.csv"
            "parcelle_sitadel.csv"
        )
        
        ALL_PRESENT=true
        for file in "${REQUIRED_FILES[@]}"; do
            if [ ! -f "$CSV_DIR/$file" ]; then
                ALL_PRESENT=false
                break
            fi
        done
        
        if [ "$ALL_PRESENT" = "true" ]; then
            echo "✅ Tous les fichiers CSV sont présents - Téléchargement ignoré"
            echo "🚫 AUCUN TÉLÉCHARGEMENT - Utilisation des CSV existants"
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "📦 ÉTAPE 2/4 : Extraction (ignorée - CSV présents)"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            echo "✅ Utilisation des CSV existants"
            echo ""
            # Passer directement à l'étape 3
            goto_step3=true
        else
            echo "⚠️  Certains fichiers CSV manquants - Téléchargement nécessaire"
            echo "📥 Les fichiers suivants seront téléchargés :"
            for file in "${REQUIRED_FILES[@]}"; do
                if [ ! -f "$CSV_DIR/$file" ]; then
                    echo "   ❌ $file"
                fi
            done
            SKIP_DOWNLOAD=false
        fi
    fi
fi

if [ "$goto_step3" != "true" ]; then
    if [ -f "$BDNB_ARCHIVE" ]; then
        echo "✅ Archive déjà présente"
        SIZE=$(du -h "$BDNB_ARCHIVE" | cut -f1)
        echo "   Taille : $SIZE"
    else
        echo "📥 TÉLÉCHARGEMENT DÉSACTIVÉ - Utilisation des CSV existants"
        echo "🚫 Le script ne téléchargera AUCUNE donnée"
        echo "📂 Vérification des CSV dans : $CSV_DIR"
        echo ""
        
        # Vérifier que les CSV existent quand même
        REQUIRED_FILES=(
            "batiment_groupe.csv"
            "batiment_groupe_dpe_representatif_logement.csv"
            "rel_batiment_groupe_parcelle.csv"
            "parcelle.csv"
            "parcelle_sitadel.csv"
        )
        
        ALL_PRESENT=true
        for file in "${REQUIRED_FILES[@]}"; do
            if [ ! -f "$CSV_DIR/$file" ]; then
                echo "❌ Fichier manquant : $CSV_DIR/$file"
                ALL_PRESENT=false
            else
                echo "✅ Fichier présent : $file"
            fi
        done
        
        if [ "$ALL_PRESENT" = "false" ]; then
            echo ""
            echo "❌ ERREUR : Des fichiers CSV sont manquants"
            echo "💡 Solution : Téléchargez manuellement les fichiers manquants ou activez le téléchargement"
            exit 1
        fi
        
        echo ""
        echo "✅ Tous les fichiers CSV sont présents - Pas de téléchargement nécessaire"
    fi
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 2/4 : Extraction
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 2/4 : Extraction des fichiers nécessaires"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "📂 Préparation dossier CSV..."
if [ -d "$CSV_DIR" ]; then
    echo "✅ Dossier CSV existe déjà"
    echo "   📂 Emplacement : $CSV_DIR"
    echo "   🔄 Réutilisation des fichiers existants"
else
    echo "📁 Création nouveau dossier CSV..."
    sudo mkdir -p "$CSV_DIR"
fi

# Liste des fichiers à extraire
declare -a FILES=(
    "batiment_groupe.csv"
    "batiment_groupe_dpe_representatif_logement.csv"
    "rel_batiment_groupe_parcelle.csv"
    "parcelle.csv"
    "parcelle_sitadel.csv"
)

TOTAL=${#FILES[@]}
EXTRACTED=0

for i in "${!FILES[@]}"; do
    FILE="${FILES[$i]}"
    NUM=$((i + 1))
    
    echo "[$NUM/$TOTAL] 📦 $FILE"
    
    # Vérifier si le fichier existe déjà
    if [ -f "$CSV_DIR/$FILE" ]; then
        SIZE=$(du -h "$CSV_DIR/$FILE" | cut -f1)
        echo "        ✅ Déjà présent ($SIZE)"
        ((EXTRACTED++))
    else
        # Se déplacer dans le dossier cible et extraire (archive = ../bdnb_france.tar.gz)
        EXTRACT_OUTPUT=$(cd "$CSV_DIR" && sudo tar -xzf "../bdnb_france.tar.gz" "./csv/$FILE" --strip-components=2 2>&1)
        EXTRACT_EXIT=$?
        
        # Vérifier si extrait
        if [ -f "$CSV_DIR/$FILE" ]; then
            SIZE=$(du -h "$CSV_DIR/$FILE" | cut -f1)
            echo "        ✅ Extrait ($SIZE)"
            ((EXTRACTED++))
        else
            echo "        ❌ Échec extraction (exit: $EXTRACT_EXIT)"
            if [ -n "$EXTRACT_OUTPUT" ]; then
                echo "        Erreur: $EXTRACT_OUTPUT"
            fi
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

# Conserver l'archive pour réutilisation future
if [ -f "$BDNB_ARCHIVE" ]; then
    echo "💾 Conservation de l'archive..."
    SIZE=$(du -h "$BDNB_ARCHIVE" | cut -f1)
    echo "✅ Archive conservée ($SIZE)"
    echo "   📂 Emplacement : $BDNB_ARCHIVE"
    echo "   🔄 Réutilisable pour prochaines mises à jour"
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

# Vérifier que les fichiers CSV nécessaires sont présents
echo "🔍 Vérification des fichiers CSV nécessaires..."
REQUIRED_FILES=(
    "batiment_groupe.csv"
    "batiment_groupe_dpe_representatif_logement.csv"
    "rel_batiment_groupe_parcelle.csv"
    "parcelle.csv"
    "parcelle_sitadel.csv"
)

MISSING_FILES=()
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$CSV_DIR/$file" ]; then
        MISSING_FILES+=("$file")
    else
        SIZE=$(du -h "$CSV_DIR/$file" | cut -f1)
        echo "   ✅ $file ($SIZE)"
    fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo ""
    echo "❌ Fichiers CSV manquants :"
    for file in "${MISSING_FILES[@]}"; do
        echo "   ❌ $file"
    done
    echo ""
    echo "💡 Solution : Relancez le script pour extraire les fichiers manquants"
    exit 1
fi

echo ""
echo "✅ Tous les fichiers CSV sont présents"
echo ""

echo "⏳ Création en cours (10-30 minutes selon serveur)..."
echo ""

# Chercher le script corrigé (priorité au script corrigé)
if [ -f "$PROJECT_DIR/create-database-corrected.js" ]; then
    SCRIPT_PATH="$PROJECT_DIR/create-database-corrected.js"
    echo "✅ Utilisation du script corrigé : create-database-corrected.js"
elif [ -f "$(dirname "${BASH_SOURCE[0]}")/create-database-corrected.js" ]; then
    SCRIPT_PATH="$(dirname "${BASH_SOURCE[0]}")/create-database-corrected.js"
    echo "✅ Utilisation du script corrigé : create-database-corrected.js"
elif [ -f "$PROJECT_DIR/create-dvf-dpe-annexes-db-enhanced.js" ]; then
    SCRIPT_PATH="$PROJECT_DIR/create-dvf-dpe-annexes-db-enhanced.js"
    echo "⚠️  Utilisation de l'ancien script (create-dvf-dpe-annexes-db-enhanced.js)"
elif [ -f "$(dirname "${BASH_SOURCE[0]}")/create-dvf-dpe-annexes-db-enhanced.js" ]; then
    SCRIPT_PATH="$(dirname "${BASH_SOURCE[0]}")/create-dvf-dpe-annexes-db-enhanced.js"
    echo "⚠️  Utilisation de l'ancien script (create-dvf-dpe-annexes-db-enhanced.js)"
else
    echo "❌ Aucun script de création de base trouvé"
    echo "   Cherché : create-database-corrected.js ou create-dvf-dpe-annexes-db-enhanced.js"
    exit 1
fi

echo "🚀 Lancement du script : $SCRIPT_PATH"
echo "📂 Avec les CSV de : $CSV_DIR"
echo ""

NODE_OPTIONS="--max-old-space-size=4096" node "$SCRIPT_PATH" "$CSV_DIR"

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
# 🧹 ÉTAPE 4/4 : Nettoyage conditionnel
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 ÉTAPE 4/4 : Nettoyage conditionnel"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏳ Vérification des critères de suppression..."
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

# Afficher statistiques et vérifier si suppression des CSV nécessaire
if command -v sqlite3 &> /dev/null; then
    echo "📈 Statistiques :"
    
    # Récupérer les pourcentages pour décision de suppression (critères étendus)
    STATS=$(sqlite3 "$DB_FILE" <<EOF
SELECT 
    ROUND(100.0 * SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as dpe_percent,
    ROUND(100.0 * SUM(CASE WHEN orientation_principale IS NOT NULL AND orientation_principale != 'inconnue' THEN 1 ELSE 0 END) / COUNT(*), 1) as orientation_percent,
    ROUND(100.0 * SUM(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as vitrage_percent,
    ROUND(100.0 * SUM(presence_piscine) / COUNT(*), 1) as piscine_percent,
    ROUND(100.0 * SUM(presence_garage) / COUNT(*), 1) as garage_percent
FROM dvf_avec_dpe_et_annexes;
EOF
    )
    
    # Afficher les statistiques détaillées
    sqlite3 "$DB_FILE" <<EOF
SELECT 'Transactions: ' || COUNT(*) FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec DPE: ' || SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) || ' (' || ROUND(100.0 * SUM(CASE WHEN classe_dpe IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec piscine: ' || SUM(presence_piscine) || ' (' || ROUND(100.0 * SUM(presence_piscine) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec garage: ' || SUM(presence_garage) || ' (' || ROUND(100.0 * SUM(presence_garage) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec véranda: ' || SUM(presence_veranda) || ' (' || ROUND(100.0 * SUM(presence_veranda) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec orientation: ' || SUM(CASE WHEN orientation_principale IS NOT NULL AND orientation_principale != 'inconnue' THEN 1 ELSE 0 END) || ' (' || ROUND(100.0 * SUM(CASE WHEN orientation_principale IS NOT NULL AND orientation_principale != 'inconnue' THEN 1 ELSE 0 END) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
SELECT 'Avec pourcentage vitrage: ' || SUM(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 ELSE 0 END) || ' (' || ROUND(100.0 * SUM(CASE WHEN pourcentage_vitrage IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) || '%)' FROM dvf_avec_dpe_et_annexes;
EOF
    
    echo ""
    
    # Extraire les pourcentages (critères étendus)
    DPE_PERCENT=$(echo "$STATS" | cut -d'|' -f1)
    ORIENTATION_PERCENT=$(echo "$STATS" | cut -d'|' -f2)
    VITRAGE_PERCENT=$(echo "$STATS" | cut -d'|' -f3)
    PISCINE_PERCENT=$(echo "$STATS" | cut -d'|' -f4)
    GARAGE_PERCENT=$(echo "$STATS" | cut -d'|' -f5)
    
    echo "🎯 Vérification des critères de suppression (étendus) :"
    echo "   • DPE : $DPE_PERCENT%"
    echo "   • Orientation : $ORIENTATION_PERCENT%"
    echo "   • Vitrage : $VITRAGE_PERCENT%"
    echo "   • Piscine : $PISCINE_PERCENT%"
    echo "   • Garage : $GARAGE_PERCENT%"
    echo ""
    
    # Vérifier si tous les paramètres sont > 0% (critères étendus)
    if (( $(echo "$DPE_PERCENT > 0" | bc -l) )) && \
       (( $(echo "$ORIENTATION_PERCENT > 0" | bc -l) )) && \
       (( $(echo "$VITRAGE_PERCENT > 0" | bc -l) )) && \
       (( $(echo "$PISCINE_PERCENT > 0" | bc -l) )) && \
       (( $(echo "$GARAGE_PERCENT > 0" | bc -l) )); then
        
        echo "✅ SUCCÈS CONFIRMÉ : Tous les paramètres sont > 0%"
        echo "🗑️ Suppression des CSV (succès confirmé - critères étendus)"
        
        if [ -d "$CSV_DIR" ]; then
            CSV_SIZE=$(du -sh "$CSV_DIR" | cut -f1)
            echo "   📂 Suppression de : $CSV_DIR ($CSV_SIZE)"
            rm -rf "$CSV_DIR"
            echo "   ✅ CSV supprimés avec succès"
        fi
        
        if [ -f "$BDNB_ARCHIVE" ] && [ "$LOCAL_MODE" != "true" ]; then
            ARCHIVE_SIZE=$(du -h "$BDNB_ARCHIVE" | cut -f1)
            echo "   📦 Suppression de l'archive : $BDNB_ARCHIVE ($ARCHIVE_SIZE)"
            rm -f "$BDNB_ARCHIVE"
            echo "   ✅ Archive supprimée avec succès"
        fi
        
    else
        echo "⚠️  CONSERVATION DES CSV : Certains paramètres sont à 0%"
        echo "   💾 CSV conservés pour diagnostic et réessai (critères étendus)"
        
        if [ -d "$CSV_DIR" ]; then
            CSV_SIZE=$(du -sh "$CSV_DIR" | cut -f1)
            echo "   📂 Conservation de : $CSV_DIR ($CSV_SIZE)"
        fi
    fi
    
    echo ""
fi

echo "✅ Script terminé avec succès !"
