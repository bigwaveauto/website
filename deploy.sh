#!/bin/bash
# Deploy to DigitalOcean droplet
set -e

echo "🔨 Building locally..."
npx ng build

echo "📤 Pushing to GitHub..."
git push origin main

echo "🚀 Deploying to server..."
ssh root@104.236.238.131 "cd /var/www/bigwaveauto && git pull origin main && npm install --omit=dev && npx ng build && pm2 restart bigwaveauto"

echo "✅ Deployed! Test at http://104.236.238.131"
