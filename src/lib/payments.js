// Payments through Paystack (card, bank transfer, USSD). We never see card details: the person pays on
// Paystack's checkout page and we confirm the result server-to-server, both when they come back (callback)
// and from Paystack's signed webhook. Only a verified, amount-checked 'success' unlocks anything.
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { q, audit } from '../db.js';
import { config } from '../config.js';
import { log } from './log.js';
import { inc } from './metrics.js';
import { AppError } from './services.js';

export const paymentsEnabled = () => !!config.paystack.secretKey;

export function hasPaid(userId, purpose, item) {
  return !!q.get("SELECT 1 AS ok FROM payments WHERE user_id = ? AND purpose = ? AND item = ? AND status = 'success'", userId, purpose, item);
}

async function paystack(method, path, body) {
  const res = await fetch(`${config.paystack.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.paystack.secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data?.status) {
    log.warn('paystack request failed', { path: path.replace(/\/verify\/.*/, '/verify/…'), status: res.status, message: data?.message });
    throw new AppError('pay.unavailable', 502);
  }
  return data.data;
}

/**
 * Starts a checkout and returns Paystack's hosted payment page URL.
 * Paystack requires an email; people here sign up with a phone, so we send a placeholder on our own domain.
 */
export async function startPayment({ user, purpose, item, amountNaira, callbackUrl }) {
  if (!paymentsEnabled()) throw new AppError('pay.unavailable', 503);
  const reference = `AHP-${randomBytes(8).toString('hex').toUpperCase()}`;
  const amountKobo = Math.round(amountNaira * 100);
  q.run('INSERT INTO payments (reference, user_id, purpose, item, amount_kobo) VALUES (?, ?, ?, ?, ?)', reference, user.id, purpose, item, amountKobo);
  const host = new URL(config.baseUrl).hostname.replace(/^www\./, '');
  try {
    const data = await paystack('POST', '/transaction/initialize', {
      email: `${user.phone}@${host === 'localhost' ? 'agrohands.ng' : host}`,
      amount: amountKobo,
      currency: 'NGN',
      reference,
      callback_url: callbackUrl,
      channels: ['card', 'bank', 'ussd', 'bank_transfer'],
      metadata: { purpose, item, user_id: user.id, custom_fields: [{ display_name: 'Phone', variable_name: 'phone', value: user.phone }] },
    });
    q.run('UPDATE payments SET access_code = ? WHERE reference = ?', data.access_code, reference);
    audit(user.id, 'payment.start', `payment:${reference}`, { purpose, item, amountKobo });
    return { reference, url: data.authorization_url };
  } catch (err) {
    q.run("UPDATE payments SET status = 'failed', gateway_note = 'initialize failed' WHERE reference = ?", reference);
    throw err;
  }
}

/** Applies a Paystack transaction (from verify or a webhook) to our record. Idempotent. Returns the new status. */
function apply(row, tx) {
  if (row.status === 'success') return 'success';
  if (tx.status === 'success') {
    // Never trust the browser or the event alone: the amount and currency must match what we asked for.
    if (Number(tx.amount) !== row.amount_kobo || String(tx.currency || 'NGN') !== row.currency) {
      q.run("UPDATE payments SET status = 'failed', gateway_note = ? WHERE id = ?", `amount mismatch: ${tx.amount} ${tx.currency}`, row.id);
      log.error('payment amount mismatch', { reference: row.reference, expected: row.amount_kobo, got: tx.amount });
      inc('payment_mismatch');
      return 'failed';
    }
    const { changes } = q.run(
      "UPDATE payments SET status = 'success', paid_at = unixepoch(), channel = ?, provider_id = ? WHERE id = ? AND status != 'success'",
      tx.channel || null, tx.id ? String(tx.id) : null, row.id);
    if (changes) {
      audit(row.user_id, 'payment.success', `payment:${row.reference}`, { purpose: row.purpose, item: row.item, amountKobo: row.amount_kobo });
      inc('payment_success');
    }
    return 'success';
  }
  if (['failed', 'abandoned', 'reversed'].includes(tx.status)) {
    q.run("UPDATE payments SET status = ?, gateway_note = ? WHERE id = ? AND status = 'pending'",
      tx.status === 'abandoned' ? 'abandoned' : 'failed', String(tx.gateway_response || tx.status).slice(0, 200), row.id);
    return tx.status === 'abandoned' ? 'abandoned' : 'failed';
  }
  return 'pending'; // ongoing, pending, queued …
}

/** Asks Paystack for the result of a checkout (used on the callback). */
export async function verifyPayment(reference) {
  const row = q.get('SELECT * FROM payments WHERE reference = ?', String(reference || ''));
  if (!row) throw new AppError('common.not_found', 404);
  if (row.status === 'success') return row;
  const tx = await paystack('GET', `/transaction/verify/${encodeURIComponent(row.reference)}`);
  apply(row, tx);
  return q.get('SELECT * FROM payments WHERE id = ?', row.id);
}

/** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key. */
export function validSignature(raw, signature, secret = config.paystack.secretKey) {
  if (!secret || !raw || !signature) return false;
  const expected = Buffer.from(createHmac('sha512', secret).update(raw).digest('hex'));
  const got = Buffer.from(String(signature));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Handles a verified webhook event. Unknown references and event types are ignored. */
export function handleEvent(event) {
  if (!event || !['charge.success', 'charge.failed'].includes(event.event)) return null;
  const tx = event.data || {};
  const row = q.get('SELECT * FROM payments WHERE reference = ?', String(tx.reference || ''));
  if (!row) return null;
  return apply(row, { ...tx, status: event.event === 'charge.success' ? 'success' : 'failed' });
}
