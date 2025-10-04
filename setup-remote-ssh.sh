#!/bin/bash

# Script pour configurer un accès SSH distant sécurisé
# Permet l'accès SSH via internet avec sécurité renforcée

echo "🔐 ========================================="
echo "🔐 CONFIGURATION SSH DISTANT SÉCURISÉ"
echo "🔐 ========================================="
echo ""

# Variables
SSH_PORT=22
NEW_SSH_PORT=2222
SSH_USER="axel"
AUTHORIZED_KEYS_FILE="/home/axel/.ssh/authorized_keys"

echo "📋 Configuration SSH:"
echo "   🔌 Port SSH actuel: $SSH_PORT"
echo "   🔌 Nouveau port SSH: $NEW_SSH_PORT"
echo "   👤 Utilisateur: $SSH_USER"
echo "   🏠 IP locale: 192.168.1.17"
echo ""

# Fonction pour vérifier si une commande existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Créer le répertoire SSH si nécessaire
setup_ssh_directory() {
    echo "📁 Configuration du répertoire SSH..."
    
    mkdir -p ~/.ssh
    chmod 700 ~/.ssh
    touch ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
    
    echo "✅ Répertoire SSH configuré"
}

# Générer une paire de clés SSH
generate_ssh_keys() {
    echo "🔑 Génération des clés SSH..."
    
    if [[ -f ~/.ssh/id_rsa ]]; then
        echo "✅ Clé SSH privée existante trouvée"
    else
        ssh-keygen -t rsa -b 4096 -C "parcelle-plus-server@raspberry-pi" -f ~/.ssh/id_rsa -N ""
        echo "✅ Nouvelle paire de clés SSH générée"
    fi
    
    # Ajouter la clé publique aux clés autorisées
    cat ~/.ssh/id_rsa.pub >> ~/.ssh/authorized_keys
    
    echo "✅ Clé publique ajoutée aux clés autorisées"
}

# Créer une clé SSH pour l'accès distant
create_remote_access_key() {
    echo "🌐 Création d'une clé SSH pour l'accès distant..."
    
    # Générer une clé spécifique pour l'accès distant
    ssh-keygen -t rsa -b 4096 -C "remote-access-parcelle-plus" -f ~/.ssh/remote_access_key -N ""
    
    # Créer un script pour afficher la clé publique
    cat > ~/get_public_key.sh << 'EOF'
#!/bin/bash
echo "🔑 CLÉ PUBLIQUE SSH POUR ACCÈS DISTANT:"
echo "======================================="
cat ~/.ssh/remote_access_key.pub
echo ""
echo "📋 INSTRUCTIONS:"
echo "1. Copiez la clé publique ci-dessus"
echo "2. Partagez-la avec la personne qui doit accéder"
echo "3. Elle devra l'ajouter à ses clés SSH"
echo ""
echo "🔐 CONNEXION DISTANTE:"
echo "ssh -i ~/.ssh/remote_access_key pi@ADRESSE_IP_PUBLIQUE -p $NEW_SSH_PORT"
EOF
    
    chmod +x ~/get_public_key.sh
    
    echo "✅ Clé d'accès distant créée"
}

# Configuration SSH sécurisée
configure_secure_ssh() {
    echo "🛡️ Configuration SSH sécurisée..."
    
    # Sauvegarder la configuration existante
    sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup
    
    # Créer une nouvelle configuration sécurisée
    sudo tee /etc/ssh/sshd_config > /dev/null << EOF
# Configuration SSH sécurisée ParcellePlus
Port $NEW_SSH_PORT
Protocol 2

# Authentification
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile %h/.ssh/authorized_keys

# Sécurité
X11Forwarding no
AllowTcpForwarding yes
GatewayPorts yes
ClientAliveInterval 60
ClientAliveCountMax 2

# Utilisateurs autorisés
AllowUsers $SSH_USER

# Chiffrement
KexAlgorithms curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
MACs hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com

# Connexions
MaxAuthTries 3
LoginGraceTime 30
MaxSessions 2
EOF
    
    echo "✅ Configuration SSH sécurisée appliquée"
}

# Installation et configuration de ngrok pour SSH
setup_ngrok_ssh() {
    echo "🌐 Configuration tunnel SSH ngrok..."
    
    # Installer ngrok si pas déjà fait
    if ! command_exists ngrok; then
        echo "📦 Installation ngrok..."
        cd /tmp
        wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz
        tar -xzf ngrok-v3-stable-linux-arm64.tgz
        sudo mv ngrok /usr/local/bin/
    fi
    
    # Demander le token ngrok
    echo "🔑 Token ngrok requis pour l'accès distant"
    echo "1. Créez un compte gratuit sur https://ngrok.com"
    echo "2. Récupérez votre token d'authentification"
    echo "3. Collez-le ci-dessous:"
    read -r NGROK_TOKEN
    
    # Configurer ngrok
    ngrok config add-authtoken "$NGROK_TOKEN"
    
    # Créer la configuration ngrok pour SSH
    mkdir -p ~/.ngrok2
    cat > ~/.ngrok2/ngrok.yml << EOF
version: "2"
authtoken: $NGROK_TOKEN
tunnels:
  ssh:
    addr: $NEW_SSH_PORT
    proto: tcp
    remote_addr: 0.tcp.ngrok.io:12345
EOF
    
    echo "✅ Tunnel SSH ngrok configuré"
}

