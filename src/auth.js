// PIN hashing, revocable sessions, CSRF tokens, lockout. Built on node:crypto only.
import { pbkdf2, pbkdf2Sync, randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { q } from './db.js';

const ITER = 120000;
const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(String(pin), salt, ITER, 32, 'sha256').toString('hex');
  return `pbkdf2$${ITER}$${salt}$${hash}`;
}

export function verifyPin(pin, stored) {
  const [, iter, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = pbkdf2Sync(String(pin), salt, Number(iter), 32, 'sha256');
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && timingSafeEqual(known, test);
}

// Async versions for request handlers. PIN hashing is deliberately slow (~40 ms of CPU); the sync versions
// block every other request while they run. These run on libuv's thread pool, so a burst of logins uses all
// cores and pages keep loading meanwhile (measured with scripts/loadtest.js).
const pbkdf2Async = promisify(pbkdf2);

export async function hashPinAsync(pin) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await pbkdf2Async(String(pin), salt, ITER, 32, 'sha256')).toString('hex');
  return `pbkdf2$${ITER}$${salt}$${hash}`;
}

export async function verifyPinAsync(pin, stored) {
  const [, iter, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = await pbkdf2Async(String(pin), salt, Number(iter), 32, 'sha256');
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && timingSafeEqual(known, test);
}

export const validPin = (pin) => /^\d{4,6}$/.test(String(pin || ''));


function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Sessions live in the database so they can be revoked: logout, PIN change/reset, suspension and
// account deletion end them immediately. The cookie holds a random token; only its SHA-256 is stored.
const tokenId = (token) => createHash('sha256').update(String(token)).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const TOUCH_EVERY = 600; // write last_seen_at at most every 10 minutes

/** Starts a session and returns the cookie value. */
export function createSession(userId, { ip, userAgent } = {}) {
  const token = randomBytes(32).toString('base64url');
  q.run('INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
    tokenId(token), userId, now() + SESSION_DAYS * 86400, ip || null, String(userAgent || '').slice(0, 200) || null);
  return token;
}

export function readSession(token) {
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const row = q.get(
    `SELECT u.*, s.id AS session_id, s.last_seen_at AS session_seen FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > unixepoch() AND u.status = 'active'`, tokenId(token));
  if (!row) return null;
  if (now() - row.session_seen > TOUCH_EVERY) q.run('UPDATE sessions SET last_seen_at = unixepoch() WHERE id = ?', row.session_id);
  delete row.session_seen;
  return row;
}

export function destroySession(token) {
  if (token) q.run('DELETE FROM sessions WHERE id = ?', tokenId(token));
}

/** Signs the user out everywhere, optionally keeping one session (the device making the change). */
export function revokeSessions(userId, { exceptId } = {}) {
  q.run('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?', userId, exceptId ?? null);
}

export const pruneSessions = () => q.run('DELETE FROM sessions WHERE expires_at <= unixepoch()').changes;

export const sessionMaxAge = SESSION_DAYS * 86400;

/** Keyed hash for short secrets (one-time codes) so the database never holds them in clear. */
export const secretHash = (purpose, value) => createHmac('sha256', `${purpose}:${config.secret}`).update(String(value)).digest('hex');
export { safeEqual };

export const newCsrfToken = () => randomBytes(18).toString('base64url');

/** Keyed hash so the same NIN can't register twice — without storing the NIN itself. */
export const ninHash = (nin) => createHmac('sha256', `nin:${config.secret}`).update(String(nin)).digest('hex');

export function normalisePhone(input) {
  let p = String(input || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+234')) p = '0' + p.slice(4);
  else if (p.startsWith('234') && p.length === 13) p = '0' + p.slice(3);
  if (/^[789]\d{9}$/.test(p)) p = '0' + p;
  return /^0[789][01]\d{8}$/.test(p) ? p : null;
}

/**
 * Checks a PIN with lockout: 5 wrong PINs lock the account for 15 minutes. Returns 'ok', 'wrong' or 'locked'.
 * The attempt is counted *before* the (async, slow) hash check, so firing many guesses in parallel cannot
 * slip past the limit: the database row, updated synchronously, is the single source of truth.
 */
export async function checkPin(userId, pin) {
  const now = Math.floor(Date.now() / 1000);
  const row = q.get('SELECT pin_hash, failed_pins, locked_until FROM users WHERE id = ?', userId);
  if (!row) return 'wrong';
  if (row.locked_until && row.locked_until > now) return 'locked';
  if (row.failed_pins >= MAX_FAILED) {
    // Guesses already in flight used up the allowance.
    q.run('UPDATE users SET failed_pins = 0, locked_until = ? WHERE id = ?', now + LOCK_MINUTES * 60, userId);
    return 'locked';
  }
  q.run('UPDATE users SET failed_pins = failed_pins + 1 WHERE id = ?', userId); // reserve this attempt
  const ok = await verifyPinAsync(pin, row.pin_hash);
  if (ok) {
    q.run('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = ?', userId);
    return 'ok';
  }
  const after = q.get('SELECT failed_pins FROM users WHERE id = ?', userId).failed_pins;
  if (after >= MAX_FAILED) q.run('UPDATE users SET failed_pins = 0, locked_until = ? WHERE id = ?', now + LOCK_MINUTES * 60, userId);
  return 'wrong';
}
