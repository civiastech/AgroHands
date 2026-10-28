// Business actions shared by the web app and USSD. All state changes go through here.
import { randomBytes } from 'node:crypto';
import { q, audit, parseJson } from '../db.js';
import { hashPin, revokeSessions } from '../auth.js';
import { config } from '../config.js';
import { buildTerms, nextContractRef } from './contract.js';
import { refreshTier } from './tiers.js';
import { getCourse, PASS_MARK } from '../data/courses.js';
import { notifyOffer, notifyOfferAnswer, notifyContractSigned, notifyDisputeResolved } from './notify.js';

export class AppError extends Error {
  constructor(key, status = 400) {
    super(key);
    this.key = key;
    this.status = status;
  }
}

/** pinHash: an already-hashed PIN (sign-up stores the hash while the SMS code is pending). phoneVerified: the
 *  person proved they own the number (SMS code, or USSD where the network supplies the number). */
export function createUser({ phone, pin, pinHash, role, name, lang = 'en', createdBy = null, consents = ['terms', 'privacy'], phoneVerified = false }) {
  if (q.get('SELECT id FROM users WHERE phone = ?', phone)) throw new AppError('auth.phone_taken');
  const finalRole = config.adminPhones.includes(phone) ? 'admin' : role;
  return q.tx(() => {
    const { lastInsertRowid: id } = q.run(
      `INSERT INTO users (phone, pin_hash, role, name, lang, created_by, phone_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? THEN unixepoch() END)`,
      phone, pinHash || hashPin(pin), finalRole, name.trim(), lang, createdBy, phoneVerified ? 1 : 0,
    );
    for (const purpose of consents) q.run('INSERT INTO consents (user_id, purpose) VALUES (?, ?)', id, purpose);
    if (finalRole === 'worker') q.run('INSERT INTO workers (user_id, languages) VALUES (?, ?)', id, JSON.stringify([lang]));
    audit(createdBy || id, 'user.create', `user:${id}`, { role: finalRole, assisted: !!createdBy });
    return Number(id);
  });
}

export function farmOf(ownerId) {
  return q.get('SELECT * FROM farms WHERE owner_id = ? ORDER BY id LIMIT 1', ownerId);
}

