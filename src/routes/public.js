import { html, raw } from '../html.js';
import { form, field, checkbox, icon, homeFor } from '../views/ui.js';
import { LOCALES } from '../i18n/index.js';
import { createSession, destroySession, revokeSessions, sessionMaxAge, hashPinAsync, checkPin, validPin, normalisePhone } from '../auth.js';
import { q, audit } from '../db.js';
import { createUser, AppError, deleteAccount, setPin } from '../lib/services.js';
import { issueOtp, pendingOtp, consumeOtp, maskPhone, OTP_TTL_SEC } from '../lib/otp.js';
import { config } from '../config.js';
import { ASSET_VERSION } from './static.js';

const POLICY_DATE = '27 October 2026';

/** Signs the browser in with a fresh, revocable session. */
function startSession(ctx, userId) {
  const token = createSession(userId, { ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
  ctx.res.cookie('ah_s', token, { maxAge: sessionMaxAge, secure: config.production });
}

const PIN_ATTRS = 'inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="new-password"';
const pinFields = (t, first = 'auth.pin') => html`<div class="row">
  <div class="grow">${field(t(first), 'pin', { type: 'password', required: true, attrs: PIN_ATTRS })}</div>
  <div class="grow">${field(t('auth.pin_confirm'), 'pin2', { type: 'password', required: true, attrs: PIN_ATTRS })}</div>
</div>`;
const brand = () => html`<img class="brand-mark" src="/icon.svg?v=${ASSET_VERSION}" alt="" width="52" height="52">`;
const verifyUrl = (token) => `/verify?t=${encodeURIComponent(token)}`;
/** Where to send someone whose code is gone: back to the start of their flow. */
const restart = (otp) => (otp?.purpose === 'reset' ? '/forgot' : `/register?role=${otp?.payload?.role || 'worker'}`);
const contact = (sentence = false) => {
  const ways = [
    config.supportEmail && html`email <a href="mailto:${config.supportEmail}?subject=Delete%20my%20account">${config.supportEmail}</a>`,
    config.supportWhatsApp && html`WhatsApp <a href="https://wa.me/${config.supportWhatsApp.replace(/\D/g, '')}">${config.supportWhatsApp}</a>`,
  ].filter(Boolean);
  if (!ways.length) return sentence ? 'contact AgroHands support' : 'AgroHands support';
  return html`${sentence ? 'Contact us by ' : ''}${ways.map((w, i) => html`${i ? ' or ' : ''}${w}`)}`;
};

// Decorative landing illustration: sun over farmland with crop rows.
const HERO_ART = raw(`<svg class="hero-art" viewBox="0 0 520 230" aria-hidden="true">
  <circle cx="404" cy="78" r="64" fill="#f2c14e" opacity=".16"/>
  <circle cx="404" cy="78" r="40" fill="#f2c14e"/>
  <path d="M0 152C92 104 186 112 274 136S434 126 520 96V230H0z" fill="#3a9a66" opacity=".55"/>
  <path d="M0 178C116 140 236 150 340 166S470 154 520 142V230H0z" fill="#62b788" opacity=".75"/>
  <g stroke="#2d7d51" stroke-width="3" stroke-linecap="round" opacity=".55">
    <path d="M70 186l18-22M110 182l16-24M150 180l14-25M190 178l12-26M230 178l10-26M270 180l8-25M310 182l6-24"/>
  </g>
  <g fill="#f2c14e">
    <path d="M440 150c-4 12-4 22 0 32 4-10 4-20 0-32zM428 160c-1 12 2 21 11 26 0-11-4-20-11-26zM452 160c-7 6-11 15-11 26 9-5 12-14 11-26z"/>
    <rect x="438" y="180" width="4" height="30" rx="2"/>
  </g>
</svg>`);

export default function register(r) {
  r.get('/', (ctx) => {
    const { t } = ctx;
    if (ctx.user) return ctx.res.redirect(homeFor(ctx.user.role));
    ctx.render('', html`<div class="landing">
      <section class="hero-band">
        <div class="hero-in">
          <div>
            <span class="eyebrow">${icon('shield')}${t('home.eyebrow')}</span>
            <h1>${t('home.hero')}</h1>
            <p class="lead">${t('home.sub')}</p>
            <div class="roles">
              <a class="role" href="/register?role=worker"><span class="tile">🧑‍🌾</span>
                <span><b>${t('home.want_work')}</b><small>${t('home.worker_sub')}</small></span>${icon('right')}</a>
              <a class="role alt" href="/register?role=farmer"><span class="tile">🚜</span>
                <span><b>${t('home.need_workers')}</b><small>${t('home.farmer_sub')}</small></span>${icon('right')}</a>
            </div>
          </div>
          ${HERO_ART}
        </div>
      </section>

      <section class="trust">
        <div class="card"><span class="tile">${icon('idcard')}</span><div><b>${t('home.trust1_t')}</b><p>${t('home.trust1')}</p></div></div>
        <div class="card"><span class="tile">${icon('file')}</span><div><b>${t('home.trust2_t')}</b><p>${t('home.trust2')}</p></div></div>
        <div class="card"><span class="tile">${icon('cap')}</span><div><b>${t('home.trust3_t')}</b><p>${t('home.trust3')}</p></div></div>
      </section>

      <section class="section">
        <h2>${t('home.how')}</h2>
        <ol class="how"><li>${t('home.step1')}</li><li>${t('home.step2')}</li><li>${t('home.step3')}</li></ol>
        <div class="callout"><span class="tile">${icon('phone')}</span>
          <div><p><b>${t('home.free_workers')}</b></p><p class="small">${t('home.ussd')}</p></div></div>
        <p class="center" style="margin-top:22px"><a href="/login"><b>${t('auth.have_account')}</b></a></p>
      </section>
    </div>`, { full: true });
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
    ctx.render(t(role === 'farmer' ? 'auth.register_farmer' : 'auth.register_worker'), html`<div class="auth">
      <div class="auth-card">
        ${brand()}
        <h1>${t(role === 'farmer' ? 'auth.register_farmer' : 'auth.register_worker')}</h1>
        <p class="lead">${t(role === 'farmer' ? 'home.farmer_sub' : 'home.worker_sub')}</p>
        <nav class="segmented" aria-label="${t('auth.account_type')}">
          <a href="/register?role=worker" ${role === 'worker' ? raw('aria-current="page"') : ''}>🧑‍🌾 ${t('role.worker')}</a>
          <a href="/register?role=farmer" ${role === 'farmer' ? raw('aria-current="page"') : ''}>🚜 ${t('role.farmer')}</a>
        </nav>
        ${form(ctx, '/register', html`
          <input type="hidden" name="role" value="${role}">
          ${field(t('auth.name'), 'name', { required: true, attrs: 'autocomplete="name" maxlength="80"' })}
          ${field(t('auth.phone'), 'phone', { type: 'tel', required: true, attrs: 'inputmode="tel" autocomplete="tel" placeholder="0803 123 4567"' })}
          ${pinFields(t)}
          ${checkbox(html`${t('auth.consent')} (<a href="/terms">${t('nav.terms')}</a> · <a href="/privacy">${t('nav.privacy')}</a>)`, 'consent', false)}
          <button class="btn block">${t('auth.create')}${icon('right')}</button>`)}
        <p class="secure-note">${icon('lock', { cls: 'i-sm' })}${t('auth.secure')}</p>
      </div>
      <p class="auth-alt"><a href="/login">${t('auth.have_account')}</a></p>
    </div>`);
  });

  r.post('/register', async (ctx) => {
    const b = ctx.body;
    const role = b.role === 'farmer' ? 'farmer' : 'worker';
    const back = `/register?role=${role}`;
    const phone = normalisePhone(b.phone);
    if (!String(b.name || '').trim()) return ctx.redirect(back, 'auth.need_name', 'error');
    if (!phone) return ctx.redirect(back, 'auth.bad_phone', 'error');
    if (!validPin(b.pin)) return ctx.redirect(back, 'auth.bad_pin', 'error');
    if (b.pin !== b.pin2) return ctx.redirect(back, 'auth.pin_mismatch', 'error');
    if (!b.consent) return ctx.redirect(back, 'auth.need_consent', 'error');
    if (q.get('SELECT id FROM users WHERE phone = ?', phone)) return ctx.redirect(back, 'auth.phone_taken', 'error');
    // The account is created only once the SMS code proves this person holds the phone. Until then the
    // details wait with the pending code (the PIN already hashed).
    const payload = { name: String(b.name).trim().slice(0, 80), role, pinHash: await hashPinAsync(b.pin), lang: ctx.lang };
    let sent;
    try {
      sent = await issueOtp({ ip: ctx.ip, phone, purpose: 'register', payload, lang: ctx.lang });
    } catch (e) {
      if (e instanceof AppError) return ctx.redirect(back, e.key, 'error');
      throw e;
    }
    ctx.redirect(verifyUrl(sent.token), sent.devCode ? 'otp.dev_code' : null, 'info', { code: sent.devCode });
  });

  // Enter the SMS code (sign-up or PIN reset).
  r.get('/verify', (ctx) => {
    const { t } = ctx;
    const otp = pendingOtp(ctx.query.t);
    if (!otp) return ctx.redirect('/register', 'otp.expired', 'error');
    const reset = otp.purpose === 'reset';
    ctx.render(t(reset ? 'auth.forgot_title' : 'otp.title'), html`<div class="auth">
      <div class="auth-card">
        ${brand()}
        <h1>${t(reset ? 'auth.forgot_title' : 'otp.title')}</h1>
        <p class="lead">${t('otp.sent_to', { phone: maskPhone(otp.phone), minutes: OTP_TTL_SEC / 60 })}</p>
        ${form(ctx, '/verify', html`
          <input type="hidden" name="t" value="${otp.token}">
          ${field(t('otp.code'), 'code', { required: true, attrs: 'inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autocomplete="one-time-code" autofocus class="otp-input"' })}
          ${reset ? pinFields(t, 'auth.new_pin') : ''}
          <button class="btn block">${t('otp.verify')}${icon('check')}</button>`)}
        ${form(ctx, '/verify/resend', html`<input type="hidden" name="t" value="${otp.token}">
          <p class="small muted center">${t('otp.no_sms')}</p>
          <button class="btn ghost block">${icon('refresh')}${t('otp.resend')}</button>`)}
      </div>
      <p class="auth-alt"><a href="${restart(otp)}">${t('otp.wrong_number')}</a></p>
    </div>`);
  });

  r.post('/verify', (ctx) => {
    const b = ctx.body;
    const here = verifyUrl(String(b.t || ''));
    const pending = pendingOtp(b.t);
    if (!pending) return ctx.redirect('/register', 'otp.expired', 'error');
    if (pending.purpose === 'reset') {
      // Check the new PIN before spending a guess on the code.
      if (!validPin(b.pin)) return ctx.redirect(here, 'auth.bad_pin', 'error');
      if (b.pin !== b.pin2) return ctx.redirect(here, 'auth.pin_mismatch', 'error');
    }
    let otp;
    try {
      otp = consumeOtp(b.t, b.code);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return ctx.redirect(e.key === 'otp.wrong' ? here : restart(pending), e.key, 'error');
    }

    if (otp.purpose === 'reset') {
      const user = q.get("SELECT * FROM users WHERE id = ? AND phone = ? AND status = 'active'", otp.payload.userId, otp.phone);
      if (!user) return ctx.redirect('/forgot', 'otp.expired', 'error');
      setPin(user.id, b.pin, { reason: 'reset' }); // also signs out every other device
      q.run('UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, unixepoch()) WHERE id = ?', user.id);
      startSession(ctx, user.id);
      return ctx.redirect(homeFor(user.role), 'auth.pin_reset');
    }

    const p = otp.payload;
    let id;
    try {
      id = createUser({ phone: otp.phone, pinHash: p.pinHash, role: p.role, name: p.name, lang: p.lang, phoneVerified: true });
    } catch (e) {
      if (e instanceof AppError) return ctx.redirect(restart(otp), e.key, 'error');
      throw e;
    }
    startSession(ctx, id);
    const user = q.get('SELECT role FROM users WHERE id = ?', id);
    ctx.redirect(user.role === 'worker' ? '/w/profile' : user.role === 'farmer' ? '/f/farm' : homeFor(user.role), 'auth.phone_verified');
  });

  r.post('/verify/resend', async (ctx) => {
    const old = pendingOtp(ctx.body.t);
    if (!old) return ctx.redirect('/register', 'otp.expired', 'error');
    const known = old.purpose === 'register' || !!q.get("SELECT id FROM users WHERE id = ? AND status = 'active'", old.payload.userId);
    let sent;
    try {
      sent = await issueOtp({ ip: ctx.ip, phone: old.phone, purpose: old.purpose, payload: old.payload, lang: ctx.lang, send: known });
    } catch (e) {
      if (e instanceof AppError) return ctx.redirect(verifyUrl(old.token), e.key, 'error');
      throw e;
    }
    ctx.redirect(verifyUrl(sent.token), sent.devCode ? 'otp.dev_code' : 'otp.resent', sent.devCode ? 'info' : 'ok', { code: sent.devCode });
  });

  r.get('/forgot', (ctx) => {
    const { t } = ctx;
    ctx.render(t('auth.forgot_title'), html`<div class="auth">
      <div class="auth-card">
        ${brand()}
        <h1>${t('auth.forgot_title')}</h1>
        <p class="lead">${t('auth.forgot_lead')}</p>
        ${form(ctx, '/forgot', html`
          ${field(t('auth.phone'), 'phone', { type: 'tel', required: true, attrs: 'inputmode="tel" autocomplete="tel" placeholder="0803 123 4567" autofocus' })}
          <button class="btn block">${t('auth.send_code')}${icon('send')}</button>`)}
      </div>
      <p class="auth-alt"><a href="/login">${t('auth.login')}</a></p>
    </div>`);
  });

  r.post('/forgot', async (ctx) => {
    const phone = normalisePhone(ctx.body.phone);
    if (!phone) return ctx.redirect('/forgot', 'auth.bad_phone', 'error');
    const user = q.get("SELECT id FROM users WHERE phone = ? AND status = 'active'", phone);
    // Same answer whether or not the number has an account; a code is only sent when it does.
    let sent;
    try {
      sent = await issueOtp({ ip: ctx.ip, phone, purpose: 'reset', payload: { userId: user?.id ?? null }, lang: ctx.lang, send: !!user });
    } catch (e) {
      if (e instanceof AppError) return ctx.redirect('/forgot', e.key, 'error');
      throw e;
    }
    ctx.redirect(verifyUrl(sent.token), sent.devCode ? 'otp.dev_code' : 'auth.reset_sent', sent.devCode ? 'info' : 'ok', { code: sent.devCode });
  });

  r.get('/login', (ctx) => {
    const { t } = ctx;
    ctx.render(t('auth.login_title'), html`<div class="auth">
      <div class="auth-card">
        ${brand()}
        <h1>${t('auth.login_title')}</h1>
        <p class="lead">${t('auth.login_lead')}</p>
        ${form(ctx, '/login', html`
          <input type="hidden" name="next" value="${ctx.query.next || ''}">
          ${field(t('auth.phone'), 'phone', { type: 'tel', required: true, attrs: 'inputmode="tel" autocomplete="tel" placeholder="0803 123 4567" autofocus' })}
          ${field(t('auth.pin'), 'pin', { type: 'password', required: true, attrs: 'inputmode="numeric" maxlength="6" autocomplete="current-password"' })}
          <button class="btn block">${t('auth.login')}${icon('right')}</button>`)}
        <p class="center small" style="margin:14px 0 0"><a href="/forgot">${t('auth.forgot')}</a></p>
        <p class="secure-note">${icon('lock', { cls: 'i-sm' })}${t('auth.secure')}</p>
      </div>
      <p class="auth-alt">${t('auth.new_here')}<br>
        <a href="/register?role=worker">${t('auth.register_worker')}</a> · <a href="/register?role=farmer">${t('auth.register_farmer')}</a></p>
    </div>`);
  });

  r.post('/login', async (ctx) => {
    const phone = normalisePhone(ctx.body.phone);
    const user = phone && q.get("SELECT * FROM users WHERE phone = ? AND status = 'active'", phone);
    if (!user) return ctx.redirect('/login', 'auth.bad_login', 'error');
    const pin = await checkPin(user.id, ctx.body.pin);
    if (pin === 'locked') return ctx.redirect('/login', 'auth.locked', 'error');
    if (pin !== 'ok') return ctx.redirect('/login', 'auth.bad_login', 'error');
    audit(user.id, 'user.login', `user:${user.id}`);
    startSession(ctx, user.id);
    if (!ctx.cookies.ah_lang && user.lang) ctx.res.cookie('ah_lang', user.lang, { maxAge: 86400 * 365, httpOnly: false });
    const next = String(ctx.body.next || '');
    ctx.res.redirect(next.startsWith('/') && !next.startsWith('//') ? next : homeFor(user.role));
  });

  r.post('/logout', (ctx) => {
    destroySession(ctx.cookies.ah_s);
    ctx.res.cookie('ah_s', '', { maxAge: 0 });
    ctx.res.redirect('/');
  });

  // Change PIN while signed in. Every other device is signed out.
  r.get('/me/pin', (ctx) => {
    if (!ctx.need()) return;
    const { t } = ctx;
    const others = q.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND id != ? AND expires_at > unixepoch()',
      ctx.user.id, ctx.user.session_id).n;
    ctx.render(t('me.pin_title'), html`<div class="auth">
      <div class="auth-card">
        <h1>${t('me.pin_title')}</h1>
        <p class="lead">${t('me.pin_lead')}</p>
        ${form(ctx, '/me/pin', html`
          ${field(t('me.current_pin'), 'current', { type: 'password', required: true, attrs: 'inputmode="numeric" maxlength="6" autocomplete="current-password"' })}
          ${pinFields(t, 'auth.new_pin')}
          <button class="btn block">${t('common.save')}${icon('check')}</button>`)}
      </div>
      ${others ? form(ctx, '/me/signout-others', html`<p class="small muted center">${t('me.other_devices', { n: others })}</p>
        <button class="btn ghost block">${icon('logout')}${t('me.signout_all')}</button>`) : ''}
    </div>`);
  });

  r.post('/me/pin', async (ctx) => {
    if (!ctx.need()) return;
    const b = ctx.body;
    const user = q.get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    const pin = await checkPin(user.id, b.current);
    if (pin === 'locked') return ctx.redirect('/me/pin', 'auth.locked', 'error');
    if (pin !== 'ok') return ctx.redirect('/me/pin', 'me.wrong_pin', 'error');
    if (!validPin(b.pin)) return ctx.redirect('/me/pin', 'auth.bad_pin', 'error');
    if (b.pin !== b.pin2) return ctx.redirect('/me/pin', 'auth.pin_mismatch', 'error');
    setPin(user.id, b.pin, { keepSessionId: ctx.user.session_id });
    ctx.redirect(homeFor(user.role), 'me.pin_changed');
  });

  r.post('/me/signout-others', (ctx) => {
    if (!ctx.need()) return;
    revokeSessions(ctx.user.id, { exceptId: ctx.user.session_id });
    audit(ctx.user.id, 'user.signout_others', `user:${ctx.user.id}`);
    ctx.redirect('/me/pin', 'me.signed_out_all');
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
      <p><b>Who sees it.</b> Farms you are matched with see your first name, skills, tier, rating and distance. Your phone number is shared only after both sides sign a contract. Field agents see what they need to verify you. Our verification provider (when used) checks your NIN on our instruction. If you buy a paid course on our website, Paystack processes the payment; we receive the result and never your card details. Our SMS provider (Africa's Talking) receives your phone number and the text of messages we send you (sign-up and PIN codes, job offers, contract alerts) to deliver them. We share data with authorities only when the law requires.</p>
      <p><b>Security.</b> Data is encrypted in transit (HTTPS). PINs and one-time SMS codes are stored as salted or keyed hashes. You can sign out of every other device from "Change PIN". Access is limited to staff who need it and is logged.</p>
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
      <p><b>Farm owners</b> pay wages in full and on time, provide safe conditions and PPE, and do not hire under-18s for farm work.</p>
      <p><b>Fees.</b> Finding and hiring workers on AgroHands is currently free for farm owners. Some training courses are paid; the price is shown before you pay, and payment is taken on our website through Paystack. If we introduce fees for farm owners (for example a placement fee), we will publish them and tell you at least 30 days before they apply, and they will never apply to hires made before that date.</p>
      <p><b>Non-circumvention.</b> Once a placement fee is published, farm owners who hire a worker they met on AgroHands outside the platform within 12 months of meeting them pay that fee.</p>
      <p><b>Disputes</b> are first mediated by AgroHands within 48 hours. AgroHands is an employment agency and not the employer.</p>
      <p><b>Conduct.</b> Fraud, harassment or abuse leads to suspension.</p>
      <p class="muted small">Draft for legal review before launch.</p>
    </div>`));
}
