import { createHash } from 'node:crypto';
import { html } from '../html.js';
import { form, field, select, statusPill, fmtDate, waLink, icon, avatar, backLink, sectionHead } from '../views/ui.js';
import { q, parseJson } from '../db.js';
import { verifyPin, isLocked, recordPinAttempt } from '../auth.js';
import { clauses, summaryLines } from '../lib/contract.js';
import { contractParty, signContract, endContract, rate, openDispute, AppError } from '../lib/services.js';
import { translator } from '../i18n/index.js';

function load(ctx) {
  const c = q.get('SELECT * FROM contracts WHERE id = ?', Number(ctx.params.id));
  if (!c) throw new AppError('common.not_found', 404);
  const party = contractParty(c, ctx.user.id);
  const staff = ['agent', 'admin'].includes(ctx.user.role);
  if (!party && !staff) throw new AppError('common.forbidden', 403);
  return { c, party, staff, terms: parseJson(c.terms, {}) };
}

export default function register(r) {
  r.get('/c/:id', (ctx) => {
    if (!ctx.need()) return;
    const { t } = ctx;
    const { c, party, terms } = load(ctx);
    const workerUser = q.get('SELECT * FROM users WHERE id = ?', c.worker_id);
    const tWorker = translator(workerUser.lang);
    const mySigned = party === 'worker' ? c.worker_signed_at : party === 'farmer' ? c.farmer_signed_at : null;
    const active = c.status === 'active';
    const other = party === 'worker' ? terms.employer : terms.worker;
    const myRating = q.get('SELECT stars FROM ratings WHERE contract_id = ? AND from_user = ?', c.id, ctx.user.id);
    const disputes = q.all('SELECT * FROM disputes WHERE contract_id = ? ORDER BY id DESC', c.id);
    const ended = ['completed', 'terminated'].includes(c.status);

    ctx.render(`${t('contract.title')} ${c.ref}`, html`
      <div class="row noprint"><span class="grow">${backLink(party === 'farmer' ? '/f' : party === 'worker' ? '/w' : '/a', t('common.back'))}</span>
        <button class="btn ghost small" data-print>${icon('print')}${t('contract.print')}</button></div>
      <div class="page-head"><span class="tile lg">${icon('file', { cls: 'i-lg' })}</span>
        <div class="grow"><h1>${t('contract.title')}</h1><p>Ref <b>${c.ref}</b> · ${fmtDate(c.created_at)}</p></div>
        ${statusPill(t, 'contract', c.status)}</div>

      ${party && c.status === 'pending' && !mySigned ? html`<div class="card sign-panel noprint">
        <div class="row" style="margin-bottom:4px"><span class="tile">${icon('edit')}</span><h3 class="grow" style="margin:0">${t('contract.sign')}</h3></div>
        <p class="small muted" style="margin:8px 0 0">${t('contract.sign_note')}</p>
        ${form(ctx, `/c/${c.id}/sign`, html`
          ${field(t('auth.pin'), 'pin', { type: 'password', required: true, attrs: 'inputmode="numeric" maxlength="6" autocomplete="current-password"' })}
          <button class="btn block">${icon('check')}${t('contract.sign')}</button>`)}</div>` : ''}
      ${party && c.status === 'pending' && mySigned ? html`<p class="flash info">${t('contract.signed_by_you')} ${t('contract.waiting_other')}</p>` : ''}
      ${active ? html`<p class="flash">${t('contract.active')}</p>` : ''}
      ${(active || ended) && party ? html`<div class="card noprint"><div class="row">${avatar(other.name)}
          <div class="grow"><span class="small muted">${t('contract.contact')}</span><b style="display:block">${other.name}</b></div></div>
          <div class="actions">
            <a class="btn ghost" href="tel:${other.phone}">${icon('phone')}${other.phone}</a>
            <a class="btn" href="${waLink(other.phone)}" target="_blank" rel="noopener">${icon('chat')}${t('contract.whatsapp')}</a>
          </div></div>` : ''}

      ${sectionHead(t('contract.summary'))}
      <ul class="summary">${summaryLines(terms, tWorker).map((l) => html`<li>${l}</li>`)}</ul>

      <div class="card contract">
        <h3>EMPLOYER</h3><p>${terms.employer.name} — ${terms.employer.farmName}<br>${terms.employer.address}${terms.employer.cac ? html`<br>CAC: ${terms.employer.cac}` : ''}</p>
        <h3>WORKER</h3><p>${terms.worker.name}<br>${terms.worker.address}${terms.worker.ninLast4 ? html`<br>NIN: •••••••${terms.worker.ninLast4} (verified)` : ''}</p>
        <ol>${clauses(terms).map(([h, body]) => html`<li><b>${h}.</b> ${body}</li>`)}</ol>
        <h3>SIGNATURES</h3>
        <p>Employer: ${c.farmer_signed_at ? `signed electronically ${new Date(c.farmer_signed_at * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC` : '— not yet signed'}<br>
           Worker: ${c.worker_signed_at ? `signed electronically ${new Date(c.worker_signed_at * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC` : '— not yet signed'}</p>
      </div>

      ${party && (active || ended) ? html`<div class="row noprint">
        <a class="btn ghost small" href="/c/${c.id}/rate">⭐ ${t('contract.rate')}${myRating ? ` (${myRating.stars})` : ''}</a>
        <a class="btn ghost small" href="/c/${c.id}/dispute">⚠️ ${t('contract.dispute')}</a></div>` : ''}

      ${disputes.length ? html`<div class="card noprint"><b>⚠️ ${t('dispute.title')}</b>
        ${disputes.map((d) => html`<p class="small">${fmtDate(d.created_at)} · ${t('dispute.cat_' + d.category)} · <b>${d.status}</b>${d.resolution ? html`<br>→ ${d.resolution}` : ''}</p>`)}</div>` : ''}

      ${(party || ctx.user.role !== 'worker') && ['pending', 'active'].includes(c.status) ? html`<details class="card noprint"><summary>${t('contract.end')}</summary>
        ${form(ctx, `/c/${c.id}/end`, html`
          ${select(t('contract.end_reason'), 'reason', (party === 'worker'
            ? ['completed', 'mutual', 'farm_closed']
            : ['completed', 'worker_left', 'no_show', 'dismissed', 'mutual', 'farm_closed']).map((x) => [x, t('contract.reason_' + x)]), '', { required: true })}
          <button class="btn danger small">${t('contract.end')}</button>`)}</details>` : ''}`);
  });

  r.post('/c/:id/sign', (ctx) => {
    if (!ctx.need()) return;
    const { c, party } = load(ctx);
    if (!party) throw new AppError('common.forbidden', 403);
    const user = q.get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    if (isLocked(user)) return ctx.redirect(`/c/${c.id}`, 'auth.locked', 'error');
    const ok = verifyPin(ctx.body.pin, user.pin_hash);
    recordPinAttempt(user, ok);
    if (!ok) return ctx.redirect(`/c/${c.id}`, 'contract.wrong_pin', 'error');
    const ip = ctx.ip;
    signContract(c.id, ctx.user.id, {
      at: new Date().toISOString(),
      ip,
      ua: createHash('sha256').update(String(ctx.req.headers['user-agent'] || '')).digest('hex').slice(0, 16),
      termsHash: createHash('sha256').update(c.terms).digest('hex'),
    });
    ctx.redirect(`/c/${c.id}`);
  });

  r.post('/c/:id/end', (ctx) => {
    if (!ctx.need()) return;
    const { c } = load(ctx);
    endContract(c.id, ctx.user.id, ctx.body.reason);
    ctx.redirect(`/c/${c.id}/rate`);
  });

  r.get('/c/:id/rate', (ctx) => {
    if (!ctx.need()) return;
    const { t } = ctx;
    const { c, party } = load(ctx);
    if (!party) throw new AppError('common.forbidden', 403);
    ctx.render(t('rating.title'), html`<h1>⭐ ${t('rating.title')}</h1>
      ${form(ctx, `/c/${c.id}/rate`, html`
        <fieldset class="skills"><legend>${t('rating.stars')}</legend>
          ${[1, 2, 3, 4, 5].map((n) => html`<label class="chip"><input type="radio" name="stars" value="${n}" required><span>${'★'.repeat(n)}</span></label>`)}
        </fieldset>
        <label class="field"><span>${t('rating.comment')}</span><textarea name="comment" rows="3" maxlength="500"></textarea></label>
        <button class="btn block">${t('common.submit')}</button>`)}
      <p><a href="/c/${c.id}">← ${t('common.back')}</a></p>`);
  });

  r.post('/c/:id/rate', (ctx) => {
    if (!ctx.need()) return;
    const { c } = load(ctx);
    rate(c.id, ctx.user.id, ctx.body.stars, ctx.body.comment);
    ctx.redirect(`/c/${c.id}`, 'rating.thanks');
  });

  r.get('/c/:id/dispute', (ctx) => {
    if (!ctx.need()) return;
    const { t } = ctx;
    const { c, party } = load(ctx);
    if (!party) throw new AppError('common.forbidden', 403);
    const cats = ['pay', 'conduct', 'safety', 'absence', 'theft', 'other'];
    ctx.render(t('dispute.title'), html`<h1>⚠️ ${t('dispute.title')}</h1>
      ${form(ctx, `/c/${c.id}/dispute`, html`
        ${select(t('dispute.category'), 'category', cats.map((k) => [k, t('dispute.cat_' + k)]), '', { required: true })}
        <label class="field"><span>${t('dispute.details')}</span><textarea name="description" rows="5" maxlength="2000" required></textarea></label>
        <button class="btn block">${t('common.submit')}</button>`)}`);
  });

  r.post('/c/:id/dispute', (ctx) => {
    if (!ctx.need()) return;
    const { c } = load(ctx);
    openDispute(c.id, ctx.user.id, ctx.body.category, ctx.body.description);
    ctx.redirect(`/c/${c.id}`, 'dispute.sent');
  });
}
