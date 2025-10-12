#!/bin/bash
# =============================================================================
# Configuration CRON pour mise à jour semestrielle DPE
# Exécution automatique : 1er février et 1er septembre à 3h du matin
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_SCRIPT="$SCRIPT_DIR/update-dvf-dpe-database.sh"
LOG_FILE="$SCRIPT_DIR/logs/dvf_dpe_update.log"

# Création du dossier logs
mkdir -p "$SCRIPT_DIR/logs"

# Création de la tâche cron
CRON_JOB="0 3 1 2,9 * cd $SCRIPT_DIR && bash $UPDATE_SCRIPT >> $LOG_FILE 2>&1"

# Vérification si la tâche existe déjà
if crontab -l 2>/dev/null | grep -q "update-dvf-dpe-database.sh"; then
    echo "⚠️  Tâche cron déjà configurée"
    crontab -l | grep "update-dvf-dpe-database.sh"
else
    # Ajout de la tâche cron
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "✅ Tâche cron configurée avec succès !"
    echo ""
    echo "📅 Planification :"
    echo "   - 1er février à 3h00"
    echo "   - 1er septembre à 3h00"
    echo ""
    echo "📋 Tâches cron actuelles :"
    crontab -l
fi

echo ""
echo "📝 Les logs seront disponibles dans : $LOG_FILE"