# Créer le service ngrok pour SSH
create_ngrok_ssh_service() {
    echo "🔧 Création du service ngrok SSH..."
    
    cat << EOF | sudo tee /etc/systemd/system/ngrok-ssh.service
[Unit]
Description=ngrok SSH tunnel
After=network.target

[Service]
Type=simple
User=axel
ExecStart=/usr/local/bin/ngrok start ssh --config /home/axel/.ngrok2/ngrok.yml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    
    sudo systemctl daemon-reload
    sudo systemctl enable ngrok-ssh
    sudo systemctl start ngrok-ssh
    
    echo "✅ Service ngrok SSH créé"
}

# Configuration du pare-feu
configure_firewall() {
    echo "🔥 Configuration du pare-feu..."
    
    # Ouvrir le nouveau port SSH
    sudo ufw allow $NEW_SSH_PORT/tcp
    
    # Fermer l'ancien port SSH (optionnel)
    echo "❓ Voulez-vous fermer l'ancien port SSH ($SSH_PORT) ? (y/N)"
    read -r close_old_port
    if [[ "$close_old_port" =~ ^[Yy]$ ]]; then
        sudo ufw delete allow $SSH_PORT/tcp
        echo "✅ Ancien port SSH fermé"
    fi
    
    echo "✅ Pare-feu configuré"
}

# Redémarrer le service SSH
restart_ssh_service() {
    echo "🔄 Redémarrage du service SSH..."
    
    sudo systemctl restart sshd
    
    if sudo systemctl is-active --quiet sshd; then
        echo "✅ Service SSH redémarré avec succès"
    else
        echo "❌ Erreur redémarrage SSH"
        echo "🔧 Restauration de la configuration..."
        sudo cp /etc/ssh/sshd_config.backup /etc/ssh/sshd_config
        sudo systemctl restart sshd
        exit 1
    fi
}

# Afficher les informations de connexion
show_connection_info() {
    echo ""
    echo "🎉 ========================================="
    echo "🎉 SSH DISTANT CONFIGURÉ AVEC SUCCÈS"
    echo "🎉 ========================================="
    echo ""
    
    # Récupérer l'URL ngrok
    sleep 5
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*' | grep tcp | cut -d'"' -f4)
    
    echo "🔐 CONNEXION SSH LOCALE:"
    echo "   ssh $SSH_USER@192.168.1.17 -p $NEW_SSH_PORT"
    echo ""
    echo "🌐 CONNEXION SSH DISTANTE (via ngrok):"
    echo "   $NGROK_URL"
    echo "   ssh $SSH_USER@0.tcp.ngrok.io -p XXXX"
    echo ""
    echo "🔑 CLÉ PUBLIQUE POUR ACCÈS DISTANT:"
    echo "   ~/get_public_key.sh"
    echo ""
    echo "📋 FICHIERS IMPORTANTS:"
    echo "   ~/.ssh/id_rsa           # Clé privée principale"
    echo "   ~/.ssh/remote_access_key # Clé privée accès distant"
    echo "   ~/.ssh/authorized_keys   # Clés autorisées"
    echo ""
    echo "🔧 COMMANDES UTILES:"
    echo "   sudo systemctl status sshd      # Statut SSH"
    echo "   sudo systemctl status ngrok-ssh # Statut tunnel"
    echo "   ~/get_public_key.sh            # Voir clé publique"
    echo "   curl http://localhost:4040/api/tunnels # URLs ngrok"
    echo ""
    echo "⚠️  SÉCURITÉ:"
    echo "   - Authentification par clé uniquement"
    echo "   - Port SSH changé vers $NEW_SSH_PORT"
    echo "   - Accès root désactivé"
    echo "   - Tunnel chiffré via ngrok"
    echo ""
}

# Fonction principale
main() {
    setup_ssh_directory
    generate_ssh_keys
    create_remote_access_key
    configure_secure_ssh
    setup_ngrok_ssh
    create_ngrok_ssh_service
    configure_firewall
    restart_ssh_service
    show_connection_info
}

# Exécuter
main

echo "✅ Configuration SSH distant terminée!"
echo "🌐 Votre Raspberry Pi est maintenant accessible via SSH distant sécurisé"
echo ""
echo "📞 POUR PARTAGER L'ACCÈS:"
echo "1. Exécutez: ~/get_public_key.sh"
echo "2. Partagez la clé publique affichée"
echo "3. Partagez l'URL ngrok de connexion" 