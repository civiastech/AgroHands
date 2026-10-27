import { html, naira } from '../html.js';
import { form, field, select, checkbox, skillPicker, skillOptions, tierBadge, locationFields, statusPill, fmtDate, icon, avatar, progress, sectionHead, emptyState, metaList } from '../views/ui.js';
import { q, audit, parseJson } from '../db.js';
import { SKILL_KEYS, skillIcon } from '../data/skills.js';
import { STATE_NAMES } from '../data/states.js';
import { LANG_CODES, LOCALES } from '../i18n/index.js';
import { pendingOffers, respondToOffer, profileComplete, AppError } from '../lib/services.js';
import { refreshTier, ageFromDob } from '../lib/tiers.js';
import { verifyNin, validNin } from '../lib/verify.js';
import { normalisePhone } from '../auth.js';

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : null;
};
const coord = (v, min, max) => (v === '' || v == null ? null : num(v, min, max));

export default function register(r) {
  r.get('/w', (ctx) => {
    if (!ctx.need('worker')) return;
    const { t, user } = ctx;
    const tier = refreshTier(user.id);
    const w = q.get('SELECT * FROM workers WHERE user_id = ?', user.id);
    const safety = q.get("SELECT passed FROM course_progress WHERE user_id = ? AND course_id = 'safety-101'", user.id);
    const offers = pendingOffers(user.id);
    const contracts = q.all(
      `SELECT c.*, f.name AS farm_name FROM contracts c JOIN farms f ON f.id = c.farm_id
       WHERE c.worker_id = ? ORDER BY c.id DESC LIMIT 10`, user.id);
    const steps = [
      [profileComplete(w), 'worker.step_profile', '/w/profile'],
      [w.nin_status === 'verified', 'worker.step_nin', '/w/verify', w.nin_status === 'pending_agent' ? '⏳' : null],
      [!!safety?.passed, 'worker.step_safety', '/academy/safety-101'],
      [w.guarantor_status === 'verified', 'worker.step_guarantor', '/w/guarantor', w.guarantor_status === 'pending' ? '⏳' : null],
      [w.address_status === 'verified', 'worker.step_address', null],
    ];
    const age = ageFromDob(w.dob);
    const done = steps.filter(([ok]) => ok).length;
    const next = steps.find(([ok, , href]) => !ok && href);
    ctx.render(t('worker.title'), html`
      <section class="card card-hero">
        <div class="row">
          ${avatar(user.name)}
          <div class="grow"><span class="small muted">${t('worker.hello')}</span><h1 style="margin:0">${user.name.split(' ')[0]}</h1></div>
          ${tierBadge(t, tier)}
        </div>
        <div style="margin:18px 0 8px" class="row"><span class="grow small"><b>${t('worker.progress', { done, total: steps.length })}</b></span>
          ${next ? html`<a class="small" style="color:inherit;font-weight:650" href="${next[2]}">${t(next[1])} →</a>` : ''}</div>
        ${progress((done / steps.length) * 100)}
        ${form(ctx, '/w/availability', html`
          <input type="hidden" name="available" value="${w.available ? 0 : 1}">
          <button class="toggle ${w.available ? 'on' : ''}" style="margin-top:16px" aria-pressed="${w.available ? 'true' : 'false'}">
            <span><b>${w.available ? t('worker.available') : t('worker.not_available')}</b>
            <small>${t(w.available ? 'worker.available_hint' : 'worker.unavailable_hint')}</small></span>
            <span class="knob" aria-hidden="true"></span></button>`)}
      </section>
      ${age !== null && age < 18 ? html`<p class="flash error">${t('worker.under18')}</p>` : ''}

      ${sectionHead(t('worker.offers'), { count: offers.length })}
      ${offers.length ? offers.map((o) => html`
        <article class="card">
          <div class="row" style="align-items:flex-start">
            <span class="tile">${skillIcon(o.skill)}</span>
            <div class="grow"><h3>${o.title}</h3>
              <span class="small muted">${t('offer.from')} <b>${o.farm_name}</b>${o.farm_verified ? html` ${icon('shield', { cls: 'i-sm', label: t('farmer.verified') })}` : ''}</span></div>
            <div style="text-align:right"><b style="font-size:18px">${naira(o.wage_amount)}</b><br><span class="small muted">${t('common.per_' + o.wage_period)}</span></div>
          </div>
          ${metaList([
            ['pin', `${o.farm_lga}, ${o.farm_state}`],
            ['calendar', `${o.start_date}${o.duration_days ? ` · ${o.duration_days} ${t('common.day')}s` : ''}`],
            ['clock', `${o.hours_per_day}h / ${t('common.day')}`],
            o.accommodation && [null, `🏠 ${t('job.accommodation')}`],
            o.meals && [null, `🍲 ${t('job.meals')}`],
          ])}
          ${o.description ? html`<p>${o.description}</p>` : ''}
          <p class="small muted">${t('offer.accept_note')}</p>
          <div class="actions">
            ${form(ctx, `/w/offers/${o.match_id}/decline`, html`<button class="btn ghost">${icon('x')}${t('worker.decline')}</button>`)}
            ${form(ctx, `/w/offers/${o.match_id}/accept`, html`<button class="btn">${icon('check')}${t('worker.accept')}</button>`)}
          </div>
        </article>`) : emptyState('inbox', t('worker.no_offers'))}

      ${(() => {
        const list = html`<ul class="card steps">
          ${steps.map(([ok, key, href, wait]) => html`<li class="${ok ? 'done' : ''}">
            <span class="${ok ? 'ok' : wait ? 'wait' : 'todo'}">${ok ? '✓' : wait || ''}</span>
            <span class="grow">${ok || !href ? t(key) : html`<a href="${href}">${t(key)}</a>`}</span>
            ${!ok && href ? html`<a href="${href}" aria-hidden="true" tabindex="-1" class="muted">${icon('right')}</a>` : ''}</li>`)}
        </ul>`;
        // Once everything is done the checklist is history: fold it away behind a success line.
        return done === steps.length
          ? html`<details class="card" style="margin-top:24px"><summary><span class="tile" style="width:32px;height:32px">${icon('check', { cls: 'i-sm' })}</span>${t('worker.all_done')}</summary>${list}</details>`
          : html`${sectionHead(t('worker.next_steps'), { action: html`<span class="small muted">${done}/${steps.length}</span>` })}${list}`;
      })()}

      ${sectionHead(t('worker.contracts'))}
      ${contracts.length ? html`<div class="list">
        ${contracts.map((c) => html`<a class="list-item" href="/c/${c.id}"><span class="tile">${icon('file')}</span>
          <span class="grow"><b>${c.farm_name}</b>
            <span class="sub row" style="gap:8px;margin-top:4px">${statusPill(t, 'contract', c.status)}${c.ref} · ${c.start_date}</span></span>
          ${icon('right', { cls: 'chev' })}</a>`)}
      </div>` : emptyState('file', t('worker.no_contracts'))}`);
  });

  r.post('/w/availability', (ctx) => {
    if (!ctx.need('worker')) return;
    q.run('UPDATE workers SET available = ? WHERE user_id = ?', ctx.body.available === '1' ? 1 : 0, ctx.user.id);
    ctx.redirect('/w');
  });

  r.get('/w/profile', (ctx) => {
    if (!ctx.need('worker')) return;
    const { t } = ctx;
    const w = q.get('SELECT * FROM workers WHERE user_id = ?', ctx.user.id);
    const skills = parseJson(w.skills);
    const langs = parseJson(w.languages);
    ctx.render(t('worker.profile'), html`
      <h1>✏️ ${t('worker.profile')}</h1>
      ${form(ctx, '/w/profile', html`
        ${select(t('worker.gender'), 'gender', [['male', t('worker.male')], ['female', t('worker.female')]], w.gender)}
        ${field(t('worker.dob'), 'dob', { type: 'date', value: w.dob, required: true, attrs: 'max="2010-12-31"' })}
        ${locationFields(t, '', w)}
        ${field(t('worker.town'), 'town', { value: w.town })}
        ${skillPicker(t, 'skills', skills)}
        ${select(t('worker.primary_skill'), 'primary_skill', skillOptions(t), w.primary_skill, { required: true })}
        ${field(t('worker.years'), 'years_exp', { type: 'number', value: w.years_exp, attrs: 'min="0" max="60" inputmode="numeric"' })}
        <div class="row">
          <div class="grow">${field(t('worker.expected_wage'), 'expected_wage', { type: 'number', value: w.expected_wage, required: true, attrs: 'min="500" max="2000000" inputmode="numeric"' })}</div>
          <div class="grow">${select(t('worker.wage_period'), 'wage_period', [['day', t('common.day')], ['month', t('common.month')]], w.wage_period)}</div>
        </div>
        ${field(t('worker.radius'), 'radius_km', { type: 'number', value: w.radius_km, attrs: 'min="1" max="300" inputmode="numeric"' })}
        ${checkbox(t('worker.relocate'), 'will_relocate', !!w.will_relocate)}
        <fieldset><legend>${t('worker.languages')}</legend>
          ${LANG_CODES.map((c) => checkbox(LOCALES[c]['lang.name'], 'languages[]', langs.includes(c), c))}
        </fieldset>
        <button class="btn block">${t('common.save')}</button>`)}`);
  });

  r.post('/w/profile', (ctx) => {
    if (!ctx.need('worker')) return;
    const b = ctx.body;
    const skills = [].concat(b.skills || []).filter((s) => SKILL_KEYS.includes(s));
    const primary = SKILL_KEYS.includes(b.primary_skill) ? b.primary_skill : skills[0] || null;
    if (primary && !skills.includes(primary)) skills.push(primary);
    const langs = [].concat(b.languages || []).filter((l) => LANG_CODES.includes(l));
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(b.dob || '') ? b.dob : null;
    q.run(
      `UPDATE workers SET gender = ?, dob = COALESCE(?, dob), state = ?, lga = ?, town = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng),
         skills = ?, primary_skill = ?, years_exp = ?, expected_wage = ?, wage_period = ?, radius_km = ?, will_relocate = ?,
         languages = ?, updated_at = unixepoch() WHERE user_id = ?`,
      ['male', 'female'].includes(b.gender) ? b.gender : null,
      // DOB from a verified NIN is authoritative; self-declared only fills it when empty.
      q.get('SELECT nin_status FROM workers WHERE user_id = ?', ctx.user.id).nin_status === 'verified' ? null : dob,
      STATE_NAMES.includes(b.state) ? b.state : null,
      String(b.lga || '').slice(0, 60), String(b.town || '').slice(0, 60),
      coord(b.lat, 4, 14), coord(b.lng, 2, 15),
      JSON.stringify(skills), primary, num(b.years_exp, 0, 60) ?? 0,
      num(b.expected_wage, 0, 2_000_000), b.wage_period === 'month' ? 'month' : 'day',
      num(b.radius_km, 1, 300) ?? 30, b.will_relocate ? 1 : 0, JSON.stringify(langs), ctx.user.id,
    );
    const w = q.get('SELECT * FROM workers WHERE user_id = ?', ctx.user.id);
    ctx.redirect(w.nin_status === 'none' ? '/w/verify' : '/w', 'common.saved');
  });

  r.get('/w/verify', (ctx) => {
    if (!ctx.need('worker')) return;
    const { t } = ctx;
    const w = q.get('SELECT * FROM workers WHERE user_id = ?', ctx.user.id);
    if (w.nin_status === 'verified') return ctx.redirect('/w', 'verify.ok');
    ctx.render(t('verify.title'), html`
      <h1>🆔 ${t('verify.title')}</h1>
      ${w.nin_status === 'pending_agent' ? html`<p class="flash">⏳ ${t('verify.pending')} (…${w.nin_last4})</p>` : ''}
      <p>${t('verify.why')}</p>
      ${form(ctx, '/w/verify', html`
        ${field(t('verify.nin'), 'nin', { required: true, attrs: 'inputmode="numeric" pattern="[0-9]{11}" maxlength="11" autocomplete="off"' })}
        ${checkbox(t('verify.consent'), 'consent', false)}
        <button class="btn block">${t('verify.button')}</button>`)}`);
  });

  r.post('/w/verify', async (ctx) => {
    if (!ctx.need('worker')) return;
    const nin = String(ctx.body.nin || '').replace(/\D/g, '');
    if (!validNin(nin)) return ctx.redirect('/w/verify', 'verify.bad_nin', 'error');
    if (!ctx.body.consent) return ctx.redirect('/w/verify', 'auth.need_consent', 'error');
    const result = await verifyNin(nin, ctx.user.name);
    const clash = q.get('SELECT user_id FROM workers WHERE nin_hash = ? AND user_id != ?', result.hash, ctx.user.id);
    if (clash) {
      audit(ctx.user.id, 'nin.duplicate', `user:${ctx.user.id}`, { other: clash.user_id });
      return ctx.redirect('/w/verify', 'verify.duplicate', 'error');
    }
    q.run('INSERT INTO consents (user_id, purpose) VALUES (?, ?)', ctx.user.id, 'nin_check');
    if (result.status === 'failed') {
      audit(ctx.user.id, 'nin.failed', `user:${ctx.user.id}`, { reason: result.reason, provider: result.provider });
      return ctx.redirect('/w/verify', result.reason === 'name_mismatch' ? 'verify.name_mismatch' : 'verify.failed', 'error');
    }
    q.run(
      `UPDATE workers SET nin_hash = ?, nin_last4 = ?, nin_status = ?, nin_provider = ?, nin_ref = ?,
         nin_verified_at = CASE WHEN ? = 'verified' THEN unixepoch() END, dob = COALESCE(?, dob) WHERE user_id = ?`,
      result.hash, result.last4, result.status, result.provider, result.ref || null, result.status, result.dob || null, ctx.user.id,
    );
    audit(ctx.user.id, 'nin.' + result.status, `user:${ctx.user.id}`, { provider: result.provider });
    refreshTier(ctx.user.id);
    if (result.status === 'verified') return ctx.redirect('/w', 'verify.ok');
    ctx.redirect('/w/guarantor', 'verify.pending');
  });

  r.get('/w/guarantor', (ctx) => {
    if (!ctx.need('worker')) return;
    const { t } = ctx;
    const w = q.get('SELECT * FROM workers WHERE user_id = ?', ctx.user.id);
    ctx.render(t('guarantor.title'), html`
      <h1>🤝 ${t('guarantor.title')}</h1>
      <p>${t('guarantor.why')}</p>
      ${form(ctx, '/w/guarantor', html`
        ${field(t('guarantor.name'), 'g_name', { value: w.guarantor_name, required: true })}
        ${field(t('guarantor.phone'), 'g_phone', { type: 'tel', value: w.guarantor_phone, required: true, attrs: 'inputmode="tel"' })}
        ${field(t('guarantor.relation'), 'g_relation', { value: w.guarantor_relation, attrs: 'placeholder="Pastor, imam, uncle, former employer…"' })}
        <button class="btn block">${t('common.save')}</button>`)}`);
  });

  r.post('/w/guarantor', (ctx) => {
    if (!ctx.need('worker')) return;
    const phone = normalisePhone(ctx.body.g_phone);
    if (!phone || phone === ctx.user.phone) return ctx.redirect('/w/guarantor', 'auth.bad_phone', 'error');
    if (!String(ctx.body.g_name || '').trim()) return ctx.redirect('/w/guarantor', 'auth.need_name', 'error');
    q.run(
      `UPDATE workers SET guarantor_name = ?, guarantor_phone = ?, guarantor_relation = ?, guarantor_status = 'pending' WHERE user_id = ?`,
      String(ctx.body.g_name).slice(0, 80), phone, String(ctx.body.g_relation || '').slice(0, 60), ctx.user.id,
    );
    ctx.redirect('/w', 'guarantor.saved');
  });

  r.post('/w/offers/:id/:action', (ctx) => {
    if (!ctx.need('worker')) return;
    const { id, action } = ctx.params;
    if (!['accept', 'decline'].includes(action)) throw new AppError('common.not_found', 404);
    const w = q.get('SELECT dob FROM workers WHERE user_id = ?', ctx.user.id);
    const age = ageFromDob(w.dob);
    if (action === 'accept' && age !== null && age < 18) throw new AppError('worker.under18');
    const contractId = respondToOffer(Number(id), ctx.user.id, action === 'accept');
    if (contractId) return ctx.redirect(`/c/${contractId}`);
    ctx.redirect('/w');
  });
}

export { fmtDate };
