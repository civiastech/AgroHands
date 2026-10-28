// Phone ownership (SMS codes), PIN reset, revocable sessions and SMS delivery.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';
process.env.SMS_PROVIDER = 'memory';

const { openDb, q } = await import('../src/db.js');
const { createHandler } = await import('../src/app.js');
const { createUser } = await import('../src/lib/services.js');
const { sentSms, queueSms, drain, toE164, _sendViaProvider } = await import('../src/lib/sms.js');
const { config } = await import('../src/config.js');
const { LOCALES } = await import('../src/i18n/index.js');
const { SMS_NAME_MAX } = await import('../src/lib/notify.js');

let server, base, handler;
before(async () => {
  openDb(':memory:');
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
      body = new URLSearchParams({ _csrf: this.jar.ah_csrf, ...form }).toString();
    }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (/Max-Age=0/.test(c)) delete this.jar[kv.slice(0, i)]; else this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  get(path) { return this.req('GET', path); }
  async post(path, form) { if (!this.jar.ah_csrf) await this.get('/'); return this.req('POST', path, form); }
  async signedIn() { return (await this.get('/me/pin')).status === 200; }
}

const flash = (c) => decodeURIComponent(c.jar.ah_f || '');
const codeFor = (phone) => /\b(\d{6})\b/.exec(sentSms.filter((m) => m.to === phone).at(-1)?.body || '')?.[1];
const tokenOf = (location) => new URL(location, 'http://x').searchParams.get('t');
const wrong = (code) => String((Number(code) + 1) % 1e6).padStart(6, '0');
const userBy = (phone) => q.get('SELECT * FROM users WHERE phone = ?', phone);

test('sign-up creates the account only after the SMS code proves the phone', async () => {
  const c = new Client();
  const phone = '08061110001';
  let r = await c.post('/register', { role: 'farmer', name: 'Grace Bello', phone, pin: '4826', pin2: '4826', consent: '1' });
  assert.match(r.location, /^\/verify\?t=[\w-]{32}$/);
  assert.equal(userBy(phone), undefined, 'no account before the code');
  assert.equal(c.jar.ah_s, undefined, 'not signed in before the code');
  const code = codeFor(phone);
  assert.match(code, /^\d{6}$/, 'code texted to the number');

  const page = await c.get(r.location);
  assert.match(page.text, /0806 \*\*\* 0001/, 'masked number shown');
  assert.match(page.text, /autocomplete="one-time-code"/);
  assert.doesNotMatch(page.text, new RegExp(code), 'the code itself is never on the page');
});

test('signing up with a number that already has an account is refused before any SMS', async () => {
  createUser({ phone: '08061110009', pin: '1234', role: 'worker', name: 'Existing' });
  const c = new Client();
  const r = await c.post('/register', { role: 'worker', name: 'Someone Else', phone: '08061110009', pin: '1111', pin2: '1111', consent: '1' });
  assert.match(r.location, /^\/register/);
  assert.match(flash(c), /already registered/);
  assert.equal(sentSms.filter((m) => m.to === '08061110009').length, 0);
});

test('wrong codes are counted, and the fifth wrong guess burns the code', async () => {
  const c = new Client();
  const phone = '08061110002';
  const r = await c.post('/register', { role: 'worker', name: 'Sani Musa', phone, pin: '1593', pin2: '1593', consent: '1' });
  const t = tokenOf(r.location);
  const code = codeFor(phone);
  for (let i = 0; i < 4; i++) {
    const x = await c.post('/verify', { t, code: wrong(code) });
    assert.equal(x.location, `/verify?t=${t}`);
    assert.match(flash(c), /not right/);
  }
  const last = await c.post('/verify', { t, code: wrong(code) });
  assert.match(last.location, /^\/register/);
  assert.match(flash(c), /expired/);
  const late = await c.post('/verify', { t, code });
  assert.match(flash(c), /expired/, 'even the right code fails once burned');
  assert.equal(late.location.startsWith('/verify'), false);
  assert.equal(userBy(phone), undefined);
});

