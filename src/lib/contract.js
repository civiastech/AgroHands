// Contract generation. Produces the written particulars required by Labour Act s.7
// (parties, nature of work, wages and payment interval, hours, leave, sick pay, notice),
// snapshotted as JSON at creation so later edits to the job can't change a signed contract.
import { q } from '../db.js';
import { config } from '../config.js';

export const NOTICE_SCHEDULE = [
  { service: 'Up to 3 months', notice: '1 day' },
  { service: '3 months to 2 years', notice: '1 week' },
  { service: '2 to 5 years', notice: '2 weeks' },
  { service: '5 years and above', notice: '1 month' },
];

export function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildTerms({ job, farm, owner, worker, workerUser }) {
  const endDate = job.duration_days ? addDays(job.start_date, job.duration_days - 1) : null;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    employer: {
      name: owner.name,
      phone: owner.phone,
      farmName: farm.name,
      address: [farm.address, farm.lga, farm.state].filter(Boolean).join(', '),
      cac: farm.cac_number || null,
    },
    worker: {
      name: workerUser.name,
      phone: workerUser.phone,
      address: [worker.town, worker.lga, worker.state].filter(Boolean).join(', '),
      ninLast4: worker.nin_last4 || null,
    },
    job: {
      title: job.title,
      skill: job.skill,
      type: job.employment_type,
      description: job.description || '',
      place: [farm.name, farm.address, farm.lga, farm.state].filter(Boolean).join(', '),
    },
    startDate: job.start_date,
    endDate,
    wage: {
      amount: job.wage_amount,
      period: job.wage_period,
      payInterval: job.wage_period === 'day' ? (job.duration_days && job.duration_days <= 14 ? 'end of engagement or weekly' : 'weekly') : 'monthly',
      method: 'Legal tender, paid in full by bank transfer, mobile wallet or cash against receipt',
    },
    hoursPerDay: job.hours_per_day,
    daysPerWeek: 6,
    accommodation: !!job.accommodation,
    meals: !!job.meals,
    agency: {
      name: 'AgroHands',
      role: 'Licensed private employment agency. AgroHands introduced the parties and records this contract; it is not the employer.',
      feeNote: `No fee is charged to the worker. Service fees are paid by the employer.`,
    },
  };
}

export function nextContractRef() {
  const year = new Date().getUTCFullYear();
  const row = q.get('SELECT COUNT(*) AS n FROM contracts');
  return `AH-${year}-${String(row.n + 1).padStart(6, '0')}`;
}

/** Clauses rendered in the contract document (English, legally operative text). */
export function clauses(t) {
  const wageLine = `₦${Number(t.wage.amount).toLocaleString('en-NG')} per ${t.wage.period}`;
  const duration = t.endDate ? `from ${t.startDate} to ${t.endDate} (fixed term)` : `from ${t.startDate} until ended by notice (open-ended)`;
  return [
    ['Parties', `This contract is between ${t.employer.name} trading as ${t.employer.farmName} ("the Employer") and ${t.worker.name} ("the Worker").`],
    ['Nature of work', `The Worker is engaged as: ${t.job.title}. ${t.job.description}`.trim()],
    ['Place of work', t.job.place],
    ['Duration', `Employment runs ${duration}.`],
    ['Wages', `${wageLine}, paid ${t.wage.payInterval}. ${t.wage.method}. No deduction shall be made from wages except as permitted by the Labour Act or other law. No wage shall be paid in goods or in place of money.`],
    ['Hours of work', `Normal hours are ${t.hoursPerDay} hours a day, up to ${t.daysPerWeek} days a week, with a rest break of at least 1 hour per day. Work beyond normal hours is by agreement and paid as overtime.`],
    ['Housing and meals', `Housing: ${t.accommodation ? 'provided by the Employer, safe and with clean water' : 'not provided'}. Meals: ${t.meals ? 'provided by the Employer' : 'not provided'}.`],
    ['Safety', 'The Employer shall provide the personal protective equipment (PPE) the work requires, safe tools, clean drinking water, a first-aid kit and access to medical help. The Worker shall use PPE provided and follow safety instructions. No spraying without PPE.'],
    ['Sick leave', 'After the Worker has served continuously, the Worker is entitled to paid sick leave of up to 12 working days in a year on presentation of a medical certificate, as provided by the Labour Act.'],
    ['Annual holiday', 'After 12 months of continuous service the Worker is entitled to at least 6 working days of holiday with full pay, as provided by the Labour Act.'],
    ['Notice', `Either party may end this contract by giving notice according to the Worker's length of continuous service: ${NOTICE_SCHEDULE.map((n) => `${n.service}: ${n.notice}`).join('; ')}; or by paying wages in lieu of notice. Serious misconduct may lead to dismissal without notice after a fair hearing.`],
    ['Identity documents', 'The Employer shall not keep the Worker’s identity documents, phone or other personal property as security.'],
    ['Disputes', 'The parties shall first report any dispute through AgroHands for mediation within 48 hours. Unresolved matters may be referred to the Federal Ministry of Labour and Employment or the courts.'],
    ['Agency', `${t.agency.role} ${t.agency.feeNote}`],
    ['Data protection', 'Personal data in this contract is processed under the Nigeria Data Protection Act 2023 only to administer this employment.'],
    ['Electronic signature', 'Each party signs electronically by confirming their personal PIN. The time, device and network address of each signature are recorded as evidence of agreement.'],
  ];
}

/** Short summary keys rendered in the worker's own language. */
export function summaryLines(t, tr) {
  const period = t.wage.period === 'day' ? tr('common.per_day') : tr('common.per_month');
  return [
    `💼 ${t.job.title}`,
    `📍 ${t.job.place}`,
    `📅 ${t.startDate}${t.endDate ? ' → ' + t.endDate : ''}`,
    `💰 ₦${Number(t.wage.amount).toLocaleString('en-NG')} ${period}`,
    `⏰ ${t.hoursPerDay}h × ${t.daysPerWeek}`,
    `🏠 ${t.accommodation ? tr('common.yes') : tr('common.no')} · 🍲 ${t.meals ? tr('common.yes') : tr('common.no')}`,
  ];
}

export const platformFeeNote = () =>
  `Placement fee (paid by employer): ${config.fees.placementPct}% of the first month's wage, minimum ₦${config.fees.placementMin.toLocaleString('en-NG')}.`;
