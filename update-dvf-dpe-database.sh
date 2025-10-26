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
    
    # Vérifier si les CSV existent déjà
    if [ -d "$CSV_DIR" ]; then
        echo "⚡ Vérification des CSV existants..."
        REQUIRED_FILES=(
            "batiment_groupe.csv"
            "batiment_groupe_dpe_representatif_logement.csv"
            "rel_batiment_groupe_parcelle.csv"
            "parcelle.csv"
        )
        
        ALL_PRESENT=true
        for file in "${REQUIRED_FILES[@]}"; do
            if [ ! -f "$CSV_DIR/$file" ]; then
                ALL_PRESENT=false
                break
            fi
        done
        
        if [ "$ALL_PRESENT" = "true" ]; then
            echo "✅ Tous les fichiers CSV sont présents - Utilisation des CSV existants"
            echo ""
            # Passer directement à l'étape 3 (pas de téléchargement nécessaire)
            goto_step3=true
        else
            echo "⚠️  Certains fichiers CSV manquants - Téléchargement et extraction nécessaires"
            echo "📥 Les fichiers suivants manquent :"
            for file in "${REQUIRED_FILES[@]}"; do
                if [ ! -f "$CSV_DIR/$file" ]; then
                    echo "   ❌ $file"
                fi
            done
            echo ""
        fi
    else
        echo "📁 Le dossier CSV n'existe pas - Téléchargement et extraction nécessaires"
        echo ""
    fi
    
    # Télécharger l'archive BDNB seulement si des CSV manquent
    if [ "$goto_step3" != "true" ]; then
        if [ ! -f "$BDNB_ARCHIVE" ]; then
            echo "📥 Téléchargement de l'archive BDNB..."
            echo "🌐 URL : $BDNB_URL"
            echo ""
            
            # Télécharger l'archive
            if command -v curl &> /dev/null; then
                curl -L -o "$BDNB_ARCHIVE" "$BDNB_URL"
            elif command -v wget &> /dev/null; then
                wget -O "$BDNB_ARCHIVE" "$BDNB_URL"
            else
                echo "❌ ERREUR : curl ou wget requis pour le téléchargement"
                exit 1
            fi
            
            if [ -f "$BDNB_ARCHIVE" ]; then
                SIZE=$(du -h "$BDNB_ARCHIVE" | cut -f1)
                echo "✅ Archive téléchargée ($SIZE)"
            else
                echo "❌ ERREUR : Échec du téléchargement"
                exit 1
            fi
        else
            echo "✅ Archive déjà présente"
            SIZE=$(du -h "$BDNB_ARCHIVE" | cut -f1)
            echo "   Taille : $SIZE"
        fi
    fi
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📥 ÉTAPE 1.5/4 : Téléchargement fichiers DVF
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 ÉTAPE 1.5/4 : Téléchargement fichiers DVF"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Vérifier les fichiers DVF
echo "🔍 Vérification des fichiers DVF..."
DVF_DIR="$PROJECT_DIR/dvf_data"
mkdir -p "$DVF_DIR"

declare -A DVF_URLS=(
    ["dvf_2020.csv"]="https://files.data.gouv.fr/geo-dvf/latest/csv/2020/full.csv.gz"
    ["dvf_2021.csv"]="https://files.data.gouv.fr/geo-dvf/latest/csv/2021/full.csv.gz"
    ["dvf_2022.csv"]="https://files.data.gouv.fr/geo-dvf/latest/csv/2022/full.csv.gz"
    ["dvf_2023.csv"]="https://files.data.gouv.fr/geo-dvf/latest/csv/2023/full.csv.gz"
    ["dvf_2024.csv"]="https://files.data.gouv.fr/geo-dvf/latest/csv/2024/full.csv.gz"
)

declare -A DVF_YEARS=(
    ["dvf_2020.csv"]="2020"
    ["dvf_2021.csv"]="2021"
    ["dvf_2022.csv"]="2022"
    ["dvf_2023.csv"]="2023"
    ["dvf_2024.csv"]="2024"
)

for file in "${!DVF_URLS[@]}"; do
    if [ ! -f "$DVF_DIR/$file" ]; then
        echo ""
        echo "📥 Téléchargement de $file..."
        YEAR="${DVF_YEARS[$file]}"
        URL="${DVF_URLS[$file]}"
        
        # Télécharger le fichier compressé
        TEMP_FILE="$DVF_DIR/${file}.gz"
        if command -v curl &> /dev/null; then
            curl -L -o "$TEMP_FILE" "$URL"
        elif command -v wget &> /dev/null; then
            wget -O "$TEMP_FILE" "$URL"
        else
            echo "❌ ERREUR : curl ou wget requis pour le téléchargement"
            exit 1
        fi
        
        # Décompresser
        if [ -f "$TEMP_FILE" ]; then
            echo "   📦 Décompression..."
            gunzip -c "$TEMP_FILE" > "$DVF_DIR/$file"
            rm "$TEMP_FILE"
            SIZE=$(du -h "$DVF_DIR/$file" | cut -f1)
            echo "   ✅ $file ($SIZE)"
        else
            echo "   ❌ Échec du téléchargement de $file"
        fi
    else
        SIZE=$(du -h "$DVF_DIR/$file" | cut -f1)
        echo "   ✅ $file ($SIZE)"
    fi
