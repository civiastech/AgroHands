#!/bin/sh
# Nightly SQLite backup for a host (systemd) install. Cron: 0 2 * * * /opt/agrohands/deploy/backup.sh
# Docker installs don't need this: the "backup" service in docker-compose.prod.yml does it.
set -e
cd /opt/agrohands
exec node --env-file-if-exists=.env --disable-warning=ExperimentalWarning scripts/backup.js
