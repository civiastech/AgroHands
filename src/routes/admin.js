// Admin console: overview, users, farms, jobs, disputes, SMS delivery, payments, audit log and CSV exports.
// Staff-only and in English. Every change is written to the audit log.
import { html, raw, naira } from '../html.js';
import { form, field, select, fmtDate, icon, sectionHead, emptyState, stat, avatar, metaList, backLink, tierBadge } from '../views/ui.js';
import { q, audit, parseJson } from '../db.js';
import { AppError, resolveDispute } from '../lib/services.js';
import { revokeSessions, normalisePhone } from '../auth.js';
import { kick } from '../lib/sms.js';

const PAGE = 50;
const ROLES = ['worker', 'farmer', 'agent', 'admin'];

const NAV = [
  ['/admin', 'Overview', 'grid'],
  ['/admin/users', 'Users', 'users'],
  ['/admin/farms', 'Farms', 'sprout'],
  ['/admin/jobs', 'Jobs', 'briefcase'],
  ['/admin/disputes', 'Disputes', 'alert'],
  ['/admin/sms', 'SMS', 'send'],
  ['/admin/payments', 'Payments', 'wallet'],
  ['/admin/audit', 'Audit log', 'file'],
];

function page(ctx, title, body) {
  const path = ctx.url.pathname;
  const active = NAV.filter(([href]) => path === href || (href !== '/admin' && path.startsWith(href + '/'))).at(-1)?.[0] ?? '/admin';
  ctx.render(title, html`
    <nav class="subnav" aria-label="Admin sections">${NAV.map(([href, label, ic]) =>
      html`<a href="${href}" ${href === active ? raw('aria-current="page"') : ''}>${icon(ic, { cls: 'i-sm' })}${label}</a>`)}</nav>
    ${body}`, { narrow: false });
}

const pill = (status, label = status) => html`<span class="pill s-${status}">${label}</span>`;
const when = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');
const pageNo = (ctx) => Math.max(1, Number.parseInt(ctx.query.page, 10) || 1);

/** Prev/next links that keep the current filters. */
function pager(ctx, total) {
  const p = pageNo(ctx);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (pages === 1) return '';
  const link = (n) => { const u = new URLSearchParams(ctx.query); u.set('page', n); return `${ctx.url.pathname}?${u}`; };
  return html`<nav class="pager" aria-label="Pages">
    ${p > 1 ? html`<a class="btn ghost small" href="${link(p - 1)}">${icon('left', { cls: 'i-sm' })}Previous</a>` : html`<span></span>`}
    <span class="small muted">Page ${p} of ${pages} · ${total} total</span>
    ${p < pages ? html`<a class="btn ghost small" href="${link(p + 1)}">Next${icon('right', { cls: 'i-sm' })}</a>` : html`<span></span>`}</nav>`;
}

/** GET filter bar: [name, label, options|null(free text), value] */
function filters(ctx, items) {
  return html`<form method="get" action="${ctx.url.pathname}" class="filters">
    ${items.map(([name, label, options, value]) => html`<label><span>${label}</span>${options
      ? html`<select name="${name}">${options.map(([v, l]) => html`<option value="${v}" ${String(v) === String(value ?? '') ? raw('selected') : ''}>${l}</option>`)}</select>`
      : html`<input type="search" name="${name}" value="${value || ''}" placeholder="${label}">`}</label>`)}
    <button class="btn small">${icon('search', { cls: 'i-sm' })}Filter</button></form>`;
}

// ---- CSV ----------------------------------------------------------------------------------------
// Cells starting with = + - @ are prefixed so spreadsheets don't run them as formulas (CSV injection).
const cell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const toCsv = (rows) => (rows.length
  ? [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).map(cell).join(','))].join('\r\n') + '\r\n'
  : '');

