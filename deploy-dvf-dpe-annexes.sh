#!/bin/bash

#############################################
# 🚀 DÉPLOIEMENT BASE DVF + DPE + ANNEXES
# Script complet pour créer la base de données
# sur le serveur OVH
#############################################

set -e

echo "🚀 === DÉPLOIEMENT BASE DVF + DPE + ANNEXES ==="
echo ""

PROJECT_DIR="/opt/parcelle-plus"
BDNB_ARCHIVE="$PROJECT_DIR/bdnb_data/bdnb_france.tar.gz"
BDNB_CSV_DIR="$PROJECT_DIR/bdnb_data/csv"

cd "$PROJECT_DIR"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 1/3 : Extraction ciblée des fichiers
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 1/3 : Extraction ciblée des fichiers BDNB"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ ! -f "$BDNB_ARCHIVE" ]; then
    echo "❌ Archive BDNB introuvable : $BDNB_ARCHIVE"
    echo "💡 Veuillez d'abord télécharger l'archive avec download-bdnb-data.sh"
    exit 1
fi

# Nettoyer l'ancien dossier CSV si présent
if [ -d "$BDNB_CSV_DIR" ]; then
    echo "🗑️  Suppression de l'ancien dossier CSV..."
    rm -rf "$BDNB_CSV_DIR"
fi

# Extraire les fichiers nécessaires
bash extract-bdnb-targeted.sh "$BDNB_ARCHIVE" "$BDNB_CSV_DIR"

if [ $? -ne 0 ]; then
    echo "❌ Échec de l'extraction"
    exit 1
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🏗️  ÉTAPE 2/3 : Création de la base de données
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🏗️  ÉTAPE 2/3 : Création de la base de données"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node create-dvf-dpe-annexes-db.js "$BDNB_CSV_DIR"

if [ $? -ne 0 ]; then
    echo "❌ Échec de la création de la base"
    exit 1
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🧹 ÉTAPE 3/3 : Nettoyage (optionnel)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 ÉTAPE 3/3 : Nettoyage"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Demander si on veut supprimer les CSV pour libérer de l'espace
read -p "Voulez-vous supprimer les fichiers CSV extraits pour libérer de l'espace ? (o/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[OoYy]$ ]]; then
    echo "🗑️  Suppression des fichiers CSV..."
    rm -rf "$BDNB_CSV_DIR"
    echo "✅ CSV supprimés"
else
    echo "📂 CSV conservés dans $BDNB_CSV_DIR"
fi

# Optionnel : supprimer l'archive (35GB libérés)
echo ""
read -p "Voulez-vous supprimer l'archive BDNB (35 GB libérés) ? (o/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[OoYy]$ ]]; then
    echo "🗑️  Suppression de l'archive BDNB..."
    rm -f "$BDNB_ARCHIVE"
    echo "✅ Archive supprimée"
else
    echo "📦 Archive conservée dans $BDNB_ARCHIVE"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DÉPLOIEMENT TERMINÉ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Base de données créée :"
echo "   $PROJECT_DIR/database/dvf_avec_dpe_et_annexes.db"
echo ""
echo "🎯 Prochaines étapes :"
echo "   1. Vérifier la base avec sqlite3"
echo "   2. Créer l'API de recherche pour l'application Android"
echo "   3. Implémenter l'algorithme de régression dans l'application"
echo ""


