// Demo data for pilots, demos and testing. Run: npm run seed   (uses DB_PATH; refuses to run in production)
// Demo logins (PIN 1234 for all):
//   Admin   08000000001     Agent  08000000002
//   Farmer  08030000001 (Farmnest Ogbomoso pineapple farm)
//   Worker  08100000001 … (25 workers across Oyo, Osun, Ogun, Kwara)
import { config } from '../src/config.js';
import { openDb, q } from '../src/db.js';
import { createUser } from '../src/lib/services.js';
import { refreshTier } from '../src/lib/tiers.js';
import { ninHash } from '../src/auth.js';
import { refreshShortlist } from '../src/lib/matching.js';

if (config.production) {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

openDb(config.dbPath);
if (q.get('SELECT COUNT(*) AS n FROM users').n > 0) {
  console.log('Database already has users — skipping seed.');
  process.exit(0);
}

const PIN = '1234';
const admin = createUser({ phone: '08000000001', pin: PIN, role: 'worker', name: 'Platform Admin' });
q.run("UPDATE users SET role = 'admin' WHERE id = ?", admin);
q.run('DELETE FROM workers WHERE user_id = ?', admin);
const agent = createUser({ phone: '08000000002', pin: PIN, role: 'worker', name: 'Kunle Agent' });
q.run("UPDATE users SET role = 'agent' WHERE id = ?", agent);
q.run('DELETE FROM workers WHERE user_id = ?', agent);

const farmer = createUser({ phone: '08030000001', pin: PIN, role: 'farmer', name: 'Joshua Oladeji' });
const { lastInsertRowid: farmId } = q.run(
  `INSERT INTO farms (owner_id, name, state, lga, address, lat, lng, size_ha, crops, verified, verified_by, plan)
   VALUES (?, 'Farmnest Ogbomoso Smart Pineapple Farm', 'Oyo', 'Ogbomoso North', 'Off Ogbomoso–Ilorin road', 8.1339, 4.2401, 20, 'Pineapple, oil palm', 1, ?, 'pro')`,
  farmer, agent,
);

// Workers: [name, state, lga, lat, lng, skills, primary, years, wage, period, relocate, tierPlan]
const W = [
  ['Adebayo Ogunleye', 'Oyo', 'Ogbomoso North', 8.14, 4.25, ['harvesting', 'weeding', 'planting'], 'harvesting', 6, 4000, 'day', 0, 'gold'],
  ['Musa Ibrahim', 'Oyo', 'Ogbomoso South', 8.12, 4.24, ['harvesting', 'palm_harvest', 'land_clearing'], 'palm_harvest', 8, 4500, 'day', 1, 'silver'],
  ['Chiamaka Eze', 'Oyo', 'Surulere', 8.07, 4.37, ['nursery', 'planting', 'weeding'], 'nursery', 3, 3500, 'day', 0, 'silver'],
  ['Tunde Afolabi', 'Oyo', 'Ogo Oluwa', 7.95, 4.2, ['spraying', 'weeding', 'harvesting'], 'spraying', 4, 4000, 'day', 0, 'bronze'],
  ['Bisi Adeyemi', 'Oyo', 'Ogbomoso North', 8.15, 4.23, ['harvesting', 'processing'], 'processing', 2, 3500, 'day', 0, 'bronze'],
  ['Emeka Nwosu', 'Oyo', 'Oyo West', 7.84, 3.93, ['tractor', 'maintenance', 'driver'], 'tractor', 10, 150000, 'month', 1, 'gold'],
  ['Halima Sani', 'Kwara', 'Ilorin East', 8.5, 4.6, ['poultry', 'farmhand'], 'poultry', 5, 90000, 'month', 1, 'silver'],
  ['Segun Bello', 'Oyo', 'Ogbomoso South', 8.11, 4.26, ['harvesting', 'weeding', 'farmhand'], 'farmhand', 1, 3000, 'day', 0, 'registered'],
  ['Yusuf Abdullahi', 'Kwara', 'Ilorin South', 8.45, 4.55, ['harvesting', 'palm_harvest'], 'palm_harvest', 7, 5000, 'day', 1, 'bronze'],
  ['Funke Ojo', 'Osun', 'Ejigbo', 7.9, 4.31, ['planting', 'weeding', 'harvesting'], 'planting', 4, 3500, 'day', 1, 'silver'],
  ['Ifeanyi Okafor', 'Osun', 'Iwo', 7.63, 4.18, ['drip_irrigation', 'greenhouse'], 'drip_irrigation', 5, 120000, 'month', 1, 'gold'],
  ['Kehinde Alabi', 'Oyo', 'Surulere', 8.06, 4.36, ['harvesting', 'weeding'], 'harvesting', 3, 3800, 'day', 0, 'bronze'],
  ['Aisha Bello', 'Oyo', 'Ogbomoso North', 8.13, 4.22, ['harvesting', 'processing', 'planting'], 'harvesting', 2, 3500, 'day', 0, 'bronze'],
  ['Gbenga Oladipo', 'Oyo', 'Ibadan North', 7.41, 3.91, ['supervisor', 'harvesting', 'farmhand'], 'supervisor', 9, 180000, 'month', 1, 'gold'],
  ['Ngozi Umeh', 'Ogun', 'Abeokuta South', 7.15, 3.35, ['greenhouse', 'nursery'], 'greenhouse', 4, 100000, 'month', 1, 'silver'],
  ['Sule Garba', 'Oyo', 'Ogo Oluwa', 7.96, 4.19, ['security', 'farmhand'], 'security', 6, 80000, 'month', 1, 'silver'],
  ['Ronke Adewale', 'Oyo', 'Ogbomoso South', 8.1, 4.27, ['harvesting', 'weeding'], 'weeding', 1, 3000, 'day', 0, 'bronze'],
  ['Peter Ayodele', 'Oyo', 'Ogbomoso North', 8.16, 4.26, ['harvesting'], 'harvesting', 0, 9000, 'day', 0, 'bronze'],
  ['Zainab Lawal', 'Kwara', 'Offa', 8.15, 4.72, ['harvesting', 'planting'], 'planting', 3, 3500, 'day', 1, 'bronze'],
  ['Ola Martins', 'Oyo', 'Surulere', 8.05, 4.35, ['spraying', 'drip_irrigation'], 'spraying', 5, 4500, 'day', 0, 'silver'],
  ['Danjuma Audu', 'Oyo', 'Ogbomoso North', 8.14, 4.24, ['land_clearing', 'farmhand', 'harvesting'], 'land_clearing', 4, 3500, 'day', 0, 'bronze'],
  ['Mercy Okon', 'Oyo', 'Oyo East', 7.85, 3.95, ['poultry', 'piggery'], 'piggery', 3, 85000, 'month', 0, 'bronze'],
  ['Femi Akande', 'Osun', 'Ejigbo', 7.91, 4.3, ['harvesting', 'palm_harvest', 'weeding'], 'harvesting', 5, 4000, 'day', 1, 'silver'],
  ['Tope Olaniyan', 'Oyo', 'Ogbomoso South', 8.12, 4.25, ['harvesting', 'weeding'], 'harvesting', 2, 3500, 'day', 0, 'bronze'],
  ['Uche Obi', 'Ogun', 'Ijebu Ode', 6.82, 3.92, ['fish_farming', 'farmhand'], 'fish_farming', 4, 90000, 'month', 0, 'silver'],
];

W.forEach(([name, state, lga, lat, lng, skills, primary, years, wage, period, relocate, plan], i) => {
  const phone = `081000000${String(i + 1).padStart(2, '0')}`;
  const id = createUser({ phone, pin: PIN, role: 'worker', name, createdBy: agent });
  const year = 1980 + (i % 20);
  q.run(
    `UPDATE workers SET state = ?, lga = ?, town = ?, lat = ?, lng = ?, skills = ?, primary_skill = ?, years_exp = ?,
       expected_wage = ?, wage_period = ?, will_relocate = ?, dob = ?, gender = ?, radius_km = 30 WHERE user_id = ?`,
    state, lga, lga, lat, lng, JSON.stringify(skills), primary, years, wage, period, relocate,
    `${year}-0${(i % 9) + 1}-1${i % 9}`, i % 3 === 2 ? 'female' : 'male', id,
  );
  if (plan !== 'registered') {
    const fakeNin = String(70000000000 + i * 7919);
    q.run(`UPDATE workers SET nin_hash = ?, nin_last4 = ?, nin_status = 'verified', nin_provider = 'seed', nin_verified_at = unixepoch() WHERE user_id = ?`,
      ninHash(fakeNin), fakeNin.slice(-4), id);
    q.run("INSERT INTO course_progress (user_id, course_id, score, passed, attempts, cert_code, completed_at) VALUES (?, 'safety-101', 100, 1, 1, ?, unixepoch())",
      id, `AHC-SEED${String(i).padStart(4, '0')}`);
  }
  if (plan === 'silver' || plan === 'gold') {
    q.run("UPDATE workers SET guarantor_name = 'Rev. A. Adeoye', guarantor_phone = '08099999999', guarantor_relation = 'Pastor', guarantor_status = 'verified', address_status = 'verified' WHERE user_id = ?", id);
  }
  if (plan === 'gold') {
    q.run('UPDATE workers SET assessed_skills = ? WHERE user_id = ?', JSON.stringify([primary]), id);
    // Three completed past jobs with 5-star ratings
    for (let k = 0; k < 3; k++) {
      const { lastInsertRowid: jobId } = q.run(
        `INSERT INTO jobs (farm_id, title, skill, headcount, employment_type, start_date, duration_days, wage_amount, wage_period, status)
         VALUES (?, ?, ?, 1, 'casual', '2026-0${k + 3}-01', 14, ?, ?, 'filled')`, farmId, `Past job ${k + 1}`, primary, wage, period);
      const { lastInsertRowid: cId } = q.run(
        `INSERT INTO contracts (ref, job_id, worker_id, farm_id, terms, status, worker_signed_at, farmer_signed_at, start_date, end_reason, ended_at)
         VALUES (?, ?, ?, ?, '{}', 'completed', unixepoch(), unixepoch(), '2026-0${k + 3}-01', 'completed', unixepoch())`,
        `AH-2026-S${id}${k}`, jobId, id, farmId);
      q.run('INSERT INTO ratings (contract_id, from_user, to_user, stars, comment) VALUES (?, ?, ?, 5, ?)', cId, farmer, id, 'Hard-working and punctual');
    }
  }
  refreshTier(id);
});

// Pending agent tasks for the demo
q.run(`UPDATE workers SET nin_status = 'pending_agent', nin_last4 = '4821', nin_hash = ? WHERE user_id = (SELECT id FROM users WHERE phone = '08100000008')`, ninHash('12345674821'));

// One open job ready to match
const { lastInsertRowid: jobId } = q.run(
  `INSERT INTO jobs (farm_id, title, skill, headcount, employment_type, start_date, duration_days, wage_amount, wage_period,
     hours_per_day, accommodation, meals, min_tier, description)
   VALUES (?, 'Pineapple harvest crew', 'harvesting', 4, 'seasonal', ?, 30, 4500, 'day', 8, 0, 1, 'bronze',
     'Harvest, sort and crate MD2 pineapples. Lunch provided. Crates and gloves supplied.')`,
  farmId, new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
);
refreshShortlist(Number(jobId));

console.log(`Seeded: admin, agent, 1 farm, ${W.length} workers, 1 open job (shortlist built).`);
console.log('Logins (PIN 1234): admin 08000000001 · agent 08000000002 · farmer 08030000001 · worker 08100000001');
