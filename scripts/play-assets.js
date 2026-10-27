// Generates every image Google Play and Android need, using your installed Chrome/Edge in headless mode.
//   npm run play:assets                         (app must be running with demo data: npm run seed && npm start)
//   BASE=http://localhost:3000 CHROME_PATH=... npm run play:assets
// Writes:
//   public/icons/*.png         app icons served to Android (any, maskable, monochrome)
//   public/screenshots/*.png   1080×1920 screenshots (web manifest + Play listing)
//   android/store/*.png        Play Console uploads: 512 icon, 1024×500 feature graphic, screenshots
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const out = (...p) => { const f = join(ROOT, ...p); mkdirSync(join(f, '..'), { recursive: true }); return f; };

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error('Chrome/Edge not found. Set CHROME_PATH.');
  return hit;
}

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'ah-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method) {
      for (const w of waiters.filter((x) => x.method === m.method)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m.params); }
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
  await send('Page.enable');
  await send('Network.enable');
  const close = () => {
    ws.close();
    proc.kill();
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ } }, 500);
  };
  return { send, once, close };
}

async function shot(cdp, url, { width, height, dpr = 1, transparent = false, mobile = false }, file) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await new Promise((r) => setTimeout(r, 400)); // let layout and fonts settle
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('  ✔', relative(ROOT, file), `${width * dpr}×${height * dpr}`);
}

const svgPage = (name) => 'data:text/html;base64,' + Buffer.from(
  `<!doctype html><html><body style="margin:0;background:transparent">${readFileSync(join(ROOT, 'assets', name), 'utf8')
    .replace('<svg ', '<svg style="display:block;width:100vw;height:100vh" ')}</body></html>`,
).toString('base64');

const htmlPage = (name) => 'data:text/html;base64,' + Buffer.from(
  readFileSync(join(ROOT, 'assets', name), 'utf8').replace('{{ICON}}', readFileSync(join(ROOT, 'assets', 'icon.svg'), 'utf8')),
).toString('base64');

async function login(phone, pin = '1234') {
  const get = await fetch(`${BASE}/login`);
  const csrf = get.headers.getSetCookie().find((c) => c.startsWith('ah_csrf=')).split(';')[0].split('=')[1];
  const res = await fetch(`${BASE}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `ah_csrf=${csrf}` },
    body: new URLSearchParams({ _csrf: csrf, phone, pin }),
  });
  const s = res.headers.getSetCookie().find((c) => c.startsWith('ah_s='));
  if (!s) throw new Error(`Could not log in as ${phone}. Is the demo data seeded (npm run seed)?`);
  return [{ name: 'ah_csrf', value: csrf }, { name: 'ah_s', value: decodeURIComponent(s.split(';')[0].slice(5)) }];
}

/** The newest job on the farmer's dashboard: in the demo data that is the open one with a ranked shortlist. */
async function newestJob(cookies) {
  const page = await (await fetch(`${BASE}/f`, { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } })).text();
  const ids = [...page.matchAll(/href="\/f\/jobs\/(\d+)"/g)].map((m) => Number(m[1]));
  return ids.length ? Math.max(...ids) : 1;
}

async function asUser(cdp, cookies) {
  await cdp.send('Network.clearBrowserCookies');
  // Store listing is in English whatever language the demo user picked.
  for (const c of [...cookies, { name: 'ah_lang', value: 'en' }]) await cdp.send('Network.setCookie', { ...c, url: BASE });
}

const cdp = await launch();
try {
  console.log('Icons');
  await shot(cdp, svgPage('icon.svg'), { width: 512, height: 512, transparent: true }, out('public', 'icons', 'icon-512.png'));
  await shot(cdp, svgPage('icon.svg'), { width: 192, height: 192, transparent: true }, out('public', 'icons', 'icon-192.png'));
  await shot(cdp, svgPage('icon-maskable.svg'), { width: 512, height: 512 }, out('public', 'icons', 'maskable-512.png'));
  await shot(cdp, svgPage('icon-maskable.svg'), { width: 192, height: 192 }, out('public', 'icons', 'maskable-192.png'));
  await shot(cdp, svgPage('icon-monochrome.svg'), { width: 512, height: 512, transparent: true }, out('public', 'icons', 'monochrome-512.png'));
  await shot(cdp, svgPage('icon.svg'), { width: 180, height: 180, transparent: true }, out('public', 'icons', 'apple-touch-icon.png'));

  console.log('Play Store graphics');
  // Play hi-res icon: 512×512 full-bleed square; Play applies its own rounded mask.
  copyFileSync(join(ROOT, 'public', 'icons', 'maskable-512.png'), out('android', 'store', 'play-icon-512.png'));
  await shot(cdp, htmlPage('feature-graphic.html'), { width: 1024, height: 500 }, out('android', 'store', 'feature-graphic-1024x500.png'));

  console.log(`Screenshots from ${BASE}`);
  const phone = { width: 360, height: 640, dpr: 3, mobile: true };
  const pages = [
    ['01-home', null, '/'],
    ['02-worker-dashboard', '08100000001', '/w'],
    ['03-academy', '08100000001', '/academy'],
    ['04-farmer-dashboard', '08030000001', '/f'],
    ['05-farmer-shortlist', '08030000001', async (cookies) => `/f/jobs/${await newestJob(cookies)}`],
  ];
  const sessions = {};
  for (const [name, user, path] of pages) {
    if (user) sessions[user] ||= await login(user);
    await asUser(cdp, user ? sessions[user] : []);
    const file = out('public', 'screenshots', `${name}.png`);
    await shot(cdp, BASE + (typeof path === 'function' ? await path(sessions[user]) : path), phone, file);
    copyFileSync(file, out('android', 'store', 'screenshots', `${name}.png`));
  }
  console.log('Done. Restart the app so the web manifest lists the new screenshots.');
} finally {
  cdp.close();
}
