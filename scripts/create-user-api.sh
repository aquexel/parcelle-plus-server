#!/bin/bash

# Script pour créer un utilisateur via l'API du serveur
# Alternative si les modules Node.js ne sont pas recompilés

if [ $# -lt 3 ]; then
    echo "❌ Usage: $0 <username> <email> <password> [userType]"
    echo "   Exemple: $0 admin admin@example.com password123 seller"
    exit 1
fi

USERNAME=$1
EMAIL=$2
PASSWORD=$3
USERTYPE=${4:-buyer}

echo "📝 Création de l'utilisateur via l'API..."
echo "   Username: $USERNAME"
echo "   Email: $EMAIL"
echo "   Type: $USERTYPE"
echo ""

RESPONSE=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$USERNAME\",
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\",
    \"fullName\": \"\",
    \"phone\": \"\",
    \"userType\": \"$USERTYPE\"
  }")

echo "$RESPONSE" | grep -q "error" && echo "❌ Erreur: $RESPONSE" || echo "✅ Utilisateur créé avec succès!"

