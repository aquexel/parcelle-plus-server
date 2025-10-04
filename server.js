const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

// Import des modules de base de données
const PolygonService = require('./services/PolygonService');
const MessageService = require('./services/MessageService');
const UserService = require('./services/UserService');

// Configuration
const PORT = process.env.PORT || 3000;
const app = express();

// Middlewares
app.use(cors({
    origin: '*', // Permettre toutes les origines pour développement
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Services
const polygonService = new PolygonService();
const messageService = new MessageService();
const userService = new UserService();

// Créer le serveur HTTP
const server = http.createServer(app);

// Configuration WebSocket
const wss = new WebSocket.Server({ server });

// Gestion des connexions WebSocket
const clients = new Map();

wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    const clientInfo = {
        id: clientId,
        ws: ws,
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        connectedAt: new Date()
    };
    
    clients.set(clientId, clientInfo);
    console.log(`🔌 Client connecté: ${clientId} (${clientInfo.ip})`);
    console.log(`👥 Clients connectés: ${clients.size}`);

    // Envoyer un message de bienvenue
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId: clientId,
        message: 'Connexion établie avec le serveur ParcellePlus'
    }));

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`📨 Message reçu de ${clientId}:`, message);
            
            switch (message.type) {
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                    
                case 'join_room':
                    // Rejoindre une "room" pour les messages
                    clientInfo.room = message.room;
                    ws.send(JSON.stringify({
                        type: 'room_joined',
                        room: message.room
                    }));
                    break;
                    
                case 'send_message':
                    // Traiter l'envoi de message
                    await handleChatMessage(clientId, message);
                    break;
            }
        } catch (error) {
            console.error('❌ Erreur WebSocket:', error);
        }
    });

    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`🔌 Client déconnecté: ${clientId}`);
        console.log(`👥 Clients connectés: ${clients.size}`);
    });
});

