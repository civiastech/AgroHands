// UI system: icons, app shell, accessibility basics and the design tokens that pages depend on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';

process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';
process.env.SMS_PROVIDER = 'memory';

const { openDb } = await import('../src/db.js');
const { createHandler } = await import('../src/app.js');
const { createUser } = await import('../src/lib/services.js');
const { ICON_NAMES } = await import('../src/views/icons.js');
const { CSS } = await import('../src/routes/static.js');
const { LOCALES } = await import('../src/i18n/index.js');

let server, base, handler;
before(async () => {
  openDb(':memory:');
  createUser({ phone: '08100000077', pin: '1234', role: 'worker', name: 'Ada Obi' });
  handler = createHandler({ limits: { authMax: 1000, writeMax: 1000, windowSec: 60 } });
  server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { handler.stop(); server.close(); });

async function loginCookie(phone) {
  const g = await fetch(`${base}/login`);
  const csrf = g.headers.getSetCookie().find((c) => c.startsWith('ah_csrf=')).split(';')[0].split('=')[1];
  const r = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `ah_csrf=${csrf}` },
    body: new URLSearchParams({ _csrf: csrf, phone, pin: '1234' }),
  });
  return `ah_csrf=${csrf}; ${r.headers.getSetCookie().find((c) => c.startsWith('ah_s=')).split(';')[0]}; ah_lang=en`;
}

test('every icon used in the code exists in the sprite', () => {
  const dir = new URL('../src/', import.meta.url);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d)]));
  const missing = [];
  for (const f of walk(dir).filter((u) => u.pathname.endsWith('.js'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bicon\('([a-z]+)'/g)) if (!ICON_NAMES.includes(m[1])) missing.push(m[1]);
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('pages carry no inline scripts (CSP allows only /static/app.js)', async () => {
  for (const path of ['/', '/login', '/register', '/academy', '/privacy']) {
    const page = await (await fetch(base + path)).text();
    for (const m of page.matchAll(/<script\b[^>]*>/g)) assert.match(m[0], /src="\/static\/app\.js/, `${path}: ${m[0]}`);
    assert.doesNotMatch(page, /\son[a-z]+="/, `${path} has an inline event handler`);
  }
});

test('signed-in shell: tab bar, one active tab, account menu, skip link', async () => {
  const cookie = await loginCookie('08100000077');
  const page = await (await fetch(`${base}/w`, { headers: { cookie } })).text();
  assert.match(page, /class="has-tabbar"/);
  assert.match(page, /<nav class="tabbar"/);
  const tabbar = page.slice(page.indexOf('<nav class="tabbar"'));
  assert.equal((tabbar.match(/aria-current="page"/g) || []).length, 1, 'exactly one active tab');
  assert.match(tabbar, /href="\/w" aria-current="page"/);
  assert.match(page, /class="skip" href="#main"/);
  assert.match(page, /<summary class="avatar-btn"[^>]*>AO<\/summary>/, 'avatar initials');
  assert.match(page, /action="\/logout"/);
});

test('public pages: language menu lists all languages, no tab bar', async () => {
  const page = await (await fetch(`${base}/`)).text();
  assert.doesNotMatch(page, /class="tabbar"/);
  for (const code of Object.keys(LOCALES)) assert.match(page, new RegExp(`href="/lang/${code}"`));
  assert.match(page, /<main id="main" class="full">/, 'landing is full-bleed');
});

test('design system ships dark mode, focus rings, reduced motion and print styles', () => {
  assert.match(CSS, /prefers-color-scheme: ?dark/);
  assert.match(CSS, /prefers-reduced-motion: ?reduce/);
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /@media print/);
  assert.doesNotMatch(CSS, /\/\*/, 'comments stripped');
});

test('new UI strings exist in every language', () => {
  const keys = Object.keys(LOCALES.en).filter((k) => /^(nav|role)\./.test(k) || ['home.eyebrow', 'worker.progress', 'farmer.stat_open'].includes(k));
  for (const [code, dict] of Object.entries(LOCALES)) {
    const missing = keys.filter((k) => !(k in dict));
    assert.deepEqual(missing, [], `${code} is missing ${missing.join(', ')}`);
  }
});
