// Admin console and Paystack payments (against a fake Paystack server).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';
process.env.SMS_PROVIDER = 'memory';
process.env.ADMIN_PHONES = '08000000001';

const { openDb, q } = await import('../src/db.js');
const { createHandler } = await import('../src/app.js');
const { createUser } = await import('../src/lib/services.js');
const { config } = await import('../src/config.js');
const { toCsv } = await import('../src/routes/admin.js');

const SECRET = 'sk_test_fake_paystack_secret';
let server, base, handler, paystack;
const fake = { initialized: [], results: {} }; // results[reference] = transaction Paystack reports on verify

before(async () => {
  openDb(':memory:');
  handler = createHandler({ limits: { authMax: 10000, writeMax: 10000, windowSec: 60 } });
  server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  paystack = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${SECRET}`) return res.writeHead(401).end('{"status":false}');
    if (req.url === '/transaction/initialize') {
      const b = JSON.parse(body);
      fake.initialized.push(b);
      return res.end(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.com/${b.reference}`, access_code: 'ac_1', reference: b.reference } }));
    }
    const m = /^\/transaction\/verify\/(.+)$/.exec(req.url);
    if (m) return res.end(JSON.stringify({ status: true, data: fake.results[decodeURIComponent(m[1])] || { status: 'ongoing' } }));
    res.writeHead(404).end('{"status":false}');
  });
  await new Promise((r) => paystack.listen(0, '127.0.0.1', r));
  config.paystack.baseUrl = `http://127.0.0.1:${paystack.address().port}`;
});
after(() => { handler.stop(); server.close(); paystack.close(); });

class Client {
  constructor(cookies = {}) { this.jar = { ...cookies }; }
  async req(method, path, form, extraHeaders = {}) {
    const headers = { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '), ...extraHeaders };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: this.jar.ah_csrf, ...form }).toString();
    }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (/Max-Age=0/.test(c)) delete this.jar[kv.slice(0, i)]; else this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text(), headers: res.headers };
  }
  get(path) { return this.req('GET', path); }
  async post(path, form) { if (!this.jar.ah_csrf) await this.get('/'); return this.req('POST', path, form); }
}
const flash = (c) => decodeURIComponent(c.jar.ah_f || '');
async function login(phone, pin, cookies) {
  const c = new Client(cookies);
  await c.post('/login', { phone, pin });
  return c;
}

let admin, adminId, worker, workerId, farmerId;
test('setup', async () => {
  adminId = createUser({ phone: '08000000001', pin: '1111', role: 'worker', name: 'Ada Admin' });
  workerId = createUser({ phone: '08100000001', pin: '2222', role: 'worker', name: 'Bayo Worker' });
  farmerId = createUser({ phone: '08030000001', pin: '3333', role: 'farmer', name: '=HYPERLINK("http://evil")' });
  q.run("INSERT INTO farms (owner_id, name, state, lga) VALUES (?, 'Sunrise Farm', 'Oyo', 'Ogbomoso North')", farmerId);
  const farm = q.get('SELECT id FROM farms').id;
  q.run(`INSERT INTO jobs (farm_id, title, skill, employment_type, start_date, wage_amount, wage_period) VALUES (?, 'Weeding crew', 'weeding', 'casual', '2026-11-10', 4000, 'day')`, farm);
  q.run("INSERT INTO matches (job_id, worker_id, score, status) VALUES (1, ?, 80, 'offered')", workerId);
  admin = await login('08000000001', '1111');
  worker = await login('08100000001', '2222');
  assert.equal(q.get('SELECT role FROM users WHERE id = ?', adminId).role, 'admin');
});

test('every admin page needs the admin role', async () => {
  for (const path of ['/admin', '/admin/users', `/admin/users/${workerId}`, '/admin/farms', '/admin/jobs', '/admin/disputes', '/admin/sms', '/admin/payments', '/admin/audit', '/admin/export/users.csv']) {
    assert.equal((await worker.get(path)).status, 403, path);
    assert.equal((await new Client().get(path)).status, 303, `${path} sends visitors to login`);
    assert.equal((await admin.get(path)).status, 200, `${path} works for admins`);
  }
});

test('overview flags work waiting for staff', async () => {
  const r = await admin.get('/admin');
  assert.match(r.text, /Farms waiting for verification/);
  assert.match(r.text, /aria-current="page"[^>]*>.*Overview/s);
});

test('user search by name or any phone format, and the user page', async () => {
  let r = await admin.get('/admin/users?q=Bayo');
  assert.match(r.text, /Bayo Worker/);
  assert.ok(!r.text.includes(`href="/admin/users/${adminId}"`), 'search results exclude non-matches');
  r = await admin.get('/admin/users?q=%2B234%20810%20000%200001');
  assert.match(r.text, /Bayo Worker/, 'finds +234 numbers');
  r = await admin.get(`/admin/users/${workerId}`);
  assert.match(r.text, /Phone not verified/);
  assert.match(r.text, /1 signed-in device/);
});

