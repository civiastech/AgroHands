#!/usr/bin/env bash
# First-time setup of a fresh Ubuntu 22.04/24.04 (or Debian 12) server, then the first deploy. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/civiastech/AgroHands/main/deploy/bootstrap.sh | bash
#
# Optional settings (put them before "bash", e.g. "... | DOMAIN=agrohands.ng bash"):
#   DOMAIN         your domain (its DNS A record must already point here). Default: <server-ip>.sslip.io,
#                  a free name that always resolves to this IP, so HTTPS works before you buy a domain.
#   ADMIN_PHONES   phone number(s) that become admin when they sign up
#   REPO, BRANCH   where to get the code (default: this GitHub repo, main)
#
# Safe to run again: it never overwrites an existing .env and only installs what is missing.
set -euo pipefail

REPO="${REPO:-https://github.com/civiastech/AgroHands.git}"
BRANCH="${BRANCH:-main}"
DIR=/opt/agrohands

say() { printf '\n\033[1;32m→ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root (or with sudo)."; exit 1; }
command -v apt-get >/dev/null || { echo "This script supports Ubuntu/Debian. See docs/DEPLOYMENT.md for other systems."; exit 1; }

say "System packages and security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl openssl ufw unattended-upgrades ca-certificates >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null

# Building the image runs the test suite; 1 GB servers need swap for that.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 1900000 ] && ! swapon --show | grep -q .; then
  say "Adding 2 GB swap (small server)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

say "Code in $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

# Writes KEY=VALUE into .env, replacing the line if it exists.
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

if [ -f .env ]; then
  say "Keeping the existing .env"
else
  say "Creating .env with fresh secrets"
  IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
  DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"
  cp .env.example .env
  chmod 600 .env
  set_env DOMAIN "$DOMAIN"
  set_env BASE_URL "https://$DOMAIN"
  set_env SESSION_SECRET "$(openssl rand -hex 32)"
  set_env METRICS_TOKEN "$(openssl rand -hex 24)"
  set_env USSD_KEY "$(openssl rand -hex 16)"
  set_env BACKUP_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_env ADMIN_PHONES "${ADMIN_PHONES:-}"
  set_env TRUST_PROXY true
  # SMS is required in production. Until you add your Africa's Talking keys, use the sandbox placeholder:
  # the site runs, but sign-up codes are not delivered (create the first admin with scripts/create-admin.js).
  set_env AT_USERNAME sandbox
  set_env AT_API_KEY replace-with-your-africas-talking-key
  set_env SMS_SENDER_ID ""
  set_env PAYSTACK_SECRET_KEY ""
fi

say "Building and starting (the test suite runs inside the build; this takes a few minutes the first time)"
./deploy/deploy.sh

DOMAIN_NOW="$(grep '^DOMAIN=' .env | cut -d= -f2)"
cat <<EOF

────────────────────────────────────────────────────────────────────────────
✔ AgroHands is running at https://${DOMAIN_NOW}
  (the HTTPS certificate is issued on the first visit; allow up to a minute)

Next:
 1. Create your admin account (prints a one-time PIN):
      cd $DIR && docker compose -f docker-compose.yml -f docker-compose.prod.yml \\
        exec app node scripts/create-admin.js 0803XXXXXXX "Your Name"

 2. SAVE THESE in your password manager now (they are in $DIR/.env):
      SESSION_SECRET          never change it after launch
      BACKUP_ENCRYPTION_KEY   without it, off-site backups cannot be restored

 3. Add your service keys to $DIR/.env (nano $DIR/.env), then run ./deploy/deploy.sh:
      AT_USERNAME, AT_API_KEY, SMS_SENDER_ID     sign-up codes and alerts (required for real users)
      BACKUP_S3_*                                encrypted off-site backups
      BACKUP_HEARTBEAT_URL, ALERT_WEBHOOK_URL    monitoring
      PAYSTACK_SECRET_KEY                        paid courses (optional)

 4. Point an uptime monitor at https://${DOMAIN_NOW}/readyz
────────────────────────────────────────────────────────────────────────────
EOF