done

# Vérifier qu'au moins un fichier DVF est présent
if ! ls "$DVF_DIR"/dvf_*.csv 1> /dev/null 2>&1; then
    echo ""
    echo "❌ ERREUR : Aucun fichier DVF disponible"
    exit 1
fi

echo ""
echo "✅ Fichiers DVF prêts"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 2/4 : Extraction CSV
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
)

# Fichier optionnel (pas présent dans toutes les archives BDNB)
declare -a OPTIONAL_FILES=(
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

# Traiter les fichiers optionnels
echo "📦 Extraction des fichiers optionnels..."
for i in "${!OPTIONAL_FILES[@]}"; do
    FILE="${OPTIONAL_FILES[$i]}"
    NUM=$((i + 1))
    
    echo "[$NUM/${#OPTIONAL_FILES[@]}] 📦 $FILE (optionnel)"
    
    # Vérifier si le fichier existe déjà
    if [ -f "$CSV_DIR/$FILE" ]; then
        SIZE=$(du -h "$CSV_DIR/$FILE" | cut -f1)
        echo "        ✅ Déjà présent ($SIZE)"
        ((EXTRACTED++))
    else
        # Essayer d'extraire depuis l'archive
        EXTRACT_OUTPUT=$(cd "$CSV_DIR" && sudo tar -xzf "../bdnb_france.tar.gz" "./csv/$FILE" --strip-components=2 2>&1)
        EXTRACT_EXIT=$?
        
        # Vérifier si extrait
        if [ -f "$CSV_DIR/$FILE" ]; then
            SIZE=$(du -h "$CSV_DIR/$FILE" | cut -f1)
            echo "        ✅ Extrait ($SIZE)"
            ((EXTRACTED++))
        else
            echo "        ⚠️ Non trouvé dans l'archive (ignoré, fichier optionnel)"
        fi
    fi
    
    echo ""
done

echo "📊 Résultat : $EXTRACTED fichiers extraits"
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
)

# Fichier optionnel
OPTIONAL_FILE="parcelle_sitadel.csv"

MISSING_FILES=()
MISSING_OPTIONAL=false
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$CSV_DIR/$file" ]; then
        MISSING_FILES+=("$file")
    else
        SIZE=$(du -h "$CSV_DIR/$file" | cut -f1)
        echo "   ✅ $file ($SIZE)"
    fi
done

# Vérifier le fichier optionnel
if [ ! -f "$CSV_DIR/$OPTIONAL_FILE" ]; then
    MISSING_OPTIONAL=true
    echo "   ⚠️  $OPTIONAL_FILE (optionnel, manquant)"
else
    SIZE=$(du -h "$CSV_DIR/$OPTIONAL_FILE" | cut -f1)
    echo "   ✅ $OPTIONAL_FILE ($SIZE)"
fi

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo ""
    echo "❌ Fichiers CSV obligatoires manquants :"
    for file in "${MISSING_FILES[@]}"; do
        echo "   ❌ $file"
    done
    echo ""
    echo "💡 Solution : Relancez le script pour extraire les fichiers manquants"
    exit 1
fi

if [ "$MISSING_OPTIONAL" = "true" ]; then
    echo ""
    echo "⚠️  Fichier optionnel manquant : $OPTIONAL_FILE"
    echo "   Le script continuera sans ce fichier"
fi

echo ""
echo "✅ Tous les fichiers CSV sont présents"
echo ""
echo "⏳ Création en cours (10-30 minutes selon serveur)..."
echo ""

# Chercher le script de création de base DVF+BDNB
if [ -f "$(dirname "${BASH_SOURCE[0]}")/create-dvf-bdnb-national-FINAL.js" ]; then
    SCRIPT_PATH="$(dirname "${BASH_SOURCE[0]}")/create-dvf-bdnb-national-FINAL.js"
    echo "✅ Utilisation du script : create-dvf-bdnb-national-FINAL.js"
elif [ -f "$PROJECT_DIR/create-dvf-bdnb-national-FINAL.js" ]; then
    SCRIPT_PATH="$PROJECT_DIR/create-dvf-bdnb-national-FINAL.js"
    echo "✅ Utilisation du script : create-dvf-bdnb-national-FINAL.js"
else
    echo "❌ Aucun script de création de base trouvé"
    echo "   Cherché : create-dvf-bdnb-national-FINAL.js"
    exit 1
fi

echo "🚀 Lancement du script : $SCRIPT_PATH"
echo "📂 Avec les CSV de : $CSV_DIR"
echo ""

# Convertir le chemin CSV en chemin absolu si nécessaire
CSV_DIR_ABS=$(cd "$CSV_DIR" && pwd)
DVF_DIR_ABS=$(cd "$PROJECT_DIR/dvf_data" 2>/dev/null && pwd || echo "$PROJECT_DIR/dvf_data")

NODE_OPTIONS="--max-old-space-size=4096" node "$SCRIPT_PATH" "$CSV_DIR_ABS" "$DVF_DIR_ABS"

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
