// Full journey over real HTTP: farmer posts job → worker registers, verifies, trains → match → offer →
// accept → both sign → active → end → rate → dispute → agent + admin + USSD.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';

process.env.NIN_PROVIDER = 'mock';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_PHONES = '08000000009';
process.env.LOG_LEVEL = 'error';

const { openDb, q } = await import('../src/db.js');
const { createHandler } = await import('../src/app.js');
const { createUser } = await import('../src/lib/services.js');

let server, base, handler;
before(async () => {
  openDb(':memory:');
  // Every test client shares 127.0.0.1, so lift the limits here; the limiter has its own tests.
  handler = createHandler({ limits: { authMax: 10000, writeMax: 10000, windowSec: 60 } });
  server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { handler.stop(); server.close(); });

class Client {
  constructor() { this.jar = {}; }
  async req(method, path, form) {
    const headers = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries({ _csrf: this.jar.ah_csrf, ...form })) {
        [].concat(v).forEach((x) => p.append(k, x));
      }
      body = p.toString();
    }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      const v = kv.slice(i + 1);
      if (/Max-Age=0/.test(c)) delete this.jar[kv.slice(0, i)]; else this.jar[kv.slice(0, i)] = v;
    }
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text };
  }
  get(path) { return this.req('GET', path); }
  async post(path, form) { if (!this.jar.ah_csrf) await this.get('/'); return this.req('POST', path, form); }
}

const flash = (c) => decodeURIComponent(c.jar.ah_f || '');

