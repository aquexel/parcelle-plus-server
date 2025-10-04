# 🖥️ Guide CMD Windows - Installation ParcellePlus

## 🎯 Commandes Exactes à Exécuter

### Étape 1 : Ouvrir CMD Windows
1. Appuyez sur **Windows + R**
2. Tapez `cmd` et appuyez sur **Entrée**
3. Ou recherchez "Invite de commandes" dans le menu Démarrer

### Étape 2 : Tester la Connexion SSH
```cmd
ssh pi@192.168.1.17
```

Si la connexion fonctionne, vous verrez :
```
pi@192.168.1.17's password: 
```

Tapez votre mot de passe et appuyez sur **Entrée**.

### Étape 3 : Naviguer vers le Dossier
```bash
cd /home/pi/raspberry-pi-server
```

### Étape 4 : Vérifier les Fichiers
```bash
ls -la
```

Vous devriez voir :
```
install-all-in-one.sh
setup-remote-ssh.sh
setup-cloud-workspace.sh
setup-smb-share.sh
server.js
package.json
```

### Étape 5 : Rendre les Scripts Exécutables
```bash
chmod +x *.sh
```

### Étape 6 : Lancer l'Installation Complète
```bash
./install-all-in-one.sh
```

## 🎯 Réponses aux Questions du Script

Le script vous posera des questions, voici les réponses :

### Question 1 : Choix d'installation
```
🎯 Que voulez-vous installer ?
1. Installation complète (serveur + SSH + SMB + workspace)
2. Serveur Node.js seulement
3. SSH distant seulement
4. Partage SMB seulement
5. Workspace cloud seulement

💡 Choix (1-5) :
```
**Réponse :** `1` (puis appuyez sur Entrée)

### Question 2 : Token ngrok
```
🔑 Token ngrok requis (créez un compte gratuit sur https://ngrok.com):
```
**Actions :**
1. Ouvrez https://ngrok.com dans votre navigateur
2. Créez un compte gratuit
3. Copiez le token d'authentification
4. Collez-le dans le terminal et appuyez sur Entrée

### Question 3 : Mot de passe SMB
```
🔑 Définissez un mot de passe pour l'accès SMB:
New SMB password:
```
**Réponse :** Tapez un mot de passe (vous ne le verrez pas s'afficher)

### Question 4 : Mot de passe Workspace
```
🔑 Définissez un mot de passe pour l'accès workspace:
```
**Réponse :** Tapez un mot de passe pour VS Code

### Question 5 : Fermer ancien port SSH
```
❓ Voulez-vous fermer l'ancien port SSH (22) ? (y/N)
```
**Réponse :** `N` (puis appuyez sur Entrée)

## 🔧 Commandes de Vérification

### Vérifier le Serveur Node.js
```bash
pm2 status
```

### Vérifier les URLs ngrok
```bash
curl http://localhost:4040/api/tunnels
```

### Voir la Clé SSH Publique
```bash
~/get_public_key.sh
```

### Tester l'API
```bash
curl http://192.168.1.17:3000/api/health
```

## 🌐 Accès depuis Windows

### Workspace Cloud
1. Ouvrez votre navigateur
2. Allez sur : `http://192.168.1.17:8080`
3. Saisissez le mot de passe défini

### Partage SMB
1. Ouvrez l'Explorateur Windows
2. Tapez dans la barre d'adresse : `\\192.168.1.17\ParcellePlus`
3. Saisissez : utilisateur `pi` + mot de passe SMB

### Serveur API
1. Ouvrez votre navigateur
2. Allez sur : `http://192.168.1.17:3000/api/health`

## 🔐 Partage d'Accès SSH

### Récupérer les Informations
```bash
# Clé publique SSH
~/get_public_key.sh

# URLs ngrok
curl http://localhost:4040/api/tunnels | grep public_url
```

### Connexion SSH Distante
```bash
ssh -i ~/.ssh/remote_access_key pi@0.tcp.ngrok.io -p XXXX
```

## 🚨 Si Vous Rencontrez des Erreurs

### Erreur : "ssh: command not found"
**Solution :** Installez OpenSSH sur Windows
```cmd
# Dans PowerShell en tant qu'administrateur
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

### Erreur : "Permission denied"
**Solution :** Vérifiez le mot de passe et l'utilisateur
```bash
ssh pi@192.168.1.17 -v
```

### Erreur : "Connection refused"
**Solution :** Vérifiez que SSH est activé sur le Raspberry Pi
```bash
sudo systemctl status ssh
```

## 📋 Checklist d'Installation

- [ ] 1. Connexion SSH réussie
- [ ] 2. Navigation vers le dossier
- [ ] 3. Scripts rendus exécutables
- [ ] 4. Installation lancée
- [ ] 5. Token ngrok fourni
- [ ] 6. Mot de passe SMB défini
- [ ] 7. Mot de passe Workspace défini
- [ ] 8. Installation terminée
- [ ] 9. Services vérifiés
- [ ] 10. Accès depuis Windows testé

## 💡 Commandes Rapides

### Copier-Coller Direct
```bash
# Connexion
ssh pi@192.168.1.17

# Installation
cd /home/pi/raspberry-pi-server && chmod +x *.sh && ./install-all-in-one.sh

# Vérification
pm2 status && curl http://localhost:4040/api/tunnels
```

## 🎉 Résultat Final

Après installation réussie, vous aurez :
- ✅ **Serveur Node.js** : http://192.168.1.17:3000
- ✅ **SSH Distant** : via ngrok
- ✅ **Workspace Cloud** : http://192.168.1.17:8080
- ✅ **Partage SMB** : \\192.168.1.17\ParcellePlus 