#!/bin/bash

#############################################
# 🚀 EXÉCUTION DU SCRIPT create-dvf-bdnb-complete.js
# Script wrapper qui gère Node.js v20 même avec sudo
#############################################

set -e

PROJECT_DIR="${1:-/opt/parcelle-plus}"
BDNB_DIR="${2:-$PROJECT_DIR/bdnb_data/csv}"
DVF_DIR="${3:-$PROJECT_DIR/dvf_data}"
LOG_DIR="$PROJECT_DIR/logs"

echo "🚀 === EXÉCUTION CREATE DVF BDNB COMPLETE ==="
echo ""
echo "📂 Répertoire projet : $PROJECT_DIR"
echo "📁 Dossier BDNB : $BDNB_DIR"
echo "📁 Dossier DVF : $DVF_DIR"
echo ""

cd "$PROJECT_DIR"

# Créer le dossier de logs si nécessaire
mkdir -p "$LOG_DIR"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📦 Charger Node.js v20 via nvm
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Déterminer l'utilisateur réel (pas celui de sudo)
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo ~$REAL_USER)

echo "👤 Utilisateur réel: $REAL_USER"
echo "🏠 Home: $REAL_HOME"
echo ""

# Charger nvm depuis le home de l'utilisateur réel
if [ -s "$REAL_HOME/.nvm/nvm.sh" ]; then
    echo "📦 Chargement de nvm depuis $REAL_HOME/.nvm/nvm.sh..."
    export NVM_DIR="$REAL_HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    echo "📦 Chargement de nvm depuis /usr/local/opt/nvm/nvm.sh..."
    export NVM_DIR="/usr/local/opt/nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
else
    echo "⚠️  nvm non trouvé, utilisation de la version Node.js par défaut"
fi

# Utiliser Node.js v20 si disponible via nvm
if command -v nvm &> /dev/null; then
    echo "📦 Activation de Node.js v20..."
    nvm use 20 2>/dev/null || nvm use 20.19.6 2>/dev/null || {
        echo "⚠️  Node.js v20 non trouvé via nvm, utilisation de la version par défaut"
    }
fi

# Vérifier la version Node.js
NODE_VERSION=$(node --version)
echo "✅ Node.js version: $NODE_VERSION"
echo ""

# Vérifier que better-sqlite3 est disponible
if ! node -e "require('better-sqlite3')" 2>/dev/null; then
    echo "❌ Erreur: better-sqlite3 non disponible"
    echo "💡 Essayez: npm install better-sqlite3"
    exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🚀 Exécution du script
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SCRIPT_PATH="$PROJECT_DIR/scripts/create-dvf-bdnb-complete.js"

# Chercher le script dans différents emplacements
if [ ! -f "$SCRIPT_PATH" ]; then
    if [ -f "$PROJECT_DIR/create-dvf-bdnb-complete.js" ]; then
        SCRIPT_PATH="$PROJECT_DIR/create-dvf-bdnb-complete.js"
    else
        echo "❌ Script create-dvf-bdnb-complete.js non trouvé"
        exit 1
    fi
fi

echo "🚀 Lancement du script : $SCRIPT_PATH"
echo "📂 BDNB: $BDNB_DIR"
echo "📂 DVF: $DVF_DIR"
echo ""

# Générer le nom du fichier de log
LOG_FILE="$LOG_DIR/logs_create_bdnb_$(date +%Y%m%d_%H%M%S).log"

echo "📝 Logs: $LOG_FILE"
echo ""

# Exécuter le script avec redirection des logs
NODE_OPTIONS="--max-old-space-size=4096" node "$SCRIPT_PATH" "$BDNB_DIR" "$DVF_DIR" 2>&1 | tee "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ SCRIPT TERMINÉ AVEC SUCCÈS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📝 Logs sauvegardés: $LOG_FILE"
else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "❌ SCRIPT TERMINÉ AVEC ERREUR (code: $EXIT_CODE)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📝 Logs: $LOG_FILE"
    exit $EXIT_CODE
fi

