// Off-site backups (encryption, S3 signing, upload, restore), heartbeat and error alerts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';

const { signV4, encryptBackup, decryptBackup } = await import('../src/lib/offsite.js');
const { createThrottle, formatAlert } = await import('../src/lib/alerts.js');
const { log, onError, configureLogger } = await import('../src/lib/log.js');
const { validateConfig, config } = await import('../src/config.js');

const run = promisify(execFile);
const KEY = randomBytes(32).toString('hex');
let s3, s3Url, dir;
const objects = new Map();
const hits = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ah-backup-'));
  // A tiny S3 stand-in: stores PUT bodies, serves GETs, and records the auth header and heartbeats.
  s3 = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    hits.push({ method: req.method, url: req.url, auth: req.headers.authorization, sha: req.headers['x-amz-content-sha256'], body });
    if (req.url.startsWith('/heartbeat')) return res.end('ok');
    if (req.method === 'PUT') { objects.set(req.url, body); return res.end(); }
    if (req.method === 'GET' && objects.has(req.url)) return res.end(objects.get(req.url));
    res.writeHead(404).end('NoSuchKey');
  });
  await new Promise((r) => s3.listen(0, '127.0.0.1', r));
  s3Url = `http://127.0.0.1:${s3.address().port}`;
});
after(() => { s3.close(); rmSync(dir, { recursive: true, force: true }); });

