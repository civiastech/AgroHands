// Layout and reusable UI pieces. Server-rendered HTML, no client framework: fast on 2G and cheap phones.
import { ASSET_VERSION } from '../routes/static.js';
import { html, raw } from '../html.js';
import { LANG_CODES, LOCALES, htmlLang } from '../i18n/index.js';
import { SKILLS } from '../data/skills.js';
import { STATE_NAMES } from '../data/states.js';
import { ICON_SPRITE, icon } from './icons.js';

export { icon };

const HOME = { worker: '/w', farmer: '/f', agent: '/a', admin: '/admin' };
export const homeFor = (role) => HOME[role] || '/';

/** Main navigation per role: bottom tabs on phones, top links on desktop. [icon, href, label key] */
function tabsFor(role) {
  const academy = ['cap', '/academy', 'nav.academy'];
  return {
    worker: [['home', '/w', 'nav.dashboard'], academy, ['idcard', '/w/verify', 'nav.verify'], ['user', '/w/profile', 'nav.profile']],
    farmer: [['home', '/f', 'nav.dashboard'], ['plus', '/f/jobs/new', 'nav.post_job'], academy, ['sprout', '/f/farm', 'nav.farm']],
    agent: [['home', '/a', 'nav.desk'], ['plus', '/a/register', 'nav.register'], academy],
    admin: [['grid', '/admin', 'nav.admin'], ['users', '/a', 'nav.desk'], academy],
  }[role] || [];
}

