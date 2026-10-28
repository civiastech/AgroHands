// Request/response helpers on top of node:http — no framework needed.
import { toString } from './html.js';
import { config } from './config.js';

const MAX_BODY = 200 * 1024; // 200 KB is plenty for forms

export function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  });
  return out;
}

export async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] || '';
  // The raw text is kept (not enumerable) for webhook signature checks.
  const withRaw = (obj) => Object.defineProperty(obj, 'raw', { value: text, enumerable: false });
  if (type.includes('application/json')) {
    try {
      const parsed = JSON.parse(text || '{}');
      return withRaw(parsed && typeof parsed === 'object' ? parsed : {});
    } catch { return withRaw({}); }
  }
  // urlencoded (forms, Africa's Talking USSD)
  const params = new URLSearchParams(text);
  const out = {};
  for (const [k, v] of params) {
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      (out[key] ||= []).push(v);
    } else if (k in out) {
      out[k] = [].concat(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return withRaw(out);
}

export class Res {
  constructor(res) {
    this.res = res;
    this.headers = {};
    this.cookies = [];
    this.status = 200;
  }
  cookie(name, value, { maxAge, httpOnly = true, path = '/', sameSite = 'Lax', secure } = {}) {
    let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
    if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
    if (httpOnly) c += '; HttpOnly';
    if (secure) c += '; Secure';
    this.cookies.push(c);
  }
  send(body, type = 'text/html; charset=utf-8', status) {
    if (status) this.status = status;
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : toString(body);
    const headers = {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), payment=(), geolocation=(self)',
      'Cross-Origin-Opener-Policy': 'same-origin',
      ...(config.production && { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
      ...this.headers,
    };
    if (type.startsWith('text/html')) {
      headers['Content-Security-Policy'] =
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self' https://checkout.paystack.com; frame-ancestors 'none'";
    }
    if (this.cookies.length) headers['Set-Cookie'] = this.cookies;
    this.res.writeHead(this.status, headers);
    this.res.end(this.res.req?.method === 'HEAD' ? undefined : payload);
  }
  json(obj, status) {
    this.send(JSON.stringify(obj, null, 2), 'application/json; charset=utf-8', status);
  }
  text(str, status) {
    this.send(str, 'text/plain; charset=utf-8', status);
  }
  redirect(location, status = 303) {
    this.status = status;
    this.headers.Location = location;
    this.send('');
  }
}
