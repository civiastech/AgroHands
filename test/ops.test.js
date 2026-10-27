// Production layer: probes, metrics, rate limits, migrations, config validation, client IP, headers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.SESSION_SECRET = 'test-secret';
process.env.METRICS_TOKEN = 'metrics-test-token';
process.env.LOG_LEVEL = 'error';

const { openDb, q, migrate, migrationFiles, schemaVersion } = await import('../src/db.js');
const { createHandler, clientIp } = await import('../src/app.js');
const { validateConfig, config } = await import('../src/config.js');
const { RateLimiter } = await import('../src/lib/ratelimit.js');

let server, base, handler;
before(async () => {
  openDb(':memory:');
  handler = createHandler({ limits: { authMax: 3, writeMax: 50, windowSec: 60 } });
  server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { handler.stop(); server.close(); });

test('liveness, readiness and version probes', async () => {
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true });
  const ready = await fetch(`${base}/readyz`);
  assert.equal(ready.status, 200);
  const body = await ready.json();
  assert.equal(body.db, true);
  assert.equal(body.schema, migrationFiles().at(-1).version);
  const v = await (await fetch(`${base}/version`)).json();
  assert.equal(v.version, config.version);
});

test('metrics need the bearer token', async () => {
  assert.equal((await fetch(`${base}/metrics`)).status, 401);
  assert.equal((await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  await fetch(`${base}/`);
  const res = await fetch(`${base}/metrics`, { headers: { authorization: 'Bearer metrics-test-token' } });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /http_requests_total\{method="GET",route="\/",status="200"\} \d+/);
  assert.match(text, /agrohands_users_total \d+/);
});

test('every response carries a request id and security headers', async () => {
  const res = await fetch(`${base}/`);
  assert.match(res.headers.get('x-request-id'), /^[\w-]{8,}$/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  const echoed = await fetch(`${base}/`, { headers: { 'x-request-id': 'trace-abc-12345' } });
  assert.equal(echoed.headers.get('x-request-id'), 'trace-abc-12345');
});

test('static assets are versioned and cached immutably', async () => {
  const page = await (await fetch(`${base}/login`)).text();
  const href = page.match(/href="(\/static\/app\.css\?v=[^"]+)"/)?.[1];
  assert.ok(href, 'stylesheet URL carries a version');
  const { ASSET_VERSION, CSS, JS } = await import('../src/routes/static.js');
  const { createHash } = await import('node:crypto');
  assert.equal(href, `/static/app.css?v=${ASSET_VERSION}`);
  // The version is a content hash, so any CSS/JS change produces new URLs (no stale year-long caches).
  assert.notEqual(ASSET_VERSION, createHash('sha256').update(CSS + ' ').update(JS).digest('hex').slice(0, 10));
  const css = await fetch(base + href);
  assert.match(css.headers.get('cache-control'), /immutable/);
  assert.match(await (await fetch(`${base}/sw.js`)).text(), new RegExp(`ah-${ASSET_VERSION}`));
});

test('malformed URLs are a 404, not a crash', async () => {
  const res = await fetch(`${base}/cert/%E0%A4%A`);
  assert.equal(res.status, 404);
});

test('login is rate limited per IP', async () => {
  handler.resetLimits();
  const get = await fetch(`${base}/login`);
  const csrf = get.headers.getSetCookie().find((c) => c.startsWith('ah_csrf=')).split(';')[0].split('=')[1];
  const attempt = () => fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `ah_csrf=${csrf}` },
    body: `_csrf=${csrf}&phone=08031112222&pin=0000`,
  });
  for (let i = 0; i < 3; i++) assert.equal((await attempt()).status, 303);
  const blocked = await attempt();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  handler.resetLimits();
});

test('rate limiter windows reset', () => {
  let now = 0;
  const rl = new RateLimiter({ max: 2, windowSec: 10, now: () => now });
  assert.ok(rl.hit('a').ok);
  assert.ok(rl.hit('a').ok);
  assert.equal(rl.hit('a').ok, false);
  assert.ok(rl.hit('b').ok, 'keys are independent');
  now = 10001;
  assert.ok(rl.hit('a').ok, 'new window');
  rl.sweep();
  rl.stop();
});

test('X-Forwarded-For is only trusted behind a proxy', () => {
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientIp(req, false), '10.0.0.1');
  assert.equal(clientIp(req, true), '6.6.6.6');
});

