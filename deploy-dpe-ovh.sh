#!/bin/bash
# Script de déploiement complet du système DPE sur OVH
# Usage: ./deploy-dpe-ovh.sh [code_departement]

set -e  # Arrêt en cas d'erreur

# Configuration
DEPARTMENT=${1:-40}
APP_DIR="/opt/parcelle-plus"

echo "╔══════════════════════════════════════════════════╗"
echo "║  🚀 DÉPLOIEMENT SYSTÈME DPE - ParcellePlus      ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "📍 Département : $DEPARTMENT"
echo "📂 Répertoire : $APP_DIR"
echo ""

# Vérifier si on est sur le serveur
if [ ! -d "$APP_DIR" ]; then
    echo "❌ Erreur : Ce script doit être exécuté sur le serveur OVH"
    echo "💡 Connectez-vous d'abord : ssh ubuntu@149.202.33.164"
    exit 1
fi

# Aller dans le répertoire de l'application
cd "$APP_DIR"

# Étape 1 : Mise à jour du code depuis GitHub
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 ÉTAPE 1/5 : Mise à jour du code depuis GitHub"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -d ".git" ]; then
    echo "⏳ git pull origin main..."
    sudo -u parcelle git pull origin main
    echo "✅ Code mis à jour"
else
    echo "⚠️ Pas de dépôt git, saut de cette étape"
fi

# Étape 2 : Installation des dépendances
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 2/5 : Installation des dépendances"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "⏳ npm install..."
sudo -u parcelle npm install --production
echo "✅ Dépendances installées"

# Étape 3 : Téléchargement des données BDNB
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📥 ÉTAPE 3/5 : Téléchargement données BDNB"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Rendre le script de téléchargement exécutable
chmod +x download-bdnb-data.sh

# Vérifier si les données existent déjà
BDNB_DIR="/opt/parcelle-plus/bdnb_data"
if [ -d "$BDNB_DIR" ] && [ "$(ls -A $BDNB_DIR 2>/dev/null)" ]; then
    echo "⚠️ Données BDNB déjà présentes"
    read -p "🔄 Voulez-vous re-télécharger les données ? (o/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        ./download-bdnb-data.sh
    else
        echo "✅ Utilisation des données existantes"
    fi
else
    echo "📥 Téléchargement de toute la France (peut prendre 20-40 minutes)"
    echo "💡 Les données seront filtrées par département lors de l'import"
    ./download-bdnb-data.sh
fi

# Étape 4 : Génération de la base DPE
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗄️ ÉTAPE 4/5 : Génération base de données DPE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Vérifier si la base existe déjà
DB_PATH="$APP_DIR/database/dpe_bdnb.db"
if [ -f "$DB_PATH" ]; then
    DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
    echo "⚠️ Base DPE existante ($DB_SIZE)"
    read -p "🔄 Voulez-vous régénérer la base ? (o/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        echo "🗑️ Suppression de l'ancienne base..."
        rm -f "$DB_PATH"
        echo "⏳ Génération de la base DPE (peut prendre 5-10 minutes)..."
        sudo -u parcelle node enrich_dvf_with_dpe.js "$BDNB_DIR" "$DEPARTMENT"
    else
        echo "✅ Utilisation de la base existante"
    fi
else
    echo "⏳ Génération de la base DPE (peut prendre 5-10 minutes)..."
    sudo -u parcelle node enrich_dvf_with_dpe.js "$BDNB_DIR" "$DEPARTMENT"
fi

# Afficher les statistiques de la base
if [ -f "$DB_PATH" ]; then
    DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
    echo ""
    echo "✅ Base DPE créée : $DB_SIZE"
    
    # Compter les transactions
    TRANSACTION_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM dvf_avec_dpe;" 2>/dev/null || echo "N/A")
    DPE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM dvf_avec_dpe WHERE classe_dpe IS NOT NULL;" 2>/dev/null || echo "N/A")
    
    echo "📊 Statistiques :"
    echo "   - Total transactions : $TRANSACTION_COUNT"
    echo "   - Avec DPE : $DPE_COUNT"
fi

# Étape 5 : Redémarrage de l'application
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 ÉTAPE 5/5 : Redémarrage de l'application"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "⏳ Redémarrage PM2..."
sudo -u parcelle pm2 restart parcelle-plus

echo "⏳ Attente du démarrage (5 secondes)..."
sleep 5

# Vérifier le statut
echo ""
echo "📊 Statut de l'application :"
sudo -u parcelle pm2 status parcelle-plus

# Test de l'API
echo ""
echo "🧪 Test de l'API..."
API_RESPONSE=$(curl -s http://localhost:3000/api/health || echo "ERREUR")
if [[ "$API_RESPONSE" == *"ok"* ]]; then
    echo "✅ API fonctionne correctement"
else
    echo "⚠️ Problème détecté, vérifiez les logs :"
    echo "   sudo -u parcelle pm2 logs parcelle-plus --lines 20"
fi

# Résumé final
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✅ DÉPLOIEMENT TERMINÉ                         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "📊 Résumé :"
echo "   • Département : $DEPARTMENT"
echo "   • Base DPE : $DB_PATH"
echo "   • Service : actif"
echo ""
echo "📝 Prochaines étapes :"
echo "   1. Ajouter la route API dans server.js"
echo "   2. Redémarrer : sudo -u parcelle pm2 restart parcelle-plus"
echo "   3. Tester : curl -X POST http://149.202.33.164:3000/api/dvf/estimate-with-dpe"
echo ""
echo "📖 Documentation : METHODOLOGIE_DPE.md"
echo "🔍 Logs : sudo -u parcelle pm2 logs parcelle-plus"
echo ""

