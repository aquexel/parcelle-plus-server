#!/bin/bash
# =============================================================================
# Script de mise à jour semestrielle de la base DPE (Février & Septembre)
# =============================================================================
# Usage: ./update-dpe-database.sh [department_code]
# Exemple: ./update-dpe-database.sh 40
# =============================================================================

set -e  # Arrêt en cas d'erreur

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DEPT_CODE="${1:-40}"  # Département par défaut : 40 (Landes)
DB_PATH="$SCRIPT_DIR/database/dpe_bdnb.db"
BDNB_DIR="$SCRIPT_DIR/bdnb_data"
BACKUP_DIR="$SCRIPT_DIR/backups"

# Couleurs pour logs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🔄 Mise à jour base DPE - $(date)${NC}"
echo -e "${GREEN}========================================${NC}"

# 1️⃣ Sauvegarde de l'ancienne base
echo -e "\n${YELLOW}📦 Sauvegarde de l'ancienne base...${NC}"
mkdir -p "$BACKUP_DIR"
if [ -f "$DB_PATH" ]; then
    BACKUP_FILE="$BACKUP_DIR/dpe_bdnb_backup_$(date +%Y%m%d_%H%M%S).db"
    cp "$DB_PATH" "$BACKUP_FILE"
    echo -e "${GREEN}✅ Sauvegarde créée : $BACKUP_FILE${NC}"
else
    echo -e "${YELLOW}⚠️  Aucune base existante à sauvegarder${NC}"
fi

# 2️⃣ Suppression de l'ancienne base
echo -e "\n${YELLOW}🗑️  Suppression de l'ancienne base...${NC}"
if [ -f "$DB_PATH" ]; then
    rm -f "$DB_PATH"
    echo -e "${GREEN}✅ Ancienne base supprimée${NC}"
fi

# 3️⃣ Suppression des anciennes données BDNB
echo -e "\n${YELLOW}🗑️  Suppression des anciennes données BDNB...${NC}"
if [ -d "$BDNB_DIR" ]; then
    rm -rf "$BDNB_DIR"
    echo -e "${GREEN}✅ Anciennes données supprimées${NC}"
fi

# 4️⃣ Téléchargement des nouvelles données
echo -e "\n${YELLOW}📥 Téléchargement des nouvelles données BDNB...${NC}"
bash "$SCRIPT_DIR/download-bdnb-data.sh"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Erreur lors du téléchargement${NC}"
    exit 1
fi

# 5️⃣ Enrichissement DVF avec DPE
echo -e "\n${YELLOW}🔧 Enrichissement DVF avec DPE (département $DEPT_CODE)...${NC}"
node "$SCRIPT_DIR/enrich_dvf_with_dpe.js" "$BDNB_DIR" "$DEPT_CODE"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Erreur lors de l'enrichissement${NC}"
    
    # Restauration de la sauvegarde en cas d'erreur
    if [ -f "$BACKUP_FILE" ]; then
        echo -e "${YELLOW}🔄 Restauration de la sauvegarde...${NC}"
        cp "$BACKUP_FILE" "$DB_PATH"
        echo -e "${GREEN}✅ Base restaurée${NC}"
    fi
    exit 1
fi

# 6️⃣ Vérification de la nouvelle base
echo -e "\n${YELLOW}🔍 Vérification de la nouvelle base...${NC}"
if [ -f "$DB_PATH" ]; then
    DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
    echo -e "${GREEN}✅ Nouvelle base créée : $DB_SIZE${NC}"
    
    # Comptage des enregistrements
    RECORD_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM dvf_avec_dpe;" 2>/dev/null || echo "0")
    echo -e "${GREEN}📊 Nombre d'enregistrements : $RECORD_COUNT${NC}"
else
    echo -e "${RED}❌ Erreur : base non créée${NC}"
    exit 1
fi

# 7️⃣ Nettoyage des fichiers temporaires (optionnel)
echo -e "\n${YELLOW}🧹 Nettoyage des fichiers temporaires...${NC}"
# Garder les CSV pour debug, mais on peut les supprimer pour gagner de l'espace
# rm -rf "$BDNB_DIR"
echo -e "${GREEN}✅ Données CSV conservées dans $BDNB_DIR${NC}"

# 8️⃣ Suppression des anciennes sauvegardes (> 6 mois)
echo -e "\n${YELLOW}🗑️  Nettoyage des anciennes sauvegardes...${NC}"
find "$BACKUP_DIR" -name "dpe_bdnb_backup_*.db" -mtime +180 -delete
echo -e "${GREEN}✅ Sauvegardes > 6 mois supprimées${NC}"

# 9️⃣ Résumé final
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Mise à jour terminée avec succès !${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "📅 Date : $(date)"
echo -e "🗄️  Base : $DB_PATH ($DB_SIZE)"
echo -e "📊 Enregistrements : $RECORD_COUNT"
echo -e "💾 Sauvegarde : $BACKUP_FILE"
echo -e "\n${YELLOW}⚠️  N'oubliez pas de redémarrer PM2 :${NC}"
echo -e "   pm2 restart parcelle-plus-server"
echo -e "${GREEN}========================================${NC}"


