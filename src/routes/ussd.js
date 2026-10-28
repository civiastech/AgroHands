// USSD for basic phones, in Africa's Talking format.
// AT POSTs: sessionId, serviceCode, phoneNumber, text ("1*Ada Obi*Oyo*3*1234"). Reply "CON ..." to continue, "END ..." to finish.
// Menus are kept under 160 characters. Free to test on the Africa's Talking sandbox; a live shortcode is a go-live cost.
import { timingSafeEqual } from 'node:crypto';
import { q } from '../db.js';
import { config } from '../config.js';
import { normalisePhone, validPin, verifyPin } from '../auth.js';
import { createUser, pendingOffers, respondToOffer } from '../lib/services.js';
import { refreshTier } from '../lib/tiers.js';
import { findState } from '../data/states.js';
import { translator, LANG_CODES } from '../i18n/index.js';

const USSD_SKILLS = ['farmhand', 'planting', 'weeding', 'harvesting', 'spraying', 'palm_harvest', 'poultry', 'tractor', 'security'];
const LANGS = LANG_CODES; // same order as the web language menu

export const USSD_TEXT = {
  en: { welcome: 'AgroHands', reg: 'Register for farm work', offers: 'My job offers', status: 'My status', lang: 'Language',
    name: 'Enter your full name\n(By continuing you accept AgroHands Terms & Privacy)', state: 'Enter your State (e.g. Oyo)', skill: 'Choose your main work:', pin: 'Choose a 4-digit PIN',
    pin2: 'Enter the PIN again', done: 'Registered! Visit an AgroHands agent with your NIN slip to get verified.',
    exists: 'You are already registered.', noacc: 'Not registered. Dial again and choose 1.', none: 'No offers now. We will SMS you.',
    accept: 'Accept', decline: 'Decline', enterpin: 'Enter your PIN to accept', accepted: 'Accepted! Contract created. An agent will read it to you before signing.',
    declined: 'Offer declined.', badpin: 'Wrong PIN.', bad: 'Invalid choice.', badstate: 'State not found.', tier: 'Level', next: 'Next step' },
  pcm: { welcome: 'AgroHands', reg: 'Register for farm work', offers: 'Work wey dem offer me', status: 'My status', lang: 'Language',
    name: 'Put your full name\n(If you continue, you accept AgroHands Terms & Privacy)', state: 'Put your State (like Oyo)', skill: 'Choose your main work:', pin: 'Choose 4-number PIN',
    pin2: 'Put the PIN again', done: 'You don register! Go see AgroHands agent with your NIN slip make dem check you.',
    exists: 'You don register before.', noacc: 'You never register. Dial again choose 1.', none: 'No offer now. We go SMS you.',
    accept: 'I gree', decline: 'I no gree', enterpin: 'Put your PIN to agree', accepted: 'You don agree! Contract don open. Agent go read am for you before you sign.',
    declined: 'You no gree the offer.', badpin: 'PIN no correct.', bad: 'Wrong choice.', badstate: 'We no see that State.', tier: 'Level', next: 'Next step' },
  // French: sticks to the GSM 7-bit alphabet (no ê, ô, ç or curly quotes) so menus keep the full 160 characters.
  fr: { welcome: 'AgroHands', reg: 'S\'inscrire pour travailler', offers: 'Mes offres d\'emploi', status: 'Mon statut', lang: 'Langue',
    name: 'Entrez votre nom complet\n(En continuant, vous acceptez les Conditions AgroHands)', state: 'Entrez votre Etat (ex. Oyo)', skill: 'Choisissez votre travail principal:', pin: 'Choisissez un PIN de 4 chiffres',
    pin2: 'Entrez le PIN encore une fois', done: 'Inscrit! Allez voir un agent AgroHands avec votre fiche NIN pour la verification.',
    exists: 'Vous etes deja inscrit.', noacc: 'Pas inscrit. Recomposez et choisissez 1.', none: 'Pas d\'offre pour le moment. Nous vous enverrons un SMS.',
    accept: 'Accepter', decline: 'Refuser', enterpin: 'Entrez votre PIN pour accepter', accepted: 'Accepte! Contrat cree. Un agent vous le lira avant la signature.',
    declined: 'Offre refusee.', badpin: 'PIN incorrect.', bad: 'Choix invalide.', badstate: 'Etat introuvable.', tier: 'Niveau', next: 'Etape suivante' },
};
const w = (lang) => USSD_TEXT[lang] || USSD_TEXT.en;

