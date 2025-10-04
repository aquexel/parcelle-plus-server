#!/bin/bash

# Script pour configurer un tunnel ngrok sur Raspberry Pi
# Permet l'accès distant sécurisé au serveur

echo "🌐 ========================================="
echo "🌐 CONFIGURATION TUNNEL NGROK"
echo "🌐 ========================================="
echo ""

# Variables
NGROK_TOKEN=""  # À remplir avec votre token ngrok
SERVICE_PORT=3000
SSH_PORT=22

echo "📋 Configuration:"
echo "   🔌 Port serveur: $SERVICE_PORT"
echo "   🔐 Port SSH: $SSH_PORT"
echo "   🏠 IP locale: 192.168.1.17"
echo ""

# Fonction pour vérifier si une commande existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Installation de ngrok
install_ngrok() {
    echo "📦 Installation de ngrok..."
    
    if command_exists ngrok; then
        echo "✅ ngrok déjà installé"
        return 0
    fi
    
    # Télécharger ngrok pour ARM64
    echo "📥 Téléchargement ngrok..."
    cd /tmp
    wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz
    tar -xzf ngrok-v3-stable-linux-arm64.tgz
    sudo mv ngrok /usr/local/bin/
    
    # Vérifier l'installation
    if command_exists ngrok; then
        echo "✅ ngrok installé avec succès"
    else
        echo "❌ Erreur installation ngrok"
        exit 1
    fi
}

# Configuration du token ngrok
setup_ngrok_token() {
    echo "🔑 Configuration du token ngrok..."
    
    if [[ -z "$NGROK_TOKEN" ]]; then
        echo "⚠️  Vous devez obtenir un token ngrok gratuit:"
        echo "   1. Allez sur https://ngrok.com/"
        echo "   2. Créez un compte gratuit"
        echo "   3. Copiez votre token d'authentification"
        echo ""
        echo "💡 Collez votre token ngrok:"
        read -r NGROK_TOKEN
    fi
    
    # Configurer le token
    ngrok config add-authtoken "$NGROK_TOKEN"
    
    echo "✅ Token ngrok configuré"
}

# Créer le fichier de configuration ngrok
create_ngrok_config() {
    echo "⚙️ Création de la configuration ngrok..."
    
    cat > ~/.ngrok2/ngrok.yml << EOF
version: "2"
authtoken: $NGROK_TOKEN
tunnels:
  parcelle-server:
    addr: 3000
    proto: http
    hostname: parcelle-plus-server.ngrok.io
    bind_tls: true
  parcelle-ssh:
    addr: 22
    proto: tcp
    remote_addr: 0.tcp.ngrok.io:12345
EOF
    
    echo "✅ Configuration ngrok créée"
}

# Créer le service systemd pour ngrok
create_ngrok_service() {
    echo "🔧 Création du service ngrok..."
    
    cat << EOF | sudo tee /etc/systemd/system/ngrok.service
[Unit]
Description=ngrok tunnel service
After=network.target

[Service]
Type=simple
User=axel
ExecStart=/usr/local/bin/ngrok start --all --config /home/axel/.ngrok2/ngrok.yml
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=5

[Install]
WantedBy=multi-user.target
EOF
    
    # Activer et démarrer le service
    sudo systemctl daemon-reload
    sudo systemctl enable ngrok
    sudo systemctl start ngrok
    
    echo "✅ Service ngrok créé et démarré"
}

# Afficher les informations de connexion
show_connection_info() {
    echo ""
    echo "🎉 ========================================="
    echo "🎉 TUNNEL NGROK CONFIGURÉ"
    echo "🎉 ========================================="
    echo ""
    
    # Attendre que ngrok démarre
    sleep 5
    
    # Récupérer les URLs publiques
    echo "🔗 URLs publiques ngrok:"
    curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[].public_url'
    
    echo ""
    echo "📋 Informations de connexion:"
    echo "   🖥️  Serveur web: https://parcelle-plus-server.ngrok.io"
    echo "   🔐 SSH: ssh pi@0.tcp.ngrok.io -p 12345"
    echo "   📊 Dashboard ngrok: http://localhost:4040"
    echo ""
    echo "💡 Commandes utiles:"
    echo "   sudo systemctl status ngrok    # Statut du tunnel"
    echo "   sudo systemctl restart ngrok   # Redémarrer le tunnel"
    echo "   curl http://localhost:4040/api/tunnels  # Voir les URLs"
    echo ""
}

# Fonction principale
main() {
    install_ngrok
    setup_ngrok_token
    create_ngrok_config
    create_ngrok_service
    show_connection_info
}

# Exécuter
main

echo "✅ Configuration ngrok terminée!"
echo "🌐 Votre serveur est maintenant accessible depuis internet" 