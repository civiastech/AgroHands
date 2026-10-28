// Off-site backups: compress + encrypt (AES-256-GCM), then upload to any S3-compatible bucket
// (Cloudflare R2, Backblaze B2, AWS S3, Wasabi, MinIO). AWS Signature V4 with node:crypto only.
//
// Encrypted file layout: "AHB1" | 12-byte IV | 16-byte auth tag | ciphertext(gzip(sqlite file))
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const MAGIC = Buffer.from('AHB1');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

export function encryptBackup(plain, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(gzipSync(plain, { level: 9 })), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(blob, keyHex) {
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error('not an AgroHands encrypted backup');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), blob.subarray(4, 16));
  decipher.setAuthTag(blob.subarray(16, 32));
  // final() throws if the key is wrong or the file was altered.
  return gunzipSync(Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]));
}

/** AWS Signature V4 Authorization header for an S3 request. */
export function signV4({ method, url, headers, payloadHash, region, accessKeyId, secretAccessKey, amzDate, service = 's3' }) {
  const u = new URL(url);
  const all = { ...headers, host: u.host };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalQuery = [...u.searchParams].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonical = [method, u.pathname, canonicalQuery, names.map((k) => `${k}:${lower[k]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256', key).update(toSign).digest('hex')}`;
}

const objectUrl = (s3, key) =>
  `${s3.endpoint.replace(/\/$/, '')}/${encodeURIComponent(s3.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function s3Request(s3, method, key, body) {
  const url = objectUrl(s3, key);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = sha256(body || '');
  const headers = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (body) headers['content-type'] = 'application/octet-stream';
  headers.authorization = signV4({ method, url, headers, payloadHash, region: s3.region, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, amzDate });
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`S3 ${method} ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

export const putObject = (s3, key, body) => s3Request(s3, 'PUT', key, body);
export const getObject = async (s3, key) => Buffer.from(await (await s3Request(s3, 'GET', key)).arrayBuffer());

/** Encrypts a local backup and uploads it. Returns the object key. */
export async function uploadBackup(s3, keyHex, plain, fileName, now = new Date()) {
  const key = `${s3.prefix}${now.toISOString().slice(0, 7)}/${fileName}.gz.enc`; // agrohands/2026-11/agrohands-….db.gz.enc
  const blob = encryptBackup(plain, keyHex);
  await putObject(s3, key, blob);
  return { key, bytes: blob.length };
}

/** Pings a dead-man's-switch monitor (Healthchecks.io, Better Stack heartbeat, Cronitor). Never throws. */
export async function heartbeat(url, ok = true) {
  if (!url) return;
  try {
    await fetch(ok ? url : `${url.replace(/\/$/, '')}/fail`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
  } catch { /* monitoring must never break the backup */ }
}
