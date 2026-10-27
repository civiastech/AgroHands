// PIN hashing, signed session cookies, CSRF tokens, lockout. Built on node:crypto only.
import { pbkdf2Sync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
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

export const validPin = (pin) => /^\d{4,6}$/.test(String(pin || ''));

const sign = (value) => createHmac('sha256', config.secret).update(value).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeSessionCookie(userId) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const value = `${userId}.${exp}`;
  return `${value}.${sign(value)}`;
}

export function readSession(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!safeEqual(sig, sign(`${id}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const user = q.get("SELECT * FROM users WHERE id = ? AND status = 'active'", Number(id));
  return user || null;
}

export const sessionMaxAge = SESSION_DAYS * 86400;

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

export function isLocked(user) {
  return user.locked_until && user.locked_until > Date.now() / 1000;
}

export function recordPinAttempt(user, ok) {
  if (ok) {
    q.run('UPDATE users SET failed_pins = 0, locked_until = NULL WHERE id = ?', user.id);
    return;
  }
  const failed = user.failed_pins + 1;
  const lock = failed >= MAX_FAILED ? Math.floor(Date.now() / 1000) + LOCK_MINUTES * 60 : null;
  q.run('UPDATE users SET failed_pins = ?, locked_until = ? WHERE id = ?', lock ? 0 : failed, lock, user.id);
}