test('suspending a user needs a reason, is audited and signs them out at once', async () => {
  let r = await admin.post(`/admin/users/${workerId}`, { role: 'worker', status: 'suspended', reason: 'Fake documents' });
  assert.equal(r.location, `/admin/users/${workerId}`);
  assert.equal(q.get('SELECT status FROM users WHERE id = ?', workerId).status, 'suspended');
  assert.equal((await worker.get('/w')).status, 303, 'signed out');
  const entry = q.get("SELECT meta FROM audit_log WHERE action = 'admin.user_update' ORDER BY id DESC");
  assert.match(entry.meta, /Fake documents/);
  assert.match(entry.meta, /"was":\{"role":"worker","status":"active"\}/);

  r = await admin.post(`/admin/users/${adminId}`, { role: 'worker', status: 'active', reason: 'x' });
  assert.equal(q.get('SELECT role FROM users WHERE id = ?', adminId).role, 'admin', 'admins cannot demote themselves');
  await admin.post(`/admin/users/${workerId}`, { role: 'worker', status: 'active', reason: 'Cleared after review' });
  worker = await login('08100000001', '2222');
});

test('farm verification and job moderation', async () => {
  const farm = q.get('SELECT id FROM farms').id;
  await admin.post(`/admin/farms/${farm}/verify`, { verified: '1' });
  assert.equal(q.get('SELECT verified, verified_by FROM farms WHERE id = ?', farm).verified_by, adminId);
  assert.match((await admin.get('/admin/farms?verified=1')).text, /Sunrise Farm/);

  await admin.post('/admin/jobs/1/close', {});
  assert.equal(q.get('SELECT status FROM jobs WHERE id = 1').status, 'closed');
  assert.equal(q.get('SELECT status FROM matches WHERE job_id = 1').status, 'expired', 'pending offers expire');
  assert.ok(q.get("SELECT 1 FROM audit_log WHERE action = 'admin.job_close'"));
});

test('failed alerts can be retried; sign-up codes cannot', async () => {
  q.run("INSERT INTO sms_outbox (phone, kind, body, status, attempts, error) VALUES ('08100000001', 'offer', 'Offer', 'failed', 5, '409 DoNotDisturbRejection')");
  q.run("INSERT INTO sms_outbox (phone, kind, body, status, attempts, error) VALUES ('08100000001', 'otp', '[code removed]', 'failed', 1, 'timeout')");
  const r = await admin.get('/admin/sms?status=failed');
  assert.match(r.text, /DoNotDisturbRejection/);
  await admin.post('/admin/sms/retry-failed', {});
  const rows = Object.fromEntries(q.all('SELECT kind, status, attempts FROM sms_outbox').map((x) => [x.kind, x]));
  assert.notEqual(rows.offer.status, 'failed', 'alert re-queued');
  assert.equal(rows.otp.status, 'failed', 'codes are never resent from the console');
});

test('CSV exports: no secrets, spreadsheet formulas neutralised, downloads audited', async () => {
  const r = await admin.get('/admin/export/users.csv');
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /agrohands-users-\d{4}-\d{2}-\d{2}\.csv/);
  assert.doesNotMatch(r.text, /pin_hash|nin_hash|pbkdf2/);
  assert.match(r.text, /"'=HYPERLINK\(""http:\/\/evil""\)"/, 'formula cell is prefixed and quoted');
  assert.ok(q.get("SELECT 1 FROM audit_log WHERE action = 'admin.export' AND subject = 'export:users'"));
  assert.equal((await admin.get('/admin/export/secrets.csv')).status, 404);
  assert.equal(toCsv([{ a: '+1', b: 'x,y', c: null }]), 'a,b,c\r\n\'+1,"x,y",\r\n');
});

