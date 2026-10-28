# Architecture

## Principles

1. **Zero runtime dependencies.** Node 22's built-in `http`, `sqlite` and `crypto` only. Nothing to patch, no supply-chain exposure, runs on a free VM.
2. **One way to change state.** Every business action lives in `src/lib/services.js` and is shared by the web UI and USSD. Routes parse input and render; they don't own rules.
3. **Pure core, thin edges.** Matching, tiers and contract generation are pure functions with unit tests. I/O sits at the edges: the DB, HTTP and the NIN provider.
4. **Fail fast, fail loud.** Invalid production config stops start-up. Every error is logged with a request id, and the user gets that id as a reference.
5. **Server-rendered, works on cheap phones.** HTML with one small script, installable as a PWA. Training works offline, and USSD covers phones with no data.

## Layers

```
            Browser / PWA                Africa's Talking (USSD)
                  │                               │
   ┌──────────────▼───────────────────────────────▼──────────────┐
   │ server.js  config validation · migrations · timeouts ·      │
   │            graceful shutdown (drain → close → exit)         │
   ├─────────────────────────────────────────────────────────────┤
   │ app.js     request id → client IP (proxy-aware) → rate      │
   │ pipeline   limit → session → language → CSRF → route →      │
   │            error mapping → access log + metrics             │
   ├─────────────────────────────────────────────────────────────┤
   │ routes/    public · worker · farmer · contracts · academy · │
   │            agent · admin · ussd · ops · static              │
   ├─────────────────────────────────────────────────────────────┤
   │ lib/       services (all writes) · matching · tiers ·       │
   │ domain     contract · verify (NIN adapter) · geo            │
   ├─────────────────────────────────────────────────────────────┤
   │ db.js      SQLite (WAL) · migrations · backup · health      │
   └─────────────────────────────────────────────────────────────┘
   cross-cutting: lib/log.js · lib/metrics.js · lib/ratelimit.js · i18n/
```

## Request lifecycle

1. **Request id:** reuses an incoming `X-Request-Id` if it is well-formed, otherwise makes one. It is echoed in the response and included in every log line.
2. **Client IP:** `X-Forwarded-For` is honoured only when `TRUST_PROXY=true`. Caddy overwrites that header with the real client IP, so it can't be spoofed. The IP is used for rate limits and e-signature evidence.
3. **Rate limits:** fixed-window, per IP. There are two buckets: auth actions (login, register, PIN signing, NIN checks, account deletion) and all POSTs. USSD is keyed by subscriber phone, because all its traffic comes from the gateway's IPs.
4. **Session:** an HMAC-signed cookie `id.exp.sig`. The user is re-read from the DB on each request, so a suspension takes effect immediately.
5. **CSRF:** double-submit token on every POST except the USSD webhook (that one has its own shared key).
6. **Errors:** an `AppError` becomes a translated flash message and a redirect back. Anything else is logged with its stack and returns a 500 with the reference id.

## Data

- SQLite in WAL mode with `foreign_keys=ON`. One writer and many readers is more than enough for this workload (thousands of users per small VM).
- **Migrations:** `src/migrations/NNN_*.sql`, applied in order in transactions and tracked in `schema_migrations`. `001_init.sql` is idempotent, so databases from before migrations upgrade in place.
- **Privacy (NDPA):** a full NIN is never stored, only an HMAC (keyed with `SESSION_SECRET`) and the last 4 digits. That is why the secret must never change.
- **Backups:** `VACUUM INTO` produces a consistent copy while the app is serving traffic.

## Scaling path

The current design targets one instance. When you outgrow it:

| Need | Change |
| --- | --- |
| More throughput on one box | Bigger VM first. SQLite in WAL mode handles thousands of writes per second. |
| Several app instances | Move the `RateLimiter` store to Redis and SQLite to Postgres. Services use `q.get/all/run/tx` only, so the swap stays inside `db.js` and the SQL dialect. |
| Payroll (Phase 2) | `lib/payments.js` already handles checkout, verification and webhooks; add a `purpose` (e.g. `placement`, `payroll`) and its fulfilment in `apply()`. |
| More SMS providers | `lib/sms.js` has one `sendViaProvider` switch; add Termii or another gateway there. The outbox, retries and tests stay the same. |

## Testing

`npm test` runs the following on Node's built-in test runner:

- **Unit:** matching, tiers, contract, NIN, i18n, escaping.
- **End-to-end:** the full hiring journey over real HTTP, plus agent and admin desks, USSD and security.
- **Ops:** probes, metrics auth, rate limits, migrations, config validation, proxy IP handling, cache headers.

The Docker build runs the same suite, and CI runs it on Node 22 and 24, then smoke-tests the built container, including a clean shutdown.
