const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');

// Import des services
const UserService = require('./services/UserService');
const PolygonService = require('./services/PolygonService');
const MessageService = require('./services/MessageService');

// Instancier les services
const userService = new UserService();
const polygonService = new PolygonService();
const messageService = new MessageService();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de sécurité
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Compression des réponses
app.use(compression());

// CORS
app.use(cors({
    origin: ['http://localhost:3000', 'http://192.168.1.10:3000', 'http://149.202.33.164'],
    credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting global
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limite chaque IP à 1000 requêtes par windowMs
    message: { error: 'Trop de requêtes, réessayez plus tard.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiting pour l'authentification
const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // Limite chaque IP à 10 tentatives de connexion par windowMs
    message: { error: 'Trop de tentatives de connexion, réessayez plus tard.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(globalLimiter);

// Middleware de logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// Route de santé
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: 'production'
    });
});

// Routes d'authentification avec rate limiting
app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
        const { username, email, password, fullName, phone, userType } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Données manquantes' });
        }

        const user = await userService.registerUser({
            username,
            email,
            password,
            fullName: fullName || '',
            phone: phone || '',
            userType: userType || 'user'
        });

        res.status(201).json({
            id: user.id,
            username: user.username,
            email: user.email,
            fullName: user.fullName
        });
    } catch (error) {
        console.error('Erreur lors de l\'inscription:', error);
        if (error.message.includes('déjà')) {
            res.status(409).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Erreur serveur' });
        }
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
        }

        const user = await userService.loginUser(username, password);
        
        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.fullName,
                fullName: user.fullName,
                user_type: user.userType || 'user',
                userType: user.userType || 'user',
                token: user.token,
                expiresAt: user.expiresAt
            }
        });
    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        res.status(401).json({ error: error.message });
    }
});

// Routes des polygones (annonces)
app.get('/api/polygons/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const polygons = await polygonService.getPolygonsByUser(userId);
        res.json(polygons);
    } catch (error) {
        console.error('Erreur lors de la récupération des polygones:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/polygons/public', async (req, res) => {
    try {
        const polygons = await polygonService.getPublicPolygons();
        res.json(polygons);
    } catch (error) {
        console.error('Erreur lors de la récupération des polygones publics:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/polygons', async (req, res) => {
    try {
        const polygonData = req.body;
        
        // Validation basique
        if (!polygonData.userId || !polygonData.coordinates) {
            return res.status(400).json({ error: 'Données manquantes (userId, coordinates requis)' });
        }

        const polygon = await polygonService.savePolygon(polygonData);
        res.status(201).json(polygon);
    } catch (error) {
        console.error('Erreur lors de la création du polygone:', error);
        res.status(500).json({ error: 'Erreur serveur lors de la création' });
    }
});

app.delete('/api/polygons/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const success = await polygonService.deletePolygon(id);
        
        if (success) {
            res.json({ success: true, message: 'Polygone supprimé' });
        } else {
            res.status(404).json({ error: 'Polygone non trouvé' });
        }
    } catch (error) {
        console.error('Erreur lors de la suppression du polygone:', error);
        res.status(500).json({ error: 'Erreur serveur lors de la suppression' });
    }
});

// Routes des annonces (alias pour polygones)
app.get('/api/announcements/public', async (req, res) => {
    try {
        const polygons = await polygonService.getPublicPolygons();
        res.json(polygons);
    } catch (error) {
        console.error('Erreur lors de la récupération des annonces:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/announcements/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const polygons = await polygonService.getPolygonsByUser(userId);
        res.json(polygons);
    } catch (error) {
        console.error('Erreur lors de la récupération des annonces utilisateur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/announcements', async (req, res) => {
    try {
        const announcementData = req.body;
        
        // Validation basique
        if (!announcementData.userId || !announcementData.title) {
            return res.status(400).json({ error: 'Données manquantes (userId, title requis)' });
        }

        // Convertir les données d'annonce en format polygone
        const polygonData = {
            userId: announcementData.userId,
            title: announcementData.title,
            description: announcementData.description || '',
            coordinates: announcementData.coordinates || [],
            price: announcementData.price || 0,
            surface: announcementData.surface || 0,
            commune: announcementData.commune || announcementData.location || 'Non spécifié',
            codeInsee: announcementData.codeInsee || '00000',
            status: 'available',
            isPublic: true
        };

        const polygon = await polygonService.savePolygon(polygonData);
        res.status(201).json(polygon);
    } catch (error) {
        console.error('Erreur lors de la création de l\'annonce:', error);
        res.status(500).json({ error: 'Erreur serveur lors de la création' });
    }
});

// Routes des messages
app.get('/api/messages/:roomId', async (req, res) => {
    try {
        const { roomId } = req.params;
        const messages = await messageService.getMessagesByRoom(roomId);
        res.json(messages);
    } catch (error) {
        console.error('Erreur lors de la récupération des messages:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/messages', async (req, res) => {
    try {
        const messageData = req.body;
        const message = await messageService.createMessage(messageData);
        res.status(201).json(message);
    } catch (error) {
        console.error('Erreur lors de la création du message:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Gestion des erreurs 404
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint non trouvé',
        path: req.originalUrl,
        method: req.method
    });
});

// Gestion des erreurs globales
app.use((error, req, res, next) => {
    console.error('Erreur globale:', error);
    res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Nettoyage automatique des sessions expirées
setInterval(() => {
    userService.cleanExpiredSessions().catch(err => {
        console.error('Erreur nettoyage sessions:', err);
    });
}, 60 * 60 * 1000); // Toutes les heures

// Démarrage du serveur
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur ParcellePlus démarré sur le port ${PORT}`);
    console.log(`📅 Démarré le: ${new Date().toISOString()}`);
    console.log(`🌍 Accessible sur: http://0.0.0.0:${PORT}`);
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
    console.log('🛑 Arrêt du serveur...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Arrêt du serveur...');
    process.exit(0);
});
