#!/bin/bash
set -e

echo "🚀 Step 1: Pulling latest changes from git..."
git pull

echo "🧹 Step 2: Pruning unused build cache to keep disk space free..."
docker builder prune -f

echo "⚡ Step 3: Building and launching production containers..."
# Enable BuildKit for faster builds & memory optimizations
export DOCKER_BUILDKIT=1
export NODE_OPTIONS="--max-old-space-size=512"

docker compose -f docker-compose.prod.yml build --no-cache

# Explicitly build and run using docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d --build

echo "🔄 Step 4: Restarting backend to reset its in-memory caches..."
# The rebuild above already replaces the backend container with a fresh process, which
# resets its in-memory caches (e.g. psgc.service.ts's PSGC location cache) as a side
# effect — this step is explicit/standalone on top of that so the cache can be reset on
# its own, without a full --no-cache rebuild, if a bad cache entry ever needs clearing
# quickly (e.g. a transient PSGC API failure got cached as a false "location not found").
docker compose -f docker-compose.prod.yml restart backend

echo "🧹 Step 5: Cleaning up temporary build images..."
docker image prune -f

echo "✅ Deployment successful! Active containers:"
docker compose -f docker-compose.prod.yml ps
