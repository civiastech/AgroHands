// CSS, client JS, PWA manifest, service worker and icon — served from memory, cached hard.
import { readdirSync } from 'node:fs';
import { config } from '../config.js';

export const CSS = `
:root{--g:#1f6f43;--g2:#e7f3ec;--ink:#1d2421;--mute:#5d6b64;--line:#d9e2dc;--warn:#9a5b00;--bad:#a12a2a;--bg:#f7f9f7;--card:#fff}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--g)}
.top{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--g);color:#fff}
.top a,.top button.link{color:#fff;text-decoration:none;margin-left:12px;font-size:15px}
.brand{font-weight:700;font-size:18px;margin:0!important}
.logo{font-size:20px}
.langs{display:flex;gap:6px;overflow-x:auto;padding:8px 12px;background:#fff;border-bottom:1px solid var(--line)}
.langs a{white-space:nowrap;padding:4px 10px;border:1px solid var(--line);border-radius:99px;text-decoration:none;font-size:14px;color:var(--ink)}
.langs a.on{background:var(--g);color:#fff;border-color:var(--g)}
main{padding:16px;margin:0 auto}
main.narrow{max-width:640px}
main.wide{max-width:1100px}
h1{font-size:24px;margin:8px 0 12px}
h2{font-size:19px;margin:22px 0 10px}
h3{font-size:16px;margin:0 0 6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:10px 0}
.hero{background:linear-gradient(160deg,#1f6f43,#2f8f5b);color:#fff;border-radius:14px;padding:22px 18px;margin-bottom:14px}
.hero h1{font-size:28px;margin:0 0 6px}
.hero p{margin:0 0 14px;opacity:.95}
.btn{display:inline-block;background:var(--g);color:#fff;border:0;border-radius:10px;padding:13px 18px;font-size:16px;font-weight:600;text-decoration:none;cursor:pointer;text-align:center}
.btn.block{display:block;width:100%;margin:8px 0}
.btn.ghost{background:#fff;color:var(--g);border:1.5px solid var(--g)}
.btn.light{background:#fff;color:var(--g)}
.btn.danger{background:var(--bad)}
.btn.small{padding:8px 12px;font-size:14px}
button.link{background:none;border:0;padding:0;cursor:pointer;font:inherit}
form.inline{display:inline}
.field{display:block;margin:12px 0}
.field span{display:block;font-weight:600;margin-bottom:4px}
.field small{color:var(--mute)}
input,select,textarea{width:100%;padding:12px;font-size:16px;border:1.5px solid var(--line);border-radius:10px;background:#fff;color:var(--ink)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--g);border-color:var(--g)}
.check{display:flex;gap:10px;align-items:flex-start;margin:12px 0}
.check input{width:22px;height:22px;flex:none;margin-top:2px}
fieldset{border:1px solid var(--line);border-radius:10px;padding:10px;margin:12px 0}
legend{font-weight:600;padding:0 4px}
.skills{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex}
.chip input{position:absolute;opacity:0;width:1px;height:1px}
.chip span{padding:8px 12px;border:1.5px solid var(--line);border-radius:99px;background:#fff;font-size:15px;cursor:pointer}
.chip input:checked+span{background:var(--g2);border-color:var(--g);color:var(--g);font-weight:600}
.chip input:focus+span{outline:2px solid var(--g)}
.flash{padding:12px;border-radius:10px;background:var(--g2);border:1px solid #b9dcc6}
.flash.error{background:#fbeaea;border-color:#efc2c2;color:var(--bad)}
.badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:13px;font-weight:600;background:#eee}
.tier-bronze{background:#f6e7d8;color:#7a4a1c}.tier-silver{background:#eceff1;color:#455a64}.tier-gold{background:#fff3c4;color:#7a5d00}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600;background:#eee}
.s-open,.s-active{background:var(--g2);color:var(--g)}.s-pending{background:#fff3c4;color:#7a5d00}
.s-filled,.s-completed{background:#e3ecfa;color:#2a4d8f}.s-closed,.s-terminated,.s-cancelled{background:#eee;color:#555}
.steps{list-style:none;padding:0;margin:0}
.steps li{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.steps li:last-child{border:0}
.steps .ok{color:var(--g);font-weight:700}
.steps .todo{color:var(--mute)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.grow{flex:1}
.muted{color:var(--mute)}
.small{font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px}
.stat b{display:block;font-size:24px}
table{width:100%;border-collapse:collapse;background:#fff;font-size:14px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
.score{font-size:22px;font-weight:700;color:var(--g)}
.bar{height:6px;background:#eef2ef;border-radius:3px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--g)}
.how{counter-reset:s;list-style:none;padding:0}
.how li{counter-increment:s;padding:8px 0 8px 40px;position:relative}
.how li:before{content:counter(s);position:absolute;left:0;top:6px;width:28px;height:28px;border-radius:50%;background:var(--g);color:#fff;display:grid;place-items:center;font-weight:700}
.contract h3{margin-top:16px}
.contract ol{padding-left:20px}
.summary{background:var(--g2);border-radius:10px;padding:10px 14px;list-style:none}
.summary li{padding:3px 0}
.cert{border:6px double var(--g);border-radius:14px;padding:28px;text-align:center;background:#fff}
.lesson p{margin:8px 0}
.q{margin:14px 0}
.q label{display:flex;gap:10px;padding:8px;border:1px solid var(--line);border-radius:10px;margin:6px 0;background:#fff}
.q input{width:20px;height:20px;flex:none}
footer{text-align:center;color:var(--mute);padding:20px 10px 40px}
@media print{.top,.langs,footer,.noprint{display:none!important}body{background:#fff}main{max-width:none}}
`;

export const JS = `
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-geo]');
  if (!b) return;
  var f = b.closest('form'), s = f.querySelector('[data-geo-status]');
  if (!navigator.geolocation) { s.textContent = 'GPS not available'; return; }
  s.textContent = '…';
  navigator.geolocation.getCurrentPosition(function (p) {
    f.querySelector('[name=lat]').value = p.coords.latitude.toFixed(5);
    f.querySelector('[name=lng]').value = p.coords.longitude.toFixed(5);
    s.textContent = '✓ ' + p.coords.latitude.toFixed(4) + ', ' + p.coords.longitude.toFixed(4);
  }, function () { s.textContent = 'Could not get location'; }, { enableHighAccuracy: true, timeout: 15000 });
});
document.addEventListener('click', function (e) {
  if (e.target.closest('[data-print]')) window.print();
});
document.addEventListener('submit', function (e) {
  var m = e.target.getAttribute('data-confirm');
  if (m && !window.confirm(m)) e.preventDefault();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
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

// Network-first for pages (fresh data), cache fallback when offline; cache-first for static assets.
export const SW = `
const V = 'ah-${config.buildId}';
const ASSETS = ['/static/app.css?v=${config.buildId}', '/static/app.js?v=${config.buildId}', '/icon.svg?v=${config.buildId}', '/offline'];
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
