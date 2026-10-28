// Operations endpoints: liveness, readiness, version, Prometheus metrics. Used by Docker, load balancers and monitoring.
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { q, dbHealthy, schemaVersion } from '../db.js';
import { renderMetrics } from '../lib/metrics.js';

let draining = false;
/** Called on SIGTERM so the load balancer stops sending traffic before we close. */
export const setDraining = (v) => { draining = v; };

const tokenOk = (header = '') => {
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(config.metricsToken);
  return want.length > 0 && given.length === want.length && timingSafeEqual(given, want);
};

export default function register(r) {
  // Liveness: the process is up and the event loop answers.
  r.get('/healthz', (ctx) => ctx.res.json({ ok: true }));

  // Readiness: safe to receive traffic (database reachable, not shutting down).
  r.get('/readyz', (ctx) => {
    const db = dbHealthy();
    const ok = db && !draining;
    ctx.res.headers['Cache-Control'] = 'no-store';
    ctx.res.json({ ok, db, draining, schema: db ? schemaVersion() : null }, ok ? 200 : 503);
  });

  r.get('/version', (ctx) => ctx.res.json({ version: config.version, build: config.buildId, node: process.version }));

  r.get('/metrics', (ctx) => {
    if (!config.metricsToken) return ctx.res.text('Metrics disabled. Set METRICS_TOKEN.', 404);
    if (!tokenOk(ctx.req.headers.authorization)) return ctx.res.text('Unauthorised', 401);
    const n = (sql) => q.get(sql).n;
    ctx.res.send(renderMetrics({
      agrohands_users_total: n('SELECT COUNT(*) AS n FROM users'),
      agrohands_workers_available: n('SELECT COUNT(*) AS n FROM workers WHERE available = 1'),
      agrohands_jobs_open: n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'open'"),
      agrohands_contracts_active: n("SELECT COUNT(*) AS n FROM contracts WHERE status = 'active'"),
      agrohands_disputes_open: n("SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'"),
      agrohands_sms_queued: n("SELECT COUNT(*) AS n FROM sms_outbox WHERE status IN ('queued','sending')"),
      agrohands_sms_failed_24h: n("SELECT COUNT(*) AS n FROM sms_outbox WHERE status = 'failed' AND created_at > unixepoch() - 86400"),
      agrohands_payments_pending_1h: n("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending' AND created_at < unixepoch() - 3600"),
      agrohands_payments_success_total: n("SELECT COUNT(*) AS n FROM payments WHERE status = 'success'"),
    }), 'text/plain; version=0.0.4; charset=utf-8');
  });
}
