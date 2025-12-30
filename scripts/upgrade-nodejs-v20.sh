#!/bin/bash

#############################################
# 🔄 MISE À NIVEAU NODE.JS V20.19.6
# Script pour installer Node.js v20.19.6 et recompiler better-sqlite3
#############################################

set -e

PROJECT_DIR="${1:-/opt/parcelle-plus}"
NODE_VERSION="20.19.6"

echo "🔄 === MISE À NIVEAU NODE.JS V${NODE_VERSION} ==="
echo ""
echo "📂 Répertoire projet : $PROJECT_DIR"
echo ""

cd "$PROJECT_DIR"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 1/4 : Installation de nvm
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 1/4 : Installation de nvm"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Vérifier si nvm est déjà installé
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    echo "✅ nvm déjà installé"
    source "$HOME/.nvm/nvm.sh"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    echo "✅ nvm déjà installé (emplacement alternatif)"
    source "/usr/local/opt/nvm/nvm.sh"
else
    echo "📥 Installation de nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
    
    # Charger nvm
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
    
    echo "✅ nvm installé"
fi

# Vérifier que nvm fonctionne
if ! command -v nvm &> /dev/null && [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
fi

if ! command -v nvm &> /dev/null; then
    echo "❌ Erreur: nvm non disponible"
    echo "💡 Essayez de relancer ce script ou exécutez:"
    echo "   source ~/.nvm/nvm.sh"
    exit 1
fi

echo "✅ nvm version: $(nvm --version)"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 2/4 : Installation de Node.js v20.19.6
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 2/4 : Installation de Node.js v${NODE_VERSION}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Vérifier la version actuelle
CURRENT_VERSION=$(node --version 2>/dev/null || echo "non installé")
echo "📊 Version Node.js actuelle: $CURRENT_VERSION"

# Installer ou utiliser Node.js v20.19.6
if nvm list | grep -q "v${NODE_VERSION}"; then
    echo "✅ Node.js v${NODE_VERSION} déjà installé via nvm"
    nvm use "$NODE_VERSION"
else
    echo "📥 Installation de Node.js v${NODE_VERSION}..."
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
    nvm alias default "$NODE_VERSION"
fi

# Vérifier l'installation
NEW_VERSION=$(node --version)
echo "✅ Node.js version: $NEW_VERSION"
echo "✅ NPM version: $(npm --version)"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 3/4 : Recompilation de better-sqlite3
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 3/4 : Recompilation de better-sqlite3"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ ! -f "$PROJECT_DIR/package.json" ]; then
    echo "❌ Erreur: package.json non trouvé dans $PROJECT_DIR"
    exit 1
fi

cd "$PROJECT_DIR"

echo "🔄 Suppression de l'ancien module better-sqlite3..."
rm -rf node_modules/better-sqlite3

echo "🔄 Recompilation de better-sqlite3 pour Node.js v${NODE_VERSION}..."
npm rebuild better-sqlite3

# Alternative si rebuild ne fonctionne pas
if [ $? -ne 0 ]; then
    echo "⚠️  Rebuild échoué, tentative de réinstallation..."
    npm uninstall better-sqlite3
    npm install better-sqlite3
fi

echo "✅ better-sqlite3 recompilé"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 ÉTAPE 4/4 : Vérification
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 ÉTAPE 4/4 : Vérification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test de chargement de better-sqlite3
echo "🧪 Test de chargement de better-sqlite3..."
node -e "const Database = require('better-sqlite3'); console.log('✅ better-sqlite3 chargé avec succès');" || {
    echo "❌ Erreur: better-sqlite3 ne peut pas être chargé"
    exit 1
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ MISE À NIVEAU TERMINÉE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Résumé:"
echo "   • Node.js: $NEW_VERSION"
echo "   • NPM: $(npm --version)"
echo "   • better-sqlite3: Recompilé"
echo ""
echo "💡 Pour utiliser Node.js v${NODE_VERSION} dans un nouveau terminal:"
echo "   source ~/.nvm/nvm.sh"
echo "   nvm use ${NODE_VERSION}"
echo ""
echo "💡 Pour définir Node.js v${NODE_VERSION} comme version par défaut:"
echo "   nvm alias default ${NODE_VERSION}"
echo ""

