// Training academy content. Lessons are short, plain-language and audio-ready (add audioUrl per
// language once recordings exist). English is the source text. A translation lives in
// courses.<lang>.js with exactly the same shape and option order, is registered in
// COURSE_TRANSLATIONS below, and is shape-checked by test/unit.test.js. Add one only after review.
//
// Standards referenced: ILO Code of Practice on Safety and Health in Agriculture (2010),
// FAO/WHO International Code of Conduct on Pesticide Management, GLOBALG.A.P. IFA / GRASP concepts,
// Nigeria Labour Act (Cap L1 LFN 2004), NBTE National Occupational Standards (agriculture).

import courseFr from './courses.fr.js';

export const COURSES = [
  {
    id: 'safety-101',
    audience: 'worker',
    icon: '⛑️',
    title: 'Farm safety, PPE and first aid',
    minutes: 15,
    fee: 0,
    requiredFor: 'bronze',
    standard: 'ILO Code of Practice on Safety and Health in Agriculture',
    lessons: [
      {
        title: 'Know the dangers on a farm',
        body: [
          'Most farm injuries come from tools (cutlass, hoe), machines (tractor, pumps), chemicals, animals, heat and snakes.',
          'Before work each day, look at your work area. Report holes, broken tools, loose wires or wasp nests to your supervisor.',
          'Never work alone far from others. Tell someone where you are going.',
        ],
      },
      {
        title: 'Personal protective equipment (PPE)',
        body: [
          'Boots protect your feet from cuts, thorns and snakebite. Gloves protect your hands from cuts and chemicals.',
          'For spraying you need: long sleeves, trousers, boots, gloves, a face mask and eye protection. No PPE = no spraying.',
          'Your employer should provide the PPE the job needs. If it is missing, ask before you start. It is your right.',
        ],
      },
      {
        title: 'Heat, water and rest',
        body: [
          'Drink clean water often, even before you feel thirsty. Rest in the shade when you feel dizzy, weak or have a headache.',
          'Heat illness can kill. If a co-worker is confused or stops sweating, move them to shade, cool them with water and call for help.',
        ],
      },
      {
        title: 'Simple first aid',
        body: [
          'Cuts: press a clean cloth on the wound to stop bleeding, then wash with clean water and cover.',
          'Snakebite: keep the person calm and still, remove rings and tight items, and take them to hospital quickly. Do not cut the wound or suck the poison.',
          'Chemical on skin or eyes: wash with plenty of clean water for at least 15 minutes, then get medical help. Take the chemical label with you.',
        ],
      },
    ],
    quiz: [
      { q: 'You are asked to spray a farm but there are no gloves or mask. What do you do?', options: ['Spray anyway, quickly', 'Ask for the PPE before you start', 'Use your shirt to cover your face'], answer: 1 },
      { q: 'A snake bites a co-worker. What is right?', options: ['Cut the wound and suck the poison', 'Keep them still and take them to hospital fast', 'Give them palm wine'], answer: 1 },
      { q: 'Chemical splashes into your eye. What do you do first?', options: ['Rub the eye', 'Wash with clean water for 15 minutes', 'Wait and see'], answer: 1 },
      { q: 'When should you drink water on a hot day?', options: ['Only at lunch', 'Often, even before you feel thirsty', 'Only when you feel dizzy'], answer: 1 },
    ],
  },
  {
    id: 'rights-101',
    audience: 'worker',
    icon: '📄',
    title: 'Your contract, your rights, your conduct',
    minutes: 12,
    fee: 0,
    standard: 'Nigeria Labour Act; ILO General Principles for Fair Recruitment',
    lessons: [
      {
        title: 'Your contract',
        body: [
          'Every AgroHands job has a written contract. It shows the farm, the work, your wage, how often you are paid, your hours and the notice period.',
          'The contract is read to you in your language before you sign. Do not sign anything you do not understand. Ask an AgroHands agent.',
        ],
      },
      {
        title: 'Your wages',
        body: [
          'Your wage must be paid in money (not only food or goods), in full, on the agreed day.',
          'AgroHands never charges you to find a job. If anyone asks you to pay to get a job through AgroHands, report it.',
          'Nobody may take your ID card or phone to force you to stay at a job. You can leave by giving the notice in your contract.',
        ],
      },
      {
        title: 'Good conduct builds your rating',
        body: [
          'Arrive on time, do the work agreed, care for tools and respect farm property. Tell your supervisor early if you cannot come.',
          'Good ratings move you up to Silver and Gold, where jobs pay more. Leaving a job without notice lowers your reliability score.',
        ],
      },
      {
        title: 'When something goes wrong',
        body: [
          'If you are not paid, are treated badly or are asked to do dangerous work without PPE, open a dispute in the app or tell your agent.',
          'AgroHands will hold the matter, speak to both sides and help resolve it. Serious issues can go to the Ministry of Labour office.',
        ],
      },
    ],
    quiz: [
      { q: 'Someone says you must pay ₦5,000 to get an AgroHands job. What is true?', options: ['You must pay', 'AgroHands never charges workers for a job — report it', 'Pay half'], answer: 1 },
      { q: 'Can an employer keep your ID card so you cannot leave?', options: ['Yes', 'No'], answer: 1 },
      { q: 'You cannot come to work tomorrow. What should you do?', options: ['Just stay home', 'Tell your supervisor early', 'Send someone else without asking'], answer: 1 },
      { q: 'What moves you up to Silver and Gold?', options: ['Good ratings, verification and training', 'Paying a fee', 'Having many phones'], answer: 0 },
    ],
  },
  {
    id: 'agrochem-201',
    audience: 'worker',
    icon: '🧪',
    title: 'Safe handling of agrochemicals',
    minutes: 15,
    fee: 0,
    standard: 'FAO/WHO International Code of Conduct on Pesticide Management',
    lessons: [
      {
        title: 'Read the label (or ask)',
        body: [
          'Every chemical label tells you: what it is for, how much to mix, what PPE to wear, and how long before people can enter the field or harvest.',
          'The colour band shows danger: red = very dangerous, yellow = dangerous, blue = harmful, green = less harmful. If you cannot read the label, ask the supervisor to read it to you.',
        ],
      },
      {
        title: 'Mixing and spraying',
        body: [
          'Mix in the open air, away from wells, streams and children. Use the measure on the label — more chemical does not work better, it only harms you and the crop.',
          'Do not spray in strong wind, in rain, or in the hottest part of the day. Walk so the wind blows spray away from you.',
          'Never eat, drink or smoke while spraying. Wash hands and face before eating.',
        ],
      },
      {
        title: 'After spraying',
        body: [
          'Wash the sprayer away from water sources. Wash your PPE and clothes separately from family clothes. Bathe with soap.',
          'Never use empty chemical containers to carry water or food. Return them or destroy them as instructed.',
          'Mark sprayed fields so others do not enter before the safe time on the label.',
        ],
      },
    ],
    quiz: [
      { q: 'The label has a red band. What does it mean?', options: ['Very dangerous', 'Safe for children', 'Fertiliser'], answer: 0 },
      { q: 'Is it OK to use an empty chemical container to store drinking water?', options: ['Yes, if washed', 'Never'], answer: 1 },
      { q: 'When is a bad time to spray?', options: ['Calm early morning', 'Strong wind or rain'], answer: 1 },
      { q: 'You need more power from the chemical. What do you do?', options: ['Double the mix', 'Use the measure on the label'], answer: 1 },
    ],
  },
  {
    id: 'gap-201',
    audience: 'worker',
    icon: '✅',
    title: 'Good Agricultural Practices: hygiene and records',
    minutes: 12,
    fee: 2000,
    standard: 'GLOBALG.A.P. Integrated Farm Assurance (concepts)',
    lessons: [
      {
        title: 'Why buyers care',
        body: [
          'Supermarkets, exporters and processors buy from farms that grow food safely and keep records. Workers who know GAP are worth more.',
        ],
      },
      {
        title: 'Hygiene at harvest',
        body: [
          'Wash hands with soap before harvest, after using the toilet and after eating. Do not harvest when you have diarrhoea or open wounds on your hands — tell your supervisor.',
          'Use clean crates. Never put harvested produce directly on the ground. Keep animals out of harvest areas.',
        ],
      },
      {
        title: 'Records',
        body: [
          'Record what was done, where and when: planting, spraying (product, dose, field), fertiliser and harvest. Records let buyers trace every crate back to a field.',
        ],
      },
    ],
    quiz: [
      { q: 'Where should harvested produce go?', options: ['On the ground', 'Into clean crates'], answer: 1 },
      { q: 'You have diarrhoea on harvest day. What do you do?', options: ['Harvest anyway', 'Tell the supervisor and avoid handling produce'], answer: 1 },
      { q: 'Why keep spraying records?', options: ['Buyers can trace produce back to the field', 'It is not useful'], answer: 0 },
    ],
  },
  {
    id: 'employer-101',
    audience: 'farmer',
    icon: '⚖️',
    title: 'Fair employment: contracts, wages and keeping good workers',
    minutes: 15,
    fee: 0,
    standard: 'Nigeria Labour Act; GLOBALG.A.P. GRASP (worker welfare)',
    lessons: [
      {
        title: 'Contracts and written particulars',
        body: [
          'The Labour Act requires written particulars of employment within three months: parties, nature of work, wages and payment interval, hours, leave and notice. AgroHands generates this for every hire on day one.',
          'Notice periods under the Act depend on length of service: one day (up to 3 months), one week (3 months to 2 years), two weeks (2 to 5 years), one month (5 years and above), unless the contract gives more.',
        ],
      },
      {
        title: 'Wages and deductions',
        body: [
          'Pay wages in money, in full, on the agreed day. The Labour Act forbids deductions from wages except those the law allows. Do not deduct for tools, food or "fines".',
          'Workers who are paid on time stay longer. On AgroHands, on-time payment raises your farm rating, which attracts better workers.',
        ],
      },
      {
        title: 'Safety is the employer’s duty',
        body: [
          'Provide PPE for the work you assign, especially for spraying and machinery. Keep a first-aid kit and a plan to reach a clinic.',
          'Do not employ anyone under 18 for hazardous farm work. AgroHands blocks under-18s from job listings.',
        ],
      },
      {
        title: 'Keeping good workers',
        body: [
          'Clear tasks, respectful supervision, decent housing where provided, clean water and rest breaks reduce absence and quitting.',
          'Rate workers honestly after 30 days and at the end of a contract. Ratings decide who you see first next time.',
        ],
      },
    ],
    quiz: [
      { q: 'Can you deduct ₦2,000 from a worker’s wage for a broken hoe?', options: ['Yes, any time', 'No — deductions are only allowed where the law permits'], answer: 1 },
      { q: 'Who provides PPE for spraying?', options: ['The employer', 'The worker must buy it'], answer: 0 },
      { q: 'A worker has served 1 year. Minimum notice under the Labour Act?', options: ['One day', 'One week', 'One month'], answer: 1 },
    ],
  },
];

export const getCourse = (id) => COURSES.find((c) => c.id === id);
export const PASS_MARK = 75;

/** Translated course text by language: { fr: { 'safety-101': { title, lessons, quiz } } }. */
export const COURSE_TRANSLATIONS = { fr: courseFr };

/**
 * The course in the reader's language when a translation exists, else English.
 * Only text is replaced: ids, fees, answers and option order always come from the English source,
 * so quiz grading is identical in every language.
 */
export function localizeCourse(course, lang) {
  const tr = course && COURSE_TRANSLATIONS[lang]?.[course.id];
  if (!tr) return course ? { ...course, translated: false } : course;
  return {
    ...course,
    translated: true,
    title: tr.title,
    lessons: course.lessons.map((l, i) => ({ ...l, title: tr.lessons[i].title, body: tr.lessons[i].body })),
    quiz: course.quiz.map((item, i) => ({ ...item, q: tr.quiz[i].q, options: tr.quiz[i].options })),
  };
}
