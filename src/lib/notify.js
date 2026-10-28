// SMS notifications for the moments people must not miss: an offer, an answer, a contract to sign.
// Text is in the recipient's own language (sms.* keys), kept to the GSM 7-bit alphabet so one message
// is one SMS on any phone. Delivery is queued; a failed provider never breaks the action that triggered it.
import { q } from '../db.js';
import { config } from '../config.js';
import { translator } from '../i18n/index.js';
import { queueSms, kick } from './sms.js';

const site = () => config.baseUrl.replace(/^https?:\/\//, '');
// Farm and job names are cut to this length so every message fits one SMS (checked in test/auth.test.js).
export const SMS_NAME_MAX = 24;

/** Queues sms.<key> for a user. Missing, deleted or suspended users are skipped. */
export function notify(userId, key, vars = {}) {
  const u = q.get("SELECT id, phone, lang, name FROM users WHERE id = ? AND status = 'active'", userId);
  if (!u) return null;
  const t = translator(u.lang);
  const id = queueSms(u.phone, key, t(`sms.${key}`, { site: site(), ...vars }), u.id);
  if (id) kick();
  return id;
}

const firstName = (name) => (String(name || '').trim().split(/\s+/)[0] || '').slice(0, 15);
const farmOwner = (farmId) => q.get('SELECT owner_id FROM farms WHERE id = ?', farmId)?.owner_id;

export function notifyOffer(matchId) {
  const m = q.get(`SELECT m.worker_id, j.title, j.wage_amount, j.wage_period, j.start_date, f.name AS farm
                   FROM matches m JOIN jobs j ON j.id = m.job_id JOIN farms f ON f.id = j.farm_id WHERE m.id = ?`, matchId);
  if (!m) return;
  const lang = q.get('SELECT lang FROM users WHERE id = ?', m.worker_id)?.lang;
  const t = translator(lang);
  notify(m.worker_id, 'offer', {
    farm: m.farm.slice(0, SMS_NAME_MAX), job: m.title.slice(0, SMS_NAME_MAX), wage: `N${Number(m.wage_amount).toLocaleString('en-NG')}`,
    period: t(m.wage_period === 'month' ? 'sms.per_month' : 'sms.per_day'), date: m.start_date,
  });
}

export function notifyOfferAnswer(matchId, accepted, contractId) {
  const m = q.get(`SELECT j.title, j.farm_id, u.name AS worker FROM matches m JOIN jobs j ON j.id = m.job_id
                   JOIN users u ON u.id = m.worker_id WHERE m.id = ?`, matchId);
  if (!m) return;
  notify(farmOwner(m.farm_id), accepted ? 'offer_accepted' : 'offer_declined',
    { worker: firstName(m.worker), job: m.title.slice(0, SMS_NAME_MAX), id: contractId ?? '' });
}

/** After one side signs: ask the other side to sign, or tell both the contract is active. */
export function notifyContractSigned(contractId) {
  const c = q.get('SELECT * FROM contracts WHERE id = ?', contractId);
  if (!c) return;
  const owner = farmOwner(c.farm_id);
  if (c.status === 'active') {
    for (const uid of [c.worker_id, owner]) notify(uid, 'contract_active', { ref: c.ref, date: c.start_date });
  } else if (c.worker_signed_at && !c.farmer_signed_at) {
    notify(owner, 'contract_sign', { ref: c.ref, id: c.id });
  } else if (c.farmer_signed_at && !c.worker_signed_at) {
    notify(c.worker_id, 'contract_sign', { ref: c.ref, id: c.id });
  }
}

export function notifyDisputeResolved(disputeId) {
  const d = q.get('SELECT d.raised_by, c.ref FROM disputes d JOIN contracts c ON c.id = d.contract_id WHERE d.id = ?', disputeId);
  if (d) notify(d.raised_by, 'dispute_resolved', { ref: d.ref });
}
