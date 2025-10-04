#!/bin/bash

# Script de configuration du partage SMB pour ParcellePlus
# Pour accéder au serveur depuis Windows

echo "🗂️ ========================================="
echo "🗂️ CONFIGURATION PARTAGE SMB PARCELLE PLUS"
echo "🗂️ ========================================="
echo ""

# Vérifier les privilèges
if [[ $EUID -eq 0 ]]; then
    echo "❌ Ne pas exécuter ce script en tant que root"
    echo "💡 Utilisez: ./setup-smb-share.sh"
    exit 1
fi

# Variables
SHARE_NAME="ParcellePlus"
SHARE_PATH="/home/axel/parcelle-plus-server"
SMB_USER="axel"

echo "📁 Nom du partage: $SHARE_NAME"
echo "📂 Chemin: $SHARE_PATH"
echo "👤 Utilisateur: $SMB_USER"
echo "🏠 IP: 192.168.1.10"
echo ""

# Fonction pour vérifier si une commande existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Installation de Samba
install_samba() {
    echo "📦 Installation de Samba..."
    
    if command_exists smbd; then
        echo "✅ Samba déjà installé"
        return 0
    fi
    
    # Mettre à jour et installer
    sudo apt update
    sudo apt install -y samba samba-common-bin
    
    if command_exists smbd; then
        echo "✅ Samba installé avec succès"
    else
        echo "❌ Erreur installation Samba"
        exit 1
    fi
}

# Configuration du partage
configure_share() {
    echo "⚙️ Configuration du partage..."
    
    # Créer le dossier s'il n'existe pas
    if [[ ! -d "$SHARE_PATH" ]]; then
        mkdir -p "$SHARE_PATH"
        echo "📁 Dossier créé: $SHARE_PATH"
    fi
    
    # Sauvegarder la configuration existante
    sudo cp /etc/samba/smb.conf /etc/samba/smb.conf.backup
    
    # Ajouter la configuration du partage
    cat << EOF | sudo tee -a /etc/samba/smb.conf

# ===========================================
# PARTAGE PARCELLE PLUS
# ===========================================
[$SHARE_NAME]
    comment = Serveur ParcellePlus - Developpement
    path = $SHARE_PATH
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
    # Sécurité
    security = user
    map to guest = bad user
    
    # Performance
    socket options = TCP_NODELAY IPTOS_LOWDELAY SO_RCVBUF=65536 SO_SNDBUF=65536
    
    # Compatibilité Windows
    server string = Raspberry Pi ParcellePlus Server
    workgroup = WORKGROUP
    netbios name = RaspberryPi-ParcellePlus
    
    # Logs
    log file = /var/log/samba/log.%m
    max log size = 1000
    log level = 1
EOF
    
    echo "✅ Configuration Samba ajoutée"
}

# Créer utilisateur Samba
setup_samba_user() {
    echo "👤 Configuration utilisateur Samba..."
    
    # Ajouter l'utilisateur pi à Samba
    echo "💡 Définissez un mot de passe pour l'accès réseau:"
    sudo smbpasswd -a "$SMB_USER"
    
    # Activer l'utilisateur
    sudo smbpasswd -e "$SMB_USER"
    
    echo "✅ Utilisateur Samba configuré"
}

# Configurer le pare-feu
configure_firewall() {
    echo "🔥 Configuration du pare-feu..."
    
    # Ports Samba
    sudo ufw allow 139/tcp
    sudo ufw allow 445/tcp
    sudo ufw allow 137/udp
    sudo ufw allow 138/udp
    
    echo "✅ Pare-feu configuré pour SMB"
    echo "   Ports ouverts: 137, 138, 139, 445"
}

# Démarrer les services
start_services() {
    echo "🚀 Démarrage des services..."
    
    # Redémarrer Samba
    sudo systemctl restart smbd
    sudo systemctl restart nmbd
    
    # Activer au démarrage
    sudo systemctl enable smbd
    sudo systemctl enable nmbd
    
    # Vérifier le statut
    if systemctl is-active --quiet smbd; then
        echo "✅ Service SMB démarré"
    else
        echo "❌ Erreur démarrage SMB"
        exit 1
    fi
    
    if systemctl is-active --quiet nmbd; then
        echo "✅ Service NetBIOS démarré"
    else
        echo "❌ Erreur démarrage NetBIOS"
        exit 1
    fi
}

# Afficher les informations de connexion
show_connection_info() {
    echo ""
    echo "🎉 ========================================="
    echo "🎉 PARTAGE SMB CONFIGURÉ AVEC SUCCÈS"
    echo "🎉 ========================================="
    echo ""
    echo "📋 Informations de connexion:"
    echo "   🖥️  Adresse réseau: \\\\192.168.1.10\\$SHARE_NAME"
    echo "   📁 Nom du partage: $SHARE_NAME"
    echo "   👤 Utilisateur: $SMB_USER"
    echo "   🔑 Mot de passe: (celui que vous avez défini)"
    echo ""
    echo "🔗 Connexion depuis Windows:"
    echo "   1. Ouvrir l'Explorateur Windows"
    echo "   2. Taper dans la barre d'adresse: \\\\192.168.1.10"
    echo "   3. Double-cliquer sur '$SHARE_NAME'"
    echo "   4. Saisir: $SMB_USER + mot de passe"
    echo ""
    echo "💾 Mapper le lecteur réseau:"
    echo "   1. Clic droit sur 'Ce PC'"
    echo "   2. 'Connecter un lecteur réseau'"
    echo "   3. Dossier: \\\\192.168.1.10\\$SHARE_NAME"
    echo "   4. Cocher 'Se reconnecter à l'ouverture de session'"
    echo ""
    echo "🧪 Test de connexion:"
    echo "   smbclient -L 192.168.1.17 -U $SMB_USER"
    echo ""
}

# Fonction principale
main() {
    install_samba
    configure_share
    setup_samba_user
    configure_firewall
    start_services
    show_connection_info
}

# Exécuter
main

echo "✅ Installation terminée avec succès!"
echo "🔄 Redémarrage recommandé: sudo reboot" 