test('full hiring journey', async () => {
  // Farmer
  const farmer = new Client();
  let r = await farmer.post('/register', { role: 'farmer', name: 'Joshua Oladeji', phone: '08030000001', pin: '2468', pin2: '2468', consent: '1' });
  assert.equal(r.location, '/f/farm');
  r = await farmer.post('/f/farm', { name: 'Test Pineapple Farm', state: 'Oyo', lga: 'Ogbomoso North', address: 'Km 4', lat: '8.1339', lng: '4.2401', size_ha: '20', crops: 'Pineapple' });
  assert.equal(r.location, '/f');

  // Worker registers in Yoruba
  const worker = new Client();
  await worker.get('/lang/yo');
  r = await worker.get('/register?role=worker');
  assert.match(r.text, /Forúkọsílẹ̀/);
  r = await worker.post('/register', { role: 'worker', name: 'Adebayo Ogunleye', phone: '0810 000 0001', pin: '1357', pin2: '1357', consent: '1' });
  assert.equal(r.location, '/w/profile');
  r = await worker.post('/w/profile', {
    gender: 'male', dob: '1994-05-10', state: 'Oyo', lga: 'Ogbomoso North', town: 'Ogbomoso', lat: '8.14', lng: '4.25',
    'skills[]': ['harvesting', 'weeding'], primary_skill: 'harvesting', years_exp: '5', expected_wage: '4000', wage_period: 'day', radius_km: '30',
  });
  assert.equal(r.location, '/w/verify');

  // NIN: bad, then good (mock provider)
  r = await worker.post('/w/verify', { nin: '123', consent: '1' });
  assert.equal(r.location, '/w/verify');
  r = await worker.post('/w/verify', { nin: '12345678901', consent: '1' });
  assert.equal(r.location, '/w');
  let w = q.get("SELECT * FROM workers WHERE nin_last4 = '8901'");
  assert.equal(w.nin_status, 'verified');
  assert.equal(w.tier, 'registered', 'still needs safety course');

  // Same NIN cannot be reused by another account
  const dup = new Client();
  await dup.post('/register', { role: 'worker', name: 'Fake Person', phone: '08100000099', pin: '1111', pin2: '1111', consent: '1' });
  r = await dup.post('/w/verify', { nin: '12345678901', consent: '1' });
  assert.equal(r.location, '/w/verify');

  // Safety course: fail then pass → Bronze
  r = await worker.post('/academy/safety-101/quiz', { a0: '0', a1: '0', a2: '0', a3: '0' });
  assert.match(r.text, /📚/);
  r = await worker.post('/academy/safety-101/quiz', { a0: '1', a1: '1', a2: '1', a3: '1' });
  assert.match(r.text, /🎉/);
  const cert = /\/cert\/(AHC-[0-9A-F]+)/.exec(r.text)[1];
  assert.equal((await new Client().get(`/cert/${cert}`)).status, 200, 'certificate is publicly verifiable');
  w = q.get("SELECT * FROM workers WHERE nin_last4 = '8901'");
  assert.equal(w.tier, 'bronze');

  // Farmer posts job → shortlist contains worker; phone is hidden before hire
  r = await farmer.post('/f/jobs', {
    title: 'Pineapple harvest', skill: 'harvesting', headcount: '1', employment_type: 'casual', start_date: '2026-11-03',
    duration_days: '14', wage_amount: '4500', wage_period: 'day', hours_per_day: '8', meals: '1', min_tier: 'bronze', description: 'Harvest and crate',
  });
  const jobPath = r.location;
  assert.match(jobPath, /^\/f\/jobs\/\d+$/);
  r = await farmer.get(jobPath);
  assert.match(r.text, /Adebayo O\./);
  assert.doesNotMatch(r.text, /08100000001/, 'worker phone must stay masked');
  const jobId = Number(jobPath.split('/').pop());
  r = await farmer.post(`${jobPath}/offer/${w.user_id}`, {});
  assert.equal(r.location, jobPath);

  // Another farmer cannot see this job
  const nosy = new Client();
  await nosy.post('/register', { role: 'farmer', name: 'Nosy Farmer', phone: '08030000002', pin: '1111', pin2: '1111', consent: '1' });
  assert.equal((await nosy.get(jobPath)).status, 404);

  // Worker accepts → contract (pending) → wrong PIN → both sign → active
  r = await worker.get('/w');
  const matchId = /\/w\/offers\/(\d+)\/accept/.exec(r.text)[1];
  r = await worker.post(`/w/offers/${matchId}/accept`, {});
  const cPath = r.location;
  assert.match(cPath, /^\/c\/\d+$/);
  r = await worker.get(cPath);
  assert.match(r.text, /Sick leave/);
  r = await worker.post(`${cPath}/sign`, { pin: '0000' });
  assert.match(flash(worker), /PIN/);
  await worker.post(`${cPath}/sign`, { pin: '1357' });
  r = await farmer.get(cPath);
  assert.doesNotMatch(r.text, /08100000001/, 'contact hidden until both sign');
  await farmer.post(`${cPath}/sign`, { pin: '2468' });
  const c = q.get('SELECT * FROM contracts WHERE id = ?', Number(cPath.split('/').pop()));
  assert.equal(c.status, 'active');
  assert.equal(q.get('SELECT status FROM jobs WHERE id = ?', jobId).status, 'filled');
  r = await farmer.get(cPath);
  assert.match(r.text, /08100000001/, 'contact visible once active');
  assert.match(r.text, /wa\.me\/2348100000001/);

  // Dispute, end, rate
  r = await worker.post(`${cPath}/dispute`, { category: 'pay', description: 'Week 1 wage is 2 days late' });
  assert.equal(r.location, cPath);
  r = await worker.post(`${cPath}/end`, { reason: 'no_show' });
  assert.match(flash(worker), /access|ọ̀nà|wọlé|.+/);
  assert.equal(q.get('SELECT status FROM contracts WHERE id = ?', c.id).status, 'active', 'worker cannot mark own no-show');
  r = await farmer.post(`${cPath}/end`, { reason: 'completed' });
  assert.equal(r.location, `${cPath}/rate`);
  await farmer.post(`${cPath}/rate`, { stars: '5', comment: 'Excellent' });
  await worker.post(`${cPath}/rate`, { stars: '4', comment: 'Paid late once' });
  assert.equal(q.get('SELECT COUNT(*) AS n FROM ratings WHERE contract_id = ?', c.id).n, 2);
  assert.equal(q.get('SELECT available FROM workers WHERE user_id = ?', w.user_id).available, 1, 'worker available again');

  // NDPA: data export excludes secrets
  r = await worker.get('/me/data');
  assert.doesNotMatch(r.text, /pin_hash|nin_hash/);
  assert.match(r.text, /Adebayo/);
});

test('agent and admin desks', async () => {
  createUser({ phone: '08000000009', pin: '9999', role: 'farmer', name: 'Boss Admin' }); // ADMIN_PHONES → admin
  const admin = new Client();
  let r = await admin.post('/login', { phone: '08000000009', pin: '9999' });
  assert.equal(r.location, '/admin');
  r = await admin.get('/admin');
  assert.match(r.text, /Open disputes/);
  const d = q.get("SELECT id FROM disputes WHERE status = 'open'");
  await admin.post(`/admin/disputes/${d.id}`, { resolution: 'Farmer paid balance', status: 'resolved' });
  assert.equal(q.get('SELECT status FROM disputes WHERE id = ?', d.id).status, 'resolved');

  createUser({ phone: '08000000008', pin: '8888', role: 'worker', name: 'Field Agent' });
  await admin.post('/admin/role', { phone: '08000000008', role: 'agent', status: 'active' });
  const agent = new Client();
  await agent.post('/login', { phone: '08000000008', pin: '8888' });
  r = await agent.post('/a/register', { name: 'Musa Ibrahim', phone: '08100000077', state: 'Kwara', lga: 'Ilorin East', skill: 'palm_harvest', consent: '1' });
  const pin = /letter-spacing:6px">(\d{4})</.exec(r.text)[1];
  const u = q.get("SELECT id FROM users WHERE phone = '08100000077'");
  await agent.post(`/a/w/${u.id}/nin`, { nin: '22233344455', consent: '1' });
  assert.equal(q.get('SELECT nin_status FROM workers WHERE user_id = ?', u.id).nin_status, 'verified');
  const musa = new Client();
  r = await musa.post('/login', { phone: '08100000077', pin });
  assert.equal(r.location, '/w', 'assisted worker can log in with temp PIN');
  // Worker cannot open agent pages
  assert.equal((await musa.get('/a')).status, 403);
});

