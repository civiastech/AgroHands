// Request pipeline: request id → parse → rate limit → session → language → CSRF → route → render → log + metrics.
// Exported for tests.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCookies, readBody, Res } from './http.js';
import { Router } from './router.js';
import { readSession, newCsrfToken } from './auth.js';
import { pickLang, translator } from './i18n/index.js';
import { layout } from './views/ui.js';
import { html } from './html.js';
import { config } from './config.js';
import { AppError } from './lib/services.js';
import { log } from './lib/log.js';
import { observeRequest } from './lib/metrics.js';
import { RateLimiter } from './lib/ratelimit.js';
import { CSS, JS, MANIFEST, ICON, SW } from './routes/static.js';

import opsRoutes from './routes/ops.js';
import wellKnownRoutes from './routes/wellknown.js';
import publicRoutes from './routes/public.js';
import workerRoutes from './routes/worker.js';
import farmerRoutes from './routes/farmer.js';
import contractRoutes from './routes/contracts.js';
import academyRoutes from './routes/academy.js';
import agentRoutes from './routes/agent.js';
import adminRoutes from './routes/admin.js';
import ussdRoutes from './routes/ussd.js';
import paymentRoutes from './routes/payments.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };

/** Every file under public/ (icons, screenshots), read once into memory: [urlPath, body, type]. */
function publicFiles(dir = PUBLIC_DIR, prefix = '') {
  let out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(publicFiles(full, `${prefix}/${name}`));
    else if (TYPES[extname(name)]) out.push([`${prefix}/${name}`, readFileSync(full), TYPES[extname(name)]]);
  }
  return out;
}

export function buildRouter() {
  const r = new Router();
  // Asset URLs carry ?v=<build> (see views/ui.js), so they can be cached for a year and still update on deploy.
  const cached = (body, type) => (ctx) => {
    ctx.res.headers['Cache-Control'] = ctx.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    ctx.res.send(body, type);
  };
  r.get('/static/app.css', cached(CSS, 'text/css; charset=utf-8'));
  r.get('/static/app.js', cached(JS, 'text/javascript; charset=utf-8'));
  r.get('/manifest.webmanifest', cached(MANIFEST, 'application/manifest+json'));
  r.get('/icon.svg', cached(ICON, 'image/svg+xml'));
  r.get('/sw.js', (ctx) => {
    ctx.res.headers['Cache-Control'] = 'no-cache';
    ctx.res.send(SW, 'text/javascript; charset=utf-8');
  });
  for (const [path, body, type] of publicFiles()) r.get(path, cached(body, type));
  r.get('/robots.txt', (ctx) => ctx.res.text('User-agent: *\nDisallow: /w/\nDisallow: /f/\nDisallow: /a/\nDisallow: /admin\nDisallow: /c/\n'));
  [opsRoutes, wellKnownRoutes, publicRoutes, workerRoutes, farmerRoutes, contractRoutes, academyRoutes, agentRoutes, adminRoutes, ussdRoutes, paymentRoutes]
    .forEach((register) => register(r));
  return r;
}

// Machine callers authenticate another way: USSD with ?key=, Paystack with an HMAC signature.
const CSRF_EXEMPT = new Set(['/ussd', '/pay/webhook']);
// Routes that check a PIN, create accounts or trigger paid NIN look-ups get the strict limit.
const AUTH_ROUTES = new Set(['/login', '/register', '/verify', '/verify/resend', '/forgot', '/me/pin', '/a/register', '/w/verify', '/c/:id/sign', '/me/delete', '/ussd']);
// Ops probes are hit every few seconds; keep them out of access logs and latency metrics noise.
const QUIET_ROUTES = new Set(['/healthz', '/readyz']);

