// CSS, client JS, PWA manifest, service worker and icon — served from memory, cached hard.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

// Design system lives in src/views/app.css (read once at start-up).
export const CSS = readFileSync(new URL('../views/app.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '') // comments
  .replace(/\s+/g, ' ') // whitespace runs
  .replace(/\s*([{};,])\s*/g, '$1')
  .trim();

// Progressive enhancement only: every page works without JavaScript.
export const JS = `
(function () {
  // GPS button: fills the hidden lat/lng inputs of its form.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-geo]');
    if (!b) return;
    var f = b.closest('form'), s = f.querySelector('[data-geo-status]');
    if (!navigator.geolocation) { s.textContent = 'GPS not available'; return; }
    s.textContent = '…';
    b.classList.add('is-loading');
    navigator.geolocation.getCurrentPosition(function (p) {
      f.querySelector('[name=lat]').value = p.coords.latitude.toFixed(5);
      f.querySelector('[name=lng]').value = p.coords.longitude.toFixed(5);
      s.textContent = '✓ ' + p.coords.latitude.toFixed(4) + ', ' + p.coords.longitude.toFixed(4);
      b.classList.remove('is-loading');
    }, function () { s.textContent = 'Could not get location'; b.classList.remove('is-loading'); }, { enableHighAccuracy: true, timeout: 15000 });
  });

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-print]')) window.print();
    var x = e.target.closest('[data-dismiss]');
    if (x) x.closest('.flash').remove();
    // Close open menus when tapping elsewhere.
    document.querySelectorAll('details.menu[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach(function (d) { d.removeAttribute('open'); d.querySelector('summary').focus(); });
  });

  // Confirm prompts, then a loading state that also blocks double submits on slow networks.
  document.addEventListener('submit', function (e) {
    var f = e.target, m = f.getAttribute('data-confirm');
    if (m && !window.confirm(m)) { e.preventDefault(); return; }
    if (f.method.toLowerCase() !== 'post') return;
    if (f.dataset.sent) { e.preventDefault(); return; }
    f.dataset.sent = '1';
    var btn = e.submitter || f.querySelector('button:not([type=button])');
    if (btn) btn.classList.add('is-loading');
    // Re-enable if the user comes back (bfcache) or the request stalls.
    setTimeout(function () { delete f.dataset.sent; if (btn) btn.classList.remove('is-loading'); }, 15000);
  });
  window.addEventListener('pageshow', function () {
    document.querySelectorAll('form[data-sent]').forEach(function (f) { delete f.dataset.sent; });
    document.querySelectorAll('.is-loading').forEach(function (b) { b.classList.remove('is-loading'); });
  });

  // Success toasts fade away; errors stay until dismissed.
  var toast = document.querySelector('.toast:not(.error)');
  if (toast) setTimeout(function () { toast.classList.add('hide'); setTimeout(function () { toast.remove(); }, 400); }, 5000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
`;

// Screenshots are picked up from public/screenshots/ (made by `npm run play:assets`).
const SCREENSHOTS = (() => {
  try {
    return readdirSync(new URL('../../public/screenshots/', import.meta.url))
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => ({ src: `/screenshots/${f}`, sizes: '1080x1920', type: 'image/png', form_factor: 'narrow' }));
  } catch {
    return [];
  }
})();

// Full Web App Manifest: what Chrome, Android and Google Play's TWA wrapper read to install the app.
export const MANIFEST = JSON.stringify({
  id: '/',
  name: 'AgroHands',
  short_name: 'AgroHands',
  description: 'Verified farm workers. Written contracts. Fair pay on time.',
  lang: 'en-NG',
  dir: 'ltr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f7f9f7',
  theme_color: '#1f6f43',
  categories: ['business', 'productivity', 'education'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    { name: 'Find farm work', short_name: 'Find work', url: '/w', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    { name: 'Post a job', short_name: 'Post job', url: '/f/jobs/new', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    { name: 'Training academy', short_name: 'Academy', url: '/academy', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
  ],
  screenshots: SCREENSHOTS,
  prefer_related_applications: false,
});

export const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#1f6f43"/><path d="M256 96c-20 60-20 110 0 160 20-50 20-100 0-160zM196 150c-6 60 12 104 56 132-2-54-22-98-56-132zM316 150c-34 34-54 78-56 132 44-28 62-72 56-132zM160 228c8 52 40 84 92 96-12-46-44-80-92-96zM352 228c-48 16-80 50-92 96 52-12 84-44 92-96z" fill="#f4d35e"/><rect x="246" y="250" width="20" height="170" rx="8" fill="#f4d35e"/><path d="M120 420h272" stroke="#fff" stroke-width="18" stroke-linecap="round"/></svg>`;

// Asset URLs carry a hash of their content (?v=…), so they can be cached for a year and still update the
// moment the CSS, JS or icon changes — whatever the build id or deploy method.
export const ASSET_VERSION = createHash('sha256').update(CSS).update(JS).update(ICON).digest('hex').slice(0, 10);

// Network-first for pages (fresh data), cache fallback when offline; cache-first for static assets.
export const SW = `
const V = 'ah-${ASSET_VERSION}';
const ASSETS = ['/static/app.css?v=${ASSET_VERSION}', '/static/app.js?v=${ASSET_VERSION}', '/icon.svg?v=${ASSET_VERSION}', '/offline'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  if (u.pathname.startsWith('/static/') || u.pathname === '/icon.svg') {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r)));
    return;
  }
  e.respondWith(fetch(r).then(res => {
    if (res.ok && (u.pathname.startsWith('/academy') || u.pathname === '/')) {
      const copy = res.clone(); caches.open(V).then(c => c.put(r, copy));
    }
    return res;
  }).catch(() => caches.match(r).then(hit => hit || caches.match('/offline'))));
});
`;
