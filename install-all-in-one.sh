#!/bin/bash

# Script d'installation tout-en-un ParcellePlus
# - Serveur Node.js avec API REST
# - SSH distant sécurisé avec ngrok
# - Partage SMB pour Windows
# - Configuration automatique complète

echo "🚀 =================================================="
echo "🚀 INSTALLATION TOUT-EN-UN PARCELLE PLUS"
echo "🚀 =================================================="
echo "   🖥️  Serveur Node.js + API REST + WebSocket"
echo "   🔐 SSH distant sécurisé avec ngrok"
echo "   🗂️  Partage SMB pour Windows"
echo "   🔧 Configuration automatique complète"
echo "=================================================="
echo ""

# Variables globales
INSTALL_DIR="/home/axel/parcelle-plus-server"
SERVICE_NAME="parcelle-plus-server"
SHARE_NAME="ParcellePlus"
SMB_USER="axel"
SERVER_PORT=3000
SSH_PORT=2222
WORKSPACE_PORT=8080
NGROK_TOKEN=""

echo "📋 Configuration complète:"
echo "   📁 Installation: $INSTALL_DIR"
echo "   🖥️  IP locale: 192.168.1.17"
echo "   🔌 Port serveur: $SERVER_PORT"
echo "   🔐 Port SSH: $SSH_PORT"
echo "   ☁️  Port workspace: $WORKSPACE_PORT"
echo "   🗂️  Partage SMB: \\\\192.168.1.17\\$SHARE_NAME"
echo "   👤 Utilisateur: $SMB_USER"
echo ""

# Menu de sélection
echo "🎯 Que voulez-vous installer ?"
echo "1. Installation complète (serveur + SSH + SMB + workspace)"
echo "2. Serveur Node.js seulement"
echo "3. SSH distant seulement"
echo "4. Partage SMB seulement"
echo "5. Workspace cloud seulement"
echo ""
echo "💡 Choix (1-5) :"
read -r INSTALL_CHOICE

# Vérifier les privilèges
if [[ $EUID -eq 0 ]]; then
    echo "❌ Ne pas exécuter ce script en tant que root"
    echo "💡 Utilisez: ./install-all-in-one.sh"
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

