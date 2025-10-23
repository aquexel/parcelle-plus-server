# 📺 Commandes pour voir les logs Screen sur le serveur

## 🔍 **Voir les sessions Screen actives**

```bash
screen -list
# ou
screen -ls
```

Cela affichera quelque chose comme :
```
There are screens on:
    12345.update-dvf-dpe-database    (Detached)
    67890.other-script               (Detached)
```

## 📖 **Se reconnecter à une session Screen**

```bash
screen -r 12345
# ou avec le nom
screen -r update-dvf-dpe-database
```

## 📋 **Voir les logs sans se reconnecter**

### Option 1 : Voir le contenu actuel
```bash
screen -S update-dvf-dpe-database -X hardcopy /tmp/screen_log.txt
cat /tmp/screen_log.txt
```

### Option 2 : Voir les dernières lignes
```bash
screen -S update-dvf-dpe-database -X hardcopy /tmp/screen_log.txt
tail -n 50 /tmp/screen_log.txt
```

### Option 3 : Rechercher des erreurs
```bash
screen -S update-dvf-dpe-database -X hardcopy /tmp/screen_log.txt
grep -i "error\|erreur\|failed\|échec" /tmp/screen_log.txt
```

## 🔄 **Si la session est terminée**

### Voir les logs système
```bash
# Logs Node.js
journalctl -u parcelle-server -n 100

# Logs système récents
journalctl -n 100

# Logs avec filtrage
journalctl -n 100 | grep -i "dpe\|dvf\|error"
```

### Vérifier les processus
```bash
# Voir les processus Node.js
ps aux | grep node

# Voir les processus PM2
pm2 list
pm2 logs parcelle-server
```

## 📊 **Vérifier l'état de la base de données**

```bash
# Vérifier si la base existe
ls -la /opt/parcelle-plus/database/

# Vérifier la taille
du -h /opt/parcelle-plus/database/dvf_avec_dpe_et_annexes_enhanced.db

# Tester la base (si sqlite3 installé)
sqlite3 /opt/parcelle-plus/database/dvf_avec_dpe_et_annexes_enhanced.db "SELECT COUNT(*) FROM dvf_avec_dpe_et_annexes;"
```

## 🚀 **Relancer le script si nécessaire**

```bash
# Se déplacer dans le bon répertoire
cd /opt/parcelle-plus

# Relancer avec screen
screen -S update-dvf-dpe-database
bash update-dvf-dpe-database.sh

# Détacher : Ctrl+A puis D
```

## 💡 **Conseils**

1. **Si screen -list ne montre rien** : Le script s'est probablement terminé
2. **Si vous voyez "Attached"** : Quelqu'un d'autre est connecté à cette session
3. **Pour forcer la reconnexion** : `screen -r -d session_name`

## 🔧 **Commandes utiles**

```bash
# Voir l'espace disque
df -h

# Voir les fichiers récents
ls -la /opt/parcelle-plus/bdnb_data/

# Voir les logs d'erreur système
dmesg | tail -20
```
