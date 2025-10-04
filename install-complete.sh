#!/bin/bash

# Script d'installation complète ParcellePlus
# - Serveur Node.js
# - Partage SMB pour accès Windows
# - Configuration automatique

echo "🚀 =================================================="
echo "🚀 INSTALLATION COMPLÈTE PARCELLE PLUS"
echo "🚀 =================================================="
echo "   🖥️  Serveur Node.js + API REST"
echo "   🗂️  Partage SMB pour Windows"
echo "   🔧 Configuration automatique"
echo "=================================================="
echo ""

# Variables globales
INSTALL_DIR="/home/axel/parcelle-plus-server"
SERVICE_NAME="parcelle-plus-server"
SHARE_NAME="ParcellePlus"
SMB_USER="axel"
PORT=3000

echo "📋 Configuration:"
echo "   📁 Installation: $INSTALL_DIR"
echo "   🖥️  IP: 192.168.1.17"
echo "   🔌 Port serveur: $PORT"
echo "   🗂️  Partage SMB: \\\\192.168.1.17\\$SHARE_NAME"
echo "   👤 Utilisateur: $SMB_USER"
echo ""

# Vérifier les privilèges
if [[ $EUID -eq 0 ]]; then
    echo "❌ Ne pas exécuter ce script en tant que root"
    echo "💡 Utilisez: ./install-complete.sh"
    exit 1
fi

# Fonction pour vérifier si une commande existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Fonction pour afficher une étape
show_step() {
    echo ""
    echo "🔹 ==============================================="
    echo "🔹 ÉTAPE $1: $2"
    echo "🔹 ==============================================="
    echo ""
}

# Étape 1: Installation Node.js
install_nodejs() {
    show_step "1" "INSTALLATION NODE.JS"
    
    if command_exists node; then
        NODE_VERSION=$(node --version)
        echo "✅ Node.js déjà installé: $NODE_VERSION"
        
        if [[ "$NODE_VERSION" < "v16" ]]; then
            echo "⚠️  Version trop ancienne, mise à jour..."
        else
            echo "✅ Version compatible"
            return 0
        fi
    fi
    
    echo "🔄 Mise à jour des paquets..."
    sudo apt update -y
    
    echo "📥 Installation Node.js 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    if command_exists node && command_exists npm; then
        echo "✅ Node.js installé: $(node --version)"
        echo "✅ NPM installé: $(npm --version)"
    else
        echo "❌ Erreur installation Node.js"
        exit 1
    fi
}

# Étape 2: Installation PM2
install_pm2() {
    show_step "2" "INSTALLATION PM2"
    
    if command_exists pm2; then
        echo "✅ PM2 déjà installé"
        return 0
    fi
    
    echo "📦 Installation PM2..."
    sudo npm install -g pm2
    
    if command_exists pm2; then
        echo "✅ PM2 installé avec succès"
    else
        echo "❌ Erreur installation PM2"
        exit 1
    fi
}

