#!/bin/bash

# Script de mise à jour du serveur ParcellePlus
# Usage: ./update-server.sh

set -e

APP_DIR="/opt/parcelle-plus"
SERVICE_USER="parcelle"
APP_NAME="parcelle-plus"

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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

log_info "🔄 Mise à jour du serveur ParcellePlus"
echo "======================================"

# Sauvegarde avant mise à jour
log_info "Création d'une sauvegarde de sécurité..."
/usr/local/bin/backup-parcelle.sh

# Mise à jour du système
log_info "Mise à jour du système..."
apt update && apt upgrade -y

# Mise à jour de l'application
log_info "Mise à jour de l'application..."
cd $APP_DIR

# Arrêt temporaire de l'application
log_info "Arrêt temporaire de l'application..."
sudo -u $SERVICE_USER pm2 stop $APP_NAME

# Sauvegarde des fichiers de configuration locaux
log_info "Sauvegarde des configurations locales..."
cp -r database/ /tmp/parcelle-backup-config/
cp package.json /tmp/parcelle-backup-config/ 2>/dev/null || true

# Mise à jour du code
log_info "Téléchargement des dernières modifications..."
git stash  # Sauvegarder les modifications locales
git pull origin main

# Restauration des configurations si nécessaire
if [ -d "/tmp/parcelle-backup-config/database" ]; then
    log_info "Restauration de la base de données..."
    cp -r /tmp/parcelle-backup-config/database/* database/
fi

# Mise à jour des dépendances
log_info "Mise à jour des dépendances Node.js..."
sudo -u $SERVICE_USER npm install --production

# Vérification de la base de données
log_info "Vérification de la base de données..."
if [ ! -f "$APP_DIR/database/parcelle_chat.db" ]; then
    log_warn "Base de données manquante, création d'une nouvelle base..."
    sudo -u $SERVICE_USER node create_clean_db.js
fi

# Redémarrage de l'application
log_info "Redémarrage de l'application..."
sudo -u $SERVICE_USER pm2 start $APP_NAME

# Attendre que l'application démarre
sleep 5

# Test de l'API
log_info "Test de l'API..."
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    log_info "✅ API accessible"
else
    log_error "❌ API non accessible"
    log_info "Vérification des logs..."
    sudo -u $SERVICE_USER pm2 logs $APP_NAME --lines 20
    exit 1
fi

# Redémarrage de Nginx
log_info "Redémarrage de Nginx..."
systemctl restart nginx

# Nettoyage
log_info "Nettoyage..."
rm -rf /tmp/parcelle-backup-config/

# Renouvellement automatique du certificat SSL
log_info "Vérification du certificat SSL..."
certbot renew --quiet || log_warn "Pas de certificat SSL à renouveler"

log_info "✅ Mise à jour terminée avec succès !"
echo ""
echo "📋 Résumé :"
echo "- Application redémarrée"
echo "- Base de données préservée"
echo "- Nginx redémarré"
echo "- Certificat SSL vérifié"
echo ""
echo "🔧 Vérifications post-mise à jour :"
echo "- Status : sudo -u $SERVICE_USER pm2 status"
echo "- Logs : sudo -u $SERVICE_USER pm2 logs $APP_NAME"
echo "- Test API : curl http://localhost:3000/api/health"
echo ""

log_info "🎉 Serveur mis à jour avec succès !"