test('USSD registration, status and language', async () => {
  const ussd = async (text, phone = '+2348100000055') =>
    (await fetch(`${base}/ussd`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sessionId: 's1', serviceCode: '*384*1#', phoneNumber: phone, text }) })).text();
  assert.match(await ussd(''), /^CON AgroHands/);
  assert.match(await ussd('1'), /full name/);
  assert.match(await ussd('1*Ada Obi*Oyo'), /main work/);
  assert.match(await ussd('1*Ada Obi*Oyo*4*1234*1234'), /^END Registered/);
  assert.equal(q.get("SELECT primary_skill FROM workers w JOIN users u ON u.id = w.user_id WHERE u.phone = '08100000055'").primary_skill, 'harvesting');
  assert.match(await ussd('3'), /Level/);
  assert.match(await ussd('2'), /No offers/);
  assert.match(await ussd('4*2'), /Pidgin/);
  assert.match(await ussd(''), /Work wey dem offer me/);
  // French: listed as option 6, then the menus switch to French.
  assert.match(await ussd('4'), /6\. Français/);
  assert.match(await ussd('4*6'), /Français/);
  assert.match(await ussd(''), /Mes offres d'emploi/);
  assert.match(await ussd('3'), /Niveau/);
});

test('French web journey: browser language, menus and pages', async () => {
  const res = await fetch(`${base}/login`, { headers: { 'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8' } });
  const page = await res.text();
  assert.match(page, /<html lang="fr">/);
  assert.match(page, /Bon retour\. Utilisez le numéro/);
  assert.match(page, /href="\/lang\/fr"[^>]*aria-current="true"/);
  const c = new Client();
  await c.get('/lang/fr');
  assert.equal(c.jar.ah_lang, 'fr');
  const home = await c.get('/');
  assert.match(home.text, /Du travail agricole en toute confiance/);
  // Training is in French too, with no "English for now" note.
  const course = await c.get('/academy/safety-101');
  assert.match(course.text, /Sécurité à la ferme, EPI et premiers secours/);
  assert.match(course.text, /N’incisez pas la plaie/);
  assert.doesNotMatch(course.text, /Course text is in English|Les cours sont en anglais/);
});

test('a French-speaking worker passes the safety quiz in French and is graded correctly', async () => {
  const phone = '08100000066';
  createUser({ phone, pin: '1234', role: 'worker', name: 'Amadou Diallo', lang: 'fr' });
  const c = new Client();
  await c.get('/lang/fr');
  await c.post('/login', { phone, pin: '1234' });
  const quiz = await c.get('/academy/safety-101/quiz');
  assert.match(quiz.text, /On vous demande de pulvériser/);
  assert.match(quiz.text, /Je demande les EPI avant de commencer/);
  // Correct answers are the same indexes as in English.
  const r = await c.post('/academy/safety-101/quiz', { a0: '1', a1: '1', a2: '1', a3: '1' });
  assert.match(r.text, /Bravo ! Vous avez réussi\./);
  const { q } = await import('../src/db.js');
  assert.equal(q.get("SELECT passed FROM course_progress p JOIN users u ON u.id = p.user_id WHERE u.phone = ? AND course_id = 'safety-101'", phone).passed, 1);
});

test('security basics', async () => {
  const c = new Client();
  await c.get('/');
  const res = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `ah_csrf=${c.jar.ah_csrf}` },
    body: 'phone=08030000001&pin=2468', redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.ok(!res.headers.getSetCookie().some((x) => x.startsWith('ah_s=')), 'no login without CSRF token');
  for (let i = 0; i < 5; i++) await c.post('/login', { phone: '08030000001', pin: '0000' });
  await c.post('/login', { phone: '08030000001', pin: '2468' });
  assert.match(flash(c), /15 minutes/, 'locked after 5 wrong PINs');
  const home = await fetch(`${base}/`);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
});

test('every t() key used in routes exists', () => {
  const en = readFileSync(new URL('../src/i18n/en.js', import.meta.url), 'utf8');
  const dir = new URL('../src/routes/', import.meta.url);
  const missing = [];
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\bt\('([a-z0-9_.]+)'\)/g)) if (!en.includes(`'${m[1]}'`)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});
