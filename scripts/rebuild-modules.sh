#!/bin/bash

# Script pour recompiler les modules natifs après mise à jour de Node.js

echo "🔧 Recompilation des modules natifs..."

cd /opt/parcelle-plus

# Recompiler better-sqlite3
echo "📦 Recompilation de better-sqlite3..."
npm rebuild better-sqlite3

# Vérifier si sqlite3 est installé et le recompiler aussi
if [ -d "node_modules/sqlite3" ]; then
    echo "📦 Recompilation de sqlite3..."
    npm rebuild sqlite3
fi

echo "✅ Recompilation terminée!"

