// Field-agent desk: assisted registration and the human checks that make tiers trustworthy.
import { randomInt } from 'node:crypto';
import { html } from '../html.js';
import { form, field, select, tierBadge, fmtDate, stateOptions } from '../views/ui.js';
import { q, audit, parseJson } from '../db.js';
import { normalisePhone, ninHash } from '../auth.js';
import { validNin } from '../lib/verify.js';
import { createUser, AppError } from '../lib/services.js';
import { refreshTier } from '../lib/tiers.js';
import { SKILL_KEYS, skillIcon } from '../data/skills.js';
import { STATE_NAMES } from '../data/states.js';

const ACTIONS = {
  nin_ok: ["UPDATE workers SET nin_status = 'verified', nin_provider = 'agent', nin_verified_at = unixepoch() WHERE user_id = ? AND nin_status = 'pending_agent'"],
  nin_bad: ["UPDATE workers SET nin_status = 'failed', nin_hash = NULL WHERE user_id = ?"],
  guarantor_ok: ["UPDATE workers SET guarantor_status = 'verified' WHERE user_id = ? AND guarantor_status = 'pending'"],
  guarantor_bad: ["UPDATE workers SET guarantor_status = 'failed' WHERE user_id = ?"],
  address_ok: ["UPDATE workers SET address_status = 'verified' WHERE user_id = ?"],
  address_bad: ["UPDATE workers SET address_status = 'failed' WHERE user_id = ?"],
};

