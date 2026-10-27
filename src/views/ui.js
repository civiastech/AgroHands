// Layout and reusable UI pieces. Server-rendered HTML, no client framework: fast on 2G and cheap phones.
import { config } from '../config.js';
import { html, raw } from '../html.js';
import { LANG_CODES, LOCALES } from '../i18n/index.js';
import { SKILLS } from '../data/skills.js';
import { STATE_NAMES } from '../data/states.js';

export function layout(ctx, { title, body, narrow = true }) {
  const { t, user, lang } = ctx;
  const home = !user ? '/' : user.role === 'worker' ? '/w' : user.role === 'farmer' ? '/f' : user.role === 'agent' ? '/a' : '/admin';
  return html`<!doctype html>
<html lang="${lang === 'pcm' ? 'en-NG' : lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1f6f43">
<title>${title ? `${title} · ` : ''}AgroHands</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg?v=${config.buildId}" type="image/svg+xml">
<link rel="stylesheet" href="/static/app.css?v=${config.buildId}">
<script src="/static/app.js?v=${config.buildId}" defer></script>
</head>
<body>
<header class="top">
  <a class="brand" href="${home}"><span class="logo">🌾</span> AgroHands</a>
  <nav>
    ${user ? html`<a href="${home}">${t('nav.dashboard')}</a> <a href="/academy">${t('nav.academy')}</a>
      <form method="post" action="/logout" class="inline">${csrfField(ctx)}<button class="link">${t('nav.logout')}</button></form>`
    : html`<a href="/login">${t('nav.login')}</a>`}
  </nav>
</header>
<div class="langs" aria-label="${t('nav.language')}">
  ${LANG_CODES.map((c) => html`<a href="/lang/${c}" class="${c === lang ? 'on' : ''}">${LOCALES[c]['lang.name']}</a>`)}
</div>
<main class="${narrow ? 'narrow' : 'wide'}">
${ctx.flash ? html`<p class="flash ${ctx.flash.type || ''}">${ctx.flash.msg}</p>` : ''}
${body}
</main>
<footer><p>${t('app.tagline')}</p><p class="small">AgroHands · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/account-deletion">Delete account</a></p></footer>
</body>
</html>`;
}

export const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;

export const form = (ctx, action, inner, { cls = '' } = {}) =>
  html`<form method="post" action="${action}" class="${cls}">${csrfField(ctx)}${inner}</form>`;

export function field(label, name, { type = 'text', value = '', required = false, attrs = '', hint = '' } = {}) {
  return html`<label class="field"><span>${label}</span>
    <input type="${type}" name="${name}" value="${value ?? ''}" ${required ? raw('required') : ''} ${raw(attrs)}>
    ${hint ? html`<small>${hint}</small>` : ''}</label>`;
}

export function select(label, name, options, selected, { required = false } = {}) {
  return html`<label class="field"><span>${label}</span>
    <select name="${name}" ${required ? raw('required') : ''}>
      <option value="">—</option>
      ${options.map(([v, l]) => html`<option value="${v}" ${String(v) === String(selected ?? '') ? raw('selected') : ''}>${l}</option>`)}
    </select></label>`;
}

export function checkbox(label, name, checked, value = '1') {
  return html`<label class="check"><input type="checkbox" name="${name}" value="${value}" ${checked ? raw('checked') : ''}> <span>${label}</span></label>`;
}

export const stateOptions = () => STATE_NAMES.map((s) => [s, s]);

export function skillPicker(t, name, selectedList = []) {
  return html`<fieldset class="skills"><legend>${t('worker.skills')}</legend>
    ${SKILLS.map((s) => html`<label class="chip"><input type="checkbox" name="${name}[]" value="${s.key}" ${selectedList.includes(s.key) ? raw('checked') : ''}>
      <span>${s.icon} ${t('skill.' + s.key)}</span></label>`)}
  </fieldset>`;
}

export const skillOptions = (t) => SKILLS.map((s) => [s.key, `${s.icon} ${t('skill.' + s.key)}`]);

export function tierBadge(t, tier) {
  const icon = { registered: '○', bronze: '🥉', silver: '🥈', gold: '🥇' }[tier] || '○';
  return html`<span class="badge tier-${tier}">${icon} ${t('tier.' + tier)}</span>`;
}

export function locationButton(t, lat, lng) {
  return html`<div class="loc">
    <input type="hidden" name="lat" value="${lat ?? ''}"><input type="hidden" name="lng" value="${lng ?? ''}">
    <button type="button" class="btn ghost" data-geo>${t('common.use_location')}</button>
    <small data-geo-status>${lat != null ? `✓ ${t('common.location_set')}` : ''}</small>
  </div>`;
}

export function locationFields(t, prefix, row = {}) {
  return html`${select(t('worker.state'), 'state', stateOptions(), row.state, { required: true })}
    ${field(t('worker.lga'), 'lga', { value: row.lga, required: true })}
    ${locationButton(t, row.lat, row.lng)}`;
}

export const stars = (n) => (n ? '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)) : '—');

export const fmtDate = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : '');

export const maskName = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};

export const waLink = (phone, text = '') =>
  `https://wa.me/234${String(phone).replace(/^0/, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

export function statusPill(t, prefix, status) {
  return html`<span class="pill s-${status}">${t(`${prefix}.status_${status}`)}</span>`;
}
