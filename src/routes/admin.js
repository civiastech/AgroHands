import { html } from '../html.js';
import { form, field, select, fmtDate } from '../views/ui.js';
import { q, audit } from '../db.js';
import { AppError, resolveDispute } from '../lib/services.js';
import { revokeSessions } from '../auth.js';

export default function register(r) {
  r.get('/admin', (ctx) => {
    if (!ctx.need('admin')) return;
    const one = (sql, ...p) => q.get(sql, ...p)?.n ?? 0;
    const tiers = Object.fromEntries(q.all('SELECT tier, COUNT(*) AS n FROM workers GROUP BY tier').map((r) => [r.tier, r.n]));
    const fill = q.get("SELECT AVG(filled_at - created_at) / 3600.0 AS h FROM jobs WHERE filled_at IS NOT NULL")?.h;
    const ended = q.get(`SELECT SUM(CASE WHEN end_reason IN ('worker_left','no_show') THEN 1 ELSE 0 END) AS bad, COUNT(*) AS n
                         FROM contracts WHERE status IN ('completed','terminated')`);
    const stats = [
      ['Workers', one("SELECT COUNT(*) AS n FROM users WHERE role = 'worker' AND status = 'active'")],
      ['Bronze+', (tiers.bronze || 0) + (tiers.silver || 0) + (tiers.gold || 0)],
      ['Silver / Gold', `${tiers.silver || 0} / ${tiers.gold || 0}`],
      ['Farms (verified)', `${one('SELECT COUNT(*) AS n FROM farms')} (${one('SELECT COUNT(*) AS n FROM farms WHERE verified = 1')})`],
      ['Open jobs', one("SELECT COUNT(*) AS n FROM jobs WHERE status = 'open'")],
      ['Active contracts', one("SELECT COUNT(*) AS n FROM contracts WHERE status = 'active'")],
      ['Avg time to fill', fill ? `${Math.round(fill)} h` : '—'],
      ['Bad exits', ended?.n ? `${Math.round((ended.bad / ended.n) * 100)}%` : '—'],
      ['Open disputes', one("SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'")],
      ['Certificates', one('SELECT COUNT(*) AS n FROM course_progress WHERE passed = 1')],
    ];
    const disputes = q.all(`SELECT d.*, c.ref, u.name AS by_name FROM disputes d JOIN contracts c ON c.id = d.contract_id
                            JOIN users u ON u.id = d.raised_by WHERE d.status = 'open' ORDER BY d.id`);
    const staff = q.all("SELECT id, name, phone, role FROM users WHERE role IN ('agent','admin') ORDER BY role, name");
    const log = q.all(`SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 40`);
    ctx.render('Admin', html`
      <h1>🛠 Admin</h1>
      <div class="grid">${stats.map(([k, v]) => html`<div class="stat"><span class="small muted">${k}</span><b>${v}</b></div>`)}</div>

      <h2>⚠️ Open disputes</h2>
      ${disputes.length ? disputes.map((d) => html`<div class="card">
        <p><a href="/c/${d.contract_id}">${d.ref}</a> · ${d.category} · by ${d.by_name} · ${fmtDate(d.created_at)}</p><p>${d.description}</p>
        ${form(ctx, `/admin/disputes/${d.id}`, html`
          ${field('Resolution', 'resolution', { required: true })}
          ${select('Outcome', 'status', [['resolved', 'Resolved'], ['rejected', 'Rejected']], 'resolved')}
          <button class="btn small">Save</button>`)}</div>`) : html`<p class="muted">None.</p>`}

      <h2>👥 Users and roles</h2>
      ${form(ctx, '/admin/role', html`<div class="row">
        <div class="grow">${field('Phone', 'phone', { type: 'tel', required: true })}</div>
        <div class="grow">${select('Role', 'role', [['agent', 'Agent'], ['admin', 'Admin'], ['worker', 'Worker'], ['farmer', 'Farmer']], 'agent')}</div>
        <div class="grow">${select('Status', 'status', [['active', 'Active'], ['suspended', 'Suspended']], 'active')}</div>
        <button class="btn">Update</button></div>`)}
      <div class="card"><table>${staff.map((s) => html`<tr><td>${s.name}</td><td>${s.phone}</td><td>${s.role}</td></tr>`)}</table></div>

      <h2>🧾 Audit log</h2>
      <div class="card"><table>${log.map((l) => html`<tr><td class="small">${new Date(l.created_at * 1000).toISOString().slice(0, 16).replace('T', ' ')}</td>
        <td>${l.name || '—'}</td><td>${l.action}</td><td class="small">${l.subject}</td></tr>`)}</table></div>`, { narrow: false });
  });

  r.post('/admin/disputes/:id', (ctx) => {
    if (!ctx.need('admin')) return;
    resolveDispute(Number(ctx.params.id), ctx.user.id, ctx.body.status, ctx.body.resolution);
    ctx.redirect('/admin', 'common.saved');
  });

  r.post('/admin/role', (ctx) => {
    if (!ctx.need('admin')) return;
    const { role, status } = ctx.body;
    const phone = String(ctx.body.phone || '').replace(/\D/g, '').replace(/^234/, '0');
    const u = q.get('SELECT * FROM users WHERE phone = ?', phone);
    if (!u) throw new AppError('common.not_found', 404);
    if (u.id === ctx.user.id) throw new AppError('common.forbidden', 403);
    if (!['agent', 'admin', 'worker', 'farmer'].includes(role) || !['active', 'suspended'].includes(status)) throw new AppError('common.error');
    q.run('UPDATE users SET role = ?, status = ? WHERE id = ?', role, status, u.id);
    if (status === 'suspended' || role !== u.role) revokeSessions(u.id); // takes effect now, on every device
    if (role === 'worker') q.run('INSERT OR IGNORE INTO workers (user_id) VALUES (?)', u.id);
    audit(ctx.user.id, 'admin.user_update', `user:${u.id}`, { role, status });
    ctx.redirect('/admin', 'common.saved');
  });
}