const EXPORTS = {
  users: `SELECT u.id, u.name, u.phone, u.role, u.status, u.lang, date(u.created_at, 'unixepoch') AS joined,
            CASE WHEN u.phone_verified_at IS NOT NULL THEN 'yes' ELSE 'no' END AS phone_verified,
            w.tier, w.state, w.lga, w.primary_skill, w.nin_status, w.guarantor_status, w.available
          FROM users u LEFT JOIN workers w ON w.user_id = u.id WHERE u.status != 'deleted' ORDER BY u.id`,
  farms: `SELECT f.id, f.name, u.name AS owner, u.phone AS owner_phone, f.state, f.lga, f.size_ha, f.crops,
            CASE f.verified WHEN 1 THEN 'yes' ELSE 'no' END AS verified, date(f.created_at, 'unixepoch') AS created
          FROM farms f JOIN users u ON u.id = f.owner_id ORDER BY f.id`,
  jobs: `SELECT j.id, j.title, f.name AS farm, j.skill, j.headcount, j.employment_type, j.start_date, j.duration_days,
            j.wage_amount, j.wage_period, j.status, date(j.created_at, 'unixepoch') AS created
          FROM jobs j JOIN farms f ON f.id = j.farm_id ORDER BY j.id`,
  contracts: `SELECT c.ref, c.status, c.start_date, c.end_date, f.name AS farm, u.name AS worker, c.end_reason,
            datetime(c.worker_signed_at, 'unixepoch') AS worker_signed, datetime(c.farmer_signed_at, 'unixepoch') AS farmer_signed
          FROM contracts c JOIN farms f ON f.id = c.farm_id JOIN users u ON u.id = c.worker_id ORDER BY c.id`,
  payments: `SELECT p.reference, p.status, p.purpose, p.item, p.amount_kobo / 100.0 AS amount_naira, u.name, u.phone,
            datetime(p.created_at, 'unixepoch') AS created, datetime(p.paid_at, 'unixepoch') AS paid, p.channel
          FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.id`,
};

