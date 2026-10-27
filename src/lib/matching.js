// Matching engine: hard filters, then a weighted score. Pure scoring core + DB wrapper.
//
// Score (0–100) = skill fit 30 + reliability 25 + rating 20 + distance 15 + trust tier 10.
// Weights are deliberately simple and explainable; tune them from 90-day retention data.
import { q, parseJson } from '../db.js';
import { estimateDistanceKm } from './geo.js';
import { tierRank, ageFromDob } from './tiers.js';

export const WEIGHTS = { skill: 30, reliability: 25, rating: 20, distance: 15, tier: 10 };
export const SHORTLIST_SIZE = 5;
const RELOCATE_RADIUS_KM = 600;
const WAGE_TOLERANCE = 1.15; // worker's ask may be up to 15% above the offer
const WORKING_DAYS_PER_MONTH = 26;

export const dailyWage = (amount, period) => (period === 'month' ? amount / WORKING_DAYS_PER_MONTH : amount);

/** Bayesian-smoothed reliability: new workers start at 0.8, not a perfect 1.0. */
export const reliability = (good, bad) => (good + 2 * 0.8) / (good + bad + 2);

/** Bayesian-smoothed rating on a 0–1 scale; new workers start at 3.5 stars. */
export const ratingScore = (avg, n) => ((avg || 0) * n + 3.5 * 2) / (n + 2) / 5;

/**
 * Score one candidate for a job. Returns null when a hard filter excludes them.
 * @param job job row, @param farm farm row, @param c candidate (worker row + stats)
 */
export function scoreCandidate(job, farm, c, now = new Date()) {
  const skills = parseJson(c.skills);
  if (!skills.includes(job.skill)) return null;
  if (!c.available) return null;
  if (tierRank(c.tier) < tierRank(job.min_tier)) return null;
  const age = ageFromDob(c.dob, now);
  if (age !== null && age < 18) return null;

  const offerDaily = dailyWage(job.wage_amount, job.wage_period);
  if (c.expected_wage) {
    const askDaily = dailyWage(c.expected_wage, c.wage_period);
    if (askDaily > offerDaily * WAGE_TOLERANCE) return null;
  }

  const { km, precise } = estimateDistanceKm(c, farm);
  const canRelocate = job.accommodation && c.will_relocate;
  const maxKm = canRelocate ? RELOCATE_RADIUS_KM : Math.max(5, c.radius_km || 30);
  if (km > maxKm) return null;

  const assessed = parseJson(c.assessed_skills).includes(job.skill);
  let skillFit = 0.55 + 0.35 * Math.min((c.years_exp || 0) / 5, 1);
  if (c.primary_skill === job.skill) skillFit += 0.05;
  if (assessed) skillFit += 0.05;
  skillFit = Math.min(skillFit, 1);

  const rel = reliability(c.good || 0, c.bad || 0);
  const rat = ratingScore(c.avg_rating, c.rating_count || 0);
  const dist = canRelocate && km > (c.radius_km || 30) ? 0.5 : Math.max(0, 1 - km / maxKm);
  const tierScore = [0, 0.5, 0.8, 1][tierRank(c.tier)];

  const parts = {
    skill: skillFit * WEIGHTS.skill,
    reliability: rel * WEIGHTS.reliability,
    rating: rat * WEIGHTS.rating,
    distance: dist * WEIGHTS.distance,
    tier: tierScore * WEIGHTS.tier,
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    workerId: c.user_id,
    score: Math.round(score * 10) / 10,
    breakdown: {
      ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      km: Math.round(km),
      kmPrecise: precise,
      assessed,
      relocating: !!(canRelocate && km > (c.radius_km || 30)),
    },
  };
}

export function rankCandidates(job, farm, candidates, limit = SHORTLIST_SIZE, now = new Date()) {
  return candidates
    .map((c) => scoreCandidate(job, farm, c, now))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.breakdown.km - b.breakdown.km)
    .slice(0, limit);
}

/** Loads candidates with their stats in one query (fast enough for tens of thousands of workers). */
export function loadCandidates(job) {
  return q.all(
    `SELECT w.*, u.name,
       COALESCE(cs.good, 0) AS good, COALESCE(cs.bad, 0) AS bad,
       rs.avg AS avg_rating, COALESCE(rs.n, 0) AS rating_count
     FROM workers w
     JOIN users u ON u.id = w.user_id AND u.status = 'active'
     LEFT JOIN (
       SELECT worker_id,
         SUM(CASE WHEN status = 'completed' OR (status = 'terminated' AND end_reason IN ('mutual','farm_closed')) THEN 1 ELSE 0 END) AS good,
         SUM(CASE WHEN status = 'terminated' AND end_reason IN ('worker_left','no_show') THEN 1 ELSE 0 END) AS bad
       FROM contracts GROUP BY worker_id
     ) cs ON cs.worker_id = w.user_id
     LEFT JOIN (SELECT to_user, AVG(stars) AS avg, COUNT(*) AS n FROM ratings GROUP BY to_user) rs ON rs.to_user = w.user_id
     WHERE w.available = 1
       AND w.skills LIKE ?
       AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.worker_id = w.user_id AND c.status IN ('pending','active'))
       AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.worker_id = w.user_id AND m.job_id = ? AND m.status IN ('declined','offered','accepted','withdrawn'))`,
    `%"${job.skill}"%`,
    job.id,
  );
}

/** Rebuilds the shortlist for a job and stores it. Keeps existing offers untouched. */
export function refreshShortlist(jobId) {
  const job = q.get('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) return [];
  const farm = q.get('SELECT * FROM farms WHERE id = ?', job.farm_id);
  const hired = q.get("SELECT COUNT(*) AS n FROM contracts WHERE job_id = ? AND status IN ('pending','active','completed')", jobId).n;
  const slots = Math.max(job.headcount - hired, 0);
  const limit = Math.max(SHORTLIST_SIZE, slots * 2);
  const ranked = rankCandidates(job, farm, loadCandidates(job), limit);
  q.tx(() => {
    q.run("DELETE FROM matches WHERE job_id = ? AND status = 'shortlisted'", jobId);
    for (const r of ranked) {
      q.run(
        `INSERT INTO matches (job_id, worker_id, score, breakdown, status) VALUES (?, ?, ?, ?, 'shortlisted')
         ON CONFLICT (job_id, worker_id) DO NOTHING`,
        jobId, r.workerId, r.score, JSON.stringify(r.breakdown),
      );
    }
  });
  return ranked;
}