test('the right code signs up, marks the phone verified, and cannot be reused', async () => {
  const c = new Client();
  const phone = '08061110003';
  const r = await c.post('/register', { role: 'worker', name: 'Ngozi Eze', phone, pin: '7531', pin2: '7531', consent: '1' });
  const t = tokenOf(r.location);
  const ok = await c.post('/verify', { t, code: codeFor(phone) });
  assert.equal(ok.location, '/w/profile');
  assert.match(flash(c), /confirmed/);
  const u = userBy(phone);
  assert.ok(u.phone_verified_at > 0);
  assert.equal(u.role, 'worker');
  assert.ok(await c.signedIn());

  const again = await new Client().post('/verify', { t, code: codeFor(phone) });
  assert.match(again.location, /^\/register/, 'single use');
  assert.equal(q.get('SELECT COUNT(*) AS n FROM users WHERE phone = ?', phone).n, 1);
  assert.equal(q.get("SELECT body FROM sms_outbox WHERE phone = ? AND kind = 'otp'", phone).body, '[code removed]', 'sent codes are not kept');
  assert.doesNotMatch(q.get('SELECT code_hash FROM otp_codes WHERE token = ?', t).code_hash, /^\d{6}$/, 'codes stored hashed');
});

test('resending is throttled and only the newest code works', async () => {
  const c = new Client();
  const phone = '08061110004';
  const r = await c.post('/register', { role: 'farmer', name: 'Ibrahim Lawal', phone, pin: '8642', pin2: '8642', consent: '1' });
  const t1 = tokenOf(r.location);
  const first = codeFor(phone);
  const soon = await c.post('/verify/resend', { t: t1 });
  assert.equal(soon.location, `/verify?t=${t1}`);
  assert.match(flash(c), /wait a minute/);

  q.run('UPDATE otp_codes SET created_at = created_at - 120 WHERE phone = ?', phone); // a couple of minutes pass
  const re = await c.post('/verify/resend', { t: t1 });
  const t2 = tokenOf(re.location);
  assert.notEqual(t2, t1);
  assert.match(flash(c), /new code/);
  assert.match((await c.post('/verify', { t: t1, code: first })).location, /^\/register/, 'old code is dead');
  assert.equal((await c.post('/verify', { t: t2, code: codeFor(phone) })).location, '/f/farm');
});

test('a number can only receive 5 codes an hour', async () => {
  const phone = '08061110005';
  for (let i = 0; i < 5; i++) {
    q.run('UPDATE otp_codes SET created_at = created_at - 61 WHERE phone = ?', phone);
    const r = await new Client().post('/register', { role: 'worker', name: 'Flood Test', phone, pin: '1111', pin2: '1111', consent: '1' });
    assert.match(r.location, /^\/verify/);
  }
  q.run('UPDATE otp_codes SET created_at = created_at - 61 WHERE phone = ?', phone);
  const c = new Client();
  const r = await c.post('/register', { role: 'worker', name: 'Flood Test', phone, pin: '1111', pin2: '1111', consent: '1' });
  assert.match(r.location, /^\/register/);
  assert.match(flash(c), /Too many codes/);
  assert.equal(sentSms.filter((m) => m.to === phone).length, 5);
});

test('forgot PIN: same answer for unknown numbers, and no SMS is sent to them', async () => {
  const before = sentSms.length;
  const c = new Client();
  const r = await c.post('/forgot', { phone: '08069999999' });
  assert.match(r.location, /^\/verify\?t=/);
  assert.match(flash(c), /If this number has an account/);
  assert.equal(sentSms.length, before, 'nothing sent');
  const page = await c.get(r.location);
  assert.match(page.text, /name="pin2"/, 'looks exactly like a real reset');
  const guess = await c.post('/verify', { t: tokenOf(r.location), code: '123456', pin: '2222', pin2: '2222' });
  assert.match(flash(c), /not right/);
  assert.match(guess.location, /^\/verify/);
});