export function sendOffer(jobId, workerId, actorId) {
  const job = q.get('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job || job.status !== 'open') throw new AppError('common.not_found', 404);
  const m = q.get('SELECT * FROM matches WHERE job_id = ? AND worker_id = ?', jobId, workerId);
  if (!m || m.status !== 'shortlisted') throw new AppError('common.error');
  q.run("UPDATE matches SET status = 'offered', offered_at = unixepoch() WHERE id = ?", m.id);
  audit(actorId, 'offer.send', `match:${m.id}`, { jobId, workerId });
  notifyOffer(m.id);
  return m.id;
}

export function pendingOffers(workerId) {
  return q.all(
    `SELECT m.id AS match_id, j.*, f.name AS farm_name, f.state AS farm_state, f.lga AS farm_lga, f.verified AS farm_verified
     FROM matches m JOIN jobs j ON j.id = m.job_id JOIN farms f ON f.id = j.farm_id
     WHERE m.worker_id = ? AND m.status = 'offered' AND j.status = 'open'
     ORDER BY m.offered_at DESC`,
    workerId,
  );
}

/** Worker accepts or declines an offer. Accepting creates a pending contract. */
export function respondToOffer(matchId, workerId, accept) {
  const m = q.get('SELECT * FROM matches WHERE id = ? AND worker_id = ?', matchId, workerId);
  if (!m || m.status !== 'offered') throw new AppError('common.not_found', 404);
  if (!accept) {
    q.run("UPDATE matches SET status = 'declined', responded_at = unixepoch() WHERE id = ?", matchId);
    audit(workerId, 'offer.decline', `match:${matchId}`);
    notifyOfferAnswer(matchId, false);
    return null;
  }
  const busy = q.get("SELECT id FROM contracts WHERE worker_id = ? AND status IN ('pending','active')", workerId);
  if (busy) throw new AppError('common.error');
  const job = q.get('SELECT * FROM jobs WHERE id = ?', m.job_id);
  if (!job || job.status !== 'open') throw new AppError('common.not_found', 404);
  const farm = q.get('SELECT * FROM farms WHERE id = ?', job.farm_id);
  const owner = q.get('SELECT * FROM users WHERE id = ?', farm.owner_id);
  const worker = q.get('SELECT * FROM workers WHERE user_id = ?', workerId);
  const workerUser = q.get('SELECT * FROM users WHERE id = ?', workerId);
  const terms = buildTerms({ job, farm, owner, worker, workerUser });
  const contractId = q.tx(() => {
    q.run("UPDATE matches SET status = 'accepted', responded_at = unixepoch() WHERE id = ?", matchId);
    const { lastInsertRowid } = q.run(
      `INSERT INTO contracts (ref, job_id, match_id, worker_id, farm_id, terms, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      nextContractRef(), job.id, matchId, workerId, farm.id, JSON.stringify(terms), terms.startDate, terms.endDate,
    );
    audit(workerId, 'offer.accept', `match:${matchId}`, { contractId: Number(lastInsertRowid) });
    return Number(lastInsertRowid);
  });
  notifyOfferAnswer(matchId, true, contractId);
  return contractId;
}

export function contractParty(contract, userId) {
  if (contract.worker_id === userId) return 'worker';
  const farm = q.get('SELECT owner_id FROM farms WHERE id = ?', contract.farm_id);
  if (farm?.owner_id === userId) return 'farmer';
  return null;
}

export function signContract(contractId, userId, meta) {
  const c = q.get('SELECT * FROM contracts WHERE id = ?', contractId);
  if (!c || c.status !== 'pending') throw new AppError('common.error');
  const party = contractParty(c, userId);
  if (!party) throw new AppError('common.forbidden', 403);
  const col = party === 'worker' ? 'worker' : 'farmer';
  q.tx(() => {
    q.run(`UPDATE contracts SET ${col}_signed_at = unixepoch(), ${col}_sig_meta = ? WHERE id = ? AND ${col}_signed_at IS NULL`,
      JSON.stringify(meta), contractId);
    const after = q.get('SELECT * FROM contracts WHERE id = ?', contractId);
    if (after.worker_signed_at && after.farmer_signed_at) {
      q.run("UPDATE contracts SET status = 'active' WHERE id = ?", contractId);
      const job = q.get('SELECT * FROM jobs WHERE id = ?', c.job_id);
      const hired = q.get("SELECT COUNT(*) AS n FROM contracts WHERE job_id = ? AND status IN ('active','completed')", c.job_id).n;
      if (hired >= job.headcount) {
        q.run("UPDATE jobs SET status = 'filled', filled_at = unixepoch() WHERE id = ?", c.job_id);
        q.run("UPDATE matches SET status = 'expired' WHERE job_id = ? AND status IN ('shortlisted','offered')", c.job_id);
      }
      q.run('UPDATE workers SET available = 0 WHERE user_id = ?', c.worker_id);
    }
    audit(userId, 'contract.sign', `contract:${contractId}`, { party });
  });
  notifyContractSigned(contractId);
}

export function endContract(contractId, userId, reason) {
  const c = q.get('SELECT * FROM contracts WHERE id = ?', contractId);
  if (!c) throw new AppError('common.not_found', 404);
  const party = contractParty(c, userId);
  const isStaff = ['agent', 'admin'].includes(q.get('SELECT role FROM users WHERE id = ?', userId)?.role);
  if (!party && !isStaff) throw new AppError('common.forbidden', 403);
  const allowed = ['completed', 'worker_left', 'no_show', 'dismissed', 'mutual', 'farm_closed'];
  if (!allowed.includes(reason)) throw new AppError('common.error');
  // Workers cannot mark themselves as no-show/left, farmers cannot erase a record by calling it "completed" early — staff can.
  if (party === 'worker' && ['worker_left', 'no_show'].includes(reason)) throw new AppError('common.forbidden', 403);
  if (c.status === 'pending') {
    q.run("UPDATE contracts SET status = 'cancelled', ended_at = unixepoch(), ended_by = ? WHERE id = ?", userId, contractId);
  } else if (c.status === 'active') {
    const status = reason === 'completed' ? 'completed' : 'terminated';
    q.run('UPDATE contracts SET status = ?, end_reason = ?, ended_at = unixepoch(), ended_by = ? WHERE id = ?',
      status, reason, userId, contractId);
    q.run('UPDATE workers SET available = 1 WHERE user_id = ?', c.worker_id);
  } else {
    throw new AppError('common.error');
  }
  audit(userId, 'contract.end', `contract:${contractId}`, { reason });
  refreshTier(c.worker_id);
}

export function rate(contractId, fromUser, stars, comment) {
  const c = q.get('SELECT * FROM contracts WHERE id = ?', contractId);
  if (!c || !['active', 'completed', 'terminated'].includes(c.status)) throw new AppError('common.error');
  const party = contractParty(c, fromUser);
  if (!party) throw new AppError('common.forbidden', 403);
  const s = Math.round(Number(stars));
  if (!(s >= 1 && s <= 5)) throw new AppError('common.error');
  const toUser = party === 'worker' ? q.get('SELECT owner_id FROM farms WHERE id = ?', c.farm_id).owner_id : c.worker_id;
  q.run(
    `INSERT INTO ratings (contract_id, from_user, to_user, stars, comment) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (contract_id, from_user) DO UPDATE SET stars = excluded.stars, comment = excluded.comment`,
    contractId, fromUser, toUser, s, String(comment || '').slice(0, 500),
  );
  if (party === 'farmer') refreshTier(c.worker_id);
}

export function openDispute(contractId, userId, category, description) {
  const c = q.get('SELECT * FROM contracts WHERE id = ?', contractId);
  if (!c || !contractParty(c, userId)) throw new AppError('common.forbidden', 403);
  const cats = ['pay', 'conduct', 'safety', 'absence', 'theft', 'other'];
  if (!cats.includes(category) || !String(description || '').trim()) throw new AppError('common.error');
  const { lastInsertRowid } = q.run(
    'INSERT INTO disputes (contract_id, raised_by, category, description) VALUES (?, ?, ?, ?)',
    contractId, userId, category, String(description).slice(0, 2000),
  );
  audit(userId, 'dispute.open', `dispute:${lastInsertRowid}`, { contractId, category });
  return Number(lastInsertRowid);
}

export function gradeQuiz(userId, courseId, answers) {
  const course = getCourse(courseId);
  if (!course) throw new AppError('common.not_found', 404);
  const correct = course.quiz.reduce((n, item, i) => n + (Number(answers[i]) === item.answer ? 1 : 0), 0);
  const score = Math.round((correct / course.quiz.length) * 100);
  const passed = score >= PASS_MARK;
  const existing = q.get('SELECT * FROM course_progress WHERE user_id = ? AND course_id = ?', userId, courseId);
  const cert = passed ? existing?.cert_code || `AHC-${randomBytes(4).toString('hex').toUpperCase()}` : existing?.cert_code || null;
  q.run(
    `INSERT INTO course_progress (user_id, course_id, score, passed, attempts, cert_code, completed_at)
     VALUES (?, ?, ?, ?, 1, ?, CASE WHEN ? THEN unixepoch() END)
     ON CONFLICT (user_id, course_id) DO UPDATE SET
       score = MAX(COALESCE(course_progress.score, 0), excluded.score),
       passed = MAX(course_progress.passed, excluded.passed),
       attempts = course_progress.attempts + 1,
       cert_code = COALESCE(course_progress.cert_code, excluded.cert_code),
       completed_at = COALESCE(course_progress.completed_at, excluded.completed_at)`,
    userId, courseId, score, passed ? 1 : 0, cert, passed ? 1 : 0,
  );
  refreshTier(userId);
  return { score, passed, correct, total: course.quiz.length, cert };
}

/** Sets a new PIN, clears any lockout and signs the user out everywhere except (optionally) this device. */
export function setPin(userId, pin, { keepSessionId, actorId = userId, reason = 'change' } = {}) {
  q.tx(() => {
    q.run('UPDATE users SET pin_hash = ?, failed_pins = 0, locked_until = NULL WHERE id = ?', hashPin(pin), userId);
    revokeSessions(userId, { exceptId: keepSessionId });
    audit(actorId, 'user.pin_' + reason, `user:${userId}`);
  });
}

/** Admin closes a dispute; the person who raised it is told by SMS. */
export function resolveDispute(disputeId, adminId, status, resolution) {
  const st = ['resolved', 'rejected'].includes(status) ? status : 'resolved';
  const { changes } = q.run(
    "UPDATE disputes SET status = ?, resolution = ?, resolved_by = ?, resolved_at = unixepoch() WHERE id = ? AND status = 'open'",
    st, String(resolution || '').slice(0, 1000), adminId, disputeId);
  if (!changes) throw new AppError('common.not_found', 404);
  audit(adminId, 'dispute.' + st, `dispute:${disputeId}`);
  notifyDisputeResolved(disputeId);
}

export function profileComplete(w) {
  return !!(w && w.state && w.lga && w.dob && parseJson(w.skills).length && w.expected_wage);
}

/** NDPA right to erasure: anonymise the person, keep contract records the law requires. */
export function deleteAccount(userId) {
  const phone = q.get('SELECT phone FROM users WHERE id = ?', userId)?.phone;
  q.tx(() => {
    revokeSessions(userId);
    q.run("UPDATE sms_outbox SET phone = 'deleted', body = '[removed]', status = CASE WHEN status = 'sent' THEN 'sent' ELSE 'failed' END WHERE user_id = ? OR phone = ?", userId, phone);
    q.run('DELETE FROM otp_codes WHERE phone = ?', phone);
    q.run(
      `UPDATE users SET status = 'deleted', name = 'Deleted user', phone = 'deleted-' || id, pin_hash = 'x' WHERE id = ?`,
      userId,
    );
    q.run(
      `UPDATE workers SET dob = NULL, lat = NULL, lng = NULL, town = NULL, guarantor_name = NULL, guarantor_phone = NULL,
         guarantor_relation = NULL, nin_hash = NULL, available = 0 WHERE user_id = ?`,
      userId,
    );
    audit(userId, 'user.delete', `user:${userId}`);
  });
}