# Installation du serveur Node.js
install_server() {
    show_step "A" "INSTALLATION SERVEUR NODE.JS"
    
    # Installer Node.js
    if ! command_exists node; then
        echo "📦 Installation Node.js..."
        sudo apt update -y
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    
    # Installer PM2
    if ! command_exists pm2; then
        echo "📦 Installation PM2..."
        sudo npm install -g pm2
    fi
    
    # Configurer les fichiers
    if [[ ! -d "$INSTALL_DIR" ]]; then
        mkdir -p "$INSTALL_DIR"
    fi
    
    if [[ -f "package.json" ]]; then
        cp -r * "$INSTALL_DIR/"
        chmod +x "$INSTALL_DIR"/*.sh
    fi
    
    # Installer les dépendances
    cd "$INSTALL_DIR" || exit 1
    npm install
    
    # Initialiser la base de données
    npm run setup
    
    # Démarrer le serveur
    pm2 stop "$SERVICE_NAME" 2>/dev/null || true
    pm2 delete "$SERVICE_NAME" 2>/dev/null || true
    pm2 start server.js --name "$SERVICE_NAME"
    pm2 startup
    pm2 save
    
    # Configurer le pare-feu
    sudo ufw allow $SERVER_PORT/tcp
    
    echo "✅ Serveur Node.js installé et configuré"
}

# Configuration SSH distant
install_ssh_remote() {
    show_step "B" "CONFIGURATION SSH DISTANT"
    
    # Configurer SSH sécurisé
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
    touch ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
    
    # Générer les clés SSH
    if [[ ! -f ~/.ssh/id_rsa ]]; then
        ssh-keygen -t rsa -b 4096 -C "parcelle-plus-server" -f ~/.ssh/id_rsa -N ""
    fi
    
    ssh-keygen -t rsa -b 4096 -C "remote-access-parcelle-plus" -f ~/.ssh/remote_access_key -N ""
    
    # Ajouter la clé aux clés autorisées
    cat ~/.ssh/id_rsa.pub >> ~/.ssh/authorized_keys
    cat ~/.ssh/remote_access_key.pub >> ~/.ssh/authorized_keys
    
    # Créer le script pour afficher la clé publique
    cat > ~/get_public_key.sh << 'EOF'
#!/bin/bash
echo "🔑 CLÉ PUBLIQUE SSH POUR ACCÈS DISTANT:"
echo "======================================="
cat ~/.ssh/remote_access_key.pub
echo ""
echo "🔐 CONNEXION DISTANTE:"
echo "ssh -i ~/.ssh/remote_access_key pi@0.tcp.ngrok.io -p XXXX"
EOF
    chmod +x ~/get_public_key.sh
    
    # Configuration SSH sécurisée
    sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup
    
    cat << EOF | sudo tee /etc/ssh/sshd_config
Port $SSH_PORT
Protocol 2
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile %h/.ssh/authorized_keys
X11Forwarding no
AllowTcpForwarding yes
ClientAliveInterval 60
ClientAliveCountMax 2
AllowUsers $SMB_USER
MaxAuthTries 3
LoginGraceTime 30
MaxSessions 2
EOF
    
    # Installer et configurer ngrok
    if ! command_exists ngrok; then
        cd /tmp
        wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz
        tar -xzf ngrok-v3-stable-linux-arm64.tgz
        sudo mv ngrok /usr/local/bin/
    fi
    
    # Demander le token ngrok
    if [[ -z "$NGROK_TOKEN" ]]; then
        echo "🔑 Token ngrok requis (créez un compte gratuit sur https://ngrok.com):"
        read -r NGROK_TOKEN
    fi
    
    ngrok config add-authtoken "$NGROK_TOKEN"
    
    # Configuration ngrok
    mkdir -p ~/.ngrok2
    cat > ~/.ngrok2/ngrok.yml << EOF
version: "2"
authtoken: $NGROK_TOKEN
tunnels:
  ssh:
    addr: $SSH_PORT
    proto: tcp
  server:
    addr: $SERVER_PORT
    proto: http
  workspace:
    addr: $WORKSPACE_PORT
    proto: http
EOF
    
    # Service ngrok
    cat << EOF | sudo tee /etc/systemd/system/ngrok-ssh.service
[Unit]
Description=ngrok SSH tunnel
After=network.target

[Service]
Type=simple
User=axel
ExecStart=/usr/local/bin/ngrok start --all --config /home/axel/.ngrok2/ngrok.yml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    
    sudo systemctl daemon-reload
    sudo systemctl enable ngrok-ssh
    sudo systemctl start ngrok-ssh
    
    # Configurer le pare-feu
    sudo ufw allow $SSH_PORT/tcp
    
    # Redémarrer SSH
    sudo systemctl restart sshd
    
    echo "✅ SSH distant configuré avec succès"
}

# Configuration du partage SMB
install_smb_share() {
    show_step "C" "CONFIGURATION PARTAGE SMB"
    
    # Installer Samba
    if ! command_exists smbd; then
        sudo apt install -y samba samba-common-bin
    fi
    
    # Configurer le partage
    sudo cp /etc/samba/smb.conf /etc/samba/smb.conf.backup
    
    cat << EOF | sudo tee -a /etc/samba/smb.conf

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
EOF
    
    # Configurer l'utilisateur SMB
    echo "🔑 Définissez un mot de passe pour l'accès SMB:"
    sudo smbpasswd -a "$SMB_USER"
    sudo smbpasswd -e "$SMB_USER"
    
    # Configurer le pare-feu
    sudo ufw allow 139/tcp
    sudo ufw allow 445/tcp
    sudo ufw allow 137/udp
    sudo ufw allow 138/udp
    
    # Démarrer Samba
    sudo systemctl restart smbd
    sudo systemctl restart nmbd
    sudo systemctl enable smbd
    sudo systemctl enable nmbd
    
    echo "✅ Partage SMB configuré avec succès"
}

# Configuration du workspace cloud
install_workspace() {
    show_step "D" "CONFIGURATION WORKSPACE CLOUD"
    
    # Installer code-server
    if ! command_exists code-server; then
        curl -fsSL https://code-server.dev/install.sh | sh
    fi
    
    # Configurer code-server
    mkdir -p ~/.config/code-server
    
    echo "🔑 Définissez un mot de passe pour l'accès workspace:"
    read -r WORKSPACE_PASSWORD
    
    cat > ~/.config/code-server/config.yaml << EOF
bind-addr: 0.0.0.0:$WORKSPACE_PORT
auth: password
password: $WORKSPACE_PASSWORD
cert: false
EOF
    
    # Service code-server
    cat << EOF | sudo tee /etc/systemd/system/code-server.service
[Unit]
Description=code-server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/code-server --config /home/pi/.config/code-server/config.yaml $INSTALL_DIR
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    
    sudo systemctl daemon-reload
    sudo systemctl enable code-server
    sudo systemctl start code-server
    
    # Configurer le pare-feu
    sudo ufw allow $WORKSPACE_PORT/tcp
    
    echo "✅ Workspace cloud configuré avec succès"
}

# Afficher les informations finales
show_final_info() {
    echo ""
    echo "🎉 =================================================="
    echo "🎉 INSTALLATION TERMINÉE AVEC SUCCÈS!"
    echo "🎉 =================================================="
    echo ""
    
    if [[ "$INSTALL_CHOICE" == "1" ]] || [[ "$INSTALL_CHOICE" == "2" ]]; then
        echo "🖥️  SERVEUR NODE.JS:"
        echo "   🔗 URL: http://192.168.1.17:$SERVER_PORT"
        echo "   ❤️  Santé: http://192.168.1.17:$SERVER_PORT/api/health"
        echo "   📊 Commandes: pm2 logs $SERVICE_NAME"
        echo ""
    fi
    
    if [[ "$INSTALL_CHOICE" == "1" ]] || [[ "$INSTALL_CHOICE" == "3" ]]; then
        echo "🔐 SSH DISTANT:"
        echo "   🏠 Local: ssh pi@192.168.1.17 -p $SSH_PORT"
        echo "   🌐 Distant: ssh -i ~/.ssh/remote_access_key pi@0.tcp.ngrok.io -p XXXX"
        echo "   🔑 Clé publique: ~/get_public_key.sh"
        echo ""
    fi
    
    if [[ "$INSTALL_CHOICE" == "1" ]] || [[ "$INSTALL_CHOICE" == "4" ]]; then
        echo "🗂️  PARTAGE SMB:"
        echo "   🔗 Adresse: \\\\192.168.1.17\\$SHARE_NAME"
        echo "   👤 Utilisateur: $SMB_USER"
        echo ""
    fi
    
    if [[ "$INSTALL_CHOICE" == "1" ]] || [[ "$INSTALL_CHOICE" == "5" ]]; then
        echo "☁️  WORKSPACE CLOUD:"
        echo "   🔗 URL: http://192.168.1.17:$WORKSPACE_PORT"
        echo "   🔑 Mot de passe: (celui défini lors de l'installation)"
        echo ""
    fi
    
    echo "🔧 URLS NGROK (après quelques secondes):"
    echo "   curl http://localhost:4040/api/tunnels"
    echo ""
    echo "🔄 REDÉMARRAGE RECOMMANDÉ:"
    echo "   sudo reboot"
    echo ""
}

# Fonction principale
main() {
    case $INSTALL_CHOICE in
        1)
            install_server
            install_ssh_remote
            install_smb_share
            install_workspace
            ;;
        2)
            install_server
            ;;
        3)
            install_ssh_remote
            ;;
        4)
            install_smb_share
            ;;
        5)
            install_workspace
            ;;
        *)
            echo "❌ Choix invalide"
            exit 1
            ;;
    esac
    
    show_final_info
}

# Exécuter l'installation
main

echo "✅ Installation terminée avec succès!"
echo "💡 Redémarrez le système pour finaliser: sudo reboot" 