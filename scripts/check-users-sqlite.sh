#!/bin/bash

# Script pour vérifier les utilisateurs en utilisant sqlite3 en ligne de commande
# Ne nécessite pas de recompilation de modules Node.js

DB_PATH="/opt/parcelle-plus/database/parcelle_chat.db"

if [ ! -f "$DB_PATH" ]; then
    echo "❌ Base de données non trouvée: $DB_PATH"
    exit 1
fi

echo "📊 Liste des utilisateurs dans la base de données:"
echo ""

sqlite3 "$DB_PATH" <<EOF
.mode column
.headers on
SELECT 
    id,
    username,
    email,
    CASE WHEN is_active = 1 THEN 'Oui' ELSE 'Non' END as actif,
    CASE WHEN is_verified = 1 THEN 'Oui' ELSE 'Non' END as verifie,
    user_type as type
FROM users;
EOF

COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users;")

if [ "$COUNT" -eq 0 ]; then
    echo ""
    echo "⚠️ Aucun utilisateur trouvé dans la base de données"
    echo "💡 Pour créer un utilisateur, utilisez: node scripts/create-user.js <username> <email> <password>"
fi

