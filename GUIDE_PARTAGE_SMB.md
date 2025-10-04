# 🗂️ Guide Partage SMB - ParcellePlus

## 🎯 Objectif

Créer un **partage réseau SMB** sur votre Raspberry Pi pour accéder facilement aux fichiers du serveur depuis Windows, sans avoir besoin de WinSCP ou SSH.

## 🚀 Installation Ultra-Simple

### 1. Transfert des fichiers
```bash
# Via WinSCP : copier le dossier raspberry-pi-server/ vers /home/pi/
```

### 2. Connexion SSH
```bash
ssh pi@192.168.1.17
cd /home/pi/raspberry-pi-server
```

### 3. Installation complète automatique
```bash
chmod +x install-complete.sh
./install-complete.sh
```

**C'est tout !** Le script fait tout automatiquement :
- ✅ Installation Node.js + serveur API
- ✅ Configuration base de données SQLite
- ✅ Installation et configuration Samba
- ✅ Configuration pare-feu
- ✅ Démarrage automatique des services

## 💻 Accès depuis Windows

### Méthode 1 : Explorateur Windows
1. Ouvrir l'**Explorateur Windows**
2. Taper dans la barre d'adresse : `\\192.168.1.17`
3. Double-cliquer sur le dossier **ParcellePlus**
4. Saisir :
   - **Utilisateur** : `pi`
   - **Mot de passe** : (celui défini lors de l'installation)

### Méthode 2 : Mapper un lecteur réseau
1. Clic droit sur **Ce PC**
2. **Connecter un lecteur réseau**
3. **Dossier** : `\\192.168.1.17\ParcellePlus`
4. Cocher **Se reconnecter à l'ouverture de session**
5. Saisir les identifiants (`pi` + mot de passe)

## 🎉 Avantages du Partage SMB

### ✅ Facilité d'accès
- **Pas besoin de WinSCP** ou SSH
- **Accès direct** comme un dossier Windows
- **Glisser-déposer** des fichiers
- **Édition directe** avec vos éditeurs préférés

### ✅ Développement en temps réel
- **Modifier les fichiers** directement sur le partage
- **Redémarrer le serveur** avec `pm2 restart parcelle-plus-server`
- **Voir les logs** avec `pm2 logs parcelle-plus-server`
- **Tests immédiats** sur http://192.168.1.17:3000

### ✅ Synchronisation automatique
- **Modifications instantanées** sur le serveur
- **Pas de transfert manuel** de fichiers
- **Backup automatique** des fichiers

## 🔧 Commandes Utiles

### Gestion du serveur Node.js
```bash
# Redémarrer le serveur après modification
pm2 restart parcelle-plus-server

# Voir les logs en temps réel
pm2 logs parcelle-plus-server

# Statut des services
pm2 status

# Arrêter le serveur
pm2 stop parcelle-plus-server

# Redémarrer le serveur
pm2 start parcelle-plus-server
```

### Gestion du partage SMB
```bash
# Redémarrer Samba
sudo systemctl restart smbd

# Voir les utilisateurs connectés
sudo smbstatus

# Voir les partages disponibles
smbclient -L 192.168.1.17 -U pi

# Changer le mot de passe SMB
sudo smbpasswd pi
```

## 🗂️ Structure du partage

Une fois connecté, vous verrez :
```
\\192.168.1.17\ParcellePlus\
├── server.js              # Serveur principal
├── package.json           # Dépendances
├── database/              # Base de données SQLite
├── services/              # Services (Messages, Polygones, etc.)
├── scripts/               # Scripts d'installation
├── test/                  # Tests du serveur
└── logs/                  # Logs du serveur
```

## 🧪 Tests de Fonctionnement

### Test du serveur API
```bash
# Depuis le Raspberry Pi
curl http://192.168.1.17:3000/api/health

# Depuis Windows (PowerShell)
Invoke-RestMethod -Uri http://192.168.1.17:3000/api/health
```

### Test du partage SMB
```bash
# Depuis Windows (CMD)
net use \\192.168.1.17\ParcellePlus /user:pi

# Lister les partages
net view \\192.168.1.17
```

## 🔍 Résolution de Problèmes

### Problème : "Accès refusé"
```bash
# Vérifier que l'utilisateur SMB existe
sudo smbpasswd -a pi

# Redémarrer Samba
sudo systemctl restart smbd
```

### Problème : "Serveur non accessible"
```bash
# Vérifier le pare-feu
sudo ufw status

# Vérifier les services
sudo systemctl status smbd
```

### Problème : "Modification non prise en compte"
```bash
# Redémarrer le serveur Node.js
pm2 restart parcelle-plus-server

# Vérifier les logs
pm2 logs parcelle-plus-server
```

## 🎯 Workflow de Développement

1. **Accéder au partage** : `\\192.168.1.17\ParcellePlus`
2. **Modifier les fichiers** directement depuis Windows
3. **Redémarrer le serveur** : `pm2 restart parcelle-plus-server`
4. **Tester l'API** : http://192.168.1.17:3000/api/health
5. **Voir les logs** : `pm2 logs parcelle-plus-server`

## 🎉 Résultat Final

Après installation, vous aurez :
- 🖥️ **Serveur Node.js** actif sur http://192.168.1.17:3000
- 🗂️ **Partage SMB** accessible via `\\192.168.1.17\ParcellePlus`
- 🔧 **Développement facile** depuis Windows
- 🚀 **Démarrage automatique** au boot du Raspberry Pi

Plus besoin de WinSCP ou SSH pour le développement quotidien ! 