test('forgot PIN resets the PIN, clears a lockout and signs out every other device', async () => {
  const phone = '08061110006';
  createUser({ phone, pin: '1212', role: 'farmer', name: 'Old Device' });
  const laptop = new Client();
  await laptop.post('/login', { phone, pin: '1212' });
  assert.ok(await laptop.signedIn());
  for (let i = 0; i < 5; i++) await new Client().post('/login', { phone, pin: '0000' });
  assert.ok(userBy(phone).locked_until > 0, 'locked out after wrong PINs');

  const phoneClient = new Client();
  const r = await phoneClient.post('/forgot', { phone });
  const t = tokenOf(r.location);
  let x = await phoneClient.post('/verify', { t, code: codeFor(phone), pin: '3434', pin2: '3435' });
  assert.match(flash(phoneClient), /not the same/, 'PIN checked before the code is spent');
  x = await phoneClient.post('/verify', { t, code: codeFor(phone), pin: '3434', pin2: '3434' });
  assert.equal(x.location, '/f');
  assert.match(flash(phoneClient), /PIN has been changed/);
  assert.ok(await phoneClient.signedIn());
  assert.equal(await laptop.signedIn(), false, 'other device signed out');
  assert.equal(userBy(phone).locked_until, null, 'lockout cleared');

  const old = new Client();
  await old.post('/login', { phone, pin: '1212' });
  assert.equal(await old.signedIn(), false, 'old PIN no longer works');
  const fresh = new Client();
  await fresh.post('/login', { phone, pin: '3434' });
  assert.ok(await fresh.signedIn());
});

test('logout ends the session on the server, so a copied cookie stops working', async () => {
  const phone = '08061110007';
  createUser({ phone, pin: '5656', role: 'worker', name: 'Cookie Thief Victim' });
  const c = new Client();
  await c.post('/login', { phone, pin: '5656' });
  const stolen = c.jar.ah_s;
  assert.match(stolen, /^[\w-]{43}$/);
  assert.equal(q.get('SELECT COUNT(*) AS n FROM sessions WHERE id = ?', stolen).n, 0, 'only a hash of the token is stored');

  await c.post('/logout', {});
  const thief = new Client();
  thief.jar.ah_s = stolen;
  assert.equal(await thief.signedIn(), false);
});

test('changing the PIN keeps this device and signs out the others; suspension signs out everywhere', async () => {
  const phone = '08061110008';
  const id = createUser({ phone, pin: '7878', role: 'worker', name: 'Two Phones' });
  const a = new Client();
  const b = new Client();
  await a.post('/login', { phone, pin: '7878' });
  await b.post('/login', { phone, pin: '7878' });
  assert.match((await a.get('/me/pin')).text, /1 other device/);

  let r = await a.post('/me/pin', { current: '0000', pin: '9090', pin2: '9090' });
  assert.match(flash(a), /current PIN is not right/);
  r = await a.post('/me/pin', { current: '7878', pin: '9090', pin2: '9090' });
  assert.equal(r.location, '/w');
  assert.ok(await a.signedIn(), 'this device stays in');
  assert.equal(await b.signedIn(), false, 'the other device is out');

  await b.post('/login', { phone, pin: '9090' });
  await a.post('/me/signout-others', {});
  assert.equal(await b.signedIn(), false, 'sign out other devices');
  assert.ok(await a.signedIn());

  q.run("UPDATE users SET status = 'suspended' WHERE id = ?", id);
  assert.equal(await a.signedIn(), false, 'suspended users are out at once');
});

test('cookies from the old signed-cookie format are rejected', async () => {
  const c = new Client();
  c.jar.ah_s = '1.9999999999.abcdef';
  assert.equal(await c.signedIn(), false);
});

test('agent sign-up texts the worker so a wrong number is caught at once', async () => {
  createUser({ phone: '08000000008', pin: '8888', role: 'worker', name: 'Field Agent' });
  q.run("UPDATE users SET role = 'agent' WHERE phone = '08000000008'");
  const agent = new Client();
  await agent.post('/login', { phone: '08000000008', pin: '8888' });
  await agent.post('/a/register', { name: 'Musa Ibrahim', phone: '08100000077', state: 'Kwara', lga: 'Ilorin East', skill: 'palm_harvest', consent: '1' });
  const sms = q.get("SELECT * FROM sms_outbox WHERE phone = '08100000077'");
  assert.equal(sms.kind, 'welcome_agent');
  assert.match(sms.body, /\/forgot$/);
});

