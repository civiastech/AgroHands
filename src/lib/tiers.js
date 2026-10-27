// Trust tiers. Pure functions + one DB helper that recomputes and stores a worker's tier.
import { q, parseJson } from '../db.js';

export const TIER_ORDER = ['registered', 'bronze', 'silver', 'gold'];
export const tierRank = (t) => Math.max(0, TIER_ORDER.indexOf(t));

/**
 * @param {object} w worker row
 * @param {object} s stats { safetyPassed, completedContracts, avgRating, ratingCount }
 */
export function computeTier(w, s) {
  const bronze = w.nin_status === 'verified' && s.safetyPassed;
  if (!bronze) return 'registered';
  const silver = w.guarantor_status === 'verified' && w.address_status === 'verified';
  if (!silver) return 'bronze';
  const gold =
    parseJson(w.assessed_skills).length > 0 &&
    s.completedContracts >= 3 &&
    s.ratingCount >= 3 &&
    s.avgRating >= 4.5;
  return gold ? 'gold' : 'silver';
}

export function workerStats(userId) {
  const safety = q.get("SELECT passed FROM course_progress WHERE user_id = ? AND course_id = 'safety-101'", userId);
  const c = q.get(
    `SELECT
       SUM(CASE WHEN status = 'completed' OR (status = 'terminated' AND end_reason IN ('mutual','farm_closed')) THEN 1 ELSE 0 END) AS good,
       SUM(CASE WHEN status = 'terminated' AND end_reason IN ('worker_left','no_show') THEN 1 ELSE 0 END) AS bad
     FROM contracts WHERE worker_id = ?`,
    userId,
  );
  const r = q.get('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM ratings WHERE to_user = ?', userId);
  return {
    safetyPassed: !!safety?.passed,
    completedContracts: Number(c?.good || 0),
    badExits: Number(c?.bad || 0),
    avgRating: r?.avg ? Number(r.avg) : 0,
    ratingCount: Number(r?.n || 0),
  };
}

export function refreshTier(userId) {
  const w = q.get('SELECT * FROM workers WHERE user_id = ?', userId);
  if (!w) return null;
  const tier = computeTier(w, workerStats(userId));
  if (tier !== w.tier) q.run('UPDATE workers SET tier = ?, updated_at = unixepoch() WHERE user_id = ?', tier, userId);
  return tier;
}

export function ageFromDob(dob, now = new Date()) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob + 'T00:00:00Z');
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
