# AgroHands — verified farm workforce platform

[![CI](https://github.com/civiastech/AgroHands/actions/workflows/ci.yml/badge.svg)](https://github.com/civiastech/AgroHands/actions/workflows/ci.yml) [![CodeQL](https://github.com/civiastech/AgroHands/actions/workflows/codeql.yml/badge.svg)](https://github.com/civiastech/AgroHands/actions/workflows/codeql.yml) ![Node](https://img.shields.io/badge/node-%E2%89%A522.13-339933) ![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

Farm owners find NIN-verified, trained, rated farm workers. They get a contract that meets the Labour Act, signed on the phone. Workers never pay to get a job.

**Zero third-party dependencies.** It runs on Node.js 22 alone, using Node's built-in web server, built-in SQLite and built-in crypto. There is nothing to `npm install`, no framework to update, and no supply-chain risk. It runs on a free VM or a ₦5,000/month VPS.

## What's in this build (Phase 1)

| Area | What works |
| --- | --- |
| Languages | English, Pidgin, Yorùbá, Hausa, Igbo and French (for workers and farm owners from neighbouring Francophone countries). Picked from the browser automatically; a user can switch on any page and in USSD. **Pidgin, Yorùbá, Hausa, Igbo and French are drafts:** a native speaker must review them before launch. |
| Workers | Phone + PIN sign-up; profile (skills, location, GPS pin, wage, travel radius, relocation); NIN verification with consent; guarantor; availability toggle; offers; accept or decline. |
| Farm owners | Farm profile with GPS pin; post jobs; ranked shortlist with explained scores; send offers; minimum-wage warning. |
| Matching engine | Hard filters: skill, availability, tier, age 18+, wage, distance, housing. Weighted score: skill 30, reliability 25, rating 20, distance 15, tier 10. Smoothed so new workers get a fair start. |
| Trust tiers | Registered → Bronze (NIN + safety course) → Silver (guarantor + address) → Gold (practical assessment + 3 completed jobs rated ≥ 4.5). |
| Contracts | Covers every Labour Act s.7 particular; summary in the worker's language; PIN e-signature with time, IP and terms-hash evidence; print or save as PDF. The worker's phone stays hidden until both sides sign; after that a WhatsApp link appears. |
| After the job | End with a reason, two-way ratings, disputes. Reliability feeds the next match. |
| Training academy | 5 courses: safety, rights, agrochemicals, GAP, and fair employment for farmers. Quizzes with a 75% pass mark. Certificates anyone can verify at `/cert/CODE`. |
| Field agents | Assisted sign-up with a temporary PIN; NIN slip confirmation; guarantor calls; address checks; skill assessments; farm verification. |
| Admin | KPIs, dispute resolution, roles and suspensions, full audit log. |
| USSD | `POST /ussd` in Africa's Talking format: register, see and accept offers, check status, change language. |
| Data protection (NDPA) | Consent records; the full NIN is never stored (keyed hash + last 4 digits only); download my data; delete my account (contract records kept). |
| Security | PBKDF2 PINs; signed sessions; CSRF tokens; lockout after 5 wrong PINs; per-IP rate limits; HSTS and strict security headers; all output escaped; proxy-aware IP capture so e-signature evidence can't be spoofed. |
| Operations | Versioned DB migrations; structured JSON logs with request IDs; `/healthz`, `/readyz`, `/version`, Prometheus `/metrics`; graceful shutdown; automated backups; fail-fast config validation. |
| Offline & Android | Installable PWA and a Google Play app (Trusted Web Activity). Training pages work offline. |

**Not in this build:** Phase 2 payroll (money movement through Paystack, Flutterwave or Moniepoint), paid course checkout, SMS alerts, and recorded audio lessons. The code is structured so each can be added without rework.

## Run it locally

**With Node** (needs Node.js 22.13+):

```bash
npm run seed      # demo data
npm run dev       # http://localhost:3000, restarts on file changes
npm test          # 25 automated tests, including the full hiring journey
```

**With Docker** (nothing else to install):

```bash
docker compose up -d --build                 # http://localhost:3000 (tests run inside the build)
docker compose exec app node scripts/seed.js # demo data
docker compose logs -f app
```

Demo logins use PIN **1234**:

| Role | Phone |
| --- | --- |
| Admin | 08000000001 |
| Agent | 08000000002 |
| Farmer | 08030000001 |
| Workers | 08100000001 to 08100000025 |

## Go live

Full guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. The short version, on any Linux server with Docker (an Oracle Cloud Always Free VM costs ₦0):

```bash
git clone <your-repo> /opt/agrohands && cd /opt/agrohands
cp .env.example .env && nano .env   # DOMAIN, BASE_URL, SESSION_SECRET, ADMIN_PHONES
./deploy/deploy.sh                  # build + test, back up, start, wait until healthy
```

This starts the app behind **Caddy** (free automatic HTTPS) plus a **backup** service (daily, keeps 14 days in `./backups`). Run `./deploy/deploy.sh` again to ship each update. A host install without Docker (systemd) is also covered in the guide.

## Google Play (Android app)

The app ships to the Play Store as a Trusted Web Activity: a signed ~1.5 MB Android app that opens the live site full-screen. Website updates reach app users with no Play update needed. Build it with Docker only:

```bash
npm run android:keystore     # once, back up android/android.keystore
npm run android:fingerprint  # → ANDROID_CERT_SHA256 on the server
npm run android:build        # → android/app-release-bundle.aab
```

Step-by-step submission, store listing text, Data safety answers and graphics: **[docs/PLAY_STORE.md](docs/PLAY_STORE.md)**.

## Configuration (`.env`)

Every setting is documented in [.env.example](.env.example). In production the app **refuses to start** if the config is unsafe: a missing or short `SESSION_SECRET`, a non-https `BASE_URL`, the `mock` NIN provider, or missing Dojah keys.

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | **Required in production**, 32+ characters. Never change it after launch: it also keys the NIN hashes. |
| `BASE_URL`, `DOMAIN` | Public https URL, and the domain Caddy gets a certificate for. |
| `ADMIN_PHONES` | Comma-separated phones that become admin when they register. |
| `TRUST_PROXY` | `true` behind Caddy/nginx (the Docker default). Controls whether `X-Forwarded-For` is believed. |
| `NIN_PROVIDER` | `manual` (free: an agent checks the NIN slip), `dojah` (paid API), `mock` (tests only). |
| `USSD_KEY` | Secret Africa's Talking sends as `?key=`. In production `/ussd` stays off until it is set. |
| `METRICS_TOKEN` | Enables `GET /metrics` (Bearer token). Caddy blocks `/metrics` from the internet anyway. |
| `LOG_LEVEL`, `LOG_FORMAT` | `info`/`json` in production, `debug`/`pretty` in dev. |
| `RATE_LIMIT_*` | Per-IP limits for auth actions and form posts. |

## What it costs (only when real users arrive)

| Item | Cost | When |
| --- | --- | --- |
| Hosting | ₦0 (Oracle free VM) | Now |
| NIN checks | ₦0 with agent checks; about ₦60 per automated API check | When volume justifies it |
| USSD shortcode | Africa's Talking: free sandbox; dedicated live code costs extra | Go-live |
| Domain | about ₦3,000–₦15,000 a year | Optional |
| Recruiter's licence + CAC | Per the blueprint | Before charging fees |

## Before launch checklist

- [ ] Native speakers review the Pidgin, Yorùbá, Hausa, Igbo and French files (`src/i18n/*.js`)
- [ ] A lawyer reviews `/terms`, `/privacy` and the contract clauses (`src/lib/contract.js`)
- [ ] Set `SESSION_SECRET`, `BASE_URL`, `DOMAIN`, `ADMIN_PHONES` and `USSD_KEY`; do not run the seed
- [ ] Recruiter's licence application filed
- [ ] Data Privacy Impact Assessment done; Data Protection Officer named
- [ ] Backups tested by restoring once (see docs/DEPLOYMENT.md)
- [ ] Off-site copy of `./backups` scheduled (rclone, object storage or similar)
- [ ] Uptime monitor pointed at `https://<domain>/readyz`

## Architecture

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

```
src/server.js         start-up: validate config, migrate, serve, graceful shutdown
src/app.js            request pipeline: request id, rate limits, sessions, CSRF, language, errors, access log
src/config.js         typed + validated configuration
src/db.js             SQLite access, migration runner, backups, health check
src/migrations/       numbered SQL migrations (001_init.sql, 002_indexes.sql, …)
src/lib/              domain logic: matching, tiers, contracts, NIN adapter, services
src/lib/log.js        structured logger · metrics.js Prometheus · ratelimit.js limiter
src/routes/*.js       screens: public, worker, farmer, contracts, academy, agent, admin, ussd, ops
src/i18n/*.js         6 languages
scripts/              seed, migrate, backup, play-assets, android-config
deploy/               Caddy, systemd, deploy script
android/              Play Store build (Docker toolchain, build.sh) and store graphics
assets/               icon and feature-graphic sources · public/ generated icons + screenshots
test/                 unit, end-to-end and ops tests
```
