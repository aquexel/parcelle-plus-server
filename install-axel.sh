#!/bin/bash

# Script d'installation automatique ParcellePlus Server
# Pour Raspberry Pi 4 avec IP 192.168.1.17

echo "🚀 ========================================="
echo "🚀 INSTALLATION PARCELLE PLUS SERVER"
echo "🚀 ========================================="
echo ""

# Vérifier si on est sur un Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    echo "⚠️  Attention: Ce script est conçu pour Raspberry Pi"
    echo "❓ Continuer quand même ? (y/N)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "❌ Installation annulée"
        exit 1
    fi
fi

# Vérifier les privilèges
if [[ $EUID -eq 0 ]]; then
    echo "❌ Ne pas exécuter ce script en tant que root"
    echo "💡 Utilisez: ./install.sh"
    exit 1
fi

# Définir les variables
INSTALL_DIR="$HOME/parcelle-plus-server"
SERVICE_NAME="parcelle-plus-server"
PORT=3000

echo "📁 Répertoire d'installation: $INSTALL_DIR"
echo "🔌 Port: $PORT"
echo "🏠 IP: 192.168.1.17"
echo ""

# Demander confirmation avant de continuer
echo "❓ Voulez-vous installer ParcellePlus Server sur ce Raspberry Pi ? (y/N)"
read -r response
if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo "❌ Installation annulée"
    exit 1
fi
echo "🚀 Démarrage de l'installation..."
echo ""

# Fonction pour vérifier si une commande existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Fonction pour installer Node.js
install_nodejs() {
    echo "📦 Installation de Node.js..."
    
    # Vérifier si Node.js est déjà installé
    if command_exists node; then
        NODE_VERSION=$(node --version)
        echo "✅ Node.js déjà installé: $NODE_VERSION"
        
        # Vérifier la version minimum
        if [[ "$NODE_VERSION" < "v16" ]]; then
            echo "⚠️  Version Node.js trop ancienne, mise à jour..."
        else
            echo "✅ Version Node.js compatible"
            return 0
        fi
    fi
    
    # Mettre à jour les paquets
    echo "🔄 Mise à jour des paquets système..."
    sudo apt update -y
    
    # Installer Node.js
    echo "📥 Téléchargement et installation de Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    # Vérifier l'installation
    if command_exists node && command_exists npm; then
        echo "✅ Node.js installé avec succès"
        echo "   Version Node.js: $(node --version)"
        echo "   Version NPM: $(npm --version)"
    else
        echo "❌ Erreur installation Node.js"
        exit 1
    fi
}

# Fonction pour installer PM2
install_pm2() {
    echo "📦 Installation de PM2..."
    
    if command_exists pm2; then
        echo "✅ PM2 déjà installé"
        return 0
    fi
    
    sudo npm install -g pm2
    
    if command_exists pm2; then
        echo "✅ PM2 installé avec succès"
    else
        echo "❌ Erreur installation PM2"
        exit 1
    fi
}

# Fonction pour créer le répertoire et copier les fichiers
setup_files() {
    echo "📁 Configuration des fichiers..."
    
    # Créer le répertoire s'il n'existe pas
    if [[ ! -d "$INSTALL_DIR" ]]; then
        echo "📁 Création du répertoire: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi
    
    # Vérifier si les fichiers source existent
    if [[ ! -f "package.json" ]]; then
        echo "❌ Fichiers source non trouvés"
        echo "💡 Assurez-vous d'être dans le dossier parcelle-plus-server/"
        exit 1
    fi
    
    # Copier les fichiers
    echo "📄 Copie des fichiers..."
    cp -r * "$INSTALL_DIR/"
    
    # Changer les permissions
    chmod +x "$INSTALL_DIR/install.sh"
    if [[ -f "$INSTALL_DIR/test/test-server.js" ]]; then
        chmod +x "$INSTALL_DIR/test/test-server.js"
    fi
    
    echo "✅ Fichiers copiés vers $INSTALL_DIR"
}

