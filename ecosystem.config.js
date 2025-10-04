// Configuration PM2 pour la production
module.exports = {
  apps: [{
    name: 'parcelle-plus',
    script: 'server.js',
    instances: 1, // Ou 'max' pour utiliser tous les CPU
    exec_mode: 'cluster',
    
    // Variables d'environnement
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // Gestion des logs
    log_file: '/var/log/pm2/parcelle-plus.log',
    out_file: '/var/log/pm2/parcelle-plus-out.log',
    error_file: '/var/log/pm2/parcelle-plus-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Redémarrage automatique
    watch: false, // Désactivé en production
    ignore_watch: ['node_modules', 'logs', 'database'],
    
    // Gestion mémoire
    max_memory_restart: '500M',
    
    // Redémarrage en cas d'erreur
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Autres options
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 8000
  }],

  deploy: {
    production: {
      user: 'parcelle',
      host: '149.202.33.164',
      ref: 'origin/main',
      repo: 'https://github.com/aquexel/parcelle-plus-server.git',
      path: '/opt/parcelle-plus',
      'pre-deploy-local': '',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};


