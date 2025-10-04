#!/bin/bash

# Script pour configurer un workspace cloud sur Raspberry Pi
# Permet l'accès via navigateur web

echo "☁️ ========================================="
echo "☁️ CONFIGURATION WORKSPACE CLOUD"
echo "☁️ ========================================="
echo ""

# Variables
WORKSPACE_PORT=8080
WORKSPACE_PASSWORD=""

echo "📋 Configuration:"
echo "   🔌 Port workspace: $WORKSPACE_PORT"
echo "   🏠 IP locale: 192.168.1.17"
echo "   🌐 URL: http://192.168.1.17:$WORKSPACE_PORT"
echo ""

# Fonction pour vérifier si une commande existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Installation de code-server (VS Code dans le navigateur)
install_code_server() {
    echo "📦 Installation de code-server..."
    
    if command_exists code-server; then
        echo "✅ code-server déjà installé"
        return 0
    fi
    
    # Installer code-server
    echo "📥 Installation via script officiel..."
    curl -fsSL https://code-server.dev/install.sh | sh
    
    # Vérifier l'installation
    if command_exists code-server; then
        echo "✅ code-server installé avec succès"
    else
        echo "❌ Erreur installation code-server"
        exit 1
    fi
}

# Configuration de code-server
configure_code_server() {
    echo "⚙️ Configuration de code-server..."
    
    # Créer le répertoire de configuration
    mkdir -p ~/.config/code-server
    
    # Demander le mot de passe
    if [[ -z "$WORKSPACE_PASSWORD" ]]; then
        echo "🔑 Définissez un mot de passe pour l'accès web:"
        read -r WORKSPACE_PASSWORD
    fi
    
    # Créer le fichier de configuration
    cat > ~/.config/code-server/config.yaml << EOF
bind-addr: 0.0.0.0:$WORKSPACE_PORT
auth: password
password: $WORKSPACE_PASSWORD
cert: false
EOF
    
    echo "✅ Configuration code-server créée"
}

# Installer les extensions utiles
install_extensions() {
    echo "🔧 Installation des extensions..."
    
    # Extensions pour Node.js et développement
    code-server --install-extension ms-vscode.vscode-json
    code-server --install-extension bradlc.vscode-tailwindcss
    code-server --install-extension esbenp.prettier-vscode
    code-server --install-extension ms-vscode.vscode-typescript-next
    code-server --install-extension formulahendry.auto-rename-tag
    code-server --install-extension christian-kohler.path-intellisense
    
    echo "✅ Extensions installées"
}

# Créer le service systemd
create_code_server_service() {
    echo "🔧 Création du service code-server..."
    
    cat << EOF | sudo tee /etc/systemd/system/code-server.service
[Unit]
Description=code-server - VS Code in browser
After=network.target

[Service]
Type=simple
User=axel
WorkingDirectory=/home/axel/parcelle-plus-server
ExecStart=/usr/bin/code-server --config /home/axel/.config/code-server/config.yaml /home/axel/parcelle-plus-server
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=development

[Install]
WantedBy=multi-user.target
EOF
    
    # Activer et démarrer le service
    sudo systemctl daemon-reload
    sudo systemctl enable code-server
    sudo systemctl start code-server
    
    echo "✅ Service code-server créé et démarré"
}

# Configuration du pare-feu
configure_firewall() {
    echo "🔥 Configuration du pare-feu..."
    
    # Ouvrir le port pour code-server
    sudo ufw allow $WORKSPACE_PORT/tcp
    
    echo "✅ Pare-feu configuré pour le port $WORKSPACE_PORT"
}

# Afficher les informations de connexion
show_connection_info() {
    echo ""
    echo "🎉 ========================================="
    echo "🎉 WORKSPACE CLOUD CONFIGURÉ"
    echo "🎉 ========================================="
    echo ""
    echo "🌐 Accès via navigateur web:"
    echo "   🔗 URL locale: http://192.168.1.17:$WORKSPACE_PORT"
    echo "   🔗 URL externe: http://VOTRE_IP_PUBLIQUE:$WORKSPACE_PORT"
    echo "   🔑 Mot de passe: $WORKSPACE_PASSWORD"
    echo ""
    echo "💻 Fonctionnalités disponibles:"
    echo "   ✅ Éditeur VS Code complet"
    echo "   ✅ Terminal intégré"
    echo "   ✅ Explorateur de fichiers"
    echo "   ✅ Débogage intégré"
    echo "   ✅ Extensions installées"
    echo ""
    echo "🔧 Commandes utiles:"
    echo "   sudo systemctl status code-server  # Statut du service"
    echo "   sudo systemctl restart code-server # Redémarrer"
    echo "   code-server --help                 # Aide"
    echo ""
    echo "💡 Utilisation:"
    echo "   1. Ouvrez votre navigateur"
    echo "   2. Allez sur http://192.168.1.17:$WORKSPACE_PORT"
    echo "   3. Saisissez le mot de passe"
    echo "   4. Développez directement dans le navigateur!"
    echo ""
}

# Fonction principale
main() {
    install_code_server
    configure_code_server
    install_extensions
    create_code_server_service
    configure_firewall
    show_connection_info
}

# Exécuter
main

echo "✅ Configuration workspace cloud terminée!"
echo "🌐 Vous pouvez maintenant développer via navigateur web" 