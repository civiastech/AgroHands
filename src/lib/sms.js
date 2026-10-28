// Outbound SMS. Every message is written to sms_outbox first, then delivered by drain(), so a provider
// outage never loses a message and never fails the user's request: failed sends retry with backoff.
// Providers: africastalking (production), log (dev: prints the message), memory (tests: see sentSms).
import { q } from '../db.js';
import { config } from '../config.js';
import { log } from './log.js';
import { inc } from './metrics.js';

const MAX_ATTEMPTS = 5;
const BATCH = 25;
// Africa's Talking per-recipient status codes. 100–102 mean accepted; these are final and not worth retrying.
const AT_OK = new Set([100, 101, 102]);
const AT_PERMANENT = new Set([403, 404, 406, 409]); // invalid number, unsupported number, blacklisted, DND rejected

/** Messages delivered by the memory provider (tests read the codes from here). */
export const sentSms = [];

/** 08031234567 → +2348031234567 */
export const toE164 = (phone) => (/^0\d{10}$/.test(phone) ? `+234${phone.slice(1)}` : phone);

/** Queues a message. Returns the outbox id. Call kick() (or let the worker run) to deliver it. */
export function queueSms(phone, kind, body, userId = null) {
  if (!/^0[789][01]\d{8}$/.test(String(phone || ''))) return null; // deleted accounts, malformed numbers
  const { lastInsertRowid } = q.run('INSERT INTO sms_outbox (user_id, phone, kind, body) VALUES (?, ?, ?, ?)', userId, phone, kind, body);
  return Number(lastInsertRowid);
}

async function sendViaProvider(phone, body, c = config.sms) {
  if (c.provider === 'memory') {
    sentSms.push({ to: phone, body, at: Date.now() });
    return { ok: true, ref: `mem-${sentSms.length}` };
  }
  if (c.provider === 'log') {
    log.info('sms (log provider — not sent)', { to: phone, body });
    return { ok: true, ref: 'log' };
  }
  const host = c.username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
  const form = new URLSearchParams({ username: c.username, to: toE164(phone), message: body });
  if (c.senderId) form.set('from', c.senderId);
  const res = await fetch(`${host}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: c.apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, permanent: res.status === 401, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: `bad response: ${text.slice(0, 200)}` }; }
  const r = data?.SMSMessageData?.Recipients?.[0];
  if (!r) return { ok: false, error: data?.SMSMessageData?.Message || 'no recipient in response' };
  if (AT_OK.has(Number(r.statusCode))) return { ok: true, ref: r.messageId };
  return { ok: false, permanent: AT_PERMANENT.has(Number(r.statusCode)), error: `${r.statusCode} ${r.status}` };
}

async function deliver(row) {
  let result;
  try {
    result = await sendViaProvider(row.phone, row.body);
  } catch (err) {
    result = { ok: false, error: err.name === 'TimeoutError' ? 'timeout' : err.message };
  }
  if (result.ok) {
    // One-time codes have done their job; don't keep them readable in the database.
    q.run(`UPDATE sms_outbox SET status = 'sent', sent_at = unixepoch(), attempts = attempts + 1, provider_ref = ?, error = NULL,
             body = CASE WHEN kind = 'otp' THEN '[code removed]' ELSE body END WHERE id = ?`, result.ref || null, row.id);
    inc('sms_sent');
    return true;
  }
  const attempts = row.attempts + 1;
  const final = result.permanent || attempts >= MAX_ATTEMPTS;
  // Backoff: 30s, 1m, 2m, 4m …
  q.run(`UPDATE sms_outbox SET status = ?, attempts = ?, error = ?, next_attempt_at = unixepoch() + ?,
           body = CASE WHEN ? AND kind = 'otp' THEN '[code removed]' ELSE body END WHERE id = ?`,
    final ? 'failed' : 'queued', attempts, String(result.error).slice(0, 300), 30 * 2 ** (attempts - 1), final, row.id);
  inc(final ? 'sms_failed' : 'sms_retry');
  log.warn('sms not delivered', { id: row.id, kind: row.kind, attempts, final, error: result.error });
  return false;
}

/** Delivers one queued message now (used for one-time codes, where the user is waiting). */
export async function sendNow(id) {
  if (!id) return false;
  const row = q.get("UPDATE sms_outbox SET status = 'sending' WHERE id = ? AND status = 'queued' RETURNING *", id);
  return row ? deliver(row) : false;
}

let draining = false;
/** Delivers everything due. Safe to call often; overlapping calls are skipped. */
export async function drain() {
  if (draining) return 0;
  draining = true;
  let n = 0;
  try {
    for (;;) {
      const rows = q.all(`UPDATE sms_outbox SET status = 'sending' WHERE id IN (
          SELECT id FROM sms_outbox WHERE status = 'queued' AND next_attempt_at <= unixepoch() ORDER BY id LIMIT ${BATCH})
        RETURNING *`);
      if (!rows.length) break;
      for (const row of rows) if (await deliver(row)) n++;
    }
  } catch (err) {
    log.error('sms drain failed', { err });
  } finally {
    draining = false;
  }
  return n;
}

/** Ask for delivery soon without blocking the caller (the request that queued the message). */
export function kick() {
  setImmediate(() => { drain().catch(() => {}); });
}

let timer;
/** Background sender: retries and anything kick() missed. Also recovers rows left 'sending' by a crash. */
export function startSmsWorker(everyMs = 15_000) {
  q.run("UPDATE sms_outbox SET status = 'queued' WHERE status = 'sending'");
  timer = setInterval(() => { drain().catch(() => {}); }, everyMs);
  timer.unref();
  kick();
}

export function stopSmsWorker() {
  clearInterval(timer);
  timer = undefined;
}

export { sendViaProvider as _sendViaProvider };
