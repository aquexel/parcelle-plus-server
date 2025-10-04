# 🎯 Solution Complète : Partage SMB + Serveur ParcellePlus

## 🚀 Résumé de la Solution

Au lieu d'utiliser WinSCP à chaque fois, nous allons créer un **partage réseau SMB** qui vous permettra d'accéder aux fichiers du serveur directement depuis l'Explorateur Windows.

## 📋 Étapes d'Installation

### 1. **Transfert Initial** (Une seule fois)
```bash
# Via WinSCP : copier le dossier raspberry-pi-server/ vers /home/pi/
```

### 2. **Connexion SSH** (Une seule fois)
```bash
ssh pi@192.168.1.17
cd /home/pi/raspberry-pi-server
```

### 3. **Installation Automatique** (Une seule fois)
```bash
chmod +x install-complete.sh
./install-complete.sh
```

## 🎉 Après Installation

### ✅ Ce que vous aurez :
- **Serveur Node.js** : http://192.168.1.17:3000
- **Partage SMB** : `\\192.168.1.17\ParcellePlus`
- **Accès direct** aux fichiers depuis Windows
- **Édition en temps réel** sans WinSCP

### ✅ Workflow de développement :
1. **Ouvrir** : `\\192.168.1.17\ParcellePlus` dans l'Explorateur Windows
2. **Modifier** : Les fichiers directement avec votre éditeur préféré
3. **Redémarrer** : `pm2 restart parcelle-plus-server` (via SSH)
4. **Tester** : http://192.168.1.17:3000/api/health

## 🔧 Commandes Rapides

### Redémarrer le serveur après modification :
```bash
ssh pi@192.168.1.17 "pm2 restart parcelle-plus-server"
```

### Voir les logs :
```bash
ssh pi@192.168.1.17 "pm2 logs parcelle-plus-server"
```

## 📁 Fichiers Importants

- **`install-complete.sh`** : Script d'installation automatique
- **`setup-smb-share.sh`** : Configuration SMB uniquement
- **`GUIDE_PARTAGE_SMB.md`** : Guide détaillé
- **`server.js`** : Serveur principal
- **`services/`** : Services API (Messages, Polygones, etc.)

## 🎯 Avantages

- 🚫 **Plus besoin de WinSCP** pour le développement quotidien
- ✅ **Accès direct** comme un dossier Windows
- ✅ **Édition en temps réel** avec vos outils préférés
- ✅ **Synchronisation automatique** des fichiers
- ✅ **Backup automatique** au niveau réseau

## 💡 Note Importante

Cette solution combine :
- **Installation du serveur Node.js** (APIs REST, WebSocket, SQLite)
- **Configuration du partage SMB** (accès réseau depuis Windows)
- **Configuration automatique** (pare-feu, services, démarrage auto)

**Une seule commande** fait tout : `./install-complete.sh` 