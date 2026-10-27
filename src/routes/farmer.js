import { html, naira } from '../html.js';
import { form, field, select, checkbox, skillOptions, locationFields, statusPill, maskName, tierBadge, icon, avatar, ring, stat, progress, sectionHead, emptyState, metaList, backLink } from '../views/ui.js';
import { q, audit, parseJson } from '../db.js';
import { SKILL_KEYS, skillIcon } from '../data/skills.js';
import { STATE_NAMES } from '../data/states.js';
import { farmOf, sendOffer, AppError } from '../lib/services.js';
import { refreshShortlist, dailyWage } from '../lib/matching.js';
import { config } from '../config.js';

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : null;
};
const coord = (v, min, max) => (v === '' || v == null ? null : num(v, min, max));

function ownJob(ctx, jobId) {
  const job = q.get('SELECT j.* FROM jobs j JOIN farms f ON f.id = j.farm_id WHERE j.id = ? AND f.owner_id = ?', jobId, ctx.user.id);
  if (!job) throw new AppError('common.not_found', 404);
  return job;
}

export default function register(r) {
  r.get('/f', (ctx) => {
    if (!ctx.need('farmer')) return;
    const { t } = ctx;
    const farm = farmOf(ctx.user.id);
    if (!farm) return ctx.redirect('/f/farm', 'farmer.need_farm');
    const jobs = q.all(
      `SELECT j.*,
         (SELECT COUNT(*) FROM matches m WHERE m.job_id = j.id AND m.status = 'offered') AS offered,
         (SELECT COUNT(*) FROM contracts c WHERE c.job_id = j.id AND c.status IN ('pending','active','completed')) AS hired
       FROM jobs j WHERE j.farm_id = ? ORDER BY j.id DESC LIMIT 30`, farm.id);
    const contracts = q.all(
      `SELECT c.*, u.name AS worker_name FROM contracts c JOIN users u ON u.id = c.worker_id
       WHERE c.farm_id = ? ORDER BY c.id DESC LIMIT 30`, farm.id);
    const openJobs = jobs.filter((j) => j.status === 'open');
    const pastJobs = jobs.filter((j) => j.status !== 'open');
    const sum = (k) => jobs.reduce((n, j) => n + (j[k] || 0), 0);
    ctx.render(t('farmer.title'), html`
      <section class="card card-hero">
        <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
          <span class="tile lg" style="background:rgb(255 255 255 / 16%)">🚜</span>
          <div class="grow"><span class="small muted">${t('farmer.title')}</span><h1 style="margin:2px 0 4px">${farm.name}</h1>
            <div class="row" style="gap:8px"><span class="small muted">${icon('pin', { cls: 'i-sm' })}</span><span class="small muted">${[farm.lga, farm.state].filter(Boolean).join(', ')}</span>
            ${farm.verified ? html`<span class="badge tier-gold">${icon('shield', { cls: 'i-sm' })}${t('farmer.verified')}</span>` : ''}</div></div>
        </div>
        <a class="btn accent block" style="margin-top:18px" href="/f/jobs/new">${icon('plus')}${t('farmer.post_job')}</a>
      </section>
      ${farm.verified ? '' : html`<p class="flash info">${t('farmer.unverified')}</p>`}

      <div class="stats">
        ${stat(t('farmer.stat_open'), openJobs.length)}
        ${stat(t('farmer.stat_offers'), sum('offered'))}
        ${stat(t('farmer.stat_hired'), sum('hired'))}
        ${stat(t('farmer.stat_active'), contracts.filter((c) => c.status === 'active').length)}
      </div>

      ${sectionHead(t('farmer.jobs'), { count: openJobs.length })}
      ${openJobs.length ? openJobs.map((j) => html`<a class="card" href="/f/jobs/${j.id}">
          <div class="row"><span class="tile">${skillIcon(j.skill)}</span>
            <div class="grow"><b>${j.title}</b><span class="small muted" style="display:block">${j.headcount} × ${naira(j.wage_amount)} ${t('common.per_' + j.wage_period)}</span></div>
            ${statusPill(t, 'job', j.status)}</div>
          ${metaList([['calendar', j.start_date], ['send', `${j.offered} ${t('farmer.stat_offers').toLowerCase()}`], ['users', `${j.hired}/${j.headcount} ${t('farmer.stat_hired').toLowerCase()}`]])}
          ${progress((j.hired / Math.max(1, j.headcount)) * 100)}
        </a>`) : emptyState('briefcase', t('farmer.no_jobs'), html`<a class="btn" href="/f/jobs/new">${icon('plus')}${t('farmer.post_job')}</a>`)}
      ${pastJobs.length ? html`<details class="card"><summary>${t('farmer.past_jobs')} <span class="count" style="background:var(--surface-2);color:var(--ink-2)">${pastJobs.length}</span></summary>
        <div class="list" style="box-shadow:none;margin-bottom:0">${pastJobs.map((j) => html`<a class="list-item" href="/f/jobs/${j.id}"><span class="tile">${skillIcon(j.skill)}</span>
          <span class="grow"><b>${j.title}</b><span class="sub row" style="gap:8px;margin-top:4px">${statusPill(t, 'job', j.status)}${j.start_date} · ${j.hired}/${j.headcount}</span></span>
          ${icon('right', { cls: 'chev' })}</a>`)}</div></details>` : ''}

      ${sectionHead(t('farmer.contracts'))}
      ${contracts.length ? html`<div class="list">
        ${contracts.map((c) => html`<a class="list-item" href="/c/${c.id}">${avatar(c.worker_name)}
          <span class="grow"><b>${c.worker_name}</b><span class="sub row" style="gap:8px;margin-top:4px">${statusPill(t, 'contract', c.status)}${c.ref}</span></span>
          ${icon('right', { cls: 'chev' })}</a>`)}
      </div>` : emptyState('users', t('farmer.no_contracts'))}`);
  });

  r.get('/f/farm', (ctx) => {
    if (!ctx.need('farmer')) return;
    const { t } = ctx;
    const farm = farmOf(ctx.user.id) || {};
    ctx.render(t('farmer.farm'), html`
      <h1>🏡 ${t('farmer.farm')}</h1>
      ${form(ctx, '/f/farm', html`
        ${field(t('farmer.farm_name'), 'name', { value: farm.name, required: true })}
        ${locationFields(t, '', farm)}
        ${field(t('farmer.address'), 'address', { value: farm.address })}
        ${field(t('farmer.size'), 'size_ha', { type: 'number', value: farm.size_ha, attrs: 'min="0" step="0.1"' })}
        ${field(t('farmer.crops'), 'crops', { value: farm.crops, attrs: 'placeholder="Pineapple, pepper, poultry…"' })}
        ${field(`${t('farmer.cac')} (${t('common.optional')})`, 'cac_number', { value: farm.cac_number })}
        <button class="btn block">${t('common.save')}</button>`)}`);
  });

  r.post('/f/farm', (ctx) => {
    if (!ctx.need('farmer')) return;
    const b = ctx.body;
    if (!String(b.name || '').trim()) throw new AppError('auth.need_name');
    const vals = [
      String(b.name).slice(0, 100), STATE_NAMES.includes(b.state) ? b.state : null, String(b.lga || '').slice(0, 60),
      String(b.address || '').slice(0, 200), coord(b.lat, 4, 14), coord(b.lng, 2, 15), num(b.size_ha, 0, 1_000_000),
      String(b.crops || '').slice(0, 200), String(b.cac_number || '').slice(0, 20) || null,
    ];
    const farm = farmOf(ctx.user.id);
    if (farm) {
      q.run(`UPDATE farms SET name = ?, state = ?, lga = ?, address = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng), size_ha = ?, crops = ?, cac_number = ? WHERE id = ?`, ...vals, farm.id);
    } else {
      q.run(`INSERT INTO farms (name, state, lga, address, lat, lng, size_ha, crops, cac_number, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...vals, ctx.user.id);
    }
    ctx.redirect('/f', 'common.saved');
  });

  r.get('/f/jobs/new', (ctx) => {
    if (!ctx.need('farmer')) return;
    const { t } = ctx;
    if (!farmOf(ctx.user.id)) return ctx.redirect('/f/farm', 'farmer.need_farm');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    ctx.render(t('farmer.post_job'), html`
      <h1>➕ ${t('farmer.post_job')}</h1>
      ${form(ctx, '/f/jobs', html`
        ${field(t('job.title'), 'title', { required: true, attrs: 'maxlength="80" placeholder="e.g. Pineapple harvest crew"' })}
        ${select(t('job.skill'), 'skill', skillOptions(t), '', { required: true })}
        ${field(t('job.headcount'), 'headcount', { type: 'number', value: 1, attrs: 'min="1" max="200"' })}
        ${select(t('job.type'), 'employment_type', [['casual', t('job.casual')], ['seasonal', t('job.seasonal')], ['permanent', t('job.permanent')]], 'casual', { required: true })}
        ${field(t('job.start'), 'start_date', { type: 'date', value: tomorrow, required: true })}
        ${field(t('job.duration'), 'duration_days', { type: 'number', attrs: 'min="1" max="730"' })}
        <div class="row">
          <div class="grow">${field(t('job.wage'), 'wage_amount', { type: 'number', required: true, attrs: 'min="500" max="5000000"' })}</div>
          <div class="grow">${select(t('worker.wage_period'), 'wage_period', [['day', t('common.day')], ['month', t('common.month')]], 'day')}</div>
        </div>
        <p class="small muted">${t('job.min_wage_note')}</p>
        ${field(t('job.hours'), 'hours_per_day', { type: 'number', value: 8, attrs: 'min="1" max="12"' })}
        ${checkbox('🏠 ' + t('job.accommodation'), 'accommodation', false)}
        ${checkbox('🍲 ' + t('job.meals'), 'meals', false)}
        ${select(t('job.min_tier'), 'min_tier', [['bronze', t('tier.bronze')], ['silver', t('tier.silver')], ['gold', t('tier.gold')]], 'bronze')}
        <label class="field"><span>${t('job.description')}</span><textarea name="description" rows="3" maxlength="600"></textarea></label>
        <button class="btn block">${t('job.create')}</button>`)}`);
  });

  r.post('/f/jobs', (ctx) => {
    if (!ctx.need('farmer')) return;
    const farm = farmOf(ctx.user.id);
    if (!farm) return ctx.redirect('/f/farm', 'farmer.need_farm');
    const b = ctx.body;
    const type = ['casual', 'seasonal', 'permanent'].includes(b.employment_type) ? b.employment_type : 'casual';
    if (!SKILL_KEYS.includes(b.skill) || !String(b.title || '').trim() || !/^\d{4}-\d{2}-\d{2}$/.test(b.start_date || '')) {
      throw new AppError('common.error');
    }
    const wage = num(b.wage_amount, 500, 5_000_000);
    if (!wage) throw new AppError('common.error');
    const { lastInsertRowid } = q.run(
      `INSERT INTO jobs (farm_id, title, skill, headcount, employment_type, start_date, duration_days, wage_amount, wage_period,
         hours_per_day, accommodation, meals, min_tier, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      farm.id, String(b.title).slice(0, 80), b.skill, num(b.headcount, 1, 200) ?? 1, type, b.start_date,
      type === 'permanent' ? null : num(b.duration_days, 1, 730), wage, b.wage_period === 'month' ? 'month' : 'day',
      num(b.hours_per_day, 1, 12) ?? 8, b.accommodation ? 1 : 0, b.meals ? 1 : 0,
      ['bronze', 'silver', 'gold'].includes(b.min_tier) ? b.min_tier : 'bronze', String(b.description || '').slice(0, 600),
    );
    audit(ctx.user.id, 'job.create', `job:${lastInsertRowid}`);
    refreshShortlist(Number(lastInsertRowid));
    ctx.redirect(`/f/jobs/${lastInsertRowid}`);
  });

  r.get('/f/jobs/:id', (ctx) => {
    if (!ctx.need('farmer')) return;
    const { t } = ctx;
    const job = ownJob(ctx, Number(ctx.params.id));
    const rows = q.all(
      `SELECT m.*, u.name, w.tier, w.skills, w.years_exp, w.primary_skill, w.state, w.lga, w.expected_wage, w.wage_period,
         (SELECT AVG(stars) FROM ratings WHERE to_user = m.worker_id) AS avg_rating,
         (SELECT COUNT(*) FROM ratings WHERE to_user = m.worker_id) AS rating_count,
         (SELECT id FROM contracts WHERE match_id = m.id) AS contract_id
       FROM matches m JOIN users u ON u.id = m.worker_id JOIN workers w ON w.user_id = m.worker_id
       WHERE m.job_id = ? AND m.status IN ('shortlisted','offered','accepted','declined')
       ORDER BY CASE m.status WHEN 'accepted' THEN 0 WHEN 'offered' THEN 1 WHEN 'shortlisted' THEN 2 ELSE 3 END, m.score DESC`,
      job.id);
    const fullTime = job.employment_type !== 'casual';
    const belowMin = fullTime && dailyWage(job.wage_amount, job.wage_period) * 26 < config.minWageMonthly;
    ctx.render(job.title, html`
      ${backLink('/f', t('common.back'))}
      <div class="page-head"><span class="tile lg">${skillIcon(job.skill)}</span>
        <div class="grow"><h1>${job.title}</h1><p>${t('skill.' + job.skill)} · ${t('job.' + job.employment_type)}</p></div>
        ${statusPill(t, 'job', job.status)}</div>
      ${metaList([
        ['wallet', `${job.headcount} × ${naira(job.wage_amount)} ${t('common.per_' + job.wage_period)}`],
        ['calendar', `${job.start_date}${job.duration_days ? ` · ${job.duration_days} ${t('common.day')}s` : ''}`],
        ['shield', `≥ ${t('tier.' + job.min_tier)}`],
        job.accommodation && [null, `🏠 ${t('job.accommodation')}`],
        job.meals && [null, `🍲 ${t('job.meals')}`],
      ])}
      ${belowMin ? html`<p class="flash error">${t('job.under_min_wage')}</p>` : ''}

      ${sectionHead(t('job.shortlist'), { count: rows.length, action: job.status === 'open'
        ? form(ctx, `/f/jobs/${job.id}/refresh`, html`<button class="btn ghost small">${icon('refresh')}${t('job.refresh')}</button>`) : '' })}
      ${rows.length ? rows.map((m) => {
        const bd = parseJson(m.breakdown, {});
        return html`<article class="card">
          <div class="row" style="align-items:flex-start">
            ${avatar(m.name)}
            <div class="grow"><h3>${maskName(m.name)}</h3>
              <div class="row" style="gap:6px;margin-top:4px">${tierBadge(t, m.tier)}<span class="small muted">${m.lga}, ${m.state}</span></div></div>
            ${ring(m.score, t('job.score'))}
          </div>
          ${metaList([
            ['pin', `${bd.km ?? '?'} km${bd.kmPrecise ? '' : ' ≈'}${bd.relocating ? ' · 🏠' : ''}`],
            ['star', m.rating_count ? `${Number(m.avg_rating).toFixed(1)} (${m.rating_count})` : t('job.new_worker')],
            ['refresh', `${t('job.reliability')} ${Math.round(((bd.reliability || 0) / 25) * 100)}%`],
            ['briefcase', `${m.years_exp} ${t('job.years_short')}`],
            ['wallet', `${naira(m.expected_wage)} ${t('common.per_' + m.wage_period)}`],
            bd.assessed && ['check', t('job.assessed')],
          ])}
          <p class="small muted" style="margin:0 0 12px;font-size:18px;letter-spacing:2px">${parseJson(m.skills).map((s) => skillIcon(s)).join(' ')}</p>
          ${m.status === 'shortlisted' && job.status === 'open'
            ? form(ctx, `/f/jobs/${job.id}/offer/${m.worker_id}`, html`<button class="btn block" style="margin:0">${icon('send')}${t('job.send_offer')}</button>`)
            : m.status === 'offered' ? html`<span class="pill s-pending">${t('job.offered')}</span>`
            : m.status === 'accepted' ? html`<div class="row"><span class="pill s-active">${t('job.accepted')}</span>
                ${m.contract_id ? html`<a class="btn ghost small" href="/c/${m.contract_id}">${icon('file')}${t('contract.title')}</a>` : ''}</div>`
            : html`<span class="pill">${t('job.declined')}</span>`}
        </article>`;
      }) : emptyState('users', t('job.no_matches'))}
      ${job.status === 'open' ? form(ctx, `/f/jobs/${job.id}/close`, html`<button class="btn ghost block" style="margin-top:24px">${icon('x')}${t('job.close')}</button>`, { cls: 'noprint' }) : ''}`);
  });

  r.post('/f/jobs/:id/refresh', (ctx) => {
    if (!ctx.need('farmer')) return;
    const job = ownJob(ctx, Number(ctx.params.id));
    refreshShortlist(job.id);
    ctx.redirect(`/f/jobs/${job.id}`);
  });

  r.post('/f/jobs/:id/offer/:worker', (ctx) => {
    if (!ctx.need('farmer')) return;
    const job = ownJob(ctx, Number(ctx.params.id));
    sendOffer(job.id, Number(ctx.params.worker), ctx.user.id);
    ctx.redirect(`/f/jobs/${job.id}`, 'job.offered');
  });

  r.post('/f/jobs/:id/close', (ctx) => {
    if (!ctx.need('farmer')) return;
    const job = ownJob(ctx, Number(ctx.params.id));
    q.run("UPDATE jobs SET status = 'closed' WHERE id = ?", job.id);
    q.run("UPDATE matches SET status = 'withdrawn' WHERE job_id = ? AND status IN ('shortlisted','offered')", job.id);
    ctx.redirect('/f');
  });
}
