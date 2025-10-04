#!/bin/bash

# Script de déploiement automatique pour serveur OVH
# Usage: ./deploy-ovh.sh

set -e

echo "🚀 Déploiement ParcellePlus sur serveur OVH"
echo "============================================"

# Variables de configuration
APP_NAME="parcelle-plus"
APP_DIR="/opt/parcelle-plus"
SERVICE_USER="parcelle"
NODE_VERSION="18"

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Vérification des droits root
if [[ $EUID -ne 0 ]]; then
   log_error "Ce script doit être exécuté en tant que root"
   exit 1
fi

# Mise à jour du système
log_info "Mise à jour du système..."
apt update && apt upgrade -y

# Installation de Node.js
log_info "Installation de Node.js $NODE_VERSION..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt install -y nodejs

# Installation des dépendances système
log_info "Installation des dépendances système..."
apt install -y git sqlite3 nginx certbot python3-certbot-nginx ufw fail2ban

# Création de l'utilisateur de service
log_info "Création de l'utilisateur de service..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd -r -s /bin/bash -m -d /home/$SERVICE_USER $SERVICE_USER
fi

# Installation de PM2
log_info "Installation de PM2..."
npm install -g pm2

# Création du répertoire de l'application
log_info "Création du répertoire de l'application..."
mkdir -p $APP_DIR
chown $SERVICE_USER:$SERVICE_USER $APP_DIR

# Copie des fichiers de l'application
log_info "Copie des fichiers de l'application..."
cp -r . $APP_DIR/
chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR

# Installation des dépendances Node.js
log_info "Installation des dépendances Node.js..."
cd $APP_DIR
sudo -u $SERVICE_USER npm install --production

# Configuration de la base de données
log_info "Configuration de la base de données..."
sudo -u $SERVICE_USER mkdir -p $APP_DIR/database
sudo -u $SERVICE_USER node $APP_DIR/create_clean_db.js

# Configuration PM2
log_info "Configuration PM2..."
sudo -u $SERVICE_USER pm2 start $APP_DIR/server.js --name $APP_NAME
sudo -u $SERVICE_USER pm2 save
pm2 startup systemd -u $SERVICE_USER --hp /home/$SERVICE_USER

# Configuration du pare-feu
log_info "Configuration du pare-feu..."
ufw --force enable
ufw allow ssh
ufw allow 'Nginx Full'

# Configuration Nginx
log_info "Configuration Nginx..."
cat > /etc/nginx/sites-available/$APP_NAME << EOF
server {
    listen 80;
    server_name _;
    
    # Sécurité
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Logs
    access_log /var/log/nginx/${APP_NAME}_access.log;
    error_log /var/log/nginx/${APP_NAME}_error.log;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Gestion des fichiers statiques (si nécessaire)
    location /static/ {
        alias $APP_DIR/public/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Activation du site Nginx
ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Configuration de Fail2Ban
log_info "Configuration de Fail2Ban..."
cat > /etc/fail2ban/jail.local << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
EOF

systemctl restart fail2ban

# Création du script de sauvegarde
log_info "Création du script de sauvegarde..."
cat > /usr/local/bin/backup-parcelle.sh << EOF
#!/bin/bash
BACKUP_DIR="/backup/parcelle-plus"
DATE=\$(date +%Y%m%d_%H%M%S)

mkdir -p \$BACKUP_DIR

# Sauvegarde de la base de données
sqlite3 $APP_DIR/database/parcelle_chat.db ".backup \$BACKUP_DIR/db_\$DATE.db"

# Sauvegarde des fichiers de configuration
tar -czf \$BACKUP_DIR/config_\$DATE.tar.gz $APP_DIR/*.js $APP_DIR/package.json

# Nettoyage des anciennes sauvegardes (garde 7 jours)
find \$BACKUP_DIR -name "*.db" -mtime +7 -delete
find \$BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Sauvegarde terminée: \$DATE"
EOF

chmod +x /usr/local/bin/backup-parcelle.sh

# Ajout de la tâche cron pour la sauvegarde quotidienne
log_info "Configuration de la sauvegarde automatique..."
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-parcelle.sh") | crontab -

# Affichage des informations finales
log_info "Déploiement terminé avec succès !"
echo ""
echo "📋 Informations importantes :"
echo "- Application installée dans : $APP_DIR"
echo "- Utilisateur de service : $SERVICE_USER"
echo "- Port de l'application : 3000"
echo "- Logs Nginx : /var/log/nginx/${APP_NAME}_*.log"
echo "- Sauvegarde quotidienne : 2h00 du matin"
echo ""
echo "🔧 Commandes utiles :"
echo "- Redémarrer l'app : sudo -u $SERVICE_USER pm2 restart $APP_NAME"
echo "- Voir les logs : sudo -u $SERVICE_USER pm2 logs $APP_NAME"
echo "- Status de l'app : sudo -u $SERVICE_USER pm2 status"
echo "- Sauvegarde manuelle : /usr/local/bin/backup-parcelle.sh"
echo ""
echo "🌐 Pour configurer SSL avec un domaine :"
echo "1. Pointez votre domaine vers cette IP"
echo "2. Modifiez server_name dans /etc/nginx/sites-available/$APP_NAME"
echo "3. Exécutez : certbot --nginx -d votre-domaine.com"
echo ""

# Test de l'API
log_info "Test de l'API..."
sleep 5
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    log_info "✅ API accessible sur http://localhost:3000"
else
    log_warn "⚠️  API non accessible, vérifiez les logs"
fi

log_info "🎉 Déploiement terminé ! Votre serveur ParcellePlus est prêt !"


