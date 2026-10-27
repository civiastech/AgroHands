// NIN verification adapter. Switch provider with NIN_PROVIDER — no code changes needed.
//   manual : free. Stores a keyed hash; an agent confirms the physical NIN slip + face. (Pilot default.)
//   mock   : demo/testing. Any NIN passes except those starting 0000.
//   dojah  : paid API (~$0.04–0.06 per call). Confirm endpoint/fields against current Dojah docs before go-live.
// We never store the full NIN: only a keyed hash (to stop one NIN opening many accounts) and the last 4 digits.
import { config } from '../config.js';
import { ninHash } from '../auth.js';
import { log } from './log.js';

export const validNin = (nin) => /^\d{11}$/.test(String(nin || ''));

const tokens = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((x) => x.length > 1);

/** Share of the account name's tokens that appear in the ID name (order-insensitive). */
export function nameMatch(accountName, idName) {
  const a = tokens(accountName);
  const b = new Set(tokens(idName));
  if (!a.length || !b.size) return 0;
  return a.filter((t) => b.has(t)).length / a.length;
}

async function dojahLookup(nin) {
  const { baseUrl, appId, secretKey } = config.dojah;
  if (!appId || !secretKey) throw new Error('Dojah credentials missing');
  const res = await fetch(`${baseUrl}/api/v1/kyc/nin?nin=${encodeURIComponent(nin)}`, {
    headers: { AppId: appId, Authorization: secretKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return { found: false };
  if (!res.ok) throw new Error(`Dojah HTTP ${res.status}`);
  const body = await res.json();
  const e = body.entity || {};
  return {
    found: true,
    name: [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' '),
    dob: e.date_of_birth || null,
    gender: e.gender || null,
    ref: body.reference_id || null,
  };
}

/**
 * @returns {Promise<{status:'verified'|'pending_agent'|'failed', reason?:string, hash:string, last4:string, dob?:string, ref?:string, provider:string}>}
 */
export async function verifyNin(nin, accountName, provider = config.ninProvider) {
  const hash = ninHash(nin);
  const last4 = String(nin).slice(-4);
  const base = { hash, last4, provider };

  if (provider === 'manual') return { ...base, status: 'pending_agent' };

  if (provider === 'mock') {
    if (String(nin).startsWith('0000')) return { ...base, status: 'failed', reason: 'not_found' };
    return { ...base, status: 'verified', ref: `mock-${last4}` };
  }

  if (provider === 'dojah') {
    try {
      const r = await dojahLookup(nin);
      if (!r.found) return { ...base, status: 'failed', reason: 'not_found' };
      if (nameMatch(accountName, r.name) < 0.5) return { ...base, status: 'failed', reason: 'name_mismatch' };
      const dob = r.dob && /^\d{4}-\d{2}-\d{2}/.test(r.dob) ? r.dob.slice(0, 10) : undefined;
      return { ...base, status: 'verified', ref: r.ref, dob };
    } catch (err) {
      log.error('nin provider error', { provider: config.ninProvider, message: err.message });
      // Provider down: fall back to agent confirmation rather than blocking the worker.
      return { ...base, status: 'pending_agent', reason: 'provider_error' };
    }
  }
  throw new Error(`Unknown NIN provider: ${provider}`);
}
