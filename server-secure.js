const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

// Import des modules de base de données
const PolygonService = require('./services/PolygonService');
const MessageService = require('./services/MessageService');
const UserService = require('./services/UserService');

// Configuration
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'parcelle-plus-secret-key-2024';
const RATE_LIMIT_REQUESTS = process.env.RATE_LIMIT_REQUESTS || 100;
const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW || 15;

const app = express();

// ========== MIDDLEWARES DE SÉCURITÉ ==========

// Helmet pour sécuriser les headers HTTP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    crossOriginEmbedderPolicy: false
}));

// Rate limiting global
const globalLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW * 60 * 1000, // 15 minutes par défaut
    max: RATE_LIMIT_REQUESTS, // 100 requêtes par défaut
    message: {
        error: 'Trop de requêtes depuis cette IP',
        retryAfter: RATE_LIMIT_WINDOW * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.log(`🚨 Rate limit dépassé pour IP: ${req.ip}`);
        res.status(429).json({
            error: 'Trop de requêtes depuis cette IP',
            retryAfter: RATE_LIMIT_WINDOW * 60
        });
    }
});

// Rate limiting spécifique pour les API
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 requêtes par minute
    message: {
        error: 'Trop de requêtes API',
        retryAfter: 60
    }
});

// CORS restrictif pour IP publique
app.use(cors({
    origin: ['http://localhost:3000', 'http://37.66.21.17:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: false
}));

// Logging des requêtes
app.use(morgan('combined'));

// Parse des données JSON
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Appliquer le rate limiting global
app.use(globalLimiter);

// ========== MIDDLEWARE D'AUTHENTIFICATION ==========

// Middleware pour vérifier la clé API
const authenticateAPI = (req, res, next) => {
    const apiKey = req.header('X-API-Key');
    const authHeader = req.header('Authorization');
    
    // Vérifier la clé API dans le header X-API-Key
    if (apiKey === API_KEY) {
        req.authenticated = true;
        return next();
    }
    
    // Vérifier la clé API dans Authorization Bearer
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token === API_KEY) {
            req.authenticated = true;
            return next();
        }
    }
    
    // Log de tentative d'accès non autorisé
    console.log(`🔒 Tentative d'accès non autorisé depuis IP: ${req.ip}`);
    console.log(`🔒 User-Agent: ${req.get('User-Agent')}`);
    
    return res.status(401).json({
        error: 'Authentification requise',
        message: 'Clé API manquante ou invalide'
    });
};

// Services
const polygonService = new PolygonService();
const messageService = new MessageService();
const userService = new UserService();

// Créer le serveur HTTP
const server = http.createServer(app);

// Configuration WebSocket sécurisée
const wss = new WebSocket.Server({ 
    server,
    verifyClient: (info) => {
        // Vérifier l'origine des connexions WebSocket
        const origin = info.origin;
        const allowedOrigins = [
            'http://localhost:3000',
            'http://37.66.21.17:3000'
        ];
        
        if (allowedOrigins.includes(origin)) {
            return true;
        }
        
        console.log(`🔒 Connexion WebSocket refusée depuis: ${origin}`);
        return false;
    }
});

// Gestion des connexions WebSocket
const clients = new Map();

wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    const clientInfo = {
        id: clientId,
        ws: ws,
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        connectedAt: new Date(),
        authenticated: false
    };
    
    clients.set(clientId, clientInfo);
    console.log(`🔌 Client connecté: ${clientId} (${clientInfo.ip})`);
    console.log(`👥 Clients connectés: ${clients.size}`);

    // Envoyer un message de bienvenue avec demande d'authentification
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId: clientId,
        message: 'Connexion établie - Authentification requise',
        requiresAuth: true
    }));

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`📨 Message reçu de ${clientId}:`, message.type);
            
            switch (message.type) {
                case 'authenticate':
                    if (message.apiKey === API_KEY) {
                        clientInfo.authenticated = true;
                        ws.send(JSON.stringify({
                            type: 'auth_success',
                            message: 'Authentification réussie'
                        }));
                        console.log(`🔓 Client authentifié: ${clientId}`);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'auth_failed',
                            message: 'Clé API invalide'
                        }));
                        console.log(`🔒 Échec authentification: ${clientId}`);
                    }
                    break;
                    
                case 'ping':
                    if (clientInfo.authenticated) {
                        ws.send(JSON.stringify({ type: 'pong' }));
                    }
                    break;
                    
                case 'join_room':
                    if (clientInfo.authenticated) {
                        clientInfo.room = message.room;
                        ws.send(JSON.stringify({
                            type: 'room_joined',
                            room: message.room
                        }));
                    }
                    break;
                    
                case 'send_message':
                    if (clientInfo.authenticated) {
                        await handleChatMessage(clientId, message);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Authentification requise'
                        }));
                    }
                    break;
                    
                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Type de message non supporté'
                    }));
            }
        } catch (error) {
            console.error('❌ Erreur WebSocket:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Erreur traitement message'
            }));
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
        
        // Diffuser le message à tous les clients authentifiés de la room
        const broadcastMessage = {
            type: 'new_message',
            message: savedMessage
        };
        
        clients.forEach((client, id) => {
            if (client.authenticated && 
                (client.room === message.room || !message.room)) {
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
        if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

// ========== ROUTES API SÉCURISÉES ==========

// Route de santé publique (sans authentification)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '1.0.0-secure',
                    ip: '37.66.21.17',
        port: PORT,
        security: {
            authenticated: false,
            rateLimit: true,
            corsEnabled: true
        }
    });
});

