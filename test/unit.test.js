import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, rankCandidates, reliability, ratingScore, dailyWage } from '../src/lib/matching.js';
import { computeTier, ageFromDob } from '../src/lib/tiers.js';
import { nameMatch, validNin } from '../src/lib/verify.js';
import { normalisePhone, hashPin, verifyPin } from '../src/auth.js';
import { clauses, buildTerms, addDays } from '../src/lib/contract.js';
import { esc, html, toString } from '../src/html.js';
import { LOCALES } from '../src/i18n/index.js';
import en from '../src/i18n/en.js';

const farm = { state: 'Oyo', lga: 'Ogbomoso North', lat: 8.1339, lng: 4.2401 };
const job = { id: 1, skill: 'harvesting', min_tier: 'bronze', wage_amount: 4500, wage_period: 'day', accommodation: 0 };
const base = {
  user_id: 1, skills: '["harvesting"]', available: 1, tier: 'bronze', dob: '1995-01-01', expected_wage: 4000, wage_period: 'day',
  state: 'Oyo', lga: 'Ogbomoso North', lat: 8.14, lng: 4.25, radius_km: 30, years_exp: 3, assessed_skills: '[]', good: 0, bad: 0, rating_count: 0,
};
const now = new Date('2026-10-27T00:00:00Z');

test('hard filters exclude the wrong people', () => {
  assert.ok(scoreCandidate(job, farm, base, now));
  assert.equal(scoreCandidate(job, farm, { ...base, skills: '["poultry"]' }, now), null, 'missing skill');
  assert.equal(scoreCandidate(job, farm, { ...base, available: 0 }, now), null, 'unavailable');
  assert.equal(scoreCandidate(job, farm, { ...base, tier: 'registered' }, now), null, 'below min tier');
  assert.equal(scoreCandidate(job, farm, { ...base, dob: '2010-06-01' }, now), null, 'under 18');
  assert.equal(scoreCandidate(job, farm, { ...base, expected_wage: 9000 }, now), null, 'asks far above offer');
  assert.equal(scoreCandidate(job, farm, { ...base, lat: 6.5, lng: 3.4 }, now), null, 'too far');
});

test('housing lets willing workers from far away qualify', () => {
  const far = { ...base, lat: 7.4, lng: 3.9, will_relocate: 1 };
  assert.equal(scoreCandidate(job, farm, far, now), null);
  const r = scoreCandidate({ ...job, accommodation: 1 }, farm, far, now);
  assert.ok(r && r.breakdown.relocating);
});

test('better track record ranks higher', () => {
  const proven = { ...base, user_id: 2, tier: 'gold', good: 5, avg_rating: 4.8, rating_count: 5, years_exp: 6, assessed_skills: '["harvesting"]' };
  const ranked = rankCandidates(job, farm, [base, proven], 5, now);
  assert.equal(ranked[0].workerId, 2);
  assert.ok(ranked[0].score <= 100 && ranked[1].score > 0);
});

test('smoothing: new workers are neither punished nor treated as perfect', () => {
  assert.equal(reliability(0, 0), 0.8);
  assert.ok(reliability(10, 0) > 0.95);
  assert.ok(reliability(0, 2) < 0.5);
  assert.equal(ratingScore(0, 0), 0.7);
  assert.equal(dailyWage(78000, 'month'), 3000);
});

test('tiers', () => {
  const w = { nin_status: 'verified', guarantor_status: 'verified', address_status: 'verified', assessed_skills: '["harvesting"]' };
  const s = { safetyPassed: true, completedContracts: 3, ratingCount: 3, avgRating: 4.7 };
  assert.equal(computeTier(w, s), 'gold');
  assert.equal(computeTier(w, { ...s, avgRating: 4 }), 'silver');
  assert.equal(computeTier({ ...w, guarantor_status: 'pending' }, s), 'bronze');
  assert.equal(computeTier(w, { ...s, safetyPassed: false }), 'registered');
  assert.equal(ageFromDob('2008-10-28', now), 17);
  assert.equal(ageFromDob('2008-10-27', now), 18);
});

test('NIN and name matching', () => {
  assert.ok(validNin('12345678901'));
  assert.ok(!validNin('1234567890'));
  assert.equal(nameMatch('Adebayo Ogunleye', 'OGUNLEYE ADEBAYO JOHN'), 1);
  assert.ok(nameMatch('Chiamaka Eze', 'Ngozi Okafor') < 0.5);
  assert.equal(nameMatch('Fúnmiláyọ̀ Ọlá', 'Funmilayo Ola'), 1);
});

test('phone and PIN', () => {
  assert.equal(normalisePhone('+234 803 123 4567'), '08031234567');
  assert.equal(normalisePhone('2348031234567'), '08031234567');
  assert.equal(normalisePhone('8031234567'), '08031234567');
  assert.equal(normalisePhone('0803123'), null);
  const h = hashPin('4821');
  assert.ok(verifyPin('4821', h));
  assert.ok(!verifyPin('4822', h));
});

test('contract has every Labour Act s.7 particular', () => {
  const terms = buildTerms({
    job: { title: 'Harvest', skill: 'harvesting', employment_type: 'casual', start_date: '2026-11-01', duration_days: 30, wage_amount: 4500, wage_period: 'day', hours_per_day: 8, accommodation: 0, meals: 1 },
    farm: { name: 'Test Farm', address: 'Road 1', lga: 'Ogbomoso North', state: 'Oyo' },
    owner: { name: 'Owner', phone: '08030000001' },
    worker: { town: 'Ogbomoso', lga: 'Ogbomoso North', state: 'Oyo', nin_last4: '1234' },
    workerUser: { name: 'Worker', phone: '08100000001' },
  });
  assert.equal(terms.endDate, '2026-11-30');
  const heads = clauses(terms).map(([h]) => h);
  for (const h of ['Parties', 'Nature of work', 'Wages', 'Hours of work', 'Sick leave', 'Annual holiday', 'Notice']) assert.ok(heads.includes(h), h);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('HTML output is escaped', () => {
  assert.equal(esc('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  assert.equal(toString(html`<b>${'<i>'}</b>`), '<b>&lt;i&gt;</b>');
});

test('every translation key exists in English', () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    for (const k of Object.keys(dict)) assert.ok(k in en, `${code} has unknown key ${k}`);
  }
});
