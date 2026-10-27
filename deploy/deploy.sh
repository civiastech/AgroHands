#!/bin/sh
# One-command production deploy / update on a Linux server with Docker.
#   First time:  git clone <repo> /opt/agrohands && cd /opt/agrohands && cp .env.example .env && nano .env
#   Every time:  ./deploy/deploy.sh
# Pulls the latest code, builds (tests run inside the build), backs up the database, then restarts with zero manual steps.
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Missing .env — copy .env.example and fill it in."; exit 1; }
grep -q '^SESSION_SECRET=.\{32,\}' .env || { echo "SESSION_SECRET in .env must be at least 32 characters."; exit 1; }

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

if [ -d .git ]; then git pull --ff-only; fi
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)
export GIT_SHA

# Backups are written by the container's "node" user (uid 1000).
mkdir -p backups
chown 1000:1000 backups 2>/dev/null || echo "Note: could not chown ./backups to uid 1000 — run this script with sudo if backups fail."

echo "→ Building ${GIT_SHA} (runs the test suite)…"
$COMPOSE build

echo "→ Pre-deploy backup…"
$COMPOSE run --rm --no-deps backup node --disable-warning=ExperimentalWarning scripts/backup.js

echo "→ Starting…"
$COMPOSE up -d --remove-orphans

echo "→ Waiting for the app to report ready…"
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$($COMPOSE ps -q app)")" = "healthy" ]; do
  i=$((i + 1)); [ $i -gt 30 ] && { echo "App did not become healthy:"; $COMPOSE logs --tail=50 app; exit 1; }
  sleep 2
done
docker image prune -f >/dev/null
echo "✔ Deployed ${GIT_SHA}"