test('AWS Signature V4 matches the published AWS example', () => {
  // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — "GET Object" example.
  const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const auth = signV4({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { range: 'bytes=0-9', 'x-amz-content-sha256': empty, 'x-amz-date': '20130524T000000Z' },
    payloadHash: empty, region: 'us-east-1', amzDate: '20130524T000000Z',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });
  assert.equal(auth, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
    + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('backups are compressed and encrypted; a wrong key or a changed byte is detected', () => {
  const plain = Buffer.from('SQLite format 3\0' + 'x'.repeat(5000));
  const blob = encryptBackup(plain, KEY);
  assert.equal(blob.subarray(0, 4).toString(), 'AHB1');
  assert.ok(blob.length < plain.length / 5, 'compressed');
  assert.ok(!blob.includes(Buffer.from('SQLite')), 'no plaintext');
  assert.deepEqual(decryptBackup(blob, KEY), plain);
  assert.throws(() => decryptBackup(blob, randomBytes(32).toString('hex')));
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptBackup(tampered, KEY));
  assert.throws(() => encryptBackup(plain, 'abc'), /64 hex/);
});

test('off-site settings are validated: no unencrypted uploads, https only', () => {
  const base = { ...config, offsite: { endpoint: 'https://acc.r2.cloudflarestorage.com', region: 'auto', bucket: 'ah', accessKeyId: 'k', secretAccessKey: 's', prefix: 'agrohands/' }, backupEncryptionKey: KEY };
  assert.deepEqual(validateConfig(base).filter((e) => /BACKUP|ALERT/.test(e)), []);
  assert.ok(validateConfig({ ...base, backupEncryptionKey: '' }).some((e) => /BACKUP_ENCRYPTION_KEY/.test(e)));
  assert.ok(validateConfig({ ...base, offsite: { ...base.offsite, endpoint: 'http://r2.example' } }).some((e) => /https/.test(e)));
  assert.ok(validateConfig({ ...base, offsite: { ...base.offsite, secretAccessKey: '' } }).some((e) => /SECRET_ACCESS_KEY/.test(e)));
  assert.ok(validateConfig({ ...base, alertWebhookUrl: 'http://hooks.example' }).some((e) => /ALERT_WEBHOOK_URL/.test(e)));
});

test('backup script: local copy, encrypted upload, heartbeat; restore script brings it back', async () => {
  const dbPath = join(dir, 'live.db');
  const live = new DatabaseSync(dbPath);
  live.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users (name) VALUES ('Adebayo'), ('Ngozi');");
  live.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT); INSERT INTO schema_migrations VALUES (4, \'004_payments.sql\');');
  live.close();
  const env = {
    ...process.env, DB_PATH: dbPath, BACKUP_DIR: join(dir, 'backups'), LOG_FORMAT: 'json', LOG_LEVEL: 'info',
    BACKUP_S3_ENDPOINT: s3Url, BACKUP_S3_BUCKET: 'ah-backups', BACKUP_S3_ACCESS_KEY_ID: 'AKIDTEST', BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
    BACKUP_S3_REGION: 'auto', BACKUP_ENCRYPTION_KEY: KEY, BACKUP_HEARTBEAT_URL: `${s3Url}/heartbeat/abc`,
  };
  const { stdout } = await run(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/backup.js'], { env });
  assert.match(stdout, /off-site backup uploaded/);
  assert.equal(readdirSync(join(dir, 'backups')).length, 1, 'local copy kept');

  const put = hits.find((h) => h.method === 'PUT');
  assert.match(put.url, /^\/ah-backups\/agrohands\/\d{4}-\d{2}\/agrohands-[\dT-]+\.db\.gz\.enc$/);
  assert.match(put.auth, /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(put.sha, createHash('sha256').update(put.body).digest('hex'), 'payload hash signed');
  assert.ok(!put.body.includes(Buffer.from('Adebayo')), 'names never leave the server in clear');
  assert.ok(hits.some((h) => h.url === '/heartbeat/abc'), 'heartbeat sent');

  const key = decodeURIComponent(put.url.replace('/ah-backups/', ''));
  const out = join(dir, 'restored.db');
  const restored = await run(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/restore.js', '--s3', key, out], { env });
  assert.match(restored.stdout, /integrity ok, schema 4, 2 users/);
  const check = new DatabaseSync(out, { readOnly: true });
  assert.deepEqual(check.prepare('SELECT name FROM users ORDER BY id').all().map((r) => r.name), ['Adebayo', 'Ngozi']);
  check.close();

  // From a downloaded file too, and never over an existing file.
  const file = join(dir, 'download.enc');
  writeFileSync(file, objects.get(put.url));
  await assert.rejects(run(process.execPath, ['scripts/restore.js', file, out], { env }), /already exists/);
  const out2 = join(dir, 'restored2.db');
  await run(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/restore.js', file, out2], { env });
  assert.ok(existsSync(out2));
  await assert.rejects(run(process.execPath, ['scripts/restore.js', file, join(dir, 'x.db')], { env: { ...env, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex') } }), /Could not decrypt/);
});

test('a failing upload is an error, pings the heartbeat /fail URL and exits non-zero', async () => {
  const dbPath = join(dir, 'live.db');
  const env = {
    ...process.env, DB_PATH: dbPath, BACKUP_DIR: join(dir, 'backups2'),
    BACKUP_S3_ENDPOINT: 'http://127.0.0.1:9', BACKUP_S3_BUCKET: 'ah', BACKUP_S3_ACCESS_KEY_ID: 'k', BACKUP_S3_SECRET_ACCESS_KEY: 's',
    BACKUP_ENCRYPTION_KEY: KEY, BACKUP_HEARTBEAT_URL: `${s3Url}/heartbeat/xyz`,
  };
  await assert.rejects(run(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/backup.js'], { env }), (err) => err.code === 1);
  assert.ok(hits.some((h) => h.url === '/heartbeat/xyz/fail'));
  assert.ok(!hits.some((h) => h.url === '/heartbeat/xyz'), 'no success ping');
});

test('error alerts: hook fires on error logs, throttled per message and per hour, useful text', () => {
  const seen = [];
  configureLogger({ sink: () => {} }); // keep the test output clean
  const off = onError((msg, data) => seen.push([msg, data]));
  log.warn('just a warning');
  log.error('backup failed', { err: new Error('disk full') });
  off();
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1].err.message, 'disk full');

  let t = 0;
  const allow = createThrottle({ now: () => t });
  assert.equal(allow('db down'), true);
  assert.equal(allow('db down'), false, 'same message suppressed');
  t += 11 * 60 * 1000;
  assert.equal(allow('db down'), true, 'again after 10 minutes');
  for (let i = 0; i < 30; i++) allow(`other ${i}`);
  assert.equal(allow('new problem'), false, 'hourly cap');
  t += 61 * 60 * 1000;
  assert.equal(allow('new problem'), true);

  const text = formatAlert('unhandled error', { err: { message: 'boom' }, method: 'POST', path: '/c/1/sign', reqId: 'r-1' }, { env: 'production', host: 'https://agrohands.ng', version: '1.3.0' });
  assert.equal(text, '🚨 AgroHands production (https://agrohands.ng, v1.3.0): unhandled error — boom [POST /c/1/sign] ref r-1');
});

test('create-admin: first admin from the command line, with a one-time PIN; promoting resets the PIN', async () => {
  const env = { ...process.env, DB_PATH: join(dir, 'admin.db') };
  const node = [process.execPath, '--disable-warning=ExperimentalWarning', 'scripts/create-admin.js'];
  const first = await run(node[0], [...node.slice(1), '+234 803 123 4567', 'Joshua', 'Oladeji'], { env });
  const pin = /One-time PIN: (\d{6})/.exec(first.stdout)[1];
  const db = new DatabaseSync(env.DB_PATH);
  const u = db.prepare("SELECT * FROM users WHERE phone = '08031234567'").get();
  assert.equal(u.role, 'admin');
  assert.equal(u.name, 'Joshua Oladeji');
  assert.ok(u.phone_verified_at > 0);
  db.close();
  const { verifyPin } = await import('../src/auth.js');
  assert.ok(verifyPin(pin, u.pin_hash));

  const again = await run(node[0], [...node.slice(1), '08031234567'], { env });
  assert.match(again.stdout, /Promoted admin 08031234567/);
  const pin2 = /One-time PIN: (\d{6})/.exec(again.stdout)[1];
  const db2 = new DatabaseSync(env.DB_PATH);
  const u2 = db2.prepare("SELECT pin_hash FROM users WHERE phone = '08031234567'").get();
  db2.close();
  assert.ok(verifyPin(pin2, u2.pin_hash) && (pin2 === pin || !verifyPin(pin, u2.pin_hash)), 'old PIN replaced');
  await assert.rejects(run(node[0], [...node.slice(1), 'not-a-phone'], { env }), (e) => e.code === 2);
});
