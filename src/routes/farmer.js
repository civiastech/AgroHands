import { html, naira } from '../html.js';
import { form, field, select, checkbox, skillOptions, locationFields, statusPill, maskName, tierBadge, stars } from '../views/ui.js';
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
    ctx.render(t('farmer.title'), html`
      <div class="row"><h1 class="grow">🚜 ${farm.name}</h1>
        ${farm.verified ? html`<span class="badge tier-gold">✔ ${t('farmer.verified')}</span>` : ''}</div>
      ${farm.verified ? '' : html`<p class="flash">${t('farmer.unverified')}</p>`}
      <a class="btn block" href="/f/jobs/new">➕ ${t('farmer.post_job')}</a>

      <h2>📋 ${t('farmer.jobs')}</h2>
      ${jobs.length ? jobs.map((j) => html`<a class="card" style="display:block;text-decoration:none;color:inherit" href="/f/jobs/${j.id}">
          <div class="row"><b class="grow">${skillIcon(j.skill)} ${j.title}</b>${statusPill(t, 'job', j.status)}</div>
          <span class="small muted">${j.headcount} × ${naira(j.wage_amount)}/${t('common.' + j.wage_period)} · 📅 ${j.start_date} · ✉ ${j.offered} · ✅ ${j.hired}/${j.headcount}</span>
        </a>`) : html`<p class="muted">${t('common.none')}</p>`}

      <h2>🤝 ${t('farmer.contracts')}</h2>
      ${contracts.length ? html`<div class="card"><table>
        ${contracts.map((c) => html`<tr><td><a href="/c/${c.id}">${c.ref}</a></td><td>${c.worker_name}</td>
          <td>${statusPill(t, 'contract', c.status)}</td></tr>`)}</table></div>` : html`<p class="muted">${t('common.none')}</p>`}

      <p class="row"><a class="btn ghost small" href="/f/farm">✏️ ${t('farmer.farm')}</a>
        <a class="btn ghost small" href="/academy">🎓 ${t('nav.academy')}</a></p>
      <p class="small muted"><a href="/me/data">${t('me.data')}</a> · <a href="/me/delete">${t('me.delete')}</a></p>`);
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
      <p><a href="/f">← ${t('common.back')}</a></p>
      <div class="row"><h1 class="grow">${skillIcon(job.skill)} ${job.title}</h1>${statusPill(t, 'job', job.status)}</div>
      <p class="muted">${t('skill.' + job.skill)} · ${job.headcount} × ${naira(job.wage_amount)}/${t('common.' + job.wage_period)} ·
        ${t('job.' + job.employment_type)} · 📅 ${job.start_date}${job.duration_days ? ` (${job.duration_days}d)` : ''} ·
        ${job.accommodation ? '🏠 ' : ''}${job.meals ? '🍲 ' : ''}≥ ${t('tier.' + job.min_tier)}</p>
      ${belowMin ? html`<p class="flash error">${t('job.under_min_wage')}</p>` : ''}
      ${job.status === 'open' ? form(ctx, `/f/jobs/${job.id}/refresh`, html`<button class="btn ghost block">🔄 ${t('job.refresh')}</button>`) : ''}

      <h2>⭐ ${t('job.shortlist')}</h2>
      ${rows.length ? rows.map((m) => {
        const bd = parseJson(m.breakdown, {});
        return html`<div class="card">
          <div class="row">
            <div class="grow"><h3>${maskName(m.name)} ${tierBadge(t, m.tier)}</h3>
              <span class="small muted">${t('worker.years')}: ${m.years_exp} · ${m.lga}, ${m.state} · ${naira(m.expected_wage)}/${t('common.' + m.wage_period)}</span></div>
            <div style="text-align:right"><div class="score">${Math.round(m.score)}</div><span class="small muted">${t('job.score')}</span></div>
          </div>
          <div class="grid small" style="margin:8px 0">
            <span>📍 ${t('job.distance')}: ${bd.km ?? '?'} km${bd.kmPrecise ? '' : ' ≈'}${bd.relocating ? ' 🏠' : ''}</span>
            <span>⭐ ${t('job.rating')}: ${m.rating_count ? stars(m.avg_rating) : t('job.new_worker')}</span>
            <span>🔁 ${t('job.reliability')}: ${Math.round(((bd.reliability || 0) / 25) * 100)}%</span>
            ${bd.assessed ? html`<span>🎯 Skill assessed</span>` : ''}
          </div>
          <div class="small muted">${parseJson(m.skills).map((s) => skillIcon(s)).join(' ')}</div>
          <div style="margin-top:8px">
            ${m.status === 'shortlisted' && job.status === 'open'
              ? form(ctx, `/f/jobs/${job.id}/offer/${m.worker_id}`, html`<button class="btn small">✉ ${t('job.send_offer')}</button>`)
              : m.status === 'offered' ? html`<span class="pill s-pending">✉ ${t('job.offered')}</span>`
              : m.status === 'accepted' ? html`<span class="pill s-active">✅ ${t('job.accepted')}</span> ${m.contract_id ? html`<a href="/c/${m.contract_id}">${t('contract.title')} →</a>` : ''}`
              : html`<span class="pill">${t('job.declined')}</span>`}
          </div>
        </div>`;
      }) : html`<p class="card muted">${t('job.no_matches')}</p>`}
      ${job.status === 'open' ? form(ctx, `/f/jobs/${job.id}/close`, html`<button class="btn ghost small">${t('job.close')}</button>`) : ''}`);
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