# Fonction pour installer les dépendances NPM
install_dependencies() {
    echo "📦 Installation des dépendances NPM..."
    
    cd "$INSTALL_DIR" || exit 1
    
    # Installer les dépendances
    npm install
    
    if [[ $? -eq 0 ]]; then
        echo "✅ Dépendances installées avec succès"
    else
        echo "❌ Erreur installation dépendances"
        exit 1
    fi
}

# Fonction pour initialiser la base de données
init_database() {
    echo "🗄️ Initialisation de la base de données..."
    
    cd "$INSTALL_DIR" || exit 1
    
    # Créer le dossier database
    mkdir -p "$INSTALL_DIR/database"
    
    # Exécuter le script d'initialisation
    npm run setup
    
    if [[ $? -eq 0 ]]; then
        echo "✅ Base de données initialisée"
    else
        echo "❌ Erreur initialisation base de données"
        exit 1
    fi
}

# Fonction pour configurer le pare-feu
configure_firewall() {
    echo "🔥 Configuration du pare-feu..."
    
    # Vérifier si ufw est installé
    if ! command_exists ufw; then
        echo "📦 Installation de ufw..."
        sudo apt install -y ufw
    fi
    
    # Configurer les règles
    sudo ufw allow ssh
    sudo ufw allow $PORT/tcp
    
    # Activer le pare-feu
    echo "y" | sudo ufw enable
    
    echo "✅ Pare-feu configuré"
    echo "   Port SSH: 22"
    echo "   Port serveur: $PORT"
}

# Fonction pour démarrer le service
start_service() {
    echo "🚀 Démarrage du service..."
    
    cd "$INSTALL_DIR" || exit 1
    
    # Arrêter le service s'il existe déjà
    pm2 stop "$SERVICE_NAME" 2>/dev/null || true
    pm2 delete "$SERVICE_NAME" 2>/dev/null || true
    
    # Démarrer le service
    pm2 start server.js --name "$SERVICE_NAME"
    
    # Configurer le démarrage automatique
    pm2 startup
    pm2 save
    
    echo "✅ Service démarré"
}

# Fonction pour tester le serveur
test_server() {
    echo "🧪 Test du serveur..."
    
    # Attendre que le serveur démarre
    sleep 3
    
    # Tester la connexion
    if curl -s -f "http://localhost:$PORT/api/health" >/dev/null; then
        echo "✅ Serveur fonctionne correctement"
        echo "🌐 URL: http://192.168.1.17:$PORT"
        echo "🔗 WebSocket: ws://192.168.1.17:$PORT"
    else
        echo "❌ Erreur test serveur"
        echo "💡 Vérifiez les logs: pm2 logs $SERVICE_NAME"
        exit 1
    fi
}

# Fonction pour afficher les informations finales
show_final_info() {
    echo ""
    echo "🎉 ========================================="
    echo "🎉 INSTALLATION TERMINÉE AVEC SUCCÈS !"
    echo "🎉 ========================================="
    echo ""
    echo "📊 Informations du serveur:"
    echo "   🏠 IP: 192.168.1.17"
    echo "   🔌 Port: $PORT"
    echo "   📁 Dossier: $INSTALL_DIR"
    echo "   🎯 Service: $SERVICE_NAME"
    echo ""
    echo "🌐 URLs disponibles:"
    echo "   • API: http://192.168.1.17:$PORT/api"
    echo "   • Santé: http://192.168.1.17:$PORT/api/health"
    echo "   • Polygones: http://192.168.1.17:$PORT/api/polygons"
    echo "   • Messages: http://192.168.1.17:$PORT/api/messages"
    echo "   • WebSocket: ws://192.168.1.17:$PORT"
    echo ""
    echo "⚙️  Commandes utiles:"
    echo "   • Voir les logs: pm2 logs $SERVICE_NAME"
    echo "   • Redémarrer: pm2 restart $SERVICE_NAME"
    echo "   • Arrêter: pm2 stop $SERVICE_NAME"
    echo "   • Statut: pm2 status"
    echo "   • Tests: cd $INSTALL_DIR && npm test"
    echo ""
}

# Exécuter les étapes d'installation
install_nodejs
install_pm2
setup_files
install_dependencies
init_database
configure_firewall
start_service
test_server
show_final_info 