// ---- Payments -----------------------------------------------------------------------------------
const sign = (body) => createHmac('sha512', SECRET).update(body).digest('hex');
const webhook = (event) => {
  const body = JSON.stringify(event);
  return fetch(`${base}/pay/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(body) }, body });
};

test('with payments off (pilot), the paid course is free', async () => {
  config.paystack.secretKey = '';
  const r = await worker.get('/academy/gap-201');
  assert.match(r.text, /free during the pilot/);
  assert.equal((await worker.get('/academy/gap-201/quiz')).status, 200);
});

test('paid course: checkout on Paystack, verified on return, quiz unlocked', async () => {
  config.paystack.secretKey = SECRET;
  let r = await worker.get('/academy/gap-201');
  assert.match(r.text, /Pay ₦2,000 to take the quiz/);
  r = await worker.get('/academy/gap-201/quiz');
  assert.equal(r.location, '/academy/gap-201', 'quiz locked until paid');
  assert.equal((await worker.post('/academy/gap-201/quiz', { a0: '1', a1: '1', a2: '0' })).location, '/academy/gap-201');

  r = await worker.post('/pay/course/gap-201', {});
  assert.match(r.location, /^https:\/\/checkout\.paystack\.com\/AHP-[0-9A-F]{16}$/);
  const sent = fake.initialized.at(-1);
  assert.equal(sent.amount, 200000, 'kobo');
  assert.equal(sent.currency, 'NGN');
  assert.equal(sent.email, '08100000001@agrohands.ng');
  assert.equal(sent.callback_url, `${config.baseUrl}/pay/callback`);
  const ref = sent.reference;

  // Back from checkout but Paystack has not settled yet: nothing unlocks.
  r = await worker.get(`/pay/callback?reference=${ref}`);
  assert.equal(r.location, '/academy/gap-201');
  assert.match(flash(worker), /still confirming/);

  fake.results[ref] = { id: 991, status: 'success', amount: 200000, currency: 'NGN', channel: 'bank_transfer', reference: ref };
  r = await worker.get(`/pay/callback?reference=${ref}`);
  assert.equal(r.location, '/academy/gap-201/quiz');
  assert.match(flash(worker), /Payment received/);
  assert.equal((await worker.get('/academy/gap-201/quiz')).status, 200);
  const p = q.get('SELECT * FROM payments WHERE reference = ?', ref);
  assert.equal(p.status, 'success');
  assert.equal(p.channel, 'bank_transfer');

  const other = await login('08000000001', '1111');
  assert.equal((await other.get(`/pay/callback?reference=${ref}`)).status, 403, 'cannot claim another person\'s payment');
  assert.match((await admin.get('/admin/payments')).text, /₦2,000/);
});

test('a success with the wrong amount is rejected', async () => {
  const w2 = createUser({ phone: '08100000002', pin: '4444', role: 'worker', name: 'Chi Worker' });
  const c = await login('08100000002', '4444');
  await c.post('/pay/course/gap-201', {});
  const ref = fake.initialized.at(-1).reference;
  fake.results[ref] = { status: 'success', amount: 100, currency: 'NGN', reference: ref };
  const r = await c.get(`/pay/callback?reference=${ref}`);
  assert.equal(r.location, '/academy/gap-201');
  assert.match(flash(c), /not completed/);
  assert.equal(q.get('SELECT status FROM payments WHERE reference = ?', ref).status, 'failed');
  assert.equal(q.get("SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND status = 'success'", w2).n, 0);
});

test('webhook: signature required, success applied once, works without the person returning', async () => {
  const w3 = createUser({ phone: '08100000003', pin: '5555', role: 'worker', name: 'Dayo Worker' });
  const c = await login('08100000003', '5555');
  await c.post('/pay/course/gap-201', {});
  const ref = fake.initialized.at(-1).reference;
  const event = { event: 'charge.success', data: { id: 7, reference: ref, status: 'success', amount: 200000, currency: 'NGN', channel: 'card' } };

  const forged = await fetch(`${base}/pay/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': 'deadbeef' }, body: JSON.stringify(event) });
  assert.equal(forged.status, 401);
  assert.equal(q.get('SELECT status FROM payments WHERE reference = ?', ref).status, 'pending');

  assert.equal((await webhook(event)).status, 200);
  assert.equal((await webhook(event)).status, 200, 'duplicates are harmless');
  assert.equal(q.get('SELECT status FROM payments WHERE reference = ?', ref).status, 'success');
  assert.equal(q.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payment.success' AND subject = ?", `payment:${ref}`).n, 1);
  assert.equal((await c.get('/academy/gap-201/quiz')).status, 200, 'unlocked by the webhook alone');
  void w3;
});

test('inside the Play Store app there is no web checkout (Google Play billing rules)', async () => {
  createUser({ phone: '08100000004', pin: '6666', role: 'worker', name: 'App User' });
  const app = new Client();
  await app.get('/?src=android');
  assert.equal(app.jar.ah_app, '1', 'app launch is remembered');
  await app.post('/login', { phone: '08100000004', pin: '6666' });
  const before = fake.initialized.length;
  let r = await app.get('/academy/gap-201');
  assert.match(r.text, /not available in the Android app/);
  assert.doesNotMatch(r.text, /Pay ₦|\/pay\/course/);
  r = await app.post('/pay/course/gap-201', {});
  assert.equal(r.location, '/academy/gap-201');
  assert.equal(fake.initialized.length, before, 'no checkout started');
  assert.equal((await app.get('/academy/gap-201/quiz')).location, '/academy/gap-201');
});

test('free courses never ask for payment', async () => {
  const r = await worker.get('/academy/safety-101');
  assert.doesNotMatch(r.text, /\/pay\/course/);
  config.paystack.secretKey = '';
});