export default function register(r) {
  r.get('/a', (ctx) => {
    if (!ctx.need('agent', 'admin')) return;
    const { t } = ctx;
    const ninQueue = q.all(`SELECT u.id, u.name, u.phone, w.state, w.lga, w.nin_last4 FROM workers w JOIN users u ON u.id = w.user_id WHERE w.nin_status = 'pending_agent' AND u.status = 'active' LIMIT 50`);
    const gQueue = q.all(`SELECT u.id, u.name, w.guarantor_name, w.guarantor_phone FROM workers w JOIN users u ON u.id = w.user_id WHERE w.guarantor_status = 'pending' AND u.status = 'active' LIMIT 50`);
    const aQueue = q.all(`SELECT u.id, u.name, w.town, w.lga, w.state FROM workers w JOIN users u ON u.id = w.user_id WHERE w.address_status = 'none' AND w.nin_status = 'verified' AND u.status = 'active' LIMIT 50`);
    const fQueue = q.all(`SELECT f.*, u.name AS owner, u.phone FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.verified = 0 LIMIT 50`);
    const disputes = q.all(`SELECT d.*, c.ref FROM disputes d JOIN contracts c ON c.id = d.contract_id WHERE d.status = 'open' ORDER BY d.id LIMIT 50`);
    const list = (title, rows, render) => html`<h2>${title} (${rows.length})</h2>${rows.length ? html`<div class="card"><table>${rows.map(render)}</table></div>` : html`<p class="muted">${t('common.none')}</p>`}`;
    ctx.render(t('agent.title'), html`
      <h1>🧭 ${t('agent.title')}</h1>
      <form method="get" action="/a/find" class="row"><div class="grow">${field(t('agent.find'), 'phone', { type: 'tel', attrs: 'inputmode="tel"' })}</div><button class="btn">🔍</button></form>
      <a class="btn block" href="/a/register">➕ ${t('agent.register_worker')}</a>
      ${list('🆔 ' + t('agent.nin_reviews'), ninQueue, (w) => html`<tr><td><a href="/a/w/${w.id}">${w.name}</a></td><td>${w.phone}</td><td>…${w.nin_last4}</td><td>${w.lga}, ${w.state}</td></tr>`)}
      ${list('🤝 ' + t('agent.guarantors'), gQueue, (w) => html`<tr><td><a href="/a/w/${w.id}">${w.name}</a></td><td>${w.guarantor_name}</td><td><a href="tel:${w.guarantor_phone}">${w.guarantor_phone}</a></td></tr>`)}
      ${list('🏠 ' + t('agent.addresses'), aQueue, (w) => html`<tr><td><a href="/a/w/${w.id}">${w.name}</a></td><td>${w.town}, ${w.lga}, ${w.state}</td></tr>`)}
      ${list('🚜 ' + t('agent.farms'), fQueue, (f) => html`<tr><td>${f.name}<br><span class="small muted">${f.owner} · ${f.phone}</span></td><td>${f.address}, ${f.lga}, ${f.state}${f.lat ? html`<br><a href="https://maps.google.com/?q=${f.lat},${f.lng}" target="_blank" rel="noopener">map</a>` : ''}</td>
        <td>${form(ctx, `/a/f/${f.id}/verify`, html`<button class="btn small">✔ ${t('agent.verify_farm')}</button>`)}</td></tr>`)}
      ${list('⚠️ Disputes', disputes, (d) => html`<tr><td><a href="/c/${d.contract_id}">${d.ref}</a></td><td>${d.category}</td><td class="small">${d.description}</td><td>${fmtDate(d.created_at)}</td></tr>`)}`, { narrow: false });
  });

  r.get('/a/find', (ctx) => {
    if (!ctx.need('agent', 'admin')) return;
    const phone = normalisePhone(ctx.query.phone);
    const u = phone && q.get("SELECT id FROM users WHERE phone = ? AND role = 'worker'", phone);
    if (!u) return ctx.redirect('/a', 'common.not_found', 'error');
    ctx.res.redirect(`/a/w/${u.id}`);
  });

  r.get('/a/w/:id', (ctx) => {
    if (!ctx.need('agent', 'admin')) return;
    const { t } = ctx;
    const id = Number(ctx.params.id);
    const u = q.get('SELECT * FROM users WHERE id = ?', id);
    const w = q.get('SELECT * FROM workers WHERE user_id = ?', id);
    if (!u || !w) throw new AppError('common.not_found', 404);
    const act = (a, label, cls = '') => form(ctx, `/a/w/${id}/${a}`, html`<button class="btn small ${cls}">${label}</button>`, { cls: 'inline' });
    const skills = parseJson(w.skills);
    const assessed = parseJson(w.assessed_skills);
    ctx.render(u.name, html`
      <p><a href="/a">← ${t('agent.title')}</a></p>
      <div class="row"><h1 class="grow">${u.name}</h1>${tierBadge(t, w.tier)}</div>
      <p class="muted">${u.phone} · ${w.town || ''} ${w.lga || ''} ${w.state || ''} · DOB ${w.dob || '?'} · joined ${fmtDate(u.created_at)}</p>
      <div class="card"><h3>🆔 NIN: ${w.nin_status}${w.nin_last4 ? ` (…${w.nin_last4})` : ''}</h3>
        ${w.nin_status === 'pending_agent' ? html`<div class="row">${act('nin_ok', '✔ ' + t('agent.confirm_nin'))} ${act('nin_bad', '✖ ' + t('agent.reject_nin'), 'ghost')}</div>` : ''}
        ${['none', 'failed'].includes(w.nin_status) ? form(ctx, `/a/w/${id}/nin`, html`
          ${field(t('verify.nin'), 'nin', { required: true, attrs: 'inputmode="numeric" pattern="[0-9]{11}" maxlength="11" autocomplete="off"' })}
          <label class="check"><input type="checkbox" name="consent" value="1" required> <span>${t('agent.confirm_nin')}. The worker consents to this check.</span></label>
          <button class="btn small">✔ ${t('verify.button')}</button>`) : ''}</div>
      <div class="card"><h3>🤝 Guarantor: ${w.guarantor_status}</h3>
        ${w.guarantor_name ? html`<p>${w.guarantor_name} (${w.guarantor_relation || '—'}) · <a href="tel:${w.guarantor_phone}">${w.guarantor_phone}</a></p>` : ''}
        ${w.guarantor_status === 'pending' ? html`<div class="row">${act('guarantor_ok', '✔ ' + t('agent.confirm_guarantor'))} ${act('guarantor_bad', '✖ ' + t('agent.reject_guarantor'), 'ghost')}</div>` : ''}</div>
      <div class="card"><h3>🏠 Address: ${w.address_status}</h3>
        ${w.address_status !== 'verified' ? html`<div class="row">${act('address_ok', '✔ ' + t('agent.confirm_address'))} ${act('address_bad', '✖', 'ghost')}</div>` : ''}</div>
      <div class="card"><h3>🎯 ${t('agent.assess')}</h3>
        <p>${skills.map((s) => html`${skillIcon(s)} ${t('skill.' + s)}${assessed.includes(s) ? ' ✔' : ''} · `)}</p>
        ${form(ctx, `/a/w/${id}/assess`, html`<div class="row"><div class="grow">${select('Skill', 'skill', skills.map((s) => [s, t('skill.' + s)]), '')}</div><button class="btn small">✔</button></div>`)}</div>`);
  });

  r.post('/a/w/:id/:action', (ctx) => {
    if (!ctx.need('agent', 'admin')) return;
    const id = Number(ctx.params.id);
    const { action } = ctx.params;
    if (action === 'nin') {
      const nin = String(ctx.body.nin || '').replace(/\D/g, '');
      if (!validNin(nin) || !ctx.body.consent) return ctx.redirect(`/a/w/${id}`, 'verify.bad_nin', 'error');
      const hash = ninHash(nin);
      if (q.get('SELECT user_id FROM workers WHERE nin_hash = ? AND user_id != ?', hash, id)) {
        return ctx.redirect(`/a/w/${id}`, 'verify.duplicate', 'error');
      }
      q.run(`UPDATE workers SET nin_hash = ?, nin_last4 = ?, nin_status = 'verified', nin_provider = 'agent', nin_verified_at = unixepoch()
             WHERE user_id = ?`, hash, nin.slice(-4), id);
      q.run('INSERT INTO consents (user_id, purpose) VALUES (?, ?)', id, 'nin_check');
    } else if (action === 'assess') {
      const w = q.get('SELECT skills, assessed_skills FROM workers WHERE user_id = ?', id);
      const skill = ctx.body.skill;
      if (!w || !SKILL_KEYS.includes(skill) || !parseJson(w.skills).includes(skill)) throw new AppError('common.error');
      const set = new Set(parseJson(w.assessed_skills)).add(skill);
      q.run('UPDATE workers SET assessed_skills = ? WHERE user_id = ?', JSON.stringify([...set]), id);
    } else if (ACTIONS[action]) {
      q.run(ACTIONS[action][0], id);
    } else {
      throw new AppError('common.not_found', 404);
    }
    audit(ctx.user.id, `agent.${action}`, `user:${id}`, ctx.body.skill ? { skill: ctx.body.skill } : undefined);
    refreshTier(id);
    ctx.redirect(`/a/w/${id}`, 'common.saved');
  });

  r.post('/a/f/:id/verify', (ctx) => {
    if (!ctx.need('agent', 'admin')) return;
    q.run('UPDATE farms SET verified = 1, verified_by = ? WHERE id = ?', ctx.user.id, Number(ctx.params.id));
    audit(ctx.user.id, 'agent.farm_verify', `farm:${ctx.params.id}`);
    ctx.redirect('/a', 'common.saved');
  });

  r.get('/a/register', (ctx) => {
    if (!ctx.need('agent', 'admin')) return;
    const { t } = ctx;
    ctx.render(t('agent.register_worker'), html`<h1>➕ ${t('agent.register_worker')}</h1>
      ${form(ctx, '/a/register', html`
        ${field(t('auth.name'), 'name', { required: true })}
        ${field(t('auth.phone'), 'phone', { type: 'tel', required: true, attrs: 'inputmode="tel"' })}
        ${select(t('worker.state'), 'state', stateOptions(), '', { required: true })}
        ${field(t('worker.lga'), 'lga', { required: true })}
        ${field(t('worker.town'), 'town')}
        ${select(t('worker.primary_skill'), 'skill', SKILL_KEYS.map((k) => [k, t('skill.' + k)]), '', { required: true })}
        <p class="small muted">The worker must agree to the Terms and Privacy Notice. Read them out in their language before you continue.</p>
        <label class="check"><input type="checkbox" name="consent" value="1" required> <span>The worker has heard and agreed to the Terms and Privacy Notice.</span></label>
        <button class="btn block">${t('auth.create')}</button>`)}`);
  });

  r.post('/a/register', (ctx) => {
    if (!ctx.need('agent', 'admin')) return;
    const { t } = ctx;
    const b = ctx.body;
    const phone = normalisePhone(b.phone);
    if (!phone) return ctx.redirect('/a/register', 'auth.bad_phone', 'error');
    if (!b.consent || !String(b.name || '').trim()) return ctx.redirect('/a/register', 'auth.need_consent', 'error');
    const pin = String(randomInt(1000, 9999));
    const id = createUser({ phone, pin, role: 'worker', name: String(b.name).slice(0, 80), lang: ctx.lang, createdBy: ctx.user.id });
    const skill = SKILL_KEYS.includes(b.skill) ? b.skill : 'farmhand';
    q.run('UPDATE workers SET state = ?, lga = ?, town = ?, skills = ?, primary_skill = ? WHERE user_id = ?',
      STATE_NAMES.includes(b.state) ? b.state : null, String(b.lga || '').slice(0, 60), String(b.town || '').slice(0, 60),
      JSON.stringify([skill]), skill, id);
    ctx.render(t('agent.register_worker'), html`
      <p class="flash">✔ ${b.name} — ${phone}</p>
      <div class="card"><p>${t('agent.temp_pin')}:</p><p class="score" style="font-size:36px;letter-spacing:6px">${pin}</p>
      <p class="small muted">Tell the worker this PIN privately. It is shown only once.</p></div>
      <a class="btn block" href="/a/w/${id}">${t('common.view')} →</a>`);
  });
}
