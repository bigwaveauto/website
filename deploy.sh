#!/bin/bash
# Deploy to DigitalOcean droplet
# Builds locally (avoids OOM on small droplet), rsyncs dist, restarts PM2.
set -e

SERVER=root@104.236.238.131
APP_DIR=/var/www/bigwaveauto

echo "🔨 Building locally..."
npx ng build

echo "📤 Pushing to GitHub..."
git push origin main

echo "🚀 Rsyncing dist to server..."
rsync -az --delete dist/MotorDeal/ $SERVER:$APP_DIR/dist/MotorDeal/

echo "🔄 Restarting server..."
ssh $SERVER "cd $APP_DIR && pm2 restart bigwaveauto --update-env"

echo "✅ Deployed! Test at https://bigwaveauto.com"
