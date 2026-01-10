// Charger les variables d'environnement depuis .env si disponible
try {
    require('dotenv').config();
} catch (e) {
    // dotenv n'est pas installé, continuer sans
}

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// Import des modules de base de données
const PolygonService = require('./services/PolygonService');
const MessageService = require('./services/MessageService');
const UserService = require('./services/UserService');
const OfferService = require('./services/OfferService');
const PriceAlertService = require('./services/PriceAlertService');
const EmailService = require('./services/EmailService');
const PDFService = require('./services/PDFService');
const PhotoDistributionService = require('./services/PhotoDistributionService');

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

// Configuration multer pour upload de photos
const photosDir = path.join(__dirname, 'photos');
if (!fs.existsSync(photosDir)) {
    fs.mkdirSync(photosDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, photosDir);
    },
    filename: (req, file, cb) => {
        const announcementId = req.params.id;
        const timestamp = Date.now();
        const index = req.body.index || 0;
        cb(null, `announcement_${announcementId}_photo_${index}_${timestamp}.jpg`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 // 2 Mo max
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Seules les images sont autorisées'), false);
        }
    }
});

// Services
const polygonService = new PolygonService();
const messageService = new MessageService();
const userService = new UserService();
const offerService = new OfferService();
const priceAlertService = new PriceAlertService();
const pdfService = new PDFService();
const photoDistributionService = new PhotoDistributionService();
const emailService = new EmailService();

// PushNotificationService optionnel (peut fonctionner sans firebase-admin pour l'enregistrement des tokens)
let pushNotificationService;
try {
    // Charger le service même si firebase-admin n'est pas installé
    // Le service peut fonctionner partiellement (enregistrement des tokens) sans Firebase
    const PushNotificationService = require('./services/PushNotificationService');
    pushNotificationService = new PushNotificationService();
    
    // Vérifier si l'initialisation Firebase a réussi
    if (pushNotificationService.isInitialized()) {
    } else {
    }
} catch (error) {
    // Créer un stub pour éviter les erreurs
    pushNotificationService = {
        isInitialized: () => false,
        registerUserFCMToken: async () => { return false; },
        sendMessageNotification: async () => { return false; },
        sendCustomNotification: async () => { return false; }
    };
}

// Créer le serveur HTTP
const server = http.createServer(app);

// Configuration WebSocket
const wss = new WebSocket.Server({ server });

// Gestion des connexions WebSocket
const clients = new Map();

// Fonction pour déterminer l'utilisateur cible d'une notification
async function determineTargetUserId(roomId, senderId) {
    try {
        // Extraire les IDs des utilisateurs depuis le roomId
        // Format: private_user1_user2_announcement_XXXXX
        if (roomId.startsWith('private_')) {
            const cleanRoomId = roomId.replace('private_', '');
            const parts = cleanRoomId.split('_announcement_')[0].split('_');
            
            if (parts.length >= 2) {
                const user1 = parts[0];
                const user2 = parts[1];
                
                // Retourner l'utilisateur qui n'est pas l'expéditeur
                return senderId === user1 ? user2 : user1;
            }
        }
        
        return null;
    } catch (error) {
        console.error('❌ Erreur détermination utilisateur cible:', error.message);
        return null;
    }
}

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

    // Envoyer un message de bienvenue
    ws.send(JSON.stringify({
        type: 'welcome',
        clientId: clientId,
        message: 'Connexion établie avec le serveur ParcellePlus'
    }));

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            // Ne pas logger les pings pour éviter de polluer les logs
            if (message.type !== 'ping') {
            }
            
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
            offers: '/api/offers',
            conversations: '/api/conversations',
            dvf_with_features: '/api/dvf/search-with-features',
            safer_prix: '/api/safer/prix',
            terrains_batir: '/api/terrains-batir/search',
            websocket: 'ws://149.202.33.164:3000'
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
        
        // Récupérer tous les polygones et filtrer les publics
        const allPolygons = await polygonService.getAllPolygons(null, limit);
        const publicPolygons = allPolygons.filter(p => 
            (p.is_public === 1 || p.is_public === true || p.isPublic === true) && 
            (p.status === 'active' || p.status === 'available')
        );
        
        // Ajouter le nombre de photos pour chaque polygone (via système P2P)
        const polygonsWithPhotos = await Promise.all(publicPolygons.map(async (polygon) => {
            let photoCount = 0;
            try {
                // Utiliser le service P2P pour compter les photos disponibles
                photoCount = await photoDistributionService.getAnnouncementPhotoCount(polygon.id);
            } catch (err) {
                // Si erreur P2P, essayer de compter depuis le serveur comme fallback
                try {
                    const photoPattern = `announcement_${polygon.id}_photo_`;
                    if (fs.existsSync(photosDir)) {
                        const allFiles = fs.readdirSync(photosDir);
                        const photoIndices = new Set();
                        allFiles.forEach(file => {
                            if (file.startsWith(photoPattern) && file.endsWith('.jpg')) {
                                const match = file.match(new RegExp(`announcement_${polygon.id}_photo_(\\d+)_`));
                                if (match && match[1]) {
                                    photoIndices.add(parseInt(match[1]));
                                }
                            }
                        });
                        photoCount = photoIndices.size;
                    }
                } catch (fsErr) {
                    // Ignorer les erreurs de lecture du dossier photos
                }
            }
            
            return {
                ...polygon,
                photoCount: photoCount,
                photo_urls: photoCount > 0 ? Array.from({ length: photoCount }, (_, i) => `/api/polygons/${polygon.id}/photos/${i}`) : []
            };
        }));
        
        res.json(polygonsWithPhotos);
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
        
        // Vérifier les alertes de prix pour cette nouvelle annonce
        try {
            const matchingAlerts = await priceAlertService.checkAnnouncementForAlerts(savedPolygon);
            
            if (matchingAlerts.length > 0) {
                
                // Envoyer une notification à chaque acheteur concerné
                for (const alert of matchingAlerts) {
                    // Marquer comme notifié
                    await priceAlertService.markAsNotified(alert.id, savedPolygon.id, alert.userId);
                    
                    // Déterminer la surface à afficher selon le type de bien
                    const surfaceToDisplay = (savedPolygon.type === 'APPARTEMENT' || savedPolygon.type === 'MAISON_SEULE') && 
                                           savedPolygon.surfaceMaison && savedPolygon.surfaceMaison > 0
                        ? savedPolygon.surfaceMaison
                        : savedPolygon.surface;
                    
                    const surfaceLabel = (savedPolygon.type === 'APPARTEMENT' && savedPolygon.surfaceMaison && savedPolygon.surfaceMaison > 0)
                        ? 'Surface appartement'
                        : (savedPolygon.type === 'MAISON_SEULE' && savedPolygon.surfaceMaison && savedPolygon.surfaceMaison > 0)
                        ? 'Surface maison'
                        : 'Surface';
                    
                    // Envoyer notification WebSocket
                    broadcastNotification({
                        type: 'price_alert',
                        userId: alert.userId,
                        announcement: savedPolygon,
                        alert: {
                            id: alert.id,
                            maxPrice: alert.maxPrice,
                            minSurface: alert.minSurface,
                            maxSurface: alert.maxSurface
                        },
                        message: `🔔 Nouvelle annonce: ${surfaceToDisplay}m² à ${savedPolygon.price}€ dans ${savedPolygon.commune}`
                    });
                    
                    // Envoyer notification FCM (push notification)
                    if (pushNotificationService.isInitialized()) {
                        const notificationTitle = "🔔 Nouvelle annonce correspondant à votre alerte";
                        const notificationBody = `${surfaceToDisplay}m² à ${savedPolygon.price}€ dans ${savedPolygon.commune}`;
                        
                        try {
                            const notificationSent = await pushNotificationService.sendCustomNotification(
                                alert.userId,
                                notificationTitle,
                                notificationBody,
                                {
                                    type: 'price_alert',
                                    announcement_id: savedPolygon.id,
                                    alert_id: alert.id,
                                    surface: surfaceToDisplay.toString(),
                                    surfaceMaison: (savedPolygon.surfaceMaison || 0).toString(),
                                    announcementType: savedPolygon.type || '',
                                    price: savedPolygon.price.toString(),
                                    commune: savedPolygon.commune || ''
                                }
                            );
                            
                            if (notificationSent) {
                            } else {
                            }
                        } catch (notificationError) {
                            console.error(`❌ Erreur lors de l'envoi de la notification FCM à ${alert.userId}:`, notificationError.message);
                        }
                    } else {
                    }
                    
                }
            }
        } catch (alertError) {
            console.error('⚠️ Erreur vérification alertes (non bloquant):', alertError);
        }
        
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