// Appliquer l'authentification et le rate limiting pour toutes les autres routes API
app.use('/api', apiLimiter);
app.use('/api', authenticateAPI);

// Route d'information (authentifiée)
app.get('/api/info', (req, res) => {
    res.json({
        message: 'ParcellePlus Server API - Version Sécurisée',
        version: '1.0.0-secure',
        timestamp: new Date().toISOString(),
        endpoints: {
            polygons: '/api/polygons',
            messages: '/api/messages',
            users: '/api/users',
            websocket: 'ws://37.66.21.17:3000'
        },
        security: {
            authenticated: true,
            rateLimit: true,
            corsEnabled: true
        }
    });
});

// Routes pour les polygones (authentifiées)
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
        
        // Notifier les autres clients authentifiés
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
        
        // Notifier les autres clients authentifiés
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
        
        // Notifier les autres clients authentifiés
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

// Routes pour les messages (authentifiées)
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
    try {
        const messageData = req.body;
        const savedMessage = await messageService.saveMessage(messageData);
        
        // Diffuser le message via WebSocket
        broadcastNotification({
            type: 'new_message',
            message: savedMessage
        });
        
        res.status(201).json(savedMessage);
    } catch (error) {
        console.error('❌ Erreur sauvegarde message:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Routes pour les utilisateurs (authentifiées)
app.get('/api/users/online', (req, res) => {
    const onlineUsers = Array.from(clients.values())
        .filter(client => client.authenticated)
        .map(client => ({
            id: client.id,
            ip: client.ip,
            connectedAt: client.connectedAt,
            room: client.room
        }));
    
    res.json({
        count: onlineUsers.length,
        users: onlineUsers
    });
});

// Route pour les statistiques (authentifiée)
app.get('/api/stats', async (req, res) => {
    try {
        const polygonStats = await polygonService.getStats();
        const messageStats = await messageService.getMessageStats();
        
        res.json({
            polygons: polygonStats,
            messages: messageStats,
            websocket: {
                totalConnections: clients.size,
                authenticatedConnections: Array.from(clients.values()).filter(c => c.authenticated).length
            }
        });
    } catch (error) {
        console.error('❌ Erreur récupération statistiques:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Gestion des erreurs 404
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint non trouvé',
        message: 'Cette route n\'existe pas'
    });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
    console.error('❌ Erreur serveur:', err);
    res.status(500).json({
        error: 'Erreur serveur interne',
        message: 'Une erreur inattendue s\'est produite'
    });
});

// Démarrer le serveur
server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ========================================');
    console.log(`🚀 Serveur ParcellePlus SÉCURISÉ démarré sur le port ${PORT}`);
    console.log(`🚀 URL publique: http://37.66.21.17:${PORT}`);
    console.log(`🚀 WebSocket: ws://37.66.21.17:${PORT}`);
    console.log(`🔒 Authentification: API Key requise`);
    console.log(`🛡️  Rate limiting: ${RATE_LIMIT_REQUESTS} req/${RATE_LIMIT_WINDOW}min`);
    console.log('🚀 ========================================');
});

// Gestion de l'arrêt propre du serveur
process.on('SIGINT', () => {
    console.log('\n🛑 Arrêt du serveur...');
    server.close(() => {
        console.log('✅ Serveur arrêté');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Arrêt du serveur (SIGTERM)...');
    server.close(() => {
        console.log('✅ Serveur arrêté');
        process.exit(0);
    });
}); 