// The most specific tab whose path prefixes the current page is the active one.
function activeTab(tabs, path) {
  let best = null;
  for (const tab of tabs) {
    const href = tab[1];
    if ((path === href || path.startsWith(href + '/')) && (!best || href.length > best.length)) best = href;
  }
  return best;
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function layout(ctx, { title, body, narrow = true, bare = false, full = false }) {
  const { t, user, lang } = ctx;
  const home = user ? homeFor(user.role) : '/';
  const path = ctx.url?.pathname || '/';
  const tabs = user ? tabsFor(user.role) : [];
  const active = activeTab(tabs, path);
  const cur = (href) => (href === active ? raw('aria-current="page"') : '');
  const profileHref = user?.role === 'worker' ? '/w/profile' : user?.role === 'farmer' ? '/f/farm' : null;
  return html`<!doctype html>
<html lang="${htmlLang(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121b16" media="(prefers-color-scheme: dark)">
<meta name="description" content="${t('home.sub')}">
<title>${title ? `${title} · ` : ''}AgroHands</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg?v=${ASSET_VERSION}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/static/app.css?v=${ASSET_VERSION}">
<script src="/static/app.js?v=${ASSET_VERSION}" defer></script>
</head>
<body class="${tabs.length ? 'has-tabbar' : ''}">
${ICON_SPRITE}
<a class="skip" href="#main">${t('nav.skip')}</a>
<header class="appbar"><div class="appbar-in">
  <a class="brand" href="${home}"><img class="brand-mark" src="/icon.svg?v=${ASSET_VERSION}" alt="" width="34" height="34">AgroHands</a>
  ${tabs.length ? html`<nav class="topnav" aria-label="${t('nav.main')}">${tabs.map(([ic, href, key]) => html`<a href="${href}" ${cur(href)}>${icon(ic)}${t(key)}</a>`)}</nav>` : ''}
  <details class="menu">
    <summary aria-label="${t('nav.language')}">${icon('globe')}<span>${LOCALES[lang]['lang.name']}</span></summary>
    <div class="menu-pop" role="menu">
      ${LANG_CODES.map((c) => html`<a role="menuitem" href="/lang/${c}" lang="${htmlLang(c)}" ${c === lang ? raw('aria-current="true"') : ''}>${LOCALES[c]['lang.name']}</a>`)}
    </div>
  </details>
  ${user ? html`<details class="menu">
    <summary class="avatar-btn" aria-label="${t('nav.account')}">${initials(user.name)}</summary>
    <div class="menu-pop" role="menu">
      <div class="menu-head"><b>${user.name}</b><span class="small muted">${t('role.' + user.role)} · ${user.phone}</span></div>
      <a role="menuitem" href="${home}">${icon('home')}${t('nav.dashboard')}</a>
      ${profileHref ? html`<a role="menuitem" href="${profileHref}">${icon('edit')}${t(user.role === 'worker' ? 'worker.profile' : 'farmer.farm')}</a>` : ''}
      <a role="menuitem" href="/me/pin">${icon('lock')}${t('me.pin_title')}</a>
      <a role="menuitem" href="/me/data">${icon('download')}${t('me.data')}</a>
      <a role="menuitem" href="/me/delete" class="danger">${icon('trash')}${t('me.delete')}</a>
      <form method="post" action="/logout">${csrfField(ctx)}<button role="menuitem">${icon('logout')}${t('nav.logout')}</button></form>
    </div>
  </details>` : path === '/login' ? '' : html`<a class="btn small" href="/login">${t('nav.login')}</a>`}
</div></header>
<main id="main" class="${full ? 'full' : narrow ? 'narrow' : 'wide'}">
${ctx.flash ? html`<div class="flash toast ${ctx.flash.type || ''}" role="${ctx.flash.type === 'error' ? 'alert' : 'status'}"><span>${ctx.flash.msg}</span><button class="close" type="button" data-dismiss aria-label="${t('common.close')}">×</button></div>` : ''}
${body}
</main>
${bare ? '' : html`<footer class="site">
  <p class="tag">${t('app.tagline')}</p>
  <nav aria-label="${t('nav.legal')}"><a href="/academy">${t('nav.academy')}</a><a href="/privacy">${t('nav.privacy')}</a><a href="/terms">${t('nav.terms')}</a><a href="/account-deletion">${t('nav.delete_account')}</a></nav>
  <p class="small" style="margin-top:10px">© ${new Date().getFullYear()} AgroHands</p>
</footer>`}
${tabs.length ? html`<nav class="tabbar" aria-label="${t('nav.main')}">${tabs.map(([ic, href, key]) => html`<a href="${href}" ${cur(href)}>${icon(ic)}<span>${t(key)}</span></a>`)}</nav>` : ''}
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
  const medal = { registered: '○', bronze: '🥉', silver: '🥈', gold: '🥇' }[tier] || '○';
  return html`<span class="badge tier-${tier}">${medal} ${t('tier.' + tier)}</span>`;
}

export function locationButton(t, lat, lng) {
  return html`<div class="loc">
    <input type="hidden" name="lat" value="${lat ?? ''}"><input type="hidden" name="lng" value="${lng ?? ''}">
    <button type="button" class="btn ghost" data-geo>${icon('pin')}${t('common.use_location').replace(/^📍\s*/, '')}</button>
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

// ---------- Layout building blocks ----------

export const backLink = (href, label) => html`<a class="back noprint" href="${href}">${icon('left', { cls: 'i-sm' })}${label}</a>`;

/** Section title with an optional count bubble and a trailing action. */
export const sectionHead = (title, { count, action } = {}) =>
  html`<div class="section-head"><h2>${title}</h2>${count ? html`<span class="count">${count}</span>` : ''}${action || ''}</div>`;

/** Friendly empty state: icon, message, optional call to action. */
export const emptyState = (iconName, text, action) =>
  html`<div class="empty"><div class="tile">${icon(iconName)}</div><p>${text}</p>${action || ''}</div>`;

export const stat = (label, value) => html`<div class="stat"><span class="label">${label}</span><b>${value}</b></div>`;

export const progress = (pct) => html`<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;

/** Circular score (0–100). */
export const ring = (value, label) =>
  html`<div class="ring" style="--p:${Math.max(0, Math.min(100, Math.round(value)))}" role="img" aria-label="${label}: ${Math.round(value)}"><b>${Math.round(value)}</b></div>`;

export const avatar = (name) => html`<span class="avatar" aria-hidden="true">${initials(name)}</span>`;

/** Row of small labelled facts: [[iconName, text], …]; falsy entries are skipped. */
export const metaList = (items) =>
  html`<ul class="meta">${items.filter(Boolean).map(([ic, text]) => html`<li>${ic ? icon(ic) : ''}${text}</li>`)}</ul>`;