test('migrations are recorded and idempotent', () => {
  assert.deepEqual(migrate(), [], 'nothing left to apply');
  assert.equal(schemaVersion(), migrationFiles().at(-1).version);
  const rows = q.all('SELECT name FROM schema_migrations ORDER BY version').map((r) => r.name);
  assert.deepEqual(rows, migrationFiles().map((m) => m.name));
});

test('production config is validated', () => {
  const good = { ...config, production: true, secretIsEphemeral: false, secret: 'x'.repeat(64), ninProvider: 'manual', baseUrl: 'https://agrohands.ng', logLevel: 'info' };
  assert.deepEqual(validateConfig(good), []);
  assert.ok(validateConfig({ ...good, secretIsEphemeral: true }).some((e) => /SESSION_SECRET/.test(e)));
  assert.ok(validateConfig({ ...good, secret: 'short' }).some((e) => /32 characters/.test(e)));
  assert.ok(validateConfig({ ...good, ninProvider: 'mock' }).some((e) => /mock/.test(e)));
  assert.ok(validateConfig({ ...good, baseUrl: 'http://x' }).some((e) => /https/.test(e)));
  assert.ok(validateConfig({ ...good, ninProvider: 'dojah', dojah: { appId: '', secretKey: '' } }).some((e) => /DOJAH/.test(e)));
});

// ---- Google Play / Trusted Web Activity requirements -------------------------------------------
const { assetLinks } = await import('../src/routes/wellknown.js');
const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');

test('assetlinks.json proves the Play app owns this domain', async () => {
  const res = await fetch(`${base}/.well-known/assetlinks.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), [], 'empty until ANDROID_CERT_SHA256 is set');
  const links = assetLinks({ android: { packageName: 'ng.agrohands.app', certFingerprints: [FP] } });
  assert.deepEqual(links[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(links[0].target.package_name, 'ng.agrohands.app');
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, [FP]);
});

test('Android signing fingerprints and package name are validated', () => {
  const c = { ...config, production: false };
  assert.deepEqual(validateConfig({ ...c, android: { packageName: 'ng.agrohands.app', certFingerprints: [FP] } }), []);
  assert.ok(validateConfig({ ...c, android: { packageName: 'ng.agrohands.app', certFingerprints: ['AB:CD'] } }).some((e) => /ANDROID_CERT_SHA256/.test(e)));
  assert.ok(validateConfig({ ...c, android: { packageName: 'AgroHands', certFingerprints: [] } }).some((e) => /ANDROID_PACKAGE/.test(e)));
});

test('web manifest meets install and TWA requirements, and every icon is served at its declared size', async () => {
  const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
  for (const k of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color']) assert.ok(m[k], `manifest.${k}`);
  assert.equal(m.display, 'standalone');
  const png = m.icons.filter((i) => i.type === 'image/png');
  assert.ok(png.some((i) => i.sizes === '512x512' && i.purpose === 'any'), '512 "any" icon');
  assert.ok(png.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), '512 maskable icon');
  assert.ok(png.some((i) => i.sizes === '192x192'), '192 icon');
  for (const icon of png) {
    const res = await fetch(base + icon.src);
    assert.equal(res.status, 200, icon.src);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', `${icon.src} is a PNG`);
    assert.equal(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, icon.sizes, `${icon.src} real size`);
  }
  for (const s of m.screenshots) assert.equal((await fetch(base + s.src)).status, 200, s.src);
});

test('privacy policy and account deletion are public (no login), as Play requires', async () => {
  const del = await fetch(`${base}/account-deletion`, { redirect: 'manual' });
  assert.equal(del.status, 200);
  const page = await del.text();
  assert.match(page, /What is deleted/);
  assert.match(page, /What is kept/);
  const privacy = await (await fetch(`${base}/privacy`, { redirect: 'manual' })).text();
  assert.match(privacy, /Location/);
  assert.match(privacy, /account-deletion/);
  assert.match(await (await fetch(`${base}/`)).text(), /href="\/account-deletion"/, 'linked from every page footer');
});

test('offline fallback page is precached by the service worker (TWA offline check)', async () => {
  const sw = await (await fetch(`${base}/sw.js`)).text();
  assert.match(sw, /'\/offline'/);
  assert.equal((await fetch(`${base}/offline`)).status, 200);
});
