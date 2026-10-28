# Deploying AgroHands

Three ways to run it, from simplest to most production-ready:

| Mode | Command | Use for |
| --- | --- | --- |
| Node, local | `npm run dev` | Development |
| Docker, local | `docker compose up -d --build` | Trying the real container on a laptop |
| Docker, production | `./deploy/deploy.sh` | Live: HTTPS, backups, hardened containers |

## 1. Production with Docker (recommended)

### Server

Any Linux VM with 1 GB RAM. **Oracle Cloud Always Free** (Ampere A1, Ubuntu) costs ₦0; any Nigerian VPS at about ₦5,000–₦10,000/month also works.

```bash
# Ubuntu: install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
# Open the firewall for web traffic (Oracle also needs an ingress rule for 80/443 in the VCN security list)
sudo ufw allow 22,80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
```

### DNS

Point an **A record** for your domain (e.g. `agrohands.ng`, and `www`) at the server's public IP **before** the first start, so Caddy can get the certificate.

### Configure and start

```bash
sudo mkdir -p /opt/agrohands && sudo chown $USER /opt/agrohands
git clone <your-repo> /opt/agrohands && cd /opt/agrohands
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # or: openssl rand -hex 32
nano .env    # set DOMAIN, BASE_URL=https://DOMAIN, SESSION_SECRET, ADMIN_PHONES, USSD_KEY, AT_USERNAME, AT_API_KEY
./deploy/deploy.sh
```

`deploy.sh` does the following:

1. Checks `.env` exists and `SESSION_SECRET` is long enough.
2. Runs `git pull`.
3. Builds the image. **The test suite runs inside the build**, so a failing build never replaces a working app.
4. Backs up the database.
5. Starts or updates `app`, `caddy` and `backup`.
6. Waits until `/readyz` reports healthy, and prints the logs if it doesn't.

Then open `https://your-domain`, register with a phone listed in `ADMIN_PHONES` (you will get an SMS code), and you're admin.

### Payments (Paystack)

Paid courses (currently the ₦2,000 GAP course) are free until `PAYSTACK_SECRET_KEY` is set.

1. Create a Paystack business account and complete compliance (business documents, settlement bank).
2. Settings → API Keys & Webhooks: copy the **test** secret key into `PAYSTACK_SECRET_KEY`, and set the webhook URL to `https://your-domain/pay/webhook`.
3. Deploy, buy the course with a Paystack test card, and check Admin → Payments shows it as successful.
4. Switch to the **live** secret key when Paystack activates your account.

A payment only counts after the server confirms it with Paystack and the amount matches; the browser's word is never trusted. Card details never touch AgroHands. Inside the Play Store app the checkout is hidden: Google Play requires its own billing for digital goods bought in an app, so paid courses are sold on the website only.

### SMS (Africa's Talking)

Sign-up needs SMS: an account is only created after the person types the code texted to their phone. The app will not start in production without a working SMS provider.

1. Create an account at africastalking.com and, in the **sandbox** app, copy the API key. Set `AT_USERNAME=sandbox` and that key, deploy, and register: the code appears in the sandbox simulator.
2. Create the **live** app, top up the wallet, and request a **sender id** (e.g. `AgroHands`). Nigerian networks filter unregistered senders for numbers on Do-Not-Disturb, so this matters.
3. Set `AT_USERNAME` to the live username, `AT_API_KEY` to the live key and `SMS_SENDER_ID`, then redeploy.

Every message goes through the `sms_outbox` table first and is retried with backoff (30 s, 1 min, 2 min …, 5 tries). Permanent rejections (invalid number, Do-Not-Disturb) are not retried. Check delivery with:

```bash
$C exec app node -e "import('./src/db.js').then(({openDb,q})=>{openDb(process.env.DB_PATH);console.table(q.all('SELECT status, COUNT(*) n FROM sms_outbox GROUP BY status'))})"
```

`/metrics` also counts `sms_sent`, `sms_retry` and `sms_failed`.

### What's running

```
Internet ──443──▶ caddy (TLS, HTTP/3, gzip/zstd, blocks /metrics)
                    │ X-Forwarded-For = real client IP
                    ▼
                  app :3000 (not published to the host)
                    │
                  volume app-data → /data/agrohands.db (SQLite, WAL)
                    ▲
                  backup (VACUUM INTO every 24h → ./backups, keeps 14 days)
```

All containers have a read-only root filesystem, drop every Linux capability and run with `no-new-privileges`. The app runs as non-root and has a 512 MB memory cap. Logs rotate at 10 MB × 5.