// Marquer une demande de photo comme satisfaite
app.post('/api/polygons/:id/photos/:index/mark-fulfilled', async (req, res) => {
    try {
        const announcementId = req.params.id;
        const photoIndex = parseInt(req.params.index);
        const userId = req.body.user_id || req.headers['x-user-id'];
        
        if (!userId) {
            return res.status(400).json({ error: 'user_id requis' });
        }
        
        await photoDistributionService.markRequestFulfilled(announcementId, photoIndex, userId);
        
        res.json({
            success: true
        });
    } catch (error) {
        console.error('❌ Erreur marquage demande comme satisfaite:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Upload de photos pour une annonce (tampon temporaire) ou mise à jour
app.post('/api/polygons/:id/photos', upload.single('photo'), async (req, res) => {
    try {
        const announcementId = req.params.id;
        const photoIndex = parseInt(req.body.index || '0');
        const userId = req.body.user_id || req.headers['x-user-id'];
        const isSeller = req.body.is_seller === 'true' || req.body.is_seller === true;
        const isUpdate = req.body.update === 'true' || req.body.update === true;
        
        if (!req.file) {
            return res.status(400).json({ error: 'Aucune photo fournie' });
        }
        
        // Vérifier que l'annonce existe
        const polygon = await polygonService.getPolygonById(announcementId);
        if (!polygon) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Annonce non trouvée' });
        }
        
        // Si c'est une mise à jour, générer une nouvelle version
        let photoVersion = null;
        if (isUpdate && isSeller) {
            photoVersion = Date.now().toString(); // Nouvelle version basée sur timestamp
        }
        
        const photoPath = `/photos/${req.file.filename}`;
        const fullPath = req.file.path;
        
        // Vérifier que le fichier existe bien sur le disque
        const fileExists = fs.existsSync(fullPath);
        const fileStats = fileExists ? fs.statSync(fullPath) : null;
        
        if (fileStats) {
        }
        
        // Enregistrer le serveur comme source de la photo (avec version si mise à jour)
        const version = await photoDistributionService.registerPhotoSource(
            announcementId, 
            photoIndex, 
            'server', 
            false, 
            true, 
            photoVersion
        );
        
        // Si c'est le vendeur qui upload, l'enregistrer aussi comme source
        if (userId && isSeller) {
            await photoDistributionService.registerPhotoSource(
                announcementId, 
                photoIndex, 
                userId, 
                true, 
                false, 
                version || photoVersion
            );
        }
        
        
        res.status(201).json({
            success: true,
            photoPath: photoPath,
            filename: req.file.filename,
            size: req.file.size,
            photoIndex: photoIndex,
            version: version || '1',
            isUpdate: isUpdate
        });
    } catch (error) {
        console.error('❌ Erreur upload photo:', error);
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (e) {
                // Ignorer
            }
        }
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Vérifier la version actuelle d'une photo
app.get('/api/polygons/:id/photos/:index/version', async (req, res) => {
    try {
        const announcementId = req.params.id;
        const photoIndex = parseInt(req.params.index);
        const userId = req.query.user_id || req.headers['x-user-id'];
        
        const currentVersion = await photoDistributionService.getCurrentPhotoVersion(announcementId, photoIndex);
        
        let hasLatest = true;
        if (userId) {
            hasLatest = await photoDistributionService.hasLatestPhotoVersion(announcementId, photoIndex, userId);
        }
        
        res.json({
            success: true,
            currentVersion: currentVersion || '1',
            hasLatestVersion: hasLatest,
            needsUpdate: !hasLatest
        });
    } catch (error) {
        console.error('❌ Erreur vérification version photo:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Découvrir les sources pour télécharger une photo
app.get('/api/polygons/:id/photos/:index/sources', async (req, res) => {
    try {
        const announcementId = req.params.id;
        const photoIndex = parseInt(req.params.index);
        const excludeUserId = req.query.exclude_user_id || null;
        
        const sources = await photoDistributionService.findPhotoSources(
            announcementId, 
            photoIndex, 
            excludeUserId
        );
        
        res.json({
            success: true,
            sources: sources,
            count: sources.length
        });
    } catch (error) {
        console.error('❌ Erreur recherche sources photo:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Enregistrer qu'un client a téléchargé une photo
app.post('/api/polygons/:id/photos/:index/register-client', async (req, res) => {
    try {
        const announcementId = req.params.id;
        const photoIndex = parseInt(req.params.index);
        const userId = req.body.user_id || req.headers['x-user-id'];
        
        if (!userId) {
            return res.status(400).json({ error: 'user_id requis' });
        }
        
        await photoDistributionService.registerPhotoClient(announcementId, photoIndex, userId);
        
        // Vérifier si le serveur peut supprimer la photo
        const canCleanup = await photoDistributionService.canCleanupServerPhoto(announcementId, photoIndex);
        
        // Vérifier s'il y a des demandes silencieuses pour cet utilisateur
        const pendingRequests = await photoDistributionService.getPendingPhotoRequests(userId);
        
        res.json({
            success: true,
            canCleanupServer: canCleanup,
            pendingPhotoRequests: pendingRequests // Retourner les demandes silencieuses
        });
    } catch (error) {
        console.error('❌ Erreur enregistrement client photo:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Récupérer les demandes de photos en attente pour un utilisateur (endpoint dédié)
app.get('/api/photos/pending-requests', async (req, res) => {
    try {
        const userId = req.query.user_id || req.headers['x-user-id'];
        
        if (!userId) {
            return res.status(400).json({ error: 'user_id requis' });
        }
        
        const pendingRequests = await photoDistributionService.getPendingPhotoRequests(userId);
        
        res.json({
            success: true,
            requests: pendingRequests,
            count: pendingRequests.length
        });
    } catch (error) {
        console.error('❌ Erreur récupération demandes silencieuses:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Télécharger une photo depuis le serveur (fallback)
app.get('/api/polygons/:id/photos/:index', async (req, res) => {
    try {
        const announcementId = req.params.id;
        const photoIndex = parseInt(req.params.index);
        
        // Chercher les fichiers correspondants
        const photoPattern = `announcement_${announcementId}_photo_${photoIndex}_`;
        const allFiles = fs.readdirSync(photosDir);
        const matchingFiles = allFiles.filter(f => f.startsWith(photoPattern) && f.endsWith('.jpg'));
        
        if (matchingFiles.length === 0) {
            // Le serveur n'a plus la photo, enregistrer une demande silencieuse (P2P)
            
            const sources = await photoDistributionService.findPhotoSources(announcementId, photoIndex);
            
            if (sources && sources.length > 0) {
                // Trouver une source non-serveur (vendeur ou autre client) - priorité au vendeur
                const nonServerSource = sources.find(s => s.isSeller && !s.isServer) || sources.find(s => !s.isServer);
                
                if (nonServerSource) {
                    
                    // Enregistrer une demande silencieuse dans la base de données
                    try {
                        await photoDistributionService.registerSilentPhotoRequest(announcementId, photoIndex, nonServerSource.userId);
                    } catch (reqError) {
                        console.error('❌ Erreur enregistrement demande silencieuse:', reqError);
                    }
                }
                
                // Retourner 404 - le client devra réessayer après que la photo soit ré-uploadée
                return res.status(404).json({ 
                    error: 'Photo non trouvée sur serveur',
                    announcementId: announcementId,
                    photoIndex: photoIndex,
                    sourcesAvailable: sources.length > 0,
                    p2pRequestRegistered: nonServerSource != null
                });
            }
            
            // Aucune source disponible
            return res.status(404).json({ 
                error: 'Photo non trouvée',
                announcementId: announcementId,
                photoIndex: photoIndex,
                pattern: photoPattern,
                totalFiles: allFiles.length,
                matchingFiles: 0,
                sourcesAvailable: false
            });
        }
        
        // Prendre le fichier le plus récent si plusieurs versions existent
        const photoFile = path.join(photosDir, matchingFiles[0]);
        const stats = fs.statSync(photoFile);
        
        res.sendFile(photoFile);
    } catch (error) {
        console.error('❌ Erreur téléchargement photo:', error);
        console.error('❌ Stack:', error.stack);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Servir les photos statiquement
app.use('/photos', express.static(photosDir));

app.delete('/api/polygons/:id', async (req, res) => {
    try {
        const polygonId = req.params.id;
        
        // Supprimer d'abord les conversations et offres liées
        const cleanup = await offerService.deleteConversationsAndOffersByAnnouncement(polygonId);
        
        // Puis supprimer le polygone
        const deleted = await polygonService.deletePolygon(polygonId);
        if (!deleted) {
            return res.status(404).json({ error: 'Polygone non trouvé' });
        }
        
        // Notifier les autres clients
        broadcastNotification({
            type: 'polygon_deleted',
            polygonId: polygonId
        });
        
        res.json({ 
            message: 'Polygone supprimé',
            cleanup: cleanup
        });
    } catch (error) {
        console.error('❌ Erreur suppression polygone:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== ROUTES STATISTIQUES VUES ANNONCES ==========

// Enregistrer une vue d'annonce
app.post('/api/announcements/:id/view', async (req, res) => {
    try {
        const { id: announcementId } = req.params;
        const { viewerId, viewerType = 'buyer' } = req.body;

        if (!viewerId) {
            return res.status(400).json({ error: 'viewerId requis' });
        }

        // Enregistrer chaque vue (même utilisateur peut voir plusieurs fois)
        const view = await polygonService.recordView(announcementId, viewerId, viewerType);
        res.status(201).json({ success: true, view });
    } catch (error) {
        console.error('❌ Erreur enregistrement vue:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer les statistiques d'une annonce spécifique
app.get('/api/announcements/:id/stats', async (req, res) => {
    try {
        const { id: announcementId } = req.params;
        const stats = await polygonService.getAnnouncementViews(announcementId);
        res.json(stats);
    } catch (error) {
        console.error('❌ Erreur récupération statistiques annonce:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer les statistiques de toutes les annonces d'un vendeur
app.get('/api/sellers/:sellerId/stats', async (req, res) => {
    try {
        const { sellerId } = req.params;
        const stats = await polygonService.getSellerStats(sellerId);
        res.json(stats);
    } catch (error) {
        console.error('❌ Erreur récupération statistiques vendeur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== ROUTES ALERTES DE PRIX ==========

// Créer une nouvelle alerte de prix
app.post('/api/price-alerts', async (req, res) => {
    try {
        const alertData = req.body;
        
        if (!alertData.userId || !alertData.maxPrice) {
            return res.status(400).json({ error: 'userId et maxPrice sont requis' });
        }
        
        const alert = await priceAlertService.createAlert(alertData);
        res.status(201).json(alert);
    } catch (error) {
        console.error('❌ Erreur création alerte:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer toutes les alertes d'un utilisateur
app.get('/api/price-alerts/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const alerts = await priceAlertService.getUserAlerts(userId);
        res.json(alerts);
    } catch (error) {
        console.error('❌ Erreur récupération alertes:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer les statistiques des alertes d'un utilisateur
app.get('/api/price-alerts/user/:userId/stats', async (req, res) => {
    try {
        const { userId } = req.params;
        const stats = await priceAlertService.getUserAlertStats(userId);
        res.json(stats);
    } catch (error) {
        console.error('❌ Erreur récupération stats alertes:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Mettre à jour une alerte
app.put('/api/price-alerts/:alertId', async (req, res) => {
    try {
        const { alertId } = req.params;
        const updateData = req.body;
        
        const updatedAlert = await priceAlertService.updateAlert(alertId, updateData);
        if (!updatedAlert) {
            return res.status(404).json({ error: 'Alerte non trouvée' });
        }
        
        res.json(updatedAlert);
    } catch (error) {
        console.error('❌ Erreur mise à jour alerte:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Supprimer une alerte
app.delete('/api/price-alerts/:alertId', async (req, res) => {
    try {
        const { alertId } = req.params;
        const deleted = await priceAlertService.deleteAlert(alertId);
        
        if (!deleted) {
            return res.status(404).json({ error: 'Alerte non trouvée' });
        }
        
        res.json({ success: true, message: 'Alerte supprimée' });
    } catch (error) {
        console.error('❌ Erreur suppression alerte:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Activer/désactiver une alerte
app.patch('/api/price-alerts/:alertId/toggle', async (req, res) => {
    try {
        const { alertId } = req.params;
        const { isActive } = req.body;
        
        const updatedAlert = await priceAlertService.updateAlert(alertId, { isActive });
        if (!updatedAlert) {
            return res.status(404).json({ error: 'Alerte non trouvée' });
        }
        
        res.json(updatedAlert);
    } catch (error) {
        console.error('❌ Erreur toggle alerte:', error);
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
    try {
        const messageData = req.body;
        
        // Si c'est une room privée, récupérer le username de l'autre utilisateur pour le nom de la room
        if (messageData.room && messageData.room.startsWith('private_')) {
            try {
                const targetUserId = await determineTargetUserId(messageData.room, messageData.senderId);
                if (targetUserId) {
                    const targetUser = await userService.getUserById(targetUserId);
                    if (targetUser && targetUser.username) {
                        messageData.targetUserName = targetUser.username;
                    }
                }
            } catch (userError) {
                console.warn('⚠️ Impossible de récupérer le username de l\'interlocuteur:', userError.message);
                // Continuer même si on ne peut pas récupérer le username
            }
        }
        
        const savedMessage = await messageService.saveMessage(messageData);
        
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
        
        // Envoyer une notification push si le service est disponible
        if (pushNotificationService.isInitialized()) {
            try {
                // Déterminer l'utilisateur cible (celui qui n'a pas envoyé le message)
                const targetUserId = await determineTargetUserId(messageData.room, messageData.senderId);
                if (targetUserId) {
                    const notificationSent = await pushNotificationService.sendMessageNotification(
                        targetUserId,
                        messageData.senderName,
                        messageData.content,
                        messageData.room,
                        messageData.senderId
                    );
                    if (notificationSent) {
                    } else {
                    }
                } else {
                }
            } catch (pushError) {
                console.error('❌ Erreur notification push:', pushError.message);
                console.error('❌ Stack trace:', pushError.stack);
            }
        } else {
        }
        
        res.status(201).json(savedMessage);
    } catch (error) {
        console.error('❌ ERREUR DÉTAILLÉE sauvegarde message:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== ROUTES PROPOSITIONS/OFFRES ==========

// Lier une annonce à une conversation (premier contact)
app.post('/api/conversations/link-announcement', async (req, res) => {
    try {
        const { roomId, announcementId, buyerId, sellerId, initialMessageId } = req.body;
        
        if (!roomId || !announcementId || !buyerId || !sellerId) {
            return res.status(400).json({ 
                error: 'roomId, announcementId, buyerId et sellerId sont requis' 
            });
        }

        const link = await offerService.linkAnnouncementToConversation({
            roomId,
            announcementId,
            buyerId,
            sellerId,
            initialMessageId
        });

        res.status(201).json(link);
    } catch (error) {
        console.error('❌ Erreur liaison annonce-conversation:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer les conversations d'un utilisateur
app.get('/api/conversations/user/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
        const conversations = await offerService.getUserConversations(userId);
        
        res.json(conversations);
    } catch (error) {
        console.error('❌ Erreur récupération conversations utilisateur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer l'annonce liée à une conversation
app.get('/api/conversations/:roomId/announcement', async (req, res) => {
    try {
        const announcement = await offerService.getConversationAnnouncement(req.params.roomId);
        
        if (!announcement) {
            return res.status(404).json({ error: 'Aucune annonce liée à cette conversation' });
        }

        res.json(announcement);
    } catch (error) {
        console.error('❌ Erreur récupération annonce conversation:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Supprimer une conversation pour une annonce spécifique
app.delete('/api/conversations/delete-for-announcement', async (req, res) => {
    try {
        const { announcementId, buyerId, sellerId } = req.body;
        
        if (!announcementId || !buyerId || !sellerId) {
            return res.status(400).json({ 
                error: 'Paramètres manquants: announcementId, buyerId, sellerId requis' 
            });
        }
        
        
        // Supprimer la conversation via OfferService
        const result = await offerService.deleteConversationForAnnouncement(announcementId, buyerId, sellerId);
        
        if (result.success) {
            res.json({ 
                success: true, 
                message: 'Conversation supprimée avec succès',
                deletedCount: result.deletedCount 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: result.error || 'Erreur lors de la suppression de la conversation' 
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur suppression conversation:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erreur serveur lors de la suppression de la conversation' 
        });
    }
});

// Créer une nouvelle proposition
app.post('/api/offers', async (req, res) => {
    try {
        const offerData = req.body;

        // Validation des données
        const required = ['announcementId', 'buyerId', 'buyerName', 'sellerId', 'sellerName', 
                         'roomId', 'originalPrice', 'proposedPrice'];
        const missing = required.filter(field => !offerData[field]);
        
        if (missing.length > 0) {
            return res.status(400).json({ 
                error: `Champs manquants: ${missing.join(', ')}` 
            });
        }

        const savedOffer = await offerService.createOffer(offerData);
        
        // Vérifier si c'est une erreur de proposition dupliquée
        if (savedOffer.error && savedOffer.code === 'DUPLICATE_OFFER') {
            return res.status(409).json({
                error: savedOffer.error,
                code: savedOffer.code
            });
        }
        

        // Notifier via WebSocket
        broadcastNotification({
            type: 'new_offer',
            offer: savedOffer,
            targetUserId: offerData.sellerId
        });

        res.status(201).json(savedOffer);
    } catch (error) {
        console.error('❌ Erreur création proposition:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer une proposition par ID
app.get('/api/offers/:id', async (req, res) => {
    try {
        const offer = await offerService.getOfferById(req.params.id);
        
        if (!offer) {
            return res.status(404).json({ error: 'Proposition non trouvée' });
        }

        res.json(offer);
    } catch (error) {
        console.error('❌ Erreur récupération proposition:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer toutes les propositions d'une conversation
app.get('/api/offers/room/:roomId', async (req, res) => {
    try {
        const offers = await offerService.getOffersByRoom(req.params.roomId);
        res.json(offers);
    } catch (error) {
        console.error('❌ Erreur récupération propositions conversation:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer les propositions d'un utilisateur
app.get('/api/offers/user/:userId', async (req, res) => {
    try {
        const { role = 'all' } = req.query; // 'buyer', 'seller', or 'all'
        const offers = await offerService.getOffersByUser(req.params.userId, role);
        res.json(offers);
    } catch (error) {
        console.error('❌ Erreur récupération propositions utilisateur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Accepter une proposition (sans signature, juste changer le statut)
app.post('/api/offers/:id/accept', async (req, res) => {
    try {
        const { actorId, actorName } = req.body;
        
        if (!actorId || !actorName) {
            return res.status(400).json({ 
                error: 'actorId et actorName sont requis' 
            });
        }

        const offer = await offerService.acceptOffer(req.params.id, actorId, actorName);

        // Notifier via WebSocket
        broadcastNotification({
            type: 'offer_accepted',
            offer: offer
        });

        res.json(offer);
    } catch (error) {
        console.error('❌ Erreur acceptation proposition:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Demander l'envoi d'un email de vérification pour signature
app.post('/api/offers/:id/request-signature-verification', async (req, res) => {
    try {
        const { actorId, actorName, actorEmail, signatureType } = req.body;
        
        if (!actorId || !actorName || !actorEmail || !signatureType) {
            return res.status(400).json({ 
                error: 'actorId, actorName, actorEmail et signatureType sont requis' 
            });
        }

        // Récupérer l'offre
        const offer = await offerService.getOfferById(req.params.id);
        if (!offer) {
            return res.status(404).json({ error: 'Proposition non trouvée' });
        }

        // Vérifier que l'offre est acceptée
        if (offer.status !== 'accepted') {
            return res.status(400).json({ error: 'La proposition doit être acceptée avant de pouvoir être signée' });
        }

        // Vérifier que l'utilisateur peut signer (acheteur ou vendeur)
        const isBuyer = offer.buyer_id === actorId;
        const isSeller = offer.seller_id === actorId;
        
        if (!isBuyer && !isSeller) {
            return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à signer cette proposition' });
        }

        // Vérifier le type de signature
        const expectedSignatureType = isBuyer ? 'buyer' : 'seller';
        if (signatureType !== expectedSignatureType) {
            return res.status(400).json({ error: `Type de signature incorrect. Attendu: ${expectedSignatureType}` });
        }

        // Vérifier si une signature existe déjà
        const existingSignature = await offerService.getSignatureByOfferAndUser(req.params.id, actorId);
        
        let signatureId;
        if (existingSignature) {
            // Si la signature existe déjà et est vérifiée, retourner une erreur
            if (existingSignature.email_verified === 1) {
                return res.status(400).json({ error: 'Vous avez déjà signé cette proposition' });
            }
            signatureId = existingSignature.id;
        } else {
            // Créer une entrée de signature en attente
            const signature = await offerService.addSignature({
                offerId: req.params.id,
                userId: actorId,
                userName: actorName,
                userEmail: actorEmail,
                signatureType: signatureType,
                emailVerified: 0
            });
            signatureId = signature.id;
        }

        // Générer un token de vérification
        const verificationToken = emailService.generateVerificationToken();
        
        // Mettre à jour la signature avec le token
        await offerService.updateSignatureVerificationToken(signatureId, verificationToken);
        
        // Envoyer l'email de vérification
        const emailSent = await emailService.sendSignatureVerificationEmail(
            actorEmail,
            actorName,
            req.params.id,
            verificationToken
        );
        
        if (!emailSent) {
            return res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email de vérification' });
        }


        res.json({ 
            success: true,
            message: 'Email de vérification envoyé. Veuillez vérifier votre boîte mail.'
        });
    } catch (error) {
        console.error('❌ Erreur demande vérification email:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Récupérer l'état de la signature pour un utilisateur
app.get('/api/offers/:id/signature-status', async (req, res) => {
    try {
        const { userId } = req.query;
        const offerId = req.params.id;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId est requis' });
        }

        // Récupérer la signature de l'utilisateur actuel
        const signature = await offerService.getSignatureByOfferAndUser(offerId, userId);
        
        // Récupérer toutes les signatures pour vérifier si les deux sont complètes
        const allSignatures = await offerService.getSignaturesByOfferId(offerId);
        const verifiedSignatures = allSignatures.filter(s => s.email_verified === 1 && s.signature_timestamp);
        const hasBuyerSignature = verifiedSignatures.some(s => s.signature_type === 'buyer');
        const hasSellerSignature = verifiedSignatures.some(s => s.signature_type === 'seller');
        const allSignaturesComplete = hasBuyerSignature && hasSellerSignature;
        
        if (!signature) {
            return res.json({ 
                exists: false,
                emailVerified: false,
                signed: false,
                allSignaturesComplete: allSignaturesComplete
            });
        }

        res.json({ 
            exists: true,
            emailVerified: signature.email_verified === 1,
            signed: signature.signature_timestamp != null,
            signatureType: signature.signature_type,
            userEmail: signature.user_email,
            signatureTimestamp: signature.signature_timestamp,
            allSignaturesComplete: allSignaturesComplete,
            hasBuyerSignature: hasBuyerSignature,
            hasSellerSignature: hasSellerSignature
        });
    } catch (error) {
        console.error('❌ Erreur récupération état signature:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Vérifier le token d'email pour signature
app.get('/api/offers/:id/verify-signature-email', async (req, res) => {
    try {
        const { token } = req.query;
        const offerId = req.params.id;
        
        if (!token) {
            return res.status(400).send(`
                <html>
                <head><title>Erreur de vérification</title></head>
                <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
                    <h1>❌ Token manquant</h1>
                    <p>Le lien de vérification est invalide. Veuillez réessayer.</p>
                </body>
                </html>
            `);
        }

        // Récupérer la signature avec ce token
        const signatures = await offerService.getSignaturesByOfferId(offerId);
        const signature = signatures.find(s => s.email_verification_token === token && s.email_verified === 0);
        
        if (!signature) {
            return res.status(400).send(`
                <html>
                <head><title>Erreur de vérification</title></head>
                <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
                    <h1>❌ Token invalide ou expiré</h1>
                    <p>Ce lien de vérification n'est plus valide. Veuillez demander un nouveau lien.</p>
                </body>
                </html>
            `);
        }

        // Vérifier l'email
        await offerService.verifySignatureEmail(offerId, signature.user_id, token);


        // Rediriger vers le deep link Android qui ouvrira l'application
        // Si l'app n'est pas installée, afficher une page de succès
        const deepLink = `parcelleplus://verify-signature-email?token=${token}&offerId=${offerId}`;
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Vérification réussie</title>
                <script>
                    // Essayer d'ouvrir l'app Android
                    window.location.href = "${deepLink}";
                    
                    // Si après 2 secondes on est toujours là, afficher la page de succès
                    setTimeout(function() {
                        document.getElementById('redirect-message').style.display = 'block';
                    }, 2000);
                </script>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        padding: 20px;
                        text-align: center;
                        background: linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%);
                        color: white;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0;
                    }
                    .container {
                        background: white;
                        color: #333;
                        padding: 40px;
                        border-radius: 10px;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                        max-width: 500px;
                    }
                    h1 { color: #4CAF50; margin-top: 0; }
                    #redirect-message { display: none; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>✅ Email vérifié avec succès</h1>
                    <p>Votre adresse email a été vérifiée. Vous pouvez maintenant signer la proposition.</p>
                    <div id="redirect-message">
                        <p>Si l'application ParcellePlus ne s'ouvre pas automatiquement, ouvrez-la manuellement.</p>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('❌ Erreur vérification email:', error);
        res.status(500).send(`
            <html>
            <head><title>Erreur serveur</title></head>
            <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
                <h1>❌ Erreur serveur</h1>
                <p>${error.message || 'Une erreur est survenue lors de la vérification.'}</p>
            </body>
            </html>
        `);
    }
});

// Ajouter une signature électronique à une offre acceptée (après vérification email)
app.post('/api/offers/:id/sign', async (req, res) => {
    try {
        const { actorId, actorName, actorEmail, signatureType, prenom, nom, dateNaissance, adresse } = req.body;
        
        if (!actorId || !actorName || !actorEmail || !signatureType) {
            return res.status(400).json({ 
                error: 'actorId, actorName, actorEmail et signatureType sont requis' 
            });
        }
        
        if (!prenom || !nom || !dateNaissance || !adresse) {
            return res.status(400).json({ 
                error: 'prenom, nom, dateNaissance et adresse sont requis' 
            });
        }

        // Récupérer l'offre
        const offer = await offerService.getOfferById(req.params.id);
        if (!offer) {
            return res.status(404).json({ error: 'Proposition non trouvée' });
        }

        // Vérifier que l'offre est acceptée
        if (offer.status !== 'accepted') {
            return res.status(400).json({ error: 'La proposition doit être acceptée avant de pouvoir être signée' });
        }

        // Vérifier que l'utilisateur peut signer (acheteur ou vendeur)
        const isBuyer = offer.buyer_id === actorId;
        const isSeller = offer.seller_id === actorId;
        
        if (!isBuyer && !isSeller) {
            return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à signer cette proposition' });
        }

        // Vérifier le type de signature
        const expectedSignatureType = isBuyer ? 'buyer' : 'seller';
        if (signatureType !== expectedSignatureType) {
            return res.status(400).json({ error: `Type de signature incorrect. Attendu: ${expectedSignatureType}` });
        }

        // Vérifier si la signature existe déjà
        const existingSignature = await offerService.getSignatureByOfferAndUser(req.params.id, actorId);
        if (!existingSignature) {
            return res.status(400).json({ error: 'Veuillez d\'abord demander la vérification email' });
        }

        // Vérifier que l'email a été vérifié
        if (existingSignature.email_verified !== 1) {
            return res.status(400).json({ error: 'Veuillez d\'abord vérifier votre email en cliquant sur le lien reçu' });
        }

        // Vérifier si la signature est déjà finalisée
        if (existingSignature.signature_timestamp) {
            return res.status(400).json({ error: 'Vous avez déjà signé cette proposition' });
        }

        // Finaliser la signature (mettre à jour le timestamp et les informations personnelles)
        await offerService.finalizeSignature(req.params.id, actorId, prenom, nom, dateNaissance, adresse);

        // Récupérer toutes les signatures (uniquement celles vérifiées et finalisées)
        const signatures = await offerService.getSignaturesByOfferId(req.params.id);
        const verifiedSignatures = signatures.filter(s => s.email_verified === 1 && s.signature_timestamp);
        const hasBuyerSignature = verifiedSignatures.some(s => s.signature_type === 'buyer');
        const hasSellerSignature = verifiedSignatures.some(s => s.signature_type === 'seller');

        let pdfPath = null;
        // Si les deux signatures sont présentes, générer le PDF
        if (hasBuyerSignature && hasSellerSignature) {
            // Récupérer l'annonce
            const announcement = await polygonService.getPolygonById(offer.announcement_id);
            
            if (announcement) {
                // Générer le PDF avec les signatures vérifiées
                try {
                    pdfPath = await pdfService.generateContractPDF(offer, announcement, verifiedSignatures);
                    
                    // Mettre à jour les signatures avec le chemin du PDF
                    await offerService.updateSignaturePdfPath(req.params.id, pdfPath);
                    
                } catch (pdfError) {
                    console.error('❌ Erreur génération PDF:', pdfError);
                    // Ne pas bloquer la signature si le PDF échoue
                }
            }
        }


        res.json({ 
            signatureAdded: true,
            pdfGenerated: pdfPath !== null,
            pdfPath: pdfPath,
            allSignaturesComplete: hasBuyerSignature && hasSellerSignature
        });
    } catch (error) {
        console.error('❌ Erreur ajout signature:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Télécharger le PDF d'un contrat signé
app.get('/api/offers/:id/pdf', async (req, res) => {
    try {
        const offerId = req.params.id;
        
        // Récupérer les signatures
        const signatures = await offerService.getSignaturesByOfferId(offerId);
        if (!signatures || signatures.length === 0) {
            return res.status(404).json({ error: 'Aucune signature trouvée pour cette proposition' });
        }
        
        // Récupérer le chemin du PDF
        const pdfPath = signatures[0].pdf_path;
        if (!pdfPath || !fs.existsSync(pdfPath)) {
            return res.status(404).json({ error: 'PDF non trouvé. L\'accord de principe n\'a peut-être pas encore été finalisé.' });
        }
        
        // Envoyer le PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="accord_principe_${offerId}.pdf"`);
        res.sendFile(path.resolve(pdfPath));
    } catch (error) {
        console.error('❌ Erreur téléchargement PDF:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Refuser une proposition
app.post('/api/offers/:id/reject', async (req, res) => {
    try {
        const { actorId, actorName, reason } = req.body;
        
        if (!actorId || !actorName) {
            return res.status(400).json({ 
                error: 'actorId et actorName sont requis' 
            });
        }

        const offer = await offerService.rejectOffer(req.params.id, actorId, actorName, reason);

        // Notifier via WebSocket
        broadcastNotification({
            type: 'offer_rejected',
            offer: offer
        });

        res.json(offer);
    } catch (error) {
        console.error('❌ Erreur refus proposition:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Créer une contre-proposition
app.post('/api/offers/:id/counter', async (req, res) => {
    try {
        const counterOfferData = req.body;

        const counterOffer = await offerService.createCounterOffer(req.params.id, counterOfferData);

        // Notifier via WebSocket
        broadcastNotification({
            type: 'counter_offer',
            offer: counterOffer
        });

        res.status(201).json(counterOffer);
    } catch (error) {
        console.error('❌ Erreur création contre-proposition:', error);
        res.status(500).json({ error: error.message || 'Erreur serveur' });
    }
});

// Récupérer l'historique d'une proposition
app.get('/api/offers/:id/history', async (req, res) => {
    try {
        const history = await offerService.getOfferHistory(req.params.id);
        res.json(history);
    } catch (error) {
        console.error('❌ Erreur récupération historique proposition:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer les statistiques des propositions d'un utilisateur
app.get('/api/offers/stats/:userId', async (req, res) => {
    try {
        const stats = await offerService.getOfferStats(req.params.userId);
        res.json(stats);
    } catch (error) {
        console.error('❌ Erreur récupération statistiques propositions:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========== ROUTES ROOMS/CONVERSATIONS ==========

// Récupérer toutes les rooms
app.get('/api/rooms', async (req, res) => {
    try {
        const rooms = await messageService.getAllRooms();
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
        const savedRoom = await messageService.createRoom(roomData);
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
        
        const success = await messageService.deleteRoom(roomId);
        if (success) {
            res.status(204).send(); // No content
        } else {
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
        
        // Envoyer l'email de confirmation (NON BLOQUANT - l'inscription réussit même si l'email échoue)
        let emailSent = false;
        try {
            emailSent = await emailService.sendVerificationEmail(
                newUser.email,
                newUser.username,
                newUser.emailVerificationToken
            );
            
            if (emailSent) {
            } else {
            }
        } catch (emailError) {
            console.error(`⚠️ Erreur envoi email de confirmation: ${emailError.message}`);
            // L'inscription continue même si l'email échoue
        }
        
        // Retourner les données sans le token
        const { emailVerificationToken, ...userWithoutToken } = newUser;
        
        res.status(201).json({
            message: emailSent 
                ? 'Utilisateur créé avec succès. Un email de confirmation a été envoyé.'
                : 'Utilisateur créé avec succès. (Email de confirmation non envoyé - SMTP non configuré)',
            user: userWithoutToken,
            emailSent: emailSent
        });
        
    } catch (error) {
        console.error('❌ Erreur inscription:', error.message);
        res.status(400).json({ 
            error: error.message || 'Erreur lors de l\'inscription'
        });
    }
});

// Vérification de l'email
app.get('/api/auth/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        
        if (!token) {
            return res.status(400).json({ error: 'Token de vérification requis' });
        }
        
        const verifiedUser = await userService.verifyEmail(token);
        
        res.status(200).json({
            message: 'Email vérifié avec succès',
            user: verifiedUser
        });
        
    } catch (error) {
        console.error('❌ Erreur vérification email:', error.message);
        res.status(400).json({ 
            error: error.message || 'Erreur lors de la vérification de l\'email'
        });
    }
});

// Renvoyer l'email de confirmation
app.post('/api/auth/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email requis' });
        }
        
        const result = await userService.resendVerificationEmail(email);
        
        // Envoyer l'email (BLOQUANT)
        const emailSent = await emailService.sendVerificationEmail(
            result.user.email,
            result.user.username,
            result.emailVerificationToken
        );
        
        if (!emailSent) {
            throw new Error('Impossible d\'envoyer l\'email de confirmation. Veuillez vérifier la configuration SMTP.');
        }
        
        
        res.status(200).json({
            message: 'Email de confirmation renvoyé',
            emailSent: true
        });
        
    } catch (error) {
        console.error('❌ Erreur renvoi email:', error.message);
        res.status(400).json({ 
            error: error.message || 'Erreur lors du renvoi de l\'email'
        });
    }
});

// Demander une réinitialisation de mot de passe
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email requis' });
        }
        
        const result = await userService.requestPasswordReset(email);
        
        // Si l'utilisateur existe, envoyer l'email (BLOQUANT)
        if (result.resetToken) {
            const emailSent = await emailService.sendPasswordResetEmail(
                result.user.email,
                result.user.username,
                result.resetToken
            );
            
            if (!emailSent) {
                throw new Error('Impossible d\'envoyer l\'email de réinitialisation. Veuillez vérifier la configuration SMTP.');
            }
            
        }
        
        // Toujours retourner le même message pour des raisons de sécurité
        res.status(200).json({
            message: 'Si cet email existe, un lien de réinitialisation a été envoyé.'
        });
        
    } catch (error) {
        console.error('❌ Erreur demande réinitialisation:', error.message);
        res.status(400).json({ 
            error: error.message || 'Erreur lors de la demande de réinitialisation'
        });
    }
});

// Route GET pour rediriger vers le deep link Android lors du clic sur le lien dans l'email
app.get('/api/auth/reset-password', async (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.status(400).send('Token de réinitialisation manquant.');
    }
    // Rediriger vers le deep link de l'application Android
    // L'application Android est configurée pour gérer ce schéma
    res.redirect(`parcelleplus://reset-password?token=${token}`);
});

// Réinitialiser le mot de passe avec un token
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token et nouveau mot de passe requis' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
        }
        
        const user = await userService.resetPassword(token, newPassword);
        
        res.status(200).json({
            message: 'Mot de passe réinitialisé avec succès',
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur réinitialisation mot de passe:', error.message);
        res.status(400).json({ 
            error: error.message || 'Erreur lors de la réinitialisation du mot de passe'
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

// Modification de l'email utilisateur
app.post('/api/users/:userId/update-email', async (req, res) => {
    try {
        const { userId } = req.params;
        const { newEmail, password } = req.body;
        
        
        // Validation des paramètres
        if (!newEmail || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email et mot de passe requis'
            });
        }
        
        // Appeler le service pour mettre à jour l'email
        const result = await userService.updateUserEmail(userId, newEmail, password);
        
        res.json({
            success: true,
            message: 'Email modifié avec succès',
            data: {
                userId: result.userId,
                newEmail: result.newEmail
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur modification email:', error.message);
        
        // Codes d'erreur spécifiques
        if (error.message === 'Utilisateur introuvable') {
            return res.status(404).json({ success: false, message: error.message });
        } else if (error.message === 'Mot de passe incorrect') {
            return res.status(401).json({ success: false, message: error.message });
        } else if (error.message.includes('déjà utilisé')) {
            return res.status(409).json({ success: false, message: error.message });
        } else if (error.message.includes('Format')) {
            return res.status(400).json({ success: false, message: error.message });
        } else {
            return res.status(500).json({ 
                success: false, 
                message: `Erreur serveur: ${error.message}` 
            });
        }
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

// Enregistrer le token FCM d'un utilisateur
app.post('/api/fcm/register-token', async (req, res) => {
    try {
        const { userId, fcmToken } = req.body;
        
        if (!userId || !fcmToken) {
            return res.status(400).json({ 
                error: 'userId et fcmToken requis' 
            });
        }
        
        // Valider le format du token FCM
        if (fcmToken.length < 50 || fcmToken.includes('HEADER_FID') || fcmToken.includes('ADMIN_UUID')) {
            console.error(`❌ Token FCM invalide détecté pour utilisateur: ${userId}`);
            return res.status(400).json({
                success: false,
                error: 'Token FCM invalide',
                message: 'Le token FCM fourni n\'est pas valide'
            });
        }
        
        // Enregistrer le token dans la base de données
        try {
            const registered = await pushNotificationService.registerUserFCMToken(userId, fcmToken);
            
            if (registered === true) {
                res.json({ 
                    success: true,
                    message: 'Token FCM enregistré avec succès',
                    userId: userId
                });
            } else {
                console.error(`⚠️ Échec enregistrement token FCM pour ${userId}`);
                res.json({ 
                    success: false,
                    message: 'Échec enregistrement token FCM',
                    userId: userId
                });
            }
        } catch (dbError) {
            console.error('❌ Erreur base de données lors de l\'enregistrement token FCM:', dbError.message);
            // On retourne quand même un 200 pour éviter que l'app réessaie en boucle
            res.json({ 
                success: false,
                message: 'Erreur base de données',
                error: dbError.message,
                errorCode: dbError.code,
                userId: userId
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur enregistrement token FCM:', error.message);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ 
            success: false,
            error: 'Erreur serveur',
            message: error.message
        });
    }
});

// Envoyer une notification FCM
app.post('/api/fcm/send-notification', async (req, res) => {
    try {
        const { userId, title, body, data = {} } = req.body;
        
        if (!userId || !title || !body) {
            return res.status(400).json({ 
                success: false,
                error: 'userId, title et body requis' 
            });
        }
        
        
        // Utiliser le service de notifications push existant
        const success = await pushNotificationService.sendCustomNotification(userId, title, body, data);
        
        if (success) {
            res.json({ 
                success: true,
                message: 'Notification envoyée avec succès',
                userId: userId
            });
        } else {
            res.status(500).json({ 
                success: false,
                error: 'Échec envoi notification' 
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur envoi notification FCM:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Erreur serveur' 
        });
    }
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

// Route DVF avec DPE et Annexes (pour estimation enrichie)
const dvfWithFeaturesRoute = require('./routes/dvfWithFeaturesRoute');
const renovationsRoute = require('./routes/renovationsRoute');
// Route pour vérifier si un username est disponible (pour OAuth)
app.get('/api/auth/oauth/check-username', async (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username) {
            return res.status(400).json({ error: 'Username requis' });
        }
        
        const isAvailable = await userService.isUsernameAvailable(username);
        
        res.json({
            available: isAvailable,
            message: isAvailable ? 'Username disponible' : 'Username déjà pris'
        });
        
    } catch (error) {
        console.error('❌ Erreur vérification username:', error.message);
        res.status(500).json({ 
            error: 'Erreur lors de la vérification du username'
        });
    }
});

// Route pour l'authentification OAuth Google
app.post('/api/auth/oauth/google', async (req, res) => {
    try {
        const { googleId, email, fullName, username, userType } = req.body;
        
        if (!googleId || !email) {
            return res.status(400).json({ 
                error: 'googleId et email requis' 
            });
        }
        
        // Créer le providerId au format "google_<googleId>"
        const providerId = `google_${googleId}`;
        
        // Vérifier d'abord si l'utilisateur existe déjà par EMAIL (priorité)
        // L'email est l'identifiant unique qui reste constant même si le provider change
        // On vérifie directement dans la base de données
        const emailCheck = userService.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        let existingUser = null;
        
        if (emailCheck) {
            // Utilisateur existe par email, récupérer ses informations
            existingUser = userService.getUserById(emailCheck.id);
        } else {
            // Si pas trouvé par email, vérifier par providerId (fallback)
            existingUser = userService.getUserById(providerId);
        }
        
        if (!existingUser && !username) {
            // Utilisateur n'existe pas et pas de username fourni
            return res.status(400).json({ 
                error: 'Username requis pour créer un compte' 
            });
        }
        
        // Enregistrer ou récupérer l'utilisateur
        // Si l'utilisateur existe déjà, username peut être vide (sera ignoré)
        const result = await userService.registerOrGetOAuthUser({
            providerId,
            email,
            fullName,
            username: username || '', // Permettre username vide si utilisateur existe
            userType: userType || 'buyer'
        });
        
        res.json({
            message: result.isNewUser ? 'Compte créé avec succès' : 'Connexion réussie',
            user: result.user,
            token: result.session.token,
            expiresAt: result.session.expiresAt,
            isNewUser: result.isNewUser
        });
        
    } catch (error) {
        console.error('❌ Erreur authentification Google:', error.message);
        res.status(400).json({ 
            error: error.message || 'Erreur lors de l\'authentification Google'
        });
    }
});

// Route pour l'authentification OAuth LinkedIn
app.post('/api/auth/oauth/linkedin', async (req, res) => {
    try {
        const { linkedinId, email, fullName, username, userType } = req.body;
        
        if (!linkedinId || !email) {
            return res.status(400).json({ 
                error: 'linkedinId et email requis' 
            });
        }
        
        // Créer le providerId au format "linkedin_<linkedinId>"
        const providerId = `linkedin_${linkedinId}`;
        
        // Vérifier d'abord si l'utilisateur existe déjà par EMAIL (priorité)
        // L'email est l'identifiant unique qui reste constant même si le provider change
        // On vérifie directement dans la base de données
        const emailCheck = userService.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        let existingUser = null;
        
        if (emailCheck) {
            // Utilisateur existe par email, récupérer ses informations
            existingUser = userService.getUserById(emailCheck.id);
        } else {
            // Si pas trouvé par email, vérifier par providerId (fallback)
            existingUser = userService.getUserById(providerId);
        }
        
        if (!existingUser && !username) {
            // Utilisateur n'existe pas et pas de username fourni
            return res.status(400).json({ 
                error: 'Username requis pour créer un compte' 
            });
        }
        
        // Enregistrer ou récupérer l'utilisateur
        // Si l'utilisateur existe déjà, username peut être vide (sera ignoré)
        const result = await userService.registerOrGetOAuthUser({
            providerId,
            email,
            fullName,
            username: username || '', // Permettre username vide si utilisateur existe
            userType: userType || 'buyer'
        });
        
        res.json({
            message: result.isNewUser ? 'Compte créé avec succès' : 'Connexion réussie',
            user: result.user,
            token: result.session.token,
            expiresAt: result.session.expiresAt,
            isNewUser: result.isNewUser
        });
        
    } catch (error) {
        console.error('❌ Erreur authentification LinkedIn:', error.message);
        res.status(400).json({ 
            error: error.message || 'Erreur lors de l\'authentification LinkedIn'
        });
    }
});

// Route pour le callback LinkedIn OAuth (redirige vers le deep link Android)
app.get('/api/auth/linkedin/callback', (req, res) => {
    try {
        const { code, state, error, error_description } = req.query;
        
        if (error) {
            // En cas d'erreur, rediriger vers l'app avec l'erreur
            const errorUri = `parcelleplus://oauth/linkedin/callback?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || error)}`;
            return res.redirect(errorUri);
        }
        
        if (!code) {
            return res.status(400).send('Code d\'autorisation manquant');
        }
        
        // Rediriger vers le deep link Android avec le code et le state
        const redirectUri = `parcelleplus://oauth/linkedin/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
        res.redirect(redirectUri);
    } catch (error) {
        console.error('❌ Erreur callback LinkedIn:', error.message);
        res.status(500).send('Erreur lors du traitement du callback LinkedIn');
    }
});

app.get('/api/dvf/search-with-features', dvfWithFeaturesRoute);
app.get('/api/renovations/search', renovationsRoute);

const saferRoute = require('./routes/saferRoute');
app.get('/api/safer/prix', saferRoute);

// Route Terrains à Bâtir (PC issue de PA)
const terrainsBatirRoute = require('./routes/terrainsBatirRoute');
app.get('/api/terrains-batir/search', terrainsBatirRoute);

// ========== ROUTE REI (TAXE FONCIERE) ==========

// Télécharger la base SQLite REI optimisée pour le calcul de taxe foncière
app.get('/api/rei/download', async (req, res) => {
    try {
        const reiDbPath = path.join(__dirname, 'database', 'rei.db');
        
        // Vérifier que le fichier existe
        if (!fs.existsSync(reiDbPath)) {
            console.warn(`⚠️ Base REI non trouvée: ${reiDbPath}`);
            return res.status(404).json({ 
                error: 'Base REI non disponible',
                message: 'Aucune base REI trouvée. Exécutez: node scripts/create-rei-database.js'
            });
        }
        
        // Obtenir les stats du fichier
        const stats = fs.statSync(reiDbPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`📥 Téléchargement base REI: ${fileSizeMB} MB`);
        
        // Définir les headers pour le téléchargement
        res.setHeader('Content-Type', 'application/x-sqlite3');
        res.setHeader('Content-Disposition', 'attachment; filename="rei.db"');
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache 1 heure
        
        // Envoyer le fichier
        res.sendFile(path.resolve(reiDbPath));
        
    } catch (error) {
        console.error('❌ Erreur téléchargement base REI:', error);
        res.status(500).json({ 
            error: 'Erreur serveur',
            message: error.message 
        });
    }
});

// Obtenir les informations sur la base REI (taille, date de mise à jour, etc.)
app.get('/api/rei/info', async (req, res) => {
    try {
        const reiDbPath = path.join(__dirname, 'database', 'rei.db');
        
        if (!fs.existsSync(reiDbPath)) {
            return res.status(404).json({ 
                available: false,
                message: 'Aucune base REI trouvée. Exécutez: node scripts/create-rei-database.js'
            });
        }
        
        const stats = fs.statSync(reiDbPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        const lastModified = stats.mtime.toISOString();
        
        res.json({
            available: true,
            filename: 'rei.db',
            sizeMB: parseFloat(fileSizeMB),
            sizeBytes: stats.size,
            lastModified: lastModified,
            downloadUrl: '/api/rei/download'
        });
        
    } catch (error) {
        console.error('❌ Erreur récupération infos REI:', error);
        res.status(500).json({ 
            error: 'Erreur serveur',
            message: error.message 
        });
    }
});

// Obtenir les données REI pour une commune spécifique (code INSEE 5 chiffres)
// Retourne uniquement les données nécessaires pour le calcul de taxe foncière
app.get('/api/rei/commune/:codeCommune', async (req, res) => {
    try {
        const codeCommune = req.params.codeCommune;
        
        // Valider le format du code commune (5 chiffres)
        if (!/^\d{5}$/.test(codeCommune)) {
            return res.status(400).json({ 
                error: 'Code commune invalide',
                message: 'Le code commune doit être composé de 5 chiffres (format INSEE)'
            });
        }
        
        console.log(`🔍 Recherche données REI pour commune: ${codeCommune}`);
        
        // Utiliser la base REI unique
        const reiDbPath = path.join(__dirname, 'database', 'rei.db');
        
        if (!fs.existsSync(reiDbPath)) {
            return res.status(404).json({ 
                error: 'Base REI non disponible',
                message: 'Aucune base REI trouvée. Exécutez: node scripts/create-rei-database.js',
                codeCommune: codeCommune
            });
        }
        
        // Utiliser better-sqlite3 pour interroger la base (si disponible, sinon sqlite3)
        let donneesRei = null;
        try {
            const Database = require('better-sqlite3');
            const db = new Database(reiDbPath, { readonly: true });
            
            // Requête pour récupérer les données REI de la commune (utiliser noms de colonnes avec underscores)
            const stmt = db.prepare(`
                SELECT 
                    code_commune as codeCommune,
                    code_departement as codeDepartement,
                    code_commune_insee as codeCommuneInsee,
                    nom_commune as nomCommune,
                    base_nette_commune as baseNetteCommune,
                    taux_commune as tauxCommune,
                    montant_reel_commune as montantReelCommune,
                    base_nette_departement as baseNetteDepartement,
                    taux_departement as tauxDepartement,
                    montant_reel_departement as montantReelDepartement,
                    base_nette_tse as baseNetteTSE,
                    taux_tse as tauxTSE,
                    montant_reel_tse as montantReelTSE,
                    annee
                FROM rei_communes 
                WHERE code_commune = ? 
                ORDER BY annee DESC 
                LIMIT 1
            `);
            
            donneesRei = stmt.get(codeCommune);
            db.close();
            
        } catch (sqliteError) {
            // Fallback sur sqlite3 si better-sqlite3 échoue
            console.warn('⚠️ better-sqlite3 non disponible, utilisation de sqlite3');
            const sqlite3 = require('sqlite3').verbose();
            
            donneesRei = await new Promise((resolve, reject) => {
                const db = new sqlite3.Database(reiDbPath, sqlite3.OPEN_READONLY);
                
                db.get(`
                    SELECT 
                        code_commune as codeCommune,
                        code_departement as codeDepartement,
                        code_commune_insee as codeCommuneInsee,
                        nom_commune as nomCommune,
                        base_nette_commune as baseNetteCommune,
                        taux_commune as tauxCommune,
                        montant_reel_commune as montantReelCommune,
                        base_nette_departement as baseNetteDepartement,
                        taux_departement as tauxDepartement,
                        montant_reel_departement as montantReelDepartement,
                        base_nette_tse as baseNetteTSE,
                        taux_tse as tauxTSE,
                        montant_reel_tse as montantReelTSE,
                        annee
                    FROM rei_communes 
                    WHERE code_commune = ? 
                    ORDER BY annee DESC 
                    LIMIT 1
                `, [codeCommune], (err, row) => {
                    db.close();
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row);
                    }
                });
            });
        }
        
        if (!donneesRei) {
            console.log(`⚠️ Aucune donnée REI trouvée pour la commune ${codeCommune}`);
            return res.status(404).json({ 
                error: 'Commune non trouvée',
                message: `Aucune donnée REI disponible pour la commune ${codeCommune}`,
                codeCommune: codeCommune
            });
        }
        
        console.log(`✅ Données REI trouvées: ${donneesRei.nomCommune} (${donneesRei.codeDepartement}) - Année ${donneesRei.annee}`);
        
        // Retourner uniquement les données nécessaires (format JSON)
        res.json({
            codeCommune: donneesRei.codeCommune,
            codeDepartement: donneesRei.codeDepartement,
            codeCommuneInsee: donneesRei.codeCommuneInsee,
            nomCommune: donneesRei.nomCommune,
            annee: donneesRei.annee,
            baseNetteCommune: donneesRei.baseNetteCommune,
            tauxCommune: donneesRei.tauxCommune,
            montantReelCommune: donneesRei.montantReelCommune,
            baseNetteDepartement: donneesRei.baseNetteDepartement,
            tauxDepartement: donneesRei.tauxDepartement,
            montantReelDepartement: donneesRei.montantReelDepartement,
            baseNetteTSE: donneesRei.baseNetteTSE,
            tauxTSE: donneesRei.tauxTSE,
            montantReelTSE: donneesRei.montantReelTSE
        });
        
    } catch (error) {
        console.error('❌ Erreur récupération données REI:', error);
        res.status(500).json({ 
            error: 'Erreur serveur',
            message: error.message,
            codeCommune: req.params.codeCommune
        });
    }
});

// Gestion des erreurs
app.use((err, req, res, next) => {
    console.error('❌ Erreur serveur:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Démarrage du serveur
server.listen(PORT, '0.0.0.0', () => {
    
    // Nettoyage automatique des sessions expirées toutes les heures
    setInterval(() => {
        userService.cleanExpiredSessions().catch(err => {
            console.error('❌ Erreur nettoyage sessions:', err);
        });
    }, 60 * 60 * 1000); // 1 heure
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
    server.close(() => {
        // Fermer les connexions aux bases de données
        polygonService.close();
        messageService.close();
        userService.close();
        offerService.close();
        process.exit(0);
    });
});
module.exports = app; 