// Function pour gérer les messages de chat
async function handleChatMessage(clientId, message) {
    try {
        const savedMessage = await messageService.saveMessage({
            senderId: message.senderId,
            senderName: message.senderName,
            content: message.content,
            room: message.room || 'general'
        });
        
        // Diffuser le message à tous les clients de la room
        const broadcastMessage = {
            type: 'new_message',
            message: savedMessage
        };
        
        clients.forEach((client, id) => {
            if (client.room === message.room || !message.room) {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(JSON.stringify(broadcastMessage));
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur sauvegarde message:', error);
    }
}

// Function pour diffuser des notifications
function broadcastNotification(notification) {
    const message = JSON.stringify({
        type: 'notification',
        ...notification
    });
    
    clients.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

// ========== ROUTES API ==========

// Route de base
app.get('/', (req, res) => {
    res.json({
        message: 'ParcellePlus Server API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            polygons: '/api/polygons',
            messages: '/api/messages',
            users: '/api/users',
            websocket: 'ws://37.66.21.17:3000'
        }
    });
});

// Routes pour les polygones
app.get('/api/polygons', async (req, res) => {
    try {
        const { userId, limit = 100 } = req.query;
        const polygons = await polygonService.getAllPolygons(userId, limit);
        res.json(polygons);
    } catch (error) {
        console.error('❌ Erreur récupération polygones:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route sécurisée pour récupérer les polygones d'un utilisateur spécifique
app.get('/api/polygons/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 100 } = req.query;
        
        console.log(`🔒 Récupération polygones pour l'utilisateur: ${userId}`);
        const polygons = await polygonService.getPolygonsByUser(userId, limit);
        res.json(polygons);
    } catch (error) {
        console.error('❌ Erreur récupération polygones utilisateur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour récupérer les polygones publics (pour les acheteurs)
app.get('/api/polygons/public', async (req, res) => {
    try {
        const { limit = 100 } = req.query;
        
        console.log(`🌐 Récupération polygones publics`);
        // Récupérer tous les polygones et filtrer les publics
        const allPolygons = await polygonService.getAllPolygons(null, limit);
        const publicPolygons = allPolygons.filter(p => 
            (p.is_public === 1 || p.is_public === true || p.isPublic === true) && 
            (p.status === 'active' || p.status === 'available')
        );
        console.log(`✅ ${publicPolygons.length} polygones publics trouvés sur ${allPolygons.length} total`);
        console.log('🔍 Debug polygones:', allPolygons.map(p => ({title: p.title, is_public: p.is_public, status: p.status})));
        res.json(publicPolygons);
    } catch (error) {
        console.error('❌ Erreur récupération polygones publics:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/polygons/:id', async (req, res) => {
    try {
        const polygon = await polygonService.getPolygonById(req.params.id);
        if (!polygon) {
            return res.status(404).json({ error: 'Polygone non trouvé' });
        }
        res.json(polygon);
    } catch (error) {
        console.error('❌ Erreur récupération polygone:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/polygons', async (req, res) => {
    try {
        const polygonData = req.body;
        const savedPolygon = await polygonService.savePolygon(polygonData);
        
        // Notifier les autres clients
        broadcastNotification({
            type: 'polygon_created',
            polygon: savedPolygon
        });
        
        res.status(201).json(savedPolygon);
    } catch (error) {
        console.error('❌ Erreur sauvegarde polygone:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.put('/api/polygons/:id', async (req, res) => {
    try {
        const updatedPolygon = await polygonService.updatePolygon(req.params.id, req.body);
        if (!updatedPolygon) {
            return res.status(404).json({ error: 'Polygone non trouvé' });
        }
        
        // Notifier les autres clients
        broadcastNotification({
            type: 'polygon_updated',
            polygon: updatedPolygon
        });
        
        res.json(updatedPolygon);
    } catch (error) {
        console.error('❌ Erreur mise à jour polygone:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.delete('/api/polygons/:id', async (req, res) => {
    try {
        const deleted = await polygonService.deletePolygon(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Polygone non trouvé' });
        }
        
        // Notifier les autres clients
        broadcastNotification({
            type: 'polygon_deleted',
            polygonId: req.params.id
        });
        
        res.json({ message: 'Polygone supprimé' });
    } catch (error) {
        console.error('❌ Erreur suppression polygone:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Routes pour les messages
app.get('/api/messages', async (req, res) => {
    try {
        const { room = 'general', limit = 50 } = req.query;
        const messages = await messageService.getMessages(room, limit);
        res.json(messages);
    } catch (error) {
        console.error('❌ Erreur récupération messages:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/messages', async (req, res) => {
    console.log('📨 POST /api/messages - Données reçues:', req.body);
    try {
        const messageData = req.body;
        console.log('📡 Appel messageService.saveMessage avec:', messageData);
        const savedMessage = await messageService.saveMessage(messageData);
        console.log('✅ Message sauvegardé:', savedMessage);
        
        // Diffuser le message via WebSocket
        const broadcastMessage = {
            type: 'new_message',
            message: savedMessage
        };
        
        clients.forEach((client) => {
            if (client.room === messageData.room || !messageData.room) {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(JSON.stringify(broadcastMessage));
                }
            }
        });
        
        console.log('✅ Réponse envoyée avec status 201');
        res.status(201).json(savedMessage);
    } catch (error) {
        console.error('❌ ERREUR DÉTAILLÉE sauvegarde message:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== ROUTES ROOMS/CONVERSATIONS ==========

// Récupérer toutes les rooms
app.get('/api/rooms', async (req, res) => {
    try {
        console.log('🏠 GET /api/rooms - Récupération des rooms');
        const rooms = await messageService.getAllRooms();
        console.log(`✅ ${rooms.length} rooms récupérées`);
        res.json(rooms);
    } catch (error) {
        console.error('❌ Erreur récupération rooms:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Créer une nouvelle room
app.post('/api/rooms', async (req, res) => {
    try {
        const roomData = req.body;
        console.log('🏠 POST /api/rooms - Création room:', roomData);
        const savedRoom = await messageService.createRoom(roomData);
        console.log('✅ Room créée:', savedRoom);
        res.status(201).json(savedRoom);
    } catch (error) {
        console.error('❌ Erreur création room:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Supprimer une room et tous ses messages
app.delete('/api/rooms/:roomId', async (req, res) => {
    try {
        const roomId = req.params.roomId;
        console.log('🗑️ DELETE /api/rooms - Suppression room:', roomId);
        
        const success = await messageService.deleteRoom(roomId);
        if (success) {
            console.log('✅ Room supprimée:', roomId);
            res.status(204).send(); // No content
        } else {
            console.log('❌ Room non trouvée:', roomId);
            res.status(404).json({ error: 'Room non trouvée' });
        }
    } catch (error) {
        console.error('❌ Erreur suppression room:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== ROUTES UTILISATEURS ET AUTHENTIFICATION ==========

// Inscription d'un nouvel utilisateur
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, fullName, phone, userType } = req.body;
        
        const userData = {
            username,
            email,
            password,
            fullName,
            phone,
            userType: userType || 'buyer'
        };
        
        const newUser = await userService.registerUser(userData);
        
        res.status(201).json({
            message: 'Utilisateur créé avec succès',
            user: newUser
        });
        
    } catch (error) {
        console.error('❌ Erreur inscription:', error.message);
        res.status(400).json({ 
            error: error.message || 'Erreur lors de l\'inscription'
        });
    }
});

// Connexion utilisateur
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                error: 'Nom d\'utilisateur et mot de passe requis' 
            });
        }
        
        const userWithToken = await userService.loginUser(username, password);
        
        res.json({
            message: 'Connexion réussie',
            user: userWithToken
        });
        
    } catch (error) {
        console.error('❌ Erreur connexion:', error.message);
        res.status(401).json({ 
            error: error.message || 'Erreur de connexion'
        });
    }
});

// Déconnexion utilisateur
app.post('/api/auth/logout', async (req, res) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '') || req.header('X-Auth-Token');
        
        if (!token) {
            return res.status(400).json({ error: 'Token requis' });
        }
        
        const success = await userService.logoutUser(token);
        
        if (success) {
            res.json({ message: 'Déconnexion réussie' });
        } else {
            res.status(404).json({ error: 'Session non trouvée' });
        }
        
    } catch (error) {
        console.error('❌ Erreur déconnexion:', error.message);
        res.status(500).json({ error: 'Erreur lors de la déconnexion' });
    }
});

// Vérification de session/token
app.get('/api/auth/verify', async (req, res) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '') || req.header('X-Auth-Token');
        
        if (!token) {
            return res.status(401).json({ error: 'Token requis' });
        }
        
        const session = await userService.validateSession(token);
        
        if (session) {
            res.json({
                valid: true,
                user: session.user
            });
        } else {
            res.status(401).json({ 
                valid: false, 
                error: 'Session expirée ou invalide' 
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur vérification token:', error.message);
        res.status(500).json({ error: 'Erreur de vérification' });
    }
});

// Profil utilisateur
app.get('/api/users/profile/:id', async (req, res) => {
    try {
        const user = await userService.getUserById(req.params.id);
        
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        res.json(user);
        
    } catch (error) {
        console.error('❌ Erreur récupération profil:', error.message);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Mise à jour du profil
app.put('/api/users/profile/:id', async (req, res) => {
    try {
        const { fullName, phone, avatarUrl } = req.body;
        
        const success = await userService.updateUserProfile(req.params.id, {
            fullName,
            phone,
            avatarUrl
        });
        
        if (success) {
            const updatedUser = await userService.getUserById(req.params.id);
            res.json({
                message: 'Profil mis à jour',
                user: updatedUser
            });
        } else {
            res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
    } catch (error) {
        console.error('❌ Erreur mise à jour profil:', error.message);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Recherche d'utilisateurs
app.get('/api/users/search', async (req, res) => {
    try {
        const { q, type, limit = 20 } = req.query;
        
        if (!q || q.length < 2) {
            return res.status(400).json({ 
                error: 'Terme de recherche requis (min 2 caractères)' 
            });
        }
        
        const users = await userService.searchUsers(q, type, parseInt(limit));
        
        res.json({
            query: q,
            results: users,
            count: users.length
        });
        
    } catch (error) {
        console.error('❌ Erreur recherche utilisateurs:', error.message);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Liste de tous les utilisateurs (pour admin)
app.get('/api/users', async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        const users = await userService.getAllUsers(parseInt(limit));
        
        res.json({
            users: users,
            count: users.length
        });
        
    } catch (error) {
        console.error('❌ Erreur récupération utilisateurs:', error.message);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Utilisateurs connectés (WebSocket)
app.get('/api/users/online', (req, res) => {
    const onlineUsers = Array.from(clients.values()).map(client => ({
        id: client.id,
        ip: client.ip,
        connectedAt: client.connectedAt,
        room: client.room,
        authenticated: client.authenticated || false
    }));
    
    res.json({
        count: onlineUsers.length,
        users: onlineUsers
    });
});

// Route de test de santé
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connections: clients.size
    });
});

// Gestion des erreurs
app.use((err, req, res, next) => {
    console.error('❌ Erreur serveur:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Démarrage du serveur
server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ========================================');
    console.log(`🚀 Serveur ParcellePlus démarré sur le port ${PORT}`);
    console.log(`🚀 URL publique: http://37.66.21.17:${PORT}`);
    console.log(`🚀 WebSocket: ws://37.66.21.17:${PORT}`);
    console.log('🚀 Services: Polygons, Messages, Users');
    console.log('🚀 ========================================');
    
    // Nettoyage automatique des sessions expirées toutes les heures
    setInterval(() => {
        userService.cleanExpiredSessions().catch(err => {
            console.error('❌ Erreur nettoyage sessions:', err);
        });
    }, 60 * 60 * 1000); // 1 heure
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
    console.log('🛑 Arrêt du serveur...');
    server.close(() => {
        // Fermer les connexions aux bases de données
        polygonService.close();
        messageService.close();
        userService.close();
        console.log('🛑 Serveur arrêté.');
        process.exit(0);
    });
});

module.exports = app; 