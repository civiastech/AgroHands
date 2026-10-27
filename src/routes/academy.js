import { html, naira } from '../html.js';
import { form } from '../views/ui.js';
import { q } from '../db.js';
import { COURSES, getCourse, PASS_MARK } from '../data/courses.js';
import { gradeQuiz, AppError } from '../lib/services.js';

export default function register(r) {
  r.get('/academy', (ctx) => {
    const { t, user } = ctx;
    const audience = user?.role === 'farmer' ? 'farmer' : user?.role === 'worker' ? 'worker' : null;
    const progress = user ? Object.fromEntries(q.all('SELECT course_id, passed, score, cert_code FROM course_progress WHERE user_id = ?', user.id).map((p) => [p.course_id, p])) : {};
    const list = COURSES.filter((c) => !audience || c.audience === audience);
    ctx.render(t('academy.title'), html`
      <h1>🎓 ${t('academy.title')}</h1>
      <p>${t('academy.sub')}</p>
      ${list.map((c) => {
        const p = progress[c.id];
        return html`<a class="card" style="display:block;text-decoration:none;color:inherit" href="/academy/${c.id}">
          <div class="row"><b class="grow">${c.icon} ${c.title}</b>${p?.passed ? html`<span class="pill s-active">✔ ${t('academy.passed')}</span>` : ''}</div>
          <span class="small muted">${c.minutes} ${t('academy.minutes')} · ${c.fee ? naira(c.fee) : t('academy.free')} · ${c.audience === 'farmer' ? '🚜' : '🧑‍🌾'}${c.requiredFor ? ` · ${t('tier.' + c.requiredFor)}` : ''}</span>
        </a>`;
      })}
      <p class="small muted">${t('academy.translation_note')}</p>`);
  });

  r.get('/academy/:id', (ctx) => {
    const { t } = ctx;
    const c = getCourse(ctx.params.id);
    if (!c) throw new AppError('common.not_found', 404);
    ctx.render(c.title, html`
      <p><a href="/academy">← ${t('academy.title')}</a></p>
      <h1>${c.icon} ${c.title}</h1>
      <p class="small muted">${c.minutes} ${t('academy.minutes')} · ${c.fee ? naira(c.fee) : t('academy.free')} · Standard: ${c.standard}</p>
      ${c.fee ? html`<p class="flash">${t('academy.paid_note')}</p>` : ''}
      ${c.lessons.map((l, i) => html`<div class="card lesson"><h3>${i + 1}. ${l.title}</h3>${l.body.map((p) => html`<p>${p}</p>`)}</div>`)}
      ${ctx.user ? html`<a class="btn block" href="/academy/${c.id}/quiz">📝 ${t('academy.continue')}</a>`
        : html`<a class="btn block" href="/login?next=/academy/${c.id}/quiz">📝 ${t('academy.continue')}</a>`}`);
  });

  r.get('/academy/:id/quiz', (ctx) => {
    if (!ctx.need()) return;
    const { t } = ctx;
    const c = getCourse(ctx.params.id);
    if (!c) throw new AppError('common.not_found', 404);
    ctx.render(`${t('academy.quiz')} · ${c.title}`, html`
      <h1>📝 ${t('academy.quiz')}: ${c.title}</h1>
      ${form(ctx, `/academy/${c.id}/quiz`, html`
        ${c.quiz.map((item, i) => html`<div class="q"><b>${i + 1}. ${item.q}</b>
          ${item.options.map((o, j) => html`<label><input type="radio" name="a${i}" value="${j}" required> <span>${o}</span></label>`)}</div>`)}
        <button class="btn block">${t('academy.submit_quiz')}</button>`)}`);
  });

  r.post('/academy/:id/quiz', (ctx) => {
    if (!ctx.need()) return;
    const { t } = ctx;
    const c = getCourse(ctx.params.id);
    if (!c) throw new AppError('common.not_found', 404);
    const answers = c.quiz.map((_, i) => ctx.body[`a${i}`]);
    const res = gradeQuiz(ctx.user.id, c.id, answers);
    ctx.render(c.title, html`
      <h1>${res.passed ? '🎉' : '📚'} ${res.passed ? t('academy.pass') : t('academy.fail')}</h1>
      <div class="card"><p>${t('academy.score')}: <b>${res.score}%</b> (${res.correct}/${res.total}) · pass mark ${PASS_MARK}%</p></div>
      ${res.passed && res.cert ? html`<a class="btn block" href="/cert/${res.cert}">🏅 ${t('academy.view_cert')}</a>`
        : html`<a class="btn block" href="/academy/${c.id}">${t('academy.start')}</a>`}
      <a class="btn ghost block" href="${ctx.user.role === 'worker' ? '/w' : '/academy'}">${t('common.back')}</a>`);
  });

  // Public certificate verification: anyone (e.g. a farm) can check a certificate code.
  r.get('/cert/:code', (ctx) => {
    const { t } = ctx;
    const p = q.get(
      `SELECT p.*, u.name FROM course_progress p JOIN users u ON u.id = p.user_id WHERE p.cert_code = ? AND p.passed = 1`,
      ctx.params.code);
    if (!p) throw new AppError('common.not_found', 404);
    const c = getCourse(p.course_id);
    ctx.render(t('academy.certificate'), html`
      <div class="cert">
        <p style="font-size:40px;margin:0">🏅</p>
        <p class="muted">AgroHands Training Academy</p>
        <h1>${t('academy.certificate')}</h1>
        <p>This certifies that</p>
        <h2>${p.name}</h2>
        <p>has completed and passed</p>
        <h3>${c?.title || p.course_id}</h3>
        <p class="small muted">Score ${p.score}% · ${new Date(p.completed_at * 1000).toISOString().slice(0, 10)} · Code ${p.cert_code}</p>
        <p class="small muted">Aligned to: ${c?.standard || ''}</p>
      </div>
      <p class="noprint" style="text-align:center"><button class="btn ghost small" data-print>🖨 Print</button></p>`);
  });
}
