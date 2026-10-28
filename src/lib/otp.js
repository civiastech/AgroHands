// One-time SMS codes: prove a person owns a phone number (sign-up) and let them reset a forgotten PIN.
// Codes are 6 digits, valid 10 minutes, 5 guesses, stored only as a keyed hash. The browser holds a random
// token that names the pending code, so nothing guessable appears in URLs.
import { randomBytes, randomInt } from 'node:crypto';
import { q, parseJson } from '../db.js';
import { secretHash, safeEqual } from '../auth.js';
import { AppError } from './services.js';
import { queueSms, sendNow, smsBudgetLeft } from './sms.js';
import { log } from './log.js';
import { translator } from '../i18n/index.js';
import { config } from '../config.js';

export const OTP_TTL_SEC = 10 * 60;
export const OTP_MAX_GUESSES = 5;
export const OTP_RESEND_SEC = 60;
export const OTP_PER_HOUR = 5;

const hash = (code) => secretHash('otp', code);

/**
 * Creates a code for phone+purpose and texts it. With send=false (unknown number on PIN reset) the row is
 * still created so the response looks the same, but no SMS goes out and no code can ever match.
 * Returns { token, devCode } — devCode only with the dev "log" SMS provider, for local testing.
 */
export async function issueOtp({ phone, purpose, payload = {}, lang = 'en', send = true, ip = null }) {
  const recent = q.get(
    'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM otp_codes WHERE phone = ? AND purpose = ? AND created_at > unixepoch() - 3600',
    phone, purpose);
  if (recent.n >= OTP_PER_HOUR) throw new AppError('otp.too_many', 429);
  if (recent.last && Date.now() / 1000 - recent.last < OTP_RESEND_SEC) throw new AppError('otp.wait', 429);
  // SMS pumping guards: one source asking for codes to many numbers, and a hard daily SMS budget.
  if (ip && q.get('SELECT COUNT(*) AS n FROM otp_codes WHERE ip = ? AND created_at > unixepoch() - 3600', ip).n >= config.sms.otpPerIpHour) {
    log.warn('one-time code limit per IP reached', { ip });
    throw new AppError('otp.too_many', 429);
  }
  if (send && smsBudgetLeft() <= 0) {
    log.error('SMS daily limit reached — sign-up and PIN reset codes are paused', { limit: config.sms.dailyLimit });
    throw new AppError('otp.unavailable', 503);
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const token = randomBytes(24).toString('base64url');
  q.tx(() => {
    // Only the newest code for a number and purpose is valid.
    q.run('UPDATE otp_codes SET consumed_at = unixepoch() WHERE phone = ? AND purpose = ? AND consumed_at IS NULL', phone, purpose);
    q.run('INSERT INTO otp_codes (token, phone, purpose, code_hash, payload, sent, ip, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() + ?)',
      token, phone, purpose, send ? hash(code) : 'none', JSON.stringify(payload), send ? 1 : 0, ip, OTP_TTL_SEC);
  });
  if (send) {
    const t = translator(lang);
    await sendNow(queueSms(phone, 'otp', t(purpose === 'reset' ? 'sms.otp_reset' : 'sms.otp', { code }), payload.userId ?? null));
  }
  return { token, devCode: send && config.sms.provider === 'log' && !config.production ? code : undefined };
}

/** The pending code a token refers to (for showing the verify page), or null when expired/used. */
export function pendingOtp(token) {
  if (!token || !/^[\w-]{32}$/.test(String(token))) return null;
  const row = q.get('SELECT * FROM otp_codes WHERE token = ? AND consumed_at IS NULL AND expires_at > unixepoch()', token);
  return row && row.attempts < OTP_MAX_GUESSES ? { ...row, payload: parseJson(row.payload, {}) } : null;
}

/** Checks a code. Returns the row (with parsed payload) and marks it used; throws otp.wrong / otp.expired. */
export function consumeOtp(token, code) {
  const row = pendingOtp(token);
  if (!row) throw new AppError('otp.expired');
  const ok = row.code_hash !== 'none' && safeEqual(hash(String(code || '').replace(/\D/g, '')), row.code_hash);
  if (!ok) {
    q.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw new AppError(row.attempts + 1 >= OTP_MAX_GUESSES ? 'otp.expired' : 'otp.wrong');
  }
  // Single use, even if two requests race: only one UPDATE matches.
  const { changes } = q.run('UPDATE otp_codes SET consumed_at = unixepoch() WHERE id = ? AND consumed_at IS NULL', row.id);
  if (!changes) throw new AppError('otp.expired');
  return row;
}

export const pruneOtps = () => q.run('DELETE FROM otp_codes WHERE created_at < unixepoch() - 86400').changes;

/** 08031234567 → 0803 *** 4567 */
export const maskPhone = (p) => (/^\d{11}$/.test(p) ? `${p.slice(0, 4)} *** ${p.slice(7)}` : p);
