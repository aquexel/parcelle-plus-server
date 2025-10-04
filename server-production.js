const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');

// Import des services
const userService = require('./services/UserService');
const polygonService = require('./services/PolygonService');
const messageService = require('./services/MessageService');

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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limite chaque IP à 100 requêtes par fenêtre de temps
    message: {
        error: 'Trop de requêtes depuis cette IP, réessayez plus tard.'
    }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limite les tentatives de connexion
    message: {
        error: 'Trop de tentatives de connexion, réessayez plus tard.'
    }
});

app.use(limiter);

// Configuration CORS pour la production
const corsOptions = {
    origin: function (origin, callback) {
        // Permettre les requêtes sans origin (applications mobiles)
        if (!origin) return callback(null, true);
        
        // Liste des domaines autorisés
        const allowedOrigins = [
            'http://localhost:3000',
            'https://votre-domaine.com', // Remplacez par votre domaine
            // Ajoutez d'autres domaines si nécessaire
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Non autorisé par CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Middleware pour parser JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de logging pour la production
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} - ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// Route de santé
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'production'
    });
});

// Routes d'authentification avec rate limiting
app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
        const { username, email, password, firstName, lastName, phone, address } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Données manquantes' });
        }

        const userData = {
            username,
            email,
            password,
            firstName: firstName || '',
            lastName: lastName || '',
            phone: phone || '',
            address: address || ''
        };

        const user = await userService.createUser(userData);
        
        // Ne pas retourner le mot de passe
        const { password: _, ...userResponse } = user;
        res.status(201).json(userResponse);
    } catch (error) {
        console.error('Erreur lors de l\'inscription:', error);
        if (error.message.includes('UNIQUE constraint failed')) {
            res.status(409).json({ error: 'Nom d\'utilisateur ou email déjà utilisé' });
        } else {
            res.status(500).json({ error: 'Erreur serveur lors de l\'inscription' });
        }
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
        }

        const user = await userService.loginUser({ username, password });
        
        // Ne pas retourner le mot de passe
        const { password: _, ...userResponse } = user;
        res.json(userResponse);
    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        res.status(401).json({ error: error.message });
    }
});

// Routes des polygones
app.get('/api/polygons/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const polygons = await polygonService.getPolygonsByUserId(userId);
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
            return res.status(400).json({ error: 'Données manquantes' });
        }

        const polygon = await polygonService.createPolygon(polygonData);
        res.status(201).json(polygon);
    } catch (error) {
        console.error('Erreur lors de la création du polygone:', error);
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
        
        if (!messageData.roomId || !messageData.senderId || !messageData.content) {
            return res.status(400).json({ error: 'Données manquantes' });
        }

        const message = await messageService.createMessage(messageData);
        res.status(201).json(message);
    } catch (error) {
        console.error('Erreur lors de la création du message:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour servir des fichiers statiques (si nécessaire)
app.use('/static', express.static(path.join(__dirname, 'public')));

// Middleware de gestion d'erreurs
app.use((err, req, res, next) => {
    console.error('Erreur non gérée:', err);
    res.status(500).json({ error: 'Erreur serveur interne' });
});

// Route 404
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route non trouvée' });
});

// Gestion propre de l'arrêt du serveur
process.on('SIGTERM', () => {
    console.log('SIGTERM reçu, arrêt propre du serveur...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT reçu, arrêt propre du serveur...');
    process.exit(0);
});

// Démarrage du serveur
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur ParcellePlus démarré sur le port ${PORT}`);
    console.log(`📅 Démarré le: ${new Date().toISOString()}`);
    console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'production'}`);
    console.log(`🔗 API disponible sur: http://localhost:${PORT}/api/health`);
});

module.exports = app;


