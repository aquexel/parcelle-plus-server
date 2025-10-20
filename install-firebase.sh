#!/bin/bash

# Script d'installation des notifications push Firebase
# À exécuter sur le serveur OVH/Raspberry Pi

echo "🔥 Installation des notifications push Firebase"
echo "=============================================="

# Vérifier si Node.js est installé
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé. Installation..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "✅ Node.js version: $(node --version)"

# Vérifier si npm est installé
if ! command -v npm &> /dev/null; then
    echo "❌ npm n'est pas installé. Installation..."
    sudo apt-get install -y npm
fi

echo "✅ npm version: $(npm --version)"

# Aller dans le dossier du serveur
cd raspberry-pi-server

# Installer Firebase Admin SDK
echo "📦 Installation de firebase-admin..."
npm install firebase-admin

# Vérifier l'installation
if [ -d "node_modules/firebase-admin" ]; then
    echo "✅ firebase-admin installé avec succès"
else
    echo "❌ Erreur installation firebase-admin"
    exit 1
fi

# Créer le dossier pour les fichiers Firebase
mkdir -p ../firebase-config

echo "📁 Dossier firebase-config créé"
echo "📋 Instructions suivantes :"
echo "   1. Téléchargez firebase-service-account.json depuis Firebase Console"
echo "   2. Placez-le dans le dossier firebase-config/"
echo "   3. Redémarrez le serveur avec: pm2 restart parcelle-plus"

echo ""
echo "🎉 Installation terminée !"
echo "📋 Prochaines étapes :"
echo "   - Configurer firebase-service-account.json"
echo "   - Redémarrer le serveur"
echo "   - Tester les notifications"
