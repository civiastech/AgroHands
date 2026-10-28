// Error alerts to a chat webhook (Slack or Discord incoming webhook). Throttled so an error storm sends a
// handful of messages, not thousands: the same message at most once per 10 minutes, at most 20 per hour.
import { config } from '../config.js';
import { onError } from './log.js';

const SAME_MESSAGE_MS = 10 * 60 * 1000;
const PER_HOUR = 20;

/** Pure throttle so it can be tested without a network. */
export function createThrottle({ sameMs = SAME_MESSAGE_MS, perHour = PER_HOUR, now = Date.now } = {}) {
  const lastByMsg = new Map();
  let windowStart = 0;
  let count = 0;
  return (msg) => {
    const t = now();
    if (t - windowStart > 3_600_000) { windowStart = t; count = 0; }
    if (count >= perHour) return false;
    if (t - (lastByMsg.get(msg) ?? -Infinity) < sameMs) return false;
    lastByMsg.set(msg, t);
    count++;
    return true;
  };
}

/** Text for the chat message: what, where, and the first useful detail. No personal data beyond what's logged. */
export function formatAlert(msg, data, { env = config.production ? 'production' : 'dev', host = config.baseUrl, version = config.version } = {}) {
  const detail = data.err?.message || data.error || data.problem || '';
  const where = [data.method, data.path].filter(Boolean).join(' ');
  return `🚨 AgroHands ${env} (${host}, v${version}): ${msg}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}${where ? ` [${where}]` : ''}${data.reqId ? ` ref ${data.reqId}` : ''}`;
}

let stop = null;
export function startAlerts(url = config.alertWebhookUrl) {
  if (!url || stop) return;
  const allow = createThrottle();
  stop = onError((msg, data) => {
    if (!allow(msg)) return;
    const text = formatAlert(msg, data);
    // Slack reads "text", Discord reads "content".
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) })
      .catch(() => { /* an unreachable webhook must not cause more errors */ });
  });
}

export function stopAlerts() {
  stop?.();
  stop = null;
}