/** Client IP. X-Forwarded-For is only honoured when TRUST_PROXY=true (we sit behind Caddy/nginx). */
export function clientIp(req, trustProxy = config.trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

export function createHandler({ limits = config.rateLimit } = {}) {
  const router = buildRouter();
  const authLimiter = new RateLimiter({ max: limits.authMax, windowSec: limits.windowSec });
  const writeLimiter = new RateLimiter({ max: limits.writeMax, windowSec: limits.windowSec });

  async function handle(req, nodeRes) {
    const started = process.hrtime.bigint();
    const res = new Res(nodeRes);
    const requestId = /^[\w-]{8,64}$/.test(req.headers['x-request-id'] || '') ? req.headers['x-request-id'] : randomUUID();
    res.headers['X-Request-Id'] = requestId;
    const ip = clientIp(req);
    let url;
    try {
      url = new URL(req.url, 'http://local');
    } catch {
      res.text('Bad request', 400);
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const reqLog = log.child({ reqId: requestId });
    const ctx = { req, res, url, ip, requestId, log: reqLog, query: Object.fromEntries(url.searchParams), cookies, params: {}, body: {} };
    const secure = config.production;
    let route = '(unmatched)';

    nodeRes.on('finish', () => {
      if (QUIET_ROUTES.has(route)) return;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      observeRequest(req.method, route, nodeRes.statusCode, seconds);
      reqLog[nodeRes.statusCode >= 500 ? 'error' : 'info']('request', {
        method: req.method, path: url.pathname, route, status: nodeRes.statusCode, ms: Math.round(seconds * 1000), ip, user: ctx.user?.id,
      });
    });

    try {
      ctx.user = readSession(cookies.ah_s);
      ctx.lang = pickLang(cookies.ah_lang || ctx.user?.lang, req.headers['accept-language']);
      ctx.t = translator(ctx.lang);
      // Inside the Play Store app (launched at /?src=android). Digital goods can't be sold there outside Google Play billing.
      ctx.inApp = cookies.ah_app === '1' || ctx.query.src === 'android' || String(req.headers.referer || '').startsWith('android-app://');
      if (ctx.inApp && cookies.ah_app !== '1') res.cookie('ah_app', '1', { maxAge: 86400 * 365, secure });
      ctx.csrf = cookies.ah_csrf || newCsrfToken();
      if (!cookies.ah_csrf) res.cookie('ah_csrf', ctx.csrf, { maxAge: 86400 * 30, secure });
      if (cookies.ah_f) {
        try { ctx.flash = JSON.parse(cookies.ah_f); } catch { /* ignore */ }
        res.cookie('ah_f', '', { maxAge: 0, secure });
      }

      ctx.render = (title, body, opts = {}) => res.send(layout(ctx, { title, body, ...opts }), undefined, opts.status);
      ctx.redirect = (to, msgKey, type = 'ok', vars) => {
        if (msgKey) res.cookie('ah_f', JSON.stringify({ msg: ctx.t(msgKey, vars), type }), { maxAge: 60, secure });
        res.redirect(to);
      };
      ctx.need = (...roles) => {
        if (!ctx.user) { ctx.redirect(`/login?next=${encodeURIComponent(url.pathname)}`); return false; }
        if (roles.length && !roles.includes(ctx.user.role)) {
          ctx.render(ctx.t('common.forbidden'), html`<p class="flash error">${ctx.t('common.forbidden')}</p>`, { status: 403 });
          return false;
        }
        return true;
      };

      const match = router.match(req.method, url.pathname);
      if (!match) {
        ctx.render(ctx.t('common.not_found'), html`<h1>404</h1><p>${ctx.t('common.not_found')}</p><p><a href="/">${ctx.t('nav.home')}</a></p>`, { status: 404 });
        return;
      }
      route = match.route;
      ctx.params = match.params;
      ctx.body = await readBody(req);

      if (req.method === 'POST') {
        // USSD traffic all comes from the gateway's IPs, so key it by the subscriber's phone instead.
        const key = route === '/ussd' ? `ussd:${ctx.body.phoneNumber || ip}` : ip;
        const limited = [writeLimiter.hit(key), AUTH_ROUTES.has(route) ? authLimiter.hit(key) : { ok: true }].find((l) => !l.ok);
        if (limited) {
          reqLog.warn('rate limited', { route, ip });
          res.headers['Retry-After'] = String(limited.retryAfterSec);
          if (route === '/ussd') return res.text(`END ${ctx.t('common.rate_limited')}`, 429);
          return ctx.render(ctx.t('common.rate_limited'), html`<p class="flash error">${ctx.t('common.rate_limited')}</p>`, { status: 429 });
        }
      }

      if (req.method === 'POST' && !CSRF_EXEMPT.has(url.pathname)) {
        if (!ctx.body._csrf || ctx.body._csrf !== cookies.ah_csrf) {
          res.cookie('ah_f', JSON.stringify({ msg: ctx.t('common.error'), type: 'error' }), { maxAge: 60, secure });
          res.redirect(url.pathname);
          return;
        }
      }
      for (const h of match.handlers) await h(ctx);
    } catch (err) {
      if (err instanceof AppError) {
        if (req.method === 'POST') {
          const back = safeBack(req.headers.referer, url.pathname);
          res.cookie('ah_f', JSON.stringify({ msg: ctx.t(err.key), type: 'error' }), { maxAge: 60, secure });
          res.redirect(back);
        } else {
          ctx.render('', html`<p class="flash error">${ctx.t(err.key)}</p>`, { status: err.status });
        }
        return;
      }
      const status = err.status && err.status < 500 ? err.status : 500;
      if (status >= 500) reqLog.error('unhandled error', { err, method: req.method, path: url.pathname });
      if (!nodeRes.headersSent) {
        res.text(status === 500 ? `Server error. Reference: ${requestId}` : 'Bad request', status);
      }
    }
  }

  handle.stop = () => { authLimiter.stop(); writeLimiter.stop(); };
  handle.resetLimits = () => { authLimiter.reset(); writeLimiter.reset(); };
  return handle;
}

// Redirect back to the referer's path only — never to another host.
function safeBack(referer, fallback) {
  try {
    const u = new URL(referer);
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}
