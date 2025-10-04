# 🔐 Guide SSH Distant - ParcellePlus

## 🎯 Objectif

Configurer un accès SSH distant sécurisé à votre Raspberry Pi pour permettre une connexion depuis n'importe où via internet.

## 🚀 Installation Ultra-Simple

### 1. Transfert et Installation
```bash
# Via WinSCP : copier le dossier raspberry-pi-server/ vers /home/pi/
ssh pi@192.168.1.17
cd /home/pi/raspberry-pi-server

# Installation complète (serveur + SSH distant)
chmod +x setup-remote-ssh.sh
./setup-remote-ssh.sh
```

## 🔧 Ce que le Script Configure

### ✅ Sécurité SSH Renforcée
- **Port SSH changé** : 22 → 2222 (plus sécurisé)
- **Authentification par clé uniquement** (mot de passe désactivé)
- **Chiffrement renforcé** (algorithmes modernes)
- **Accès root désactivé**
- **Limitation des tentatives** de connexion

### ✅ Clés SSH Automatiques
- **Clé principale** : `~/.ssh/id_rsa`
- **Clé d'accès distant** : `~/.ssh/remote_access_key`
- **Clés autorisées** : `~/.ssh/authorized_keys`

### ✅ Tunnel ngrok Sécurisé
- **Exposition internet** via tunnel chiffré
- **URL temporaire** pour l'accès distant
- **Service automatique** au démarrage

## 🌐 Accès SSH Distant

### Étape 1 : Récupérer les Informations
```bash
# Voir la clé publique à partager
~/get_public_key.sh

# Voir l'URL ngrok
curl http://localhost:4040/api/tunnels
```

### Étape 2 : Partager l'Accès
1. **Clé publique** : Copiez le contenu de `~/.ssh/remote_access_key.pub`
2. **URL ngrok** : Récupérez l'URL TCP (ex: `0.tcp.ngrok.io:12345`)

### Étape 3 : Connexion Distante
```bash
# Depuis n'importe où sur internet
ssh -i ~/.ssh/remote_access_key pi@0.tcp.ngrok.io -p 12345
```

## 🔑 Gestion des Clés SSH

### Ajouter une Nouvelle Clé Publique
```bash
# Ajouter une clé publique reçue
echo "ssh-rsa AAAAB3NzaC1yc2E... user@host" >> ~/.ssh/authorized_keys

# Vérifier les clés autorisées
cat ~/.ssh/authorized_keys
```

### Révoquer une Clé
```bash
# Éditer le fichier des clés autorisées
nano ~/.ssh/authorized_keys

# Supprimer la ligne correspondante à la clé à révoquer
```

## 🛡️ Sécurité et Bonnes Pratiques

### ✅ Sécurité Appliquée
- **Authentification par clé uniquement** (pas de mot de passe)
- **Port non-standard** (2222 au lieu de 22)
- **Chiffrement moderne** (ChaCha20, AES-256)
- **Tunnel chiffré** (ngrok avec TLS)
- **Limitation des connexions** simultanées

### ✅ Monitoring et Logs
```bash
# Voir les connexions SSH
sudo journalctl -u sshd -f

# Voir les tunnels actifs
sudo systemctl status ngrok-ssh

# Voir les tentatives de connexion
sudo tail -f /var/log/auth.log
```

## 🔧 Commandes Utiles

### Gestion SSH
```bash
# Statut du service SSH
sudo systemctl status sshd

# Redémarrer SSH
sudo systemctl restart sshd

# Tester la configuration SSH
sudo sshd -t
```

### Gestion ngrok
```bash
# Statut du tunnel
sudo systemctl status ngrok-ssh

# Redémarrer le tunnel
sudo systemctl restart ngrok-ssh

# Voir les URLs actives
curl http://localhost:4040/api/tunnels
```

### Gestion des Clés
```bash
# Voir la clé publique
~/get_public_key.sh

# Générer une nouvelle clé
ssh-keygen -t rsa -b 4096 -C "nouvelle-cle" -f ~/.ssh/nouvelle_cle

# Tester une connexion
ssh -i ~/.ssh/remote_access_key pi@localhost -p 2222
```

## 🔍 Résolution de Problèmes

### Problème : "Permission denied (publickey)"
```bash
# Vérifier les permissions
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
chmod 600 ~/.ssh/remote_access_key

# Vérifier que la clé publique est bien ajoutée
cat ~/.ssh/authorized_keys
```

### Problème : "Connection refused"
```bash
# Vérifier que SSH fonctionne
sudo systemctl status sshd

# Vérifier le port
sudo netstat -tlnp | grep :2222

# Vérifier le pare-feu
sudo ufw status
```

### Problème : "Tunnel ngrok non accessible"
```bash
# Vérifier le service ngrok
sudo systemctl status ngrok-ssh

# Voir les logs
sudo journalctl -u ngrok-ssh -f

# Redémarrer ngrok
sudo systemctl restart ngrok-ssh
```

## 🎯 Workflow d'Utilisation

### 1. Configuration Initiale (une seule fois)
```bash
./setup-remote-ssh.sh
```

### 2. Partage d'Accès
```bash
# Récupérer les infos à partager
~/get_public_key.sh
curl http://localhost:4040/api/tunnels
```

### 3. Connexion Distante
```bash
# Depuis n'importe où
ssh -i ~/.ssh/remote_access_key pi@0.tcp.ngrok.io -p XXXX
```

### 4. Développement
```bash
# Une fois connecté via SSH
cd /home/pi/parcelle-plus-server
pm2 logs parcelle-plus-server
pm2 restart parcelle-plus-server
```

## 🌟 Avantages de cette Solution

- 🔐 **Sécurité maximale** (clés SSH + tunnel chiffré)
- 🌐 **Accès depuis partout** (via internet)
- 🚀 **Configuration automatique** (un seul script)
- 🔧 **Gestion simplifiée** (services systemd)
- 📊 **Monitoring intégré** (logs et statuts)
- 🔄 **Démarrage automatique** (survit aux redémarrages)

## 💡 Notes Importantes

1. **Token ngrok** : Requis pour l'accès distant (gratuit sur ngrok.com)
2. **Port SSH** : Changé de 22 à 2222 pour plus de sécurité
3. **Clés SSH** : Authentification par clé uniquement (plus sûr)
4. **Tunnel** : URL temporaire qui change à chaque redémarrage
5. **Partage** : Partagez uniquement la clé publique, jamais la privée

## 🎉 Résultat Final

Après configuration, vous aurez :
- ✅ **SSH local** : `ssh pi@192.168.1.17 -p 2222`
- ✅ **SSH distant** : `ssh -i ~/.ssh/remote_access_key pi@0.tcp.ngrok.io -p XXXX`
- ✅ **Accès sécurisé** depuis n'importe où dans le monde
- ✅ **Gestion facile** des accès via clés SSH 