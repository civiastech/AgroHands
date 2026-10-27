// Start-up: validate config → open DB + migrate → serve → shut down gracefully on SIGTERM/SIGINT.
import { createServer } from 'node:http';
import { config, validateConfig, configWarnings } from './config.js';
import { openDb, closeDb, migrate, schemaVersion } from './db.js';
import { createHandler } from './app.js';
import { setDraining } from './routes/ops.js';
import { log } from './lib/log.js';

const problems = validateConfig();
if (problems.length) {
  for (const p of problems) log.error('config error', { problem: p });
  log.error('refusing to start — fix the configuration above (see .env.example)');
  process.exit(1);
}
for (const w of configWarnings()) log.warn(w);

openDb(config.dbPath, { migrate: false });
const applied = migrate();
if (applied.length) log.info('migrations applied', { applied });

const handler = createHandler();
const server = createServer(handler);
// Slow-client protection (slowloris) and sane keep-alive behind a reverse proxy.
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000; // longer than typical proxy idle timeouts (Caddy/ALB: 60s)
server.maxRequestsPerSocket = 1000;

server.listen(config.port, config.host, () => {
  log.info('AgroHands started', {
    url: config.baseUrl, port: config.port, version: config.version, build: config.buildId,
    schema: schemaVersion(), nin: config.ninProvider, env: config.production ? 'production' : 'development', node: process.version,
  });
});

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  setDraining(true); // /readyz now answers 503 so the proxy stops routing here
  const force = setTimeout(() => {
    log.warn('forced exit after timeout', { ms: config.shutdownTimeoutMs });
    process.exit(1);
  }, config.shutdownTimeoutMs);
  force.unref();
  server.close((err) => {
    handler.stop();
    closeDb();
    log.info('stopped cleanly');
    process.exit(err ? 1 : 0);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { err: reason }));
process.on('uncaughtException', (err) => {
  // State may be corrupt: log, then exit and let Docker/systemd restart us.
  log.error('uncaught exception', { err });
  shutdown('uncaughtException');
});