// ---- SMS delivery ------------------------------------------------------------------------------
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const AT = { provider: 'africastalking', username: 'agrohands', apiKey: 'atsk_test', senderId: 'AgroHands' };
const atReply = (statusCode, status) => new Response(JSON.stringify({
  SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode, status, number: '+2348031234567', messageId: 'ATXid_1' }] },
}), { status: 201 });

test("Africa's Talking request: E.164 number, sender id, API key header", async () => {
  let seen;
  const result = await withFetch(async (url, init) => { seen = { url, init }; return atReply(101, 'Success'); },
    () => _sendViaProvider('08031234567', 'Hello', AT));
  assert.deepEqual(result, { ok: true, ref: 'ATXid_1' });
  assert.equal(seen.url, 'https://api.africastalking.com/version1/messaging');
  assert.equal(seen.init.headers.apiKey, 'atsk_test');
  const form = new URLSearchParams(String(seen.init.body));
  assert.equal(form.get('to'), '+2348031234567');
  assert.equal(form.get('from'), 'AgroHands');
  assert.equal(form.get('username'), 'agrohands');
  assert.equal(toE164('08031234567'), '+2348031234567');

  await withFetch(async (url) => { seen = { url }; return atReply(101, 'Success'); }, () => _sendViaProvider('08031234567', 'x', { ...AT, username: 'sandbox' }));
  assert.match(seen.url, /api\.sandbox\.africastalking\.com/);
});

test('failed SMS retry with backoff; permanent rejections (DND, bad number) stop at once', async () => {
  const saved = { ...config.sms };
  Object.assign(config.sms, AT);
  try {
    const flaky = queueSms('08031234567', 'offer', 'You have an offer');
    await withFetch(async () => new Response('gateway down', { status: 502 }), () => drain());
    let row = q.get('SELECT * FROM sms_outbox WHERE id = ?', flaky);
    assert.equal(row.status, 'queued');
    assert.equal(row.attempts, 1);
    assert.ok(row.next_attempt_at > Date.now() / 1000 + 20, 'backs off');

    q.run('UPDATE sms_outbox SET next_attempt_at = 0 WHERE id = ?', flaky);
    await withFetch(async () => atReply(101, 'Success'), () => drain());
    row = q.get('SELECT * FROM sms_outbox WHERE id = ?', flaky);
    assert.equal(row.status, 'sent');
    assert.equal(row.provider_ref, 'ATXid_1');

    const dnd = queueSms('08031234568', 'otp', 'AgroHands code: 123456');
    await withFetch(async () => atReply(409, 'DoNotDisturbRejection'), () => drain());
    row = q.get('SELECT * FROM sms_outbox WHERE id = ?', dnd);
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 1, 'no pointless retries');
    assert.equal(row.body, '[code removed]', 'failed codes are not kept either');

    const timeout = queueSms('08031234569', 'offer', 'x');
    for (let i = 0; i < 5; i++) {
      q.run('UPDATE sms_outbox SET next_attempt_at = 0 WHERE id = ?', timeout);
      await withFetch(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, () => drain());
    }
    row = q.get('SELECT * FROM sms_outbox WHERE id = ?', timeout);
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 5);
    assert.equal(row.error, 'timeout');
  } finally {
    Object.assign(config.sms, saved);
  }
  assert.equal(queueSms('deleted-12', 'offer', 'x'), null, 'deleted accounts are never texted');
});