export default function register(r) {
  // ---- Overview -----------------------------------------------------------------------------------
  r.get('/admin', (ctx) => {
    if (!ctx.need('admin')) return;
    const n = (sql, ...p) => q.get(sql, ...p)?.n ?? 0;
    const tiers = Object.fromEntries(q.all('SELECT tier, COUNT(*) AS n FROM workers GROUP BY tier').map((x) => [x.tier, x.n]));
    const fill = q.get('SELECT AVG(filled_at - created_at) / 3600.0 AS h FROM jobs WHERE filled_at IS NOT NULL')?.h;
    const ended = q.get(`SELECT SUM(CASE WHEN end_reason IN ('worker_left','no_show') THEN 1 ELSE 0 END) AS bad, COUNT(*) AS n
                         FROM contracts WHERE status IN ('completed','terminated')`);
    const paid = q.get("SELECT COALESCE(SUM(amount_kobo), 0) / 100 AS total FROM payments WHERE status = 'success'").total;
    const attention = [
      ['alert', 'Open disputes', n("SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'"), '/admin/disputes'],
      ['sprout', 'Farms waiting for verification', n('SELECT COUNT(*) AS n FROM farms WHERE verified = 0'), '/admin/farms?verified=0'],
      ['idcard', 'NIN slips waiting for an agent', n("SELECT COUNT(*) AS n FROM workers WHERE nin_status = 'pending_agent'"), '/a'],
      ['send', 'SMS failed in the last 24 hours', n("SELECT COUNT(*) AS n FROM sms_outbox WHERE status = 'failed' AND created_at > unixepoch() - 86400"), '/admin/sms?status=failed'],
      ['wallet', 'Payments needing a look', n("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending' AND created_at < unixepoch() - 3600"), '/admin/payments?status=pending'],
    ].filter(([, , count]) => count > 0);
    page(ctx, 'Admin', html`
      <div class="page-head"><span class="tile lg">${icon('grid', { cls: 'i-lg' })}</span>
        <div class="grow"><h1>Admin</h1><p>Platform health, queues and exports.</p></div></div>

      ${sectionHead('Needs attention', { count: attention.length || undefined })}
      ${attention.length ? html`<div class="list">${attention.map(([ic, label, count, href]) => html`<a class="list-item" href="${href}">
          <span class="tile accent">${icon(ic)}</span><span class="grow"><b>${label}</b></span><span class="count-pill">${count}</span>${icon('right', { cls: 'chev' })}</a>`)}</div>`
        : emptyState('check', 'Nothing waiting. All queues are clear.')}

      ${sectionHead('Marketplace')}
      <div class="grid">
        ${stat('Active workers', n("SELECT COUNT(*) AS n FROM users WHERE role = 'worker' AND status = 'active'"))}
        ${stat('Bronze or better', (tiers.bronze || 0) + (tiers.silver || 0) + (tiers.gold || 0))}
        ${stat('Silver / Gold', `${tiers.silver || 0} / ${tiers.gold || 0}`)}
        ${stat('Farms (verified)', `${n('SELECT COUNT(*) AS n FROM farms')} (${n('SELECT COUNT(*) AS n FROM farms WHERE verified = 1')})`)}
        ${stat('Open jobs', n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'open'"))}
        ${stat('Active contracts', n("SELECT COUNT(*) AS n FROM contracts WHERE status = 'active'"))}
        ${stat('Avg time to fill', fill ? `${Math.round(fill)} h` : '—')}
        ${stat('Bad exits', ended?.n ? `${Math.round((ended.bad / ended.n) * 100)}%` : '—')}
        ${stat('Certificates', n('SELECT COUNT(*) AS n FROM course_progress WHERE passed = 1'))}
        ${stat('Sign-ups, last 7 days', n('SELECT COUNT(*) AS n FROM users WHERE created_at > unixepoch() - 7 * 86400'))}
        ${stat('SMS sent, last 24 h', n("SELECT COUNT(*) AS n FROM sms_outbox WHERE status = 'sent' AND sent_at > unixepoch() - 86400"))}
        ${stat('Payments received', naira(paid))}
      </div>

      ${sectionHead('Export (CSV)')}
      <div class="row wrap">${Object.keys(EXPORTS).map((k) => html`<a class="btn ghost small" href="/admin/export/${k}.csv">${icon('download', { cls: 'i-sm' })}${k}</a>`)}</div>
      <p class="small muted">Exports contain personal data. Keep them on encrypted devices and delete them when done; each download is logged.</p>`);
  });

  // ---- Users ----------------------------------------------------------------------------------------
  r.get('/admin/users', (ctx) => {
    if (!ctx.need('admin')) return;
    const { role = '', status = 'active' } = ctx.query;
    const term = String(ctx.query.q || '').trim();
    const where = ["u.status != 'deleted'"];
    const params = [];
    if (term) {
      const phone = normalisePhone(term);
      where.push('(u.name LIKE ? OR u.phone LIKE ?)');
      params.push(`%${term}%`, phone || `%${term.replace(/\D/g, '') || term}%`);
    }
    if (ROLES.includes(role)) { where.push('u.role = ?'); params.push(role); }
    if (['active', 'suspended'].includes(status)) { where.push('u.status = ?'); params.push(status); }
    const sql = `FROM users u LEFT JOIN workers w ON w.user_id = u.id WHERE ${where.join(' AND ')}`;
    const total = q.get(`SELECT COUNT(*) AS n ${sql}`, ...params).n;
    const users = q.all(`SELECT u.*, w.tier ${sql} ORDER BY u.id DESC LIMIT ${PAGE} OFFSET ${(pageNo(ctx) - 1) * PAGE}`, ...params);
    page(ctx, 'Users', html`
      <h1>Users</h1>
      ${filters(ctx, [
        ['q', 'Name or phone', null, term],
        ['role', 'Role', [['', 'All roles'], ...ROLES.map((x) => [x, x])], role],
        ['status', 'Status', [['active', 'Active'], ['suspended', 'Suspended'], ['all', 'All']], status],
      ])}
      ${users.length ? html`<div class="list">${users.map((u) => html`<a class="list-item" href="/admin/users/${u.id}">${avatar(u.name)}
          <span class="grow"><b>${u.name}</b><span class="sub">${u.phone} · ${u.role}${u.tier ? ` · ${u.tier}` : ''} · joined ${fmtDate(u.created_at)}</span>
            ${u.status !== 'active' || !u.phone_verified_at ? html`<span class="sub">${u.status !== 'active' ? pill(u.status) : html`<span class="pill s-pending">phone not verified</span>`}</span>` : ''}</span>
          ${icon('right', { cls: 'chev' })}</a>`)}</div>${pager(ctx, total)}`
        : emptyState('users', 'No users match.')}`);
  });

  r.get('/admin/users/:id', (ctx) => {
    if (!ctx.need('admin')) return;
    const { t } = ctx;
    const u = q.get("SELECT * FROM users WHERE id = ? AND status != 'deleted'", Number(ctx.params.id));
    if (!u) throw new AppError('common.not_found', 404);
    const w = q.get('SELECT * FROM workers WHERE user_id = ?', u.id);
    const farms = q.all('SELECT * FROM farms WHERE owner_id = ?', u.id);
    const sessions = q.get('SELECT COUNT(*) AS n, MAX(last_seen_at) AS seen FROM sessions WHERE user_id = ? AND expires_at > unixepoch()', u.id);
    const contracts = q.all(`SELECT c.id, c.ref, c.status, c.start_date, f.name AS farm FROM contracts c JOIN farms f ON f.id = c.farm_id
                             WHERE c.worker_id = ? OR f.owner_id = ? ORDER BY c.id DESC LIMIT 20`, u.id, u.id);
    const createdBy = u.created_by && q.get('SELECT name FROM users WHERE id = ?', u.created_by)?.name;
    const log = q.all(`SELECT a.*, x.name FROM audit_log a LEFT JOIN users x ON x.id = a.actor_id
                       WHERE a.subject = ? OR a.actor_id = ? ORDER BY a.id DESC LIMIT 30`, `user:${u.id}`, u.id);
    const self = u.id === ctx.user.id;
    page(ctx, u.name, html`
      ${backLink('/admin/users', 'Users')}
      <div class="page-head">${avatar(u.name)}
        <div class="grow"><h1>${u.name}</h1><p>${u.phone} · ${u.role} ${u.status !== 'active' ? pill(u.status) : ''}</p></div></div>
      <div class="card">${metaList([
        ['phone', u.phone_verified_at ? `Phone verified ${fmtDate(u.phone_verified_at)}` : 'Phone not verified'],
        ['calendar', `Joined ${fmtDate(u.created_at)}${createdBy ? ` by agent ${createdBy}` : ''}`],
        ['globe', `Language: ${u.lang}`],
        ['lock', `${sessions.n} signed-in device(s)${sessions.seen ? ` · last seen ${when(sessions.seen)}` : ''}`],
        u.locked_until && u.locked_until > Date.now() / 1000 ? ['alert', `Locked until ${when(u.locked_until)}`] : null,
      ])}</div>

      ${w ? html`${sectionHead('Worker profile')}
        <div class="card">${tierBadge(t, w.tier)}${metaList([
          ['pin', [w.town, w.lga, w.state].filter(Boolean).join(', ') || '—'],
          ['briefcase', parseJson(w.skills).map((s) => t('skill.' + s)).join(', ') || '—'],
          ['idcard', `NIN: ${w.nin_status}${w.nin_last4 ? ` (…${w.nin_last4})` : ''}`],
          ['users', `Guarantor: ${w.guarantor_status}`],
          ['home', `Address: ${w.address_status}`],
        ])}<a class="btn ghost small" href="/a/w/${u.id}">Open in agent desk</a></div>` : ''}

      ${farms.length ? html`${sectionHead('Farms', { count: farms.length })}<div class="list">${farms.map((f) => html`<div class="list-item">
          <span class="tile">🚜</span><span class="grow"><b>${f.name}</b><span class="sub">${f.lga}, ${f.state}</span></span>
          ${f.verified ? pill('active', 'verified') : pill('pending', 'unverified')}</div>`)}</div>` : ''}

      ${contracts.length ? html`${sectionHead('Contracts', { count: contracts.length })}<div class="list">${contracts.map((c) => html`<a class="list-item" href="/c/${c.id}">
          <span class="grow"><b>${c.ref}</b><span class="sub">${c.farm} · from ${c.start_date}</span></span>${pill(c.status)}${icon('right', { cls: 'chev' })}</a>`)}</div>` : ''}

      ${sectionHead('Account actions')}
      ${self ? html`<p class="small muted">You cannot change your own role or status.</p>` : html`<div class="card">
        ${form(ctx, `/admin/users/${u.id}`, html`<div class="row wrap">
          <div class="grow">${select('Role', 'role', ROLES.map((x) => [x, x]), u.role)}</div>
          <div class="grow">${select('Status', 'status', [['active', 'Active'], ['suspended', 'Suspended']], u.status)}</div></div>
          ${field('Reason (kept in the audit log)', 'reason', { required: true, attrs: 'maxlength="200"' })}
          <button class="btn">${icon('check')}Save</button>`)}
        ${form(ctx, `/admin/users/${u.id}/signout`, html`<button class="btn ghost">${icon('logout')}Sign out on all devices</button>`)}</div>`}

      ${sectionHead('Activity')}
      <div class="card table-card"><table>${log.map((l) => html`<tr><td class="small nowrap">${when(l.created_at)}</td><td>${l.name || '—'}</td><td>${l.action}</td><td class="small">${l.subject}</td></tr>`)}</table></div>`);
  });

  r.post('/admin/users/:id', (ctx) => {
    if (!ctx.need('admin')) return;
    const u = q.get("SELECT * FROM users WHERE id = ? AND status != 'deleted'", Number(ctx.params.id));
    if (!u) throw new AppError('common.not_found', 404);
    updateUser(ctx, u, ctx.body);
    ctx.redirect(`/admin/users/${u.id}`, 'common.saved');
  });

  r.post('/admin/users/:id/signout', (ctx) => {
    if (!ctx.need('admin')) return;
    const id = Number(ctx.params.id);
    revokeSessions(id);
    audit(ctx.user.id, 'admin.signout', `user:${id}`);
    ctx.redirect(`/admin/users/${id}`, 'common.saved');
  });

  // Kept for the quick form and older bookmarks: update a user by phone number.
  r.post('/admin/role', (ctx) => {
    if (!ctx.need('admin')) return;
    const u = q.get("SELECT * FROM users WHERE phone = ? AND status != 'deleted'", normalisePhone(ctx.body.phone));
    if (!u) throw new AppError('common.not_found', 404);
    updateUser(ctx, u, ctx.body);
    ctx.redirect('/admin/users', 'common.saved');
  });

  // ---- Farms ----------------------------------------------------------------------------------------
  r.get('/admin/farms', (ctx) => {
    if (!ctx.need('admin')) return;
    const verified = ['0', '1'].includes(ctx.query.verified) ? ctx.query.verified : '';
    const term = String(ctx.query.q || '').trim();
    const where = ['1 = 1'];
    const params = [];
    if (verified) { where.push('f.verified = ?'); params.push(Number(verified)); }
    if (term) { where.push('(f.name LIKE ? OR f.state LIKE ? OR f.lga LIKE ? OR u.name LIKE ?)'); params.push(...Array(4).fill(`%${term}%`)); }
    const sql = `FROM farms f JOIN users u ON u.id = f.owner_id WHERE ${where.join(' AND ')}`;
    const total = q.get(`SELECT COUNT(*) AS n ${sql}`, ...params).n;
    const farms = q.all(`SELECT f.*, u.name AS owner, u.phone, u.id AS owner_id,
        (SELECT COUNT(*) FROM jobs j WHERE j.farm_id = f.id) AS jobs ${sql}
        ORDER BY f.verified, f.id DESC LIMIT ${PAGE} OFFSET ${(pageNo(ctx) - 1) * PAGE}`, ...params);
    page(ctx, 'Farms', html`
      <h1>Farms</h1>
      ${filters(ctx, [['q', 'Name, place or owner', null, term], ['verified', 'Verification', [['', 'All'], ['0', 'Waiting'], ['1', 'Verified']], verified]])}
      ${farms.length ? html`<div class="list">${farms.map((f) => html`<div class="list-item"><span class="tile">🚜</span>
          <span class="grow"><b>${f.name}</b>
            <span class="sub"><a href="/admin/users/${f.owner_id}">${f.owner}</a> · <a href="tel:${f.phone}">${f.phone}</a> · ${f.jobs} job(s)</span>
            <span class="sub">${[f.address, f.lga, f.state].filter(Boolean).join(', ')}${f.lat ? html` · <a href="https://maps.google.com/?q=${f.lat},${f.lng}" target="_blank" rel="noopener">map</a>` : ''}${f.cac_number ? ` · CAC ${f.cac_number}` : ''}</span></span>
          ${form(ctx, `/admin/farms/${f.id}/verify`, html`<input type="hidden" name="verified" value="${f.verified ? 0 : 1}">
            <button class="btn small ${f.verified ? 'ghost' : ''}">${f.verified ? 'Unverify' : html`${icon('check', { cls: 'i-sm' })}Verify`}</button>`)}</div>`)}</div>${pager(ctx, total)}`
        : emptyState('sprout', 'No farms match.')}`);
  });

  r.post('/admin/farms/:id/verify', (ctx) => {
    if (!ctx.need('admin')) return;
    const id = Number(ctx.params.id);
    const on = ctx.body.verified === '1';
    const { changes } = q.run('UPDATE farms SET verified = ?, verified_by = ? WHERE id = ?', on ? 1 : 0, on ? ctx.user.id : null, id);
    if (!changes) throw new AppError('common.not_found', 404);
    audit(ctx.user.id, on ? 'admin.farm_verify' : 'admin.farm_unverify', `farm:${id}`);
    ctx.redirect(ctx.req.headers.referer ? new URL(ctx.req.headers.referer).pathname + new URL(ctx.req.headers.referer).search : '/admin/farms', 'common.saved');
  });

  // ---- Jobs -----------------------------------------------------------------------------------------
  r.get('/admin/jobs', (ctx) => {
    if (!ctx.need('admin')) return;
    const { t } = ctx;
    const status = ['open', 'filled', 'closed'].includes(ctx.query.status) ? ctx.query.status : ctx.query.status === 'all' ? '' : 'open';
    const term = String(ctx.query.q || '').trim();
    const where = ['1 = 1'];
    const params = [];
    if (status) { where.push('j.status = ?'); params.push(status); }
    if (term) { where.push('(j.title LIKE ? OR f.name LIKE ? OR f.state LIKE ?)'); params.push(...Array(3).fill(`%${term}%`)); }
    const sql = `FROM jobs j JOIN farms f ON f.id = j.farm_id WHERE ${where.join(' AND ')}`;
    const total = q.get(`SELECT COUNT(*) AS n ${sql}`, ...params).n;
    const jobs = q.all(`SELECT j.*, f.name AS farm, f.state, f.lga, f.verified,
        (SELECT COUNT(*) FROM matches m WHERE m.job_id = j.id AND m.status = 'offered') AS offered
        ${sql} ORDER BY j.id DESC LIMIT ${PAGE} OFFSET ${(pageNo(ctx) - 1) * PAGE}`, ...params);
    page(ctx, 'Jobs', html`
      <h1>Jobs</h1>
      ${filters(ctx, [['q', 'Title, farm or state', null, term], ['status', 'Status', [['open', 'Open'], ['filled', 'Filled'], ['closed', 'Closed'], ['all', 'All']], status || 'all']])}
      ${jobs.length ? html`<div class="list">${jobs.map((j) => html`<div class="list-item"><span class="tile">${icon('briefcase')}</span>
          <span class="grow"><b>${j.title}</b>
            <span class="sub">${j.farm}${j.verified ? '' : ' (unverified farm)'} · ${j.lga}, ${j.state}</span>
            <span class="sub">${t('skill.' + j.skill)} · ${j.headcount} needed · ${naira(j.wage_amount)}/${j.wage_period} · from ${j.start_date} · ${j.offered} offer(s) out</span></span>
          ${pill(j.status)}
          ${j.status === 'open' ? form(ctx, `/admin/jobs/${j.id}/close`, html`<button class="btn small ghost" data-confirm="Close this job? Pending offers will expire.">${icon('x', { cls: 'i-sm' })}Close</button>`) : ''}</div>`)}</div>${pager(ctx, total)}`
        : emptyState('briefcase', 'No jobs match.')}`);
  });

  r.post('/admin/jobs/:id/close', (ctx) => {
    if (!ctx.need('admin')) return;
    const id = Number(ctx.params.id);
    q.tx(() => {
      const { changes } = q.run("UPDATE jobs SET status = 'closed' WHERE id = ? AND status = 'open'", id);
      if (!changes) throw new AppError('common.not_found', 404);
      q.run("UPDATE matches SET status = 'expired' WHERE job_id = ? AND status IN ('shortlisted','offered')", id);
      audit(ctx.user.id, 'admin.job_close', `job:${id}`);
    });
    ctx.redirect('/admin/jobs', 'common.saved');
  });

  // ---- Disputes -------------------------------------------------------------------------------------
  r.get('/admin/disputes', (ctx) => {
    if (!ctx.need('admin')) return;
    const open = q.all(`SELECT d.*, c.ref, c.id AS cid, u.name AS by_name, u.phone AS by_phone FROM disputes d
                        JOIN contracts c ON c.id = d.contract_id JOIN users u ON u.id = d.raised_by WHERE d.status = 'open' ORDER BY d.id`);
    const closed = q.all(`SELECT d.*, c.ref, c.id AS cid, u.name AS by_name FROM disputes d JOIN contracts c ON c.id = d.contract_id
                          JOIN users u ON u.id = d.raised_by WHERE d.status != 'open' ORDER BY d.resolved_at DESC LIMIT 20`);
    page(ctx, 'Disputes', html`
      <h1>Disputes</h1>
      ${sectionHead('Open', { count: open.length || undefined })}
      ${open.length ? open.map((d) => html`<div class="card">
        <p class="row wrap"><a href="/c/${d.cid}"><b>${d.ref}</b></a><span class="pill s-pending">${d.category}</span>
          <span class="small muted">by ${d.by_name} (<a href="tel:${d.by_phone}">${d.by_phone}</a>) · ${fmtDate(d.created_at)}</span></p>
        <p>${d.description}</p>
        ${form(ctx, `/admin/disputes/${d.id}`, html`
          ${field('Resolution (the person who raised it is told by SMS)', 'resolution', { required: true, attrs: 'maxlength="1000"' })}
          <div class="row wrap">${select('Outcome', 'status', [['resolved', 'Resolved'], ['rejected', 'Rejected']], 'resolved')}
          <button class="btn">${icon('check')}Close dispute</button></div>`)}</div>`) : emptyState('check', 'No open disputes.')}
      ${closed.length ? html`${sectionHead('Recently closed')}<div class="list">${closed.map((d) => html`<a class="list-item" href="/c/${d.cid}">
          <span class="grow"><b>${d.ref} · ${d.category}</b><span class="sub">${d.by_name} · ${d.resolution}</span></span>
          ${pill(d.status === 'resolved' ? 'completed' : 'closed', d.status)}</a>`)}</div>` : ''}`);
  });

  r.post('/admin/disputes/:id', (ctx) => {
    if (!ctx.need('admin')) return;
    resolveDispute(Number(ctx.params.id), ctx.user.id, ctx.body.status, ctx.body.resolution);
    ctx.redirect('/admin/disputes', 'common.saved');
  });

  // ---- SMS delivery ---------------------------------------------------------------------------------
  r.get('/admin/sms', (ctx) => {
    if (!ctx.need('admin')) return;
    const status = ['queued', 'sending', 'sent', 'failed'].includes(ctx.query.status) ? ctx.query.status : '';
    const counts = Object.fromEntries(q.all("SELECT status, COUNT(*) AS n FROM sms_outbox WHERE created_at > unixepoch() - 7 * 86400 GROUP BY status").map((x) => [x.status, x.n]));
    const params = status ? [status] : [];
    const total = q.get(`SELECT COUNT(*) AS n FROM sms_outbox ${status ? 'WHERE status = ?' : ''}`, ...params).n;
    const rows = q.all(`SELECT * FROM sms_outbox ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT ${PAGE} OFFSET ${(pageNo(ctx) - 1) * PAGE}`, ...params);
    const failed = q.get("SELECT COUNT(*) AS n FROM sms_outbox WHERE status = 'failed' AND created_at > unixepoch() - 86400 AND kind != 'otp'").n;
    page(ctx, 'SMS', html`
      <h1>SMS delivery</h1>
      <div class="grid">${stat('Sent (7 days)', counts.sent || 0)}${stat('Waiting / retrying', (counts.queued || 0) + (counts.sending || 0))}${stat('Failed (7 days)', counts.failed || 0)}</div>
      ${failed ? form(ctx, '/admin/sms/retry-failed', html`<button class="btn ghost" style="margin-top:12px">${icon('refresh')}Retry ${failed} failed alert(s) from the last 24 hours</button>`) : ''}
      ${filters(ctx, [['status', 'Status', [['', 'All'], ['failed', 'Failed'], ['queued', 'Queued'], ['sent', 'Sent']], status]])}
      ${rows.length ? html`<div class="list">${rows.map((m) => html`<div class="list-item">
          <span class="grow"><b>${m.kind} → ${m.phone}</b>
            <span class="sub">${when(m.created_at)} · ${m.attempts} attempt(s)${m.error ? html` · <span class="text-bad">${m.error}</span>` : ''}</span>
            <span class="sub">${m.body}</span></span>
          ${pill(m.status === 'sent' ? 'active' : m.status === 'failed' ? 'failed' : 'pending', m.status)}
          ${m.status === 'failed' && m.kind !== 'otp' && m.phone !== 'deleted' ? form(ctx, `/admin/sms/${m.id}/retry`, html`<button class="btn small ghost">${icon('refresh', { cls: 'i-sm' })}Retry</button>`) : ''}</div>`)}</div>${pager(ctx, total)}`
        : emptyState('send', 'No messages.')}
      <p class="small muted">Sign-up and PIN codes are never retried from here (they expire in 10 minutes); the person can ask for a new code.</p>`);
  });

  const retry = (where, ...params) => q.run(`UPDATE sms_outbox SET status = 'queued', attempts = 0, error = NULL, next_attempt_at = unixepoch()
                                            WHERE status = 'failed' AND kind != 'otp' AND phone != 'deleted' AND ${where}`, ...params).changes;
  r.post('/admin/sms/:id/retry', (ctx) => {
    if (!ctx.need('admin')) return;
    const n = retry('id = ?', Number(ctx.params.id));
    audit(ctx.user.id, 'admin.sms_retry', `sms:${ctx.params.id}`, { n });
    kick();
    ctx.redirect('/admin/sms', 'common.saved');
  });
  r.post('/admin/sms/retry-failed', (ctx) => {
    if (!ctx.need('admin')) return;
    const n = retry('created_at > unixepoch() - 86400');
    audit(ctx.user.id, 'admin.sms_retry', 'sms:failed-24h', { n });
    kick();
    ctx.redirect('/admin/sms', 'common.saved');
  });

  // ---- Payments -------------------------------------------------------------------------------------
  r.get('/admin/payments', (ctx) => {
    if (!ctx.need('admin')) return;
    const status = ['pending', 'success', 'failed'].includes(ctx.query.status) ? ctx.query.status : '';
    const params = status ? [status] : [];
    const total = q.get(`SELECT COUNT(*) AS n FROM payments ${status ? 'WHERE status = ?' : ''}`, ...params).n;
    const rows = q.all(`SELECT p.*, u.name, u.phone FROM payments p JOIN users u ON u.id = p.user_id ${status ? 'WHERE p.status = ?' : ''}
                        ORDER BY p.id DESC LIMIT ${PAGE} OFFSET ${(pageNo(ctx) - 1) * PAGE}`, ...params);
    const sums = q.get(`SELECT COALESCE(SUM(CASE WHEN status = 'success' THEN amount_kobo END), 0) / 100 AS paid,
                        COUNT(CASE WHEN status = 'success' THEN 1 END) AS n FROM payments`);
    page(ctx, 'Payments', html`
      <h1>Payments</h1>
      <div class="grid">${stat('Received', naira(sums.paid))}${stat('Successful payments', sums.n)}</div>
      ${filters(ctx, [['status', 'Status', [['', 'All'], ['success', 'Successful'], ['pending', 'Pending'], ['failed', 'Failed']], status]])}
      ${rows.length ? html`<div class="list">${rows.map((p) => html`<div class="list-item">
          <span class="grow"><b>${naira(p.amount_kobo / 100)} · ${p.purpose} ${p.item}</b>
            <span class="sub"><a href="/admin/users/${p.user_id}">${p.name}</a> · ${p.phone} · ${when(p.created_at)} · ref ${p.reference}${p.channel ? ` · ${p.channel}` : ''}</span></span>
          ${pill(p.status === 'success' ? 'active' : p.status === 'failed' ? 'failed' : 'pending', p.status)}</div>`)}</div>${pager(ctx, total)}`
        : emptyState('wallet', 'No payments yet.')}`);
  });

  // ---- Audit log ------------------------------------------------------------------------------------
  r.get('/admin/audit', (ctx) => {
    if (!ctx.need('admin')) return;
    const action = String(ctx.query.action || '').trim();
    const subject = String(ctx.query.subject || '').trim();
    const where = ['1 = 1'];
    const params = [];
    if (action) { where.push('a.action LIKE ?'); params.push(`${action}%`); }
    if (subject) { where.push('a.subject = ?'); params.push(subject); }
    const total = q.get(`SELECT COUNT(*) AS n FROM audit_log a WHERE ${where.join(' AND ')}`, ...params).n;
    const rows = q.all(`SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where.join(' AND ')}
                        ORDER BY a.id DESC LIMIT ${PAGE} OFFSET ${(pageNo(ctx) - 1) * PAGE}`, ...params);
    page(ctx, 'Audit log', html`
      <h1>Audit log</h1>
      ${filters(ctx, [['action', 'Action starts with (e.g. admin.)', null, action], ['subject', 'Subject (e.g. user:12)', null, subject]])}
      <div class="card table-card"><table>
        <thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>Subject</th><th>Details</th></tr></thead>
        <tbody>${rows.map((l) => html`<tr><td class="small nowrap">${when(l.created_at)}</td>
          <td>${l.actor_id ? html`<a href="/admin/users/${l.actor_id}">${l.name || l.actor_id}</a>` : '—'}</td>
          <td>${l.action}</td><td class="small">${l.subject}</td><td class="small muted">${l.meta || ''}</td></tr>`)}</tbody></table></div>
      ${pager(ctx, total)}`);
  });

  // ---- Exports --------------------------------------------------------------------------------------
  r.get('/admin/export/:name', (ctx) => {
    if (!ctx.need('admin')) return;
    const name = String(ctx.params.name).replace(/\.csv$/, '');
    if (!EXPORTS[name]) throw new AppError('common.not_found', 404);
    const rows = q.all(EXPORTS[name]);
    audit(ctx.user.id, 'admin.export', `export:${name}`, { rows: rows.length });
    ctx.res.headers['Content-Disposition'] = `attachment; filename="agrohands-${name}-${new Date().toISOString().slice(0, 10)}.csv"`;
    ctx.res.headers['Cache-Control'] = 'no-store';
    ctx.res.send('﻿' + toCsv(rows), 'text/csv; charset=utf-8'); // BOM so Excel reads Yoruba/Igbo names correctly
  });
}

/** Role/status change from the admin console. Changes take effect at once on every device. */
function updateUser(ctx, u, { role, status, reason }) {
  if (u.id === ctx.user.id) throw new AppError('common.forbidden', 403);
  if (!ROLES.includes(role) || !['active', 'suspended'].includes(status)) throw new AppError('common.error');
  q.tx(() => {
    q.run('UPDATE users SET role = ?, status = ? WHERE id = ?', role, status, u.id);
    if (role === 'worker') q.run('INSERT OR IGNORE INTO workers (user_id) VALUES (?)', u.id);
    if (status === 'suspended' || role !== u.role) revokeSessions(u.id);
    audit(ctx.user.id, 'admin.user_update', `user:${u.id}`, { role, status, was: { role: u.role, status: u.status }, reason: String(reason || '').slice(0, 200) || undefined });
  });
}