### Everyday operations

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$C ps                                   # status + health
$C logs -f app                          # JSON logs; every line has reqId
$C logs app | grep '"level":"error"'    # errors only
$C exec app node scripts/migrate.js --status
$C restart app
./deploy/deploy.sh                      # ship an update
```

A user who sees "Server error. Reference: <id>" can send you that id. Search the logs for it to find the exact request.

### Backups and restore

Backups land in `/opt/agrohands/backups/agrohands-<timestamp>.db` every 24 hours (kept `BACKUP_KEEP_DAYS`, default 14).

**Off-site copy (do this before launch).** A backup on the same disk dies with the disk. Set the `BACKUP_S3_*` variables and every backup is also compressed, encrypted (AES-256-GCM) and uploaded to a bucket on another provider:

1. Create a bucket. Cloudflare R2 is simplest (10 GB free; endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`). Backblaze B2 and AWS S3 work the same way.
2. Create an API token with **object read & write on that bucket only**.
3. Add a lifecycle rule on the bucket: delete objects after 90 days.
4. `openssl rand -hex 32` → `BACKUP_ENCRYPTION_KEY`. **Save it in your password manager now.** Without it the off-site backups cannot be opened, by you or anyone else.
5. Fill in `.env`, then `$C up -d backup && $C logs -f backup` and look for `off-site backup uploaded`.

The backup service refuses to start if a bucket is set without an encryption key: personal data never leaves the server unencrypted.

**Heartbeat.** Create a free check at healthchecks.io (period 1 day, grace 2 hours) and put its ping URL in `BACKUP_HEARTBEAT_URL`. Each backup pings it; a failure pings `…/fail`; silence for a day emails you.

**Restore from the off-site copy** (e.g. on a new server):

```bash
$C run --rm backup node scripts/restore.js --s3 agrohands/2026-11/agrohands-2026-11-14T02-00-00.db.gz.enc /backups/restored.db
# prints: Restored …: integrity ok, schema N, N users.  Then copy it into place as below, using restored.db.
```

Or download the `.gz.enc` file from the bucket's web console and run `npm run restore -- <file> restored.db` anywhere with Node 22 and the key.

To restore a local backup:

```bash
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$C stop app backup
docker run --rm -v agrohands_app-data:/data -v "$PWD/backups":/b alpine \
  sh -c 'rm -f /data/agrohands.db-wal /data/agrohands.db-shm && cp /b/agrohands-YYYY-MM-DDTHH-MM-SS.db /data/agrohands.db && chown 1000:1000 /data/agrohands.db'
$C up -d
```

**Rehearse a restore before launch** and once a quarter: restore the newest off-site backup to a spare machine and log in.

### Monitoring

| What | How | Alerts you when |
| --- | --- | --- |
| Uptime | UptimeRobot or Better Stack (free) checking `https://your-domain/readyz` every minute | the site or database is down |
| Errors | `ALERT_WEBHOOK_URL` = a Slack or Discord incoming webhook | the app or backup logs an error (throttled: same error once per 10 min, max 20/hour) |
| Backups | `BACKUP_HEARTBEAT_URL` (healthchecks.io) | a backup fails or does not run for a day |
| SMS, payments | Admin → Overview "Needs attention", and `/metrics` gauges `agrohands_sms_failed_24h`, `agrohands_payments_pending_1h` | SMS stop delivering, payments stuck |


- **Uptime:** point a free monitor (UptimeRobot, Better Stack) at `https://your-domain/readyz`. It returns 503 if the database is unreachable or the app is shutting down.
- **Metrics:** set `METRICS_TOKEN`; Prometheus scrapes `http://app:3000/metrics` from inside the Docker network with `Authorization: Bearer <token>`. Request rates, latency histograms per route, memory, plus business gauges (users, open jobs, active contracts, open disputes).
- **Version:** `GET /version` shows which build is live.

### Using prebuilt images (optional)

CI (`.github/workflows/ci.yml`) publishes `ghcr.io/<owner>/<repo>` on every push to `main` and on `v*` tags. To deploy those instead of building on the server, set `APP_IMAGE=ghcr.io/<owner>/<repo>:<tag>` in `.env` and run `$C pull && $C up -d`.

### Port conflicts

If 80 or 443 are already in use on the host, set `HTTP_PORT` and `HTTPS_PORT` in `.env`. Automatic certificates need the real 80/443 to be reachable, though, so free them or put another proxy in front.

## 2. Host install without Docker (systemd)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs caddy
sudo git clone <your-repo> /opt/agrohands && cd /opt/agrohands
sudo cp .env.example .env && sudo nano .env       # also set DB_PATH=/opt/agrohands/data/agrohands.db, BACKUP_DIR=/opt/agrohands/backups
sudo mkdir -p data backups && sudo chown www-data data backups
sudo cp deploy/agrohands.service /etc/systemd/system/ && sudo systemctl enable --now agrohands
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile   # your domain
sudo systemctl reload caddy
echo "0 2 * * * www-data /opt/agrohands/deploy/backup.sh" | sudo tee /etc/cron.d/agrohands
```

To update: `git pull && npm test && sudo systemctl restart agrohands`. Migrations apply on start.

## 3. Local

```bash
npm run seed && npm run dev                       # Node
docker compose up -d --build                      # Docker → http://localhost:3000
docker compose exec app node scripts/seed.js      # demo data in Docker
docker compose down -v                            # stop and wipe local data
```

Locally the app warns that `SESSION_SECRET` is unset and uses a temporary one (sessions reset on restart). That is expected.

## Database migrations

Schema changes go in a new file, `src/migrations/NNN_description.sql` (next number, never edit an applied one). They run automatically on start, each in a transaction, and are recorded in `schema_migrations`. `npm run migrate -- --status` lists them.
