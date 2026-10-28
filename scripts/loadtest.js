// Load test with no dependencies. Run it against a copy with demo data, never against production:
//   DB_PATH=./data/load.db npm run seed
//   DB_PATH=./data/load.db LOG_LEVEL=warn RATE_LIMIT_AUTH_MAX=100000 RATE_LIMIT_WRITE_MAX=100000 npm start
//   BASE=http://localhost:3000 DURATION=30 USERS=50 npm run loadtest
//
// Phase 1: USERS concurrent virtual users browse for DURATION seconds (visitors, workers, farmers, admin),
//          each waiting THINK_MS between requests (0 = flat out, the default, to find the ceiling).
// Phase 2: a burst of logins (PIN hashing is deliberately slow, so this is the CPU-heavy path).
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const DURATION = Number(process.env.DURATION || 30) * 1000;
const USERS = Number(process.env.USERS || 50);
const THINK = Number(process.env.THINK_MS || 0);
const LOGINS = Number(process.env.LOGINS || 100);
const PIN = process.env.PIN || '1234';

if (/agrohands\.ng|sslip\.io/.test(BASE) && !process.env.I_KNOW) {
  console.error('Refusing to load-test what looks like production. Set I_KNOW=1 if you really mean it.');
  process.exit(2);
}

const stats = new Map(); // label -> { ms: [], errors, statuses }
function record(label, ms, ok, status) {
  let s = stats.get(label);
  if (!s) stats.set(label, (s = { ms: [], errors: 0, statuses: {} }));
  s.ms.push(ms);
  if (!ok) s.errors++;
  s.statuses[status] = (s.statuses[status] || 0) + 1;
}

async function hit(label, path, { cookie = '', method = 'GET', body } = {}) {
  const t = performance.now();
  let status = 'ERR';
  try {
    const res = await fetch(BASE + path, {
      method, body, redirect: 'manual',
      headers: { cookie, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    });
    await res.arrayBuffer();
    status = res.status;
    record(label, performance.now() - t, status < 400, status);
    return res;
  } catch {
    record(label, performance.now() - t, false, status);
    return null;
  }
}

async function login(phone) {
  const page = await fetch(`${BASE}/login`);
  const csrf = page.headers.getSetCookie().find((c) => c.startsWith('ah_csrf=')).split(';')[0].slice(8);
  await page.arrayBuffer();
  const res = await hit('POST /login', '/login', {
    method: 'POST', cookie: `ah_csrf=${csrf}`, body: new URLSearchParams({ _csrf: csrf, phone, pin: PIN }).toString(),
  });
  const s = res?.headers.getSetCookie().find((c) => c.startsWith('ah_s='));
  return s ? `ah_csrf=${csrf}; ah_s=${s.split(';')[0].slice(5)}` : null;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
function report(title, seconds) {
  console.log(`\n${title}`);
  const rows = [...stats].map(([label, s]) => {
    const ms = [...s.ms].sort((a, b) => a - b);
    return {
      request: label, count: ms.length, 'req/s': +(ms.length / seconds).toFixed(1),
      'p50 ms': +pct(ms, 50).toFixed(1), 'p95 ms': +pct(ms, 95).toFixed(1), 'p99 ms': +pct(ms, 99).toFixed(1),
      'max ms': +ms.at(-1).toFixed(1), errors: s.errors, statuses: JSON.stringify(s.statuses),
    };
  });
  console.table(rows);
  const all = [...stats.values()].flatMap((s) => s.ms).sort((a, b) => a - b);
  const errors = [...stats.values()].reduce((n, s) => n + s.errors, 0);
  console.log(`total ${all.length} requests, ${(all.length / seconds).toFixed(1)} req/s, p95 ${pct(all, 95).toFixed(1)} ms, p99 ${pct(all, 99).toFixed(1)} ms, errors ${errors}`);
  stats.clear();
}

// ---- Sessions for the demo accounts (npm run seed) ----------------------------------------------
console.log(`Load test against ${BASE}: ${USERS} users for ${DURATION / 1000}s, think time ${THINK} ms`);
const farmer = await login('08030000001');
const admin = await login('08000000001');
const workers = (await Promise.all(Array.from({ length: 10 }, (_, i) => login(`081000000${String(i + 1).padStart(2, '0')}`)))).filter(Boolean);
if (!farmer || !admin || !workers.length) {
  console.error('Could not log in as the demo accounts. Seed the database first (npm run seed) and lift the auth rate limit.');
  process.exit(1);
}
const farmPage = await (await fetch(`${BASE}/f`, { headers: { cookie: farmer } })).text();
const jobIds = [...farmPage.matchAll(/href="\/f\/jobs\/(\d+)"/g)].map((m) => m[1]);
stats.clear();

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const SCENARIOS = [
  // [weight, label, path, cookie()]
  [20, 'GET / (landing)', '/', () => ''],
  [8, 'GET /login', '/login', () => ''],
  [10, 'GET /academy', '/academy', () => ''],
  [8, 'GET /static/app.css', '/static/app.css', () => ''],
  [20, 'GET /w (worker home)', '/w', () => pick(workers)],
  [10, 'GET /academy/:id (lesson)', '/academy/safety-101', () => pick(workers)],
  [10, 'GET /f (farmer home)', '/f', () => farmer],
  [10, 'GET /f/jobs/:id (ranked shortlist)', () => `/f/jobs/${pick(jobIds)}`, () => farmer],
  [4, 'GET /admin (overview)', '/admin', () => admin],
];
const total = SCENARIOS.reduce((n, [w]) => n + w, 0);
function scenario() {
  let r = Math.random() * total;
  for (const s of SCENARIOS) if ((r -= s[0]) < 0) return s;
  return SCENARIOS[0];
}

// ---- Phase 1: browsing ---------------------------------------------------------------------------
const end = Date.now() + DURATION;
const started = performance.now();
await Promise.all(Array.from({ length: USERS }, async () => {
  while (Date.now() < end) {
    const [, label, path, cookie] = scenario();
    await hit(label, typeof path === 'function' ? path() : path, { cookie: cookie() });
    if (THINK) await new Promise((r) => setTimeout(r, THINK * (0.5 + Math.random())));
  }
}));
report('Phase 1: browsing', (performance.now() - started) / 1000);

// ---- Phase 2: login burst, with 10 users still browsing (do pages stay fast while PINs are hashed?) --
const t2 = performance.now();
let next = 0;
let loginsDone = false;
const browsing = Promise.all(Array.from({ length: 10 }, async () => {
  while (!loginsDone) await hit('GET /w during logins', '/w', { cookie: pick(workers) });
}));
await Promise.all(Array.from({ length: Math.min(20, LOGINS) }, async () => {
  while (next++ < LOGINS) await login(`081000000${String((next % 20) + 1).padStart(2, '0')}`);
}));
loginsDone = true;
await browsing;
report(`Phase 2: ${LOGINS} logins, 20 at a time, while 10 users browse`, (performance.now() - t2) / 1000);