test('every SMS text is one GSM 7-bit message (160 characters) in every language, with long values', () => {
  const GSM7 = /^[@£$¥èéùìòÇ\nØø\rÅå_ÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;
  const worst = {
    code: '123456', site: 'app.agrohands.ng', farm: 'X'.repeat(SMS_NAME_MAX), job: 'Y'.repeat(SMS_NAME_MAX), wage: 'N150,000', period: '/ubochi',
    date: '2026-11-03', worker: 'W'.repeat(15), id: '123456', ref: 'AH-2026-000123',
  };
  const problems = [];
  for (const [code, dict] of Object.entries(LOCALES)) {
    for (const [k, v] of Object.entries(dict)) {
      if (!k.startsWith('sms.')) continue;
      let s = v;
      for (const [name, val] of Object.entries(worst)) s = s.replaceAll(`{${name}}`, val);
      if (!GSM7.test(s)) problems.push(`${code} ${k} is not GSM 7-bit: ${s}`);
      if (s.length > 160) problems.push(`${code} ${k} is ${s.length} characters: ${s}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('SMS pumping guards: codes per IP per hour, and a hard daily SMS budget', async () => {
  const { smsLast24h } = await import('../src/lib/sms.js');
  const saved = { ...config.sms };
  try {
    // Per IP: every test client is 127.0.0.1, so allow just two more codes from it.
    config.sms.otpPerIpHour = q.get("SELECT COUNT(*) AS n FROM otp_codes WHERE ip = '127.0.0.1' AND created_at > unixepoch() - 3600").n + 2;
    for (const phone of ['08062220001', '08062220002']) {
      const r = await new Client().post('/register', { role: 'worker', name: 'Ip Test', phone, pin: '1111', pin2: '1111', consent: '1' });
      assert.match(r.location, /^\/verify/);
    }
    const c = new Client();
    const blocked = await c.post('/register', { role: 'worker', name: 'Ip Test', phone: '08062220003', pin: '1111', pin2: '1111', consent: '1' });
    assert.match(blocked.location, /^\/register/);
    assert.match(flash(c), /Too many codes/);
    assert.equal(sentSms.filter((m) => m.to === '08062220003').length, 0);
    config.sms.otpPerIpHour = saved.otpPerIpHour;

    // Daily budget reached: no code is created or sent, the person gets a clear message, alerts stop too.
    config.sms.dailyLimit = smsLast24h();
    const d = new Client();
    const r = await d.post('/register', { role: 'worker', name: 'Budget Test', phone: '08062220004', pin: '1111', pin2: '1111', consent: '1' });
    assert.match(r.location, /^\/register/);
    assert.match(flash(d), /can't send codes right now/);
    assert.equal(q.get("SELECT COUNT(*) AS n FROM otp_codes WHERE phone = '08062220004'").n, 0);
    assert.equal(queueSms('08031234567', 'offer', 'x'), null, 'notifications are held back too');
    assert.equal((await new Client().get('/login')).status, 200, 'the site itself keeps working');
  } finally {
    Object.assign(config.sms, saved);
  }
  const ok = await new Client().post('/register', { role: 'worker', name: 'Budget Test', phone: '08062220004', pin: '1111', pin2: '1111', consent: '1' });
  assert.match(ok.location, /^\/verify/, 'works again once under the limit');
});

test('lockout holds against parallel guessing: 20 PINs at once get at most 5 real checks', async () => {
  const phone = '08061110010';
  createUser({ phone, pin: '9182', role: 'farmer', name: 'Parallel Target' });
  const { checkPin } = await import('../src/auth.js');
  const id = userBy(phone).id;
  const guesses = Array.from({ length: 20 }, (_, i) => String(1000 + i));
  const results = await Promise.all(guesses.map((g) => checkPin(id, g)));
  assert.equal(results.filter((r) => r === 'wrong').length, 5, 'only 5 guesses were actually checked');
  assert.equal(results.filter((r) => r === 'locked').length, 15);
  assert.ok(userBy(phone).locked_until > Date.now() / 1000, 'account locked');
  assert.equal(await checkPin(id, '9182'), 'locked', 'even the right PIN waits out the lock');
  q.run('UPDATE users SET locked_until = NULL, failed_pins = 0 WHERE id = ?', id);
  assert.equal(await checkPin(id, '9182'), 'ok');
});
