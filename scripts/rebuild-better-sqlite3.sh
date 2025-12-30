#!/bin/bash

#############################################
# 🔄 RECOMPILATION DE better-sqlite3
# Script pour recompiler better-sqlite3 pour la version Node.js actuelle
#############################################

set -e

PROJECT_DIR="${1:-/opt/parcelle-plus}"

echo "🔄 === RECOMPILATION DE better-sqlite3 ==="
echo ""
echo "📂 Répertoire projet : $PROJECT_DIR"
echo "📊 Version Node.js : $(node --version)"
echo ""

cd "$PROJECT_DIR"

if [ ! -f "$PROJECT_DIR/package.json" ]; then
    echo "❌ Erreur: package.json non trouvé dans $PROJECT_DIR"
    exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🔄 Recompilation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "🔄 Suppression de l'ancien module better-sqlite3..."
rm -rf node_modules/better-sqlite3

echo "🔄 Recompilation de better-sqlite3..."
npm rebuild better-sqlite3

# Alternative si rebuild ne fonctionne pas
if [ $? -ne 0 ]; then
    echo "⚠️  Rebuild échoué, tentative de réinstallation complète..."
    npm uninstall better-sqlite3
    npm install better-sqlite3
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ✅ Vérification
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo "🧪 Test de chargement de better-sqlite3..."
node -e "const Database = require('better-sqlite3'); console.log('✅ better-sqlite3 chargé avec succès');" || {
    echo "❌ Erreur: better-sqlite3 ne peut pas être chargé"
    echo "💡 Essayez: npm install better-sqlite3 --build-from-source"
    exit 1
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ RECOMPILATION TERMINÉE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