export function ussdReply({ phoneNumber, text = '' }) {
  const phone = normalisePhone(phoneNumber);
  if (!phone) return 'END Invalid phone number.';
  const user = q.get("SELECT * FROM users WHERE phone = ? AND status = 'active'", phone);
  const lang = user?.lang || 'en';
  const s = w(lang);
  const t = translator(lang);
  const parts = text === '' ? [] : String(text).split('*');
  const [choice, ...rest] = parts;

  if (!choice) return `CON ${s.welcome}\n1. ${s.reg}\n2. ${s.offers}\n3. ${s.status}\n4. ${s.lang}`;

  if (choice === '1') {
    if (user) return `END ${s.exists}`;
    const [name, state, skillIdx, pin, pin2] = rest;
    if (name === undefined) return `CON ${s.name}`;
    if (state === undefined) return `CON ${s.state}`;
    if (!findState(state)) return `END ${s.badstate}`;
    if (skillIdx === undefined) return `CON ${s.skill}\n${USSD_SKILLS.map((k, i) => `${i + 1}. ${t('skill.' + k)}`).join('\n')}`;
    const skill = USSD_SKILLS[Number(skillIdx) - 1];
    if (!skill) return `END ${s.bad}`;
    if (pin === undefined) return `CON ${s.pin}`;
    if (!validPin(pin)) return `END ${t('auth.bad_pin')}`;
    if (pin2 === undefined) return `CON ${s.pin2}`;
    if (pin !== pin2) return `END ${t('auth.pin_mismatch')}`;
    const id = createUser({ phone, pin, role: 'worker', name: name.slice(0, 80), lang, consents: ['terms_ussd'], phoneVerified: true }); // the network supplies phoneNumber
    q.run('UPDATE workers SET state = ?, skills = ?, primary_skill = ? WHERE user_id = ?', findState(state).name, JSON.stringify([skill]), skill, id);
    return `END ${s.done}`;
  }

  if (!user || user.role !== 'worker') return `END ${s.noacc}`;

  if (choice === '2') {
    const offers = pendingOffers(user.id).slice(0, 3);
    if (!offers.length) return `END ${s.none}`;
    const [pick, action, pin] = rest;
    if (pick === undefined) {
      return `CON ${s.offers}\n${offers.map((o, i) => `${i + 1}. ${o.title.slice(0, 22)} N${o.wage_amount}/${o.wage_period} ${o.farm_lga || o.farm_state}`).join('\n')}`;
    }
    const o = offers[Number(pick) - 1];
    if (!o) return `END ${s.bad}`;
    if (action === undefined) return `CON ${o.title.slice(0, 40)}\n${o.start_date} N${o.wage_amount}/${o.wage_period}\n1. ${s.accept}\n2. ${s.decline}`;
    if (action === '2') { respondToOffer(o.match_id, user.id, false); return `END ${s.declined}`; }
    if (action !== '1') return `END ${s.bad}`;
    if (pin === undefined) return `CON ${s.enterpin}`;
    if (!verifyPin(pin, user.pin_hash)) return `END ${s.badpin}`;
    respondToOffer(o.match_id, user.id, true);
    return `END ${s.accepted}`;
  }

  if (choice === '3') {
    const tier = refreshTier(user.id);
    const wk = q.get('SELECT * FROM workers WHERE user_id = ?', user.id);
    const next = wk.nin_status !== 'verified' ? t('worker.step_nin') : tier === 'registered' ? t('worker.step_safety')
      : wk.guarantor_status !== 'verified' ? t('worker.step_guarantor') : t('worker.step_done');
    return `END ${s.tier}: ${t('tier.' + tier)}\n${s.next}: ${next}`;
  }

  if (choice === '4') {
    const [pick] = rest;
    if (pick === undefined) return `CON ${s.lang}\n${LANGS.map((c, i) => `${i + 1}. ${translator(c)('lang.name')}`).join('\n')}`;
    const code = LANGS[Number(pick) - 1];
    if (!code) return `END ${s.bad}`;
    q.run('UPDATE users SET lang = ? WHERE id = ?', code, user.id);
    return `END ✓ ${translator(code)('lang.name')}`;
  }
  return `END ${s.bad}`;
}

const keyOk = (given = '') => {
  const a = Buffer.from(String(given));
  const b = Buffer.from(config.ussdKey);
  return a.length === b.length && timingSafeEqual(a, b);
};

export default function register(r) {
  r.post('/ussd', (ctx) => {
    // In production the endpoint stays shut until USSD_KEY is set; in dev it is open for the sandbox.
    if (config.production && !config.ussdKey) return ctx.res.text('END Service unavailable', 503);
    if (config.ussdKey && !keyOk(ctx.query.key)) return ctx.res.text('END Unauthorised', 403);
    try {
      ctx.res.text(ussdReply(ctx.body));
    } catch (e) {
      ctx.log.error('ussd error', { err: e });
      ctx.res.text('END Service busy. Try again.');
    }
  });
}
