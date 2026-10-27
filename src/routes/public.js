import { html } from '../html.js';
import { form, field, checkbox } from '../views/ui.js';
import { LOCALES } from '../i18n/index.js';
import { makeSessionCookie, sessionMaxAge, verifyPin, validPin, normalisePhone, isLocked, recordPinAttempt } from '../auth.js';
import { q, audit } from '../db.js';
import { createUser, AppError, deleteAccount } from '../lib/services.js';
import { config } from '../config.js';

const POLICY_DATE = '27 October 2026';
const contact = (sentence = false) => {
  const ways = [
    config.supportEmail && html`email <a href="mailto:${config.supportEmail}?subject=Delete%20my%20account">${config.supportEmail}</a>`,
    config.supportWhatsApp && html`WhatsApp <a href="https://wa.me/${config.supportWhatsApp.replace(/D/g, '')}">${config.supportWhatsApp}</a>`,
  ].filter(Boolean);
  if (!ways.length) return sentence ? 'contact AgroHands support' : 'AgroHands support';
  return html`${sentence ? 'Contact us by ' : ''}${ways.map((w, i) => html`${i ? ' or ' : ''}${w}`)}`;
};

const homeFor = (role) => ({ worker: '/w', farmer: '/f', agent: '/a', admin: '/admin' })[role] || '/';