# Étape 3: Configuration des fichiers
setup_server_files() {
    show_step "3" "CONFIGURATION SERVEUR"
    
    # Créer le répertoire
    if [[ ! -d "$INSTALL_DIR" ]]; then
        echo "📁 Création du répertoire: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi
    
    # Vérifier les fichiers source
    if [[ ! -f "package.json" ]]; then
        echo "❌ Fichiers source non trouvés"
        echo "💡 Assurez-vous d'être dans le dossier raspberry-pi-server/"
        exit 1
    fi
    
    # Copier les fichiers
    echo "📄 Copie des fichiers serveur..."
    cp -r * "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR"/*.sh
    
    echo "✅ Fichiers serveur copiés"
}

# Étape 4: Installation dépendances
install_dependencies() {
    show_step "4" "INSTALLATION DÉPENDANCES"
    
    cd "$INSTALL_DIR" || exit 1
    
    echo "📦 Installation des dépendances NPM..."
    npm install
    
    if [[ $? -eq 0 ]]; then
        echo "✅ Dépendances installées"
    else
        echo "❌ Erreur installation dépendances"
        exit 1
    fi
}

# Étape 5: Initialisation base de données
init_database() {
    show_step "5" "INITIALISATION BASE DE DONNÉES"
    
    cd "$INSTALL_DIR" || exit 1
    
    echo "🗄️  Création des tables SQLite..."
    npm run setup
    
    if [[ $? -eq 0 ]]; then
        echo "✅ Base de données initialisée"
    else
        echo "❌ Erreur initialisation base de données"
        exit 1
    fi
}

# Étape 6: Installation Samba
install_samba() {
    show_step "6" "INSTALLATION SAMBA (PARTAGE SMB)"
    
    if command_exists smbd; then
        echo "✅ Samba déjà installé"
        return 0
    fi
    
    echo "📦 Installation Samba..."
    sudo apt install -y samba samba-common-bin
    
    if command_exists smbd; then
        echo "✅ Samba installé avec succès"
    else
        echo "❌ Erreur installation Samba"
        exit 1
    fi
}

# Étape 7: Configuration partage
configure_smb_share() {
    show_step "7" "CONFIGURATION PARTAGE SMB"
    
    # Sauvegarder la configuration existante
    sudo cp /etc/samba/smb.conf /etc/samba/smb.conf.backup
    
    # Configuration du partage
    cat << EOF | sudo tee -a /etc/samba/smb.conf

# ===========================================
# PARTAGE PARCELLE PLUS
# ===========================================
[$SHARE_NAME]
    comment = Serveur ParcellePlus - Développement
    path = $INSTALL_DIR
    browseable = yes
    read only = no
    create mask = 0755
    directory mask = 0755
    valid users = $SMB_USER
    force user = $SMB_USER
    force group = $SMB_USER
    guest ok = no
    
# Configuration globale optimisée
[global]
    security = user
    map to guest = bad user
    server string = Raspberry Pi ParcellePlus Server
    workgroup = WORKGROUP
    netbios name = RaspberryPi-ParcellePlus
    log file = /var/log/samba/log.%m
    max log size = 1000
    log level = 1
EOF
    
    echo "✅ Configuration SMB ajoutée"
}

# Étape 8: Configuration utilisateur Samba
setup_samba_user() {
    show_step "8" "CONFIGURATION UTILISATEUR SMB"
    
    echo "👤 Configuration utilisateur Samba..."
    echo "💡 Définissez un mot de passe pour l'accès réseau SMB:"
    sudo smbpasswd -a "$SMB_USER"
    sudo smbpasswd -e "$SMB_USER"
    
    echo "✅ Utilisateur SMB configuré"
}

# Étape 9: Configuration pare-feu
configure_firewall() {
    show_step "9" "CONFIGURATION PARE-FEU"
    
    echo "🔥 Configuration des ports..."
    
    # Ports serveur Node.js
    sudo ufw allow ssh
    sudo ufw allow $PORT/tcp
    
    # Ports Samba
    sudo ufw allow 139/tcp
    sudo ufw allow 445/tcp
    sudo ufw allow 137/udp
    sudo ufw allow 138/udp
    
    # Activer le pare-feu
    echo "y" | sudo ufw enable
    
    echo "✅ Pare-feu configuré"
    echo "   Port SSH: 22"
    echo "   Port serveur: $PORT"
    echo "   Ports SMB: 137, 138, 139, 445"
}

# Étape 10: Démarrage des services
start_services() {
    show_step "10" "DÉMARRAGE DES SERVICES"
    
    cd "$INSTALL_DIR" || exit 1
    
    # Démarrer le serveur Node.js
    echo "🚀 Démarrage serveur Node.js..."
    pm2 stop "$SERVICE_NAME" 2>/dev/null || true
    pm2 delete "$SERVICE_NAME" 2>/dev/null || true
    pm2 start server.js --name "$SERVICE_NAME"
    
    # Démarrer Samba
    echo "🗂️  Démarrage services Samba..."
    sudo systemctl restart smbd
    sudo systemctl restart nmbd
    sudo systemctl enable smbd
    sudo systemctl enable nmbd
    
    # Configuration démarrage automatique
    pm2 startup
    pm2 save
    
    echo "✅ Services démarrés"
}

# Étape 11: Tests et vérifications
run_tests() {
    show_step "11" "TESTS ET VÉRIFICATIONS"
    
    echo "🧪 Test serveur Node.js..."
    sleep 3
    
    # Test API
    API_RESPONSE=$(curl -s http://192.168.1.17:$PORT/api/health)
    if [[ $? -eq 0 ]]; then
        echo "✅ API serveur: OK"
        echo "   Réponse: $API_RESPONSE"
    else
        echo "❌ API serveur: ERREUR"
    fi
    
    # Test PM2
    PM2_STATUS=$(pm2 list | grep "$SERVICE_NAME")
    if [[ $? -eq 0 ]]; then
        echo "✅ Service PM2: OK"
    else
        echo "❌ Service PM2: ERREUR"
    fi
    
    # Test Samba
    if systemctl is-active --quiet smbd; then
        echo "✅ Service SMB: OK"
    else
        echo "❌ Service SMB: ERREUR"
    fi
    
    echo "✅ Tests terminés"
}

# Affichage final
show_final_info() {
    echo ""
    echo "🎉 =================================================="
    echo "🎉 INSTALLATION TERMINÉE AVEC SUCCÈS!"
    echo "🎉 =================================================="
    echo ""
    echo "🖥️  SERVEUR NODE.JS:"
    echo "   🔗 URL: http://192.168.1.17:$PORT"
    echo "   ❤️  Santé: http://192.168.1.17:$PORT/api/health"
    echo "   📊 Logs: pm2 logs $SERVICE_NAME"
    echo ""
    echo "🗂️  PARTAGE SMB:"
    echo "   🔗 Adresse: \\\\192.168.1.17\\$SHARE_NAME"
    echo "   👤 Utilisateur: $SMB_USER"
    echo "   🔑 Mot de passe: (celui que vous avez défini)"
    echo ""
    echo "🔧 COMMANDES UTILES:"
    echo "   pm2 restart $SERVICE_NAME   # Redémarrer serveur"
    echo "   pm2 logs $SERVICE_NAME      # Voir les logs"
    echo "   pm2 status                  # Statut services"
    echo "   sudo systemctl restart smbd # Redémarrer SMB"
    echo ""
    echo "💻 CONNEXION DEPUIS WINDOWS:"
    echo "   1. Ouvrir l'Explorateur Windows"
    echo "   2. Taper: \\\\192.168.1.17"
    echo "   3. Double-cliquer sur '$SHARE_NAME'"
    echo "   4. Saisir: $SMB_USER + mot de passe"
    echo ""
    echo "🔄 REDÉMARRAGE RECOMMANDÉ:"
    echo "   sudo reboot"
    echo ""
}

# Fonction principale
main() {
    install_nodejs
    install_pm2
    setup_server_files
    install_dependencies
    init_database
    install_samba
    configure_smb_share
    setup_samba_user
    configure_firewall
    start_services
    run_tests
    show_final_info
}

# Exécuter l'installation
main

echo "✅ Installation complète terminée!"
echo "💡 N'oubliez pas de redémarrer: sudo reboot" 