export default function register(r) {
  r.get('/', (ctx) => {
    const { t } = ctx;
    if (ctx.user) return ctx.res.redirect(homeFor(ctx.user.role));
    ctx.render('', html`
      <section class="hero">
        <h1>${t('home.hero')}</h1>
        <p>${t('home.sub')}</p>
        <a class="btn light block" href="/register?role=worker">🧑‍🌾 ${t('home.want_work')}</a>
        <a class="btn ghost block" style="background:transparent;color:#fff;border-color:#fff" href="/register?role=farmer">🚜 ${t('home.need_workers')}</a>
      </section>
      <div class="card">
        <h2 style="margin-top:0">${t('home.how')}</h2>
        <ol class="how"><li>${t('home.step1')}</li><li>${t('home.step2')}</li><li>${t('home.step3')}</li></ol>
      </div>
      <div class="card"><p>✅ <b>${t('home.free_workers')}</b></p><p class="muted">📞 ${t('home.ussd')}</p></div>
      <p style="text-align:center"><a href="/login">${t('auth.have_account')}</a></p>`);
  });

  r.get('/lang/:code', (ctx) => {
    const code = LOCALES[ctx.params.code] ? ctx.params.code : 'en';
    ctx.res.cookie('ah_lang', code, { maxAge: 86400 * 365, httpOnly: false, secure: config.production });
    if (ctx.user) q.run('UPDATE users SET lang = ? WHERE id = ?', code, ctx.user.id);
    let back = '/';
    try { back = new URL(ctx.req.headers.referer).pathname; } catch { /* default */ }
    ctx.res.redirect(back.startsWith('/lang/') ? '/' : back);
  });

  r.get('/register', (ctx) => {
    const { t } = ctx;
    const role = ctx.query.role === 'farmer' ? 'farmer' : 'worker';
    ctx.render(t(role === 'farmer' ? 'auth.register_farmer' : 'auth.register_worker'), html`
      <h1>${role === 'farmer' ? '🚜 ' + t('auth.register_farmer') : '🧑‍🌾 ' + t('auth.register_worker')}</h1>
      ${form(ctx, '/register', html`
        <input type="hidden" name="role" value="${role}">
        ${field(t('auth.name'), 'name', { required: true, attrs: 'autocomplete="name" maxlength="80"' })}
        ${field(t('auth.phone'), 'phone', { type: 'tel', required: true, attrs: 'inputmode="tel" autocomplete="tel" placeholder="080..."' })}
        ${field(t('auth.pin'), 'pin', { type: 'password', required: true, attrs: 'inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="new-password"' })}
        ${field(t('auth.pin_confirm'), 'pin2', { type: 'password', required: true, attrs: 'inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="new-password"' })}
        ${checkbox(html`${t('auth.consent')} (<a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>)`, 'consent', false)}
        <button class="btn block">${t('auth.create')}</button>`)}
      <p><a href="/login">${t('auth.have_account')}</a></p>`);
  });

  r.post('/register', (ctx) => {
    const b = ctx.body;
    const role = b.role === 'farmer' ? 'farmer' : 'worker';
    const back = `/register?role=${role}`;
    const phone = normalisePhone(b.phone);
    if (!String(b.name || '').trim()) return ctx.redirect(back, 'auth.need_name', 'error');
    if (!phone) return ctx.redirect(back, 'auth.bad_phone', 'error');
    if (!validPin(b.pin)) return ctx.redirect(back, 'auth.bad_pin', 'error');
    if (b.pin !== b.pin2) return ctx.redirect(back, 'auth.pin_mismatch', 'error');
    if (!b.consent) return ctx.redirect(back, 'auth.need_consent', 'error');
    let id;
    try {
      id = createUser({ phone, pin: b.pin, role, name: String(b.name).slice(0, 80), lang: ctx.lang });
    } catch (e) {
      if (e instanceof AppError) return ctx.redirect(back, e.key, 'error');
      throw e;
    }
    ctx.res.cookie('ah_s', makeSessionCookie(id), { maxAge: sessionMaxAge, secure: config.production });
    const user = q.get('SELECT role FROM users WHERE id = ?', id);
    ctx.redirect(user.role === 'worker' ? '/w/profile' : user.role === 'farmer' ? '/f/farm' : homeFor(user.role));
  });

  r.get('/login', (ctx) => {
    const { t } = ctx;
    ctx.render(t('auth.login_title'), html`
      <h1>${t('auth.login_title')}</h1>
      ${form(ctx, '/login', html`
        <input type="hidden" name="next" value="${ctx.query.next || ''}">
        ${field(t('auth.phone'), 'phone', { type: 'tel', required: true, attrs: 'inputmode="tel" autocomplete="tel"' })}
        ${field(t('auth.pin'), 'pin', { type: 'password', required: true, attrs: 'inputmode="numeric" maxlength="6" autocomplete="current-password"' })}
        <button class="btn block">${t('auth.login')}</button>`)}
      <p><a href="/register?role=worker">${t('auth.register_worker')}</a> · <a href="/register?role=farmer">${t('auth.register_farmer')}</a></p>`);
  });

  r.post('/login', (ctx) => {
    const phone = normalisePhone(ctx.body.phone);
    const user = phone && q.get("SELECT * FROM users WHERE phone = ? AND status = 'active'", phone);
    if (!user) return ctx.redirect('/login', 'auth.bad_login', 'error');
    if (isLocked(user)) return ctx.redirect('/login', 'auth.locked', 'error');
    const ok = verifyPin(ctx.body.pin, user.pin_hash);
    recordPinAttempt(user, ok);
    if (!ok) return ctx.redirect('/login', 'auth.bad_login', 'error');
    audit(user.id, 'user.login', `user:${user.id}`);
    ctx.res.cookie('ah_s', makeSessionCookie(user.id), { maxAge: sessionMaxAge, secure: config.production });
    if (!ctx.cookies.ah_lang && user.lang) ctx.res.cookie('ah_lang', user.lang, { maxAge: 86400 * 365, httpOnly: false });
    const next = String(ctx.body.next || '');
    ctx.res.redirect(next.startsWith('/') && !next.startsWith('//') ? next : homeFor(user.role));
  });

  r.post('/logout', (ctx) => {
    ctx.res.cookie('ah_s', '', { maxAge: 0 });
    ctx.res.redirect('/');
  });

  // NDPA data-subject rights: access (download) and erasure.
  r.get('/me/data', (ctx) => {
    if (!ctx.need()) return;
    const id = ctx.user.id;
    const { pin_hash, failed_pins, locked_until, ...user } = q.get('SELECT * FROM users WHERE id = ?', id);
    const worker = q.get('SELECT * FROM workers WHERE user_id = ?', id);
    if (worker) delete worker.nin_hash;
    ctx.res.headers['Content-Disposition'] = 'attachment; filename="agrohands-my-data.json"';
    ctx.res.json({
      exportedAt: new Date().toISOString(),
      user,
      worker,
      farms: q.all('SELECT * FROM farms WHERE owner_id = ?', id),
      consents: q.all('SELECT purpose, granted_at FROM consents WHERE user_id = ?', id),
      contracts: q.all('SELECT ref, status, start_date, end_date, terms FROM contracts WHERE worker_id = ? OR farm_id IN (SELECT id FROM farms WHERE owner_id = ?)', id, id),
      ratingsReceived: q.all('SELECT stars, comment, created_at FROM ratings WHERE to_user = ?', id),
      courses: q.all('SELECT course_id, score, passed, cert_code FROM course_progress WHERE user_id = ?', id),
    });
  });

  r.get('/me/delete', (ctx) => {
    if (!ctx.need()) return;
    const { t } = ctx;
    ctx.render(t('me.delete'), html`<h1>${t('me.delete')}</h1>
      ${form(ctx, '/me/delete', html`<p>${t('me.delete_confirm')}</p>
        ${field('DELETE', 'confirm', { required: true })}
        <button class="btn danger block">${t('me.delete')}</button>`)}`);
  });

  r.post('/me/delete', (ctx) => {
    if (!ctx.need()) return;
    if (ctx.body.confirm !== 'DELETE') throw new AppError('common.error');
    deleteAccount(ctx.user.id);
    ctx.res.cookie('ah_s', '', { maxAge: 0 });
    ctx.redirect('/', 'me.deleted');
  });

  r.get('/offline', (ctx) => ctx.render('Offline', html`<h1>📶 Offline</h1><p>You are offline. Your saved training pages still work. Reconnect to see new offers.</p>`));

  // Public (no login): Google Play links to this from the store listing and the Data safety form.
  r.get('/privacy', (ctx) => ctx.render('Privacy', html`
    <h1>Privacy policy</h1>
    <div class="card">
      <p class="small muted">Effective ${POLICY_DATE}. Applies to the AgroHands website, Android app and USSD service.</p>
      <p><b>Who we are.</b> AgroHands connects farm owners with verified farm workers in Nigeria. We are the data controller for the information you give us. Contact: ${contact()}.</p>
      <p><b>What we collect.</b> Name, phone number, date of birth, gender, state and town, skills, wage expectations, work history, ratings and training results. For identity checks we use your NIN only with your consent: we keep a protected code and the last 4 digits, never your full NIN. Guarantor name and phone if you add one.</p>
      <p><b>Location.</b> Only when you press "Use my current location" we read your device's precise location once, to save your home or farm position for matching by distance. We never track location in the background. You can type your town instead.</p>
      <p><b>Device and technical data.</b> Cookies that keep you signed in, protect forms (CSRF) and remember your language. IP address and time, recorded when you sign a contract (as evidence) and in security logs. We do not use advertising, analytics or tracking cookies, and we do not sell data.</p>
      <p><b>Why.</b> To verify identity, match you with work or workers, create and evidence contracts, resolve disputes and keep the platform safe (Nigeria Data Protection Act 2023: consent, contract, and legal obligation).</p>
      <p><b>Who sees it.</b> Farms you are matched with see your first name, skills, tier, rating and distance. Your phone number is shared only after both sides sign a contract. Field agents see what they need to verify you. Our verification provider (when used) checks your NIN on our instruction. We share data with authorities only when the law requires.</p>
      <p><b>Security.</b> Data is encrypted in transit (HTTPS). PINs are stored as salted hashes. Access is limited to staff who need it and is logged.</p>
      <p><b>Retention.</b> Contract and signature records are kept for 6 years, as labour and tax law require. Everything else is deleted or anonymised when you close your account. Backups roll off within 14 days.</p>
      <p><b>Children.</b> AgroHands is for people aged 18 and over. We do not knowingly register children, and farms may not hire under-18s.</p>
      <p><b>Your rights.</b> Access, correct, download (<a href="/me/data">download my data</a>) or delete your data (<a href="/account-deletion">how to delete your account</a>), withdraw consent, and complain to the Nigeria Data Protection Commission (ndpc.gov.ng).</p>
      <p><b>Changes.</b> We will show a notice in the app before any important change.</p>
      <p class="muted small">Draft for legal review before launch.</p>
    </div>`));

  // Public (no login): Google Play requires a web page where users can request deletion even without the app.
  r.get('/account-deletion', (ctx) => ctx.render('Delete your account', html`
    <h1>Delete your AgroHands account</h1>
    <div class="card">
      <p><b>In the app or website</b> (fastest): sign in, open your dashboard, choose <a href="/me/delete">Delete my account</a>, type DELETE and confirm. It happens immediately.</p>
      <p><b>Without the app</b> (for example, a basic phone using USSD): ${contact(true)}, or visit any AgroHands field agent. Send the phone number you registered with. We confirm by calling that number, then delete within 7 days.</p>
      <h2>What is deleted</h2>
      <p>Your name, phone number, PIN, date of birth, location, town, guarantor details and NIN code. Your profile disappears from all matching.</p>
      <h2>What is kept, and for how long</h2>
      <p>Signed contracts and signature evidence (needed for labour and tax law) are kept for 6 years, linked to "Deleted user". Ratings you gave stay, without your name. Copies in backups roll off within 14 days.</p>
      <p class="small"><a href="/privacy">Privacy policy</a></p>
    </div>`));

  r.get('/terms', (ctx) => ctx.render('Terms', html`
    <h1>Terms of use (summary)</h1>
    <div class="card">
      <p><b>Workers</b> never pay AgroHands to find work. Provide true information. Turn up for jobs you accept, or give notice.</p>
      <p><b>Farm owners</b> pay the published fees, pay wages in full and on time, provide safe conditions and PPE, and do not hire under-18s for farm work.</p>
      <p><b>Non-circumvention.</b> Farm owners who hire a worker they met on AgroHands outside the platform within 12 months pay the standard placement fee.</p>
      <p><b>Disputes</b> are first mediated by AgroHands within 48 hours. AgroHands is an employment agency and not the employer.</p>
      <p><b>Conduct.</b> Fraud, harassment or abuse leads to suspension.</p>
      <p class="muted small">Draft for legal review before launch.</p>
    </div>`));
}
