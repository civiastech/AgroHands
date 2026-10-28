// Central configuration. Every value can be overridden with an environment variable.
// Values are parsed and validated once at start-up; a bad production config fails fast with a clear message.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = process.env;

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const int = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  return n;
};
const bool = (name, fallback) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};
const list = (name) => (env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);

const production = env.NODE_ENV === 'production';
const port = int('PORT', 3000, { min: 0, max: 65535 });

export const config = {
  version: env.APP_VERSION || pkg.version,
  // Short build id: busts browser and service-worker caches on every deploy.
  buildId: (env.GIT_SHA || env.APP_VERSION || pkg.version).slice(0, 12),
  port,
  host: env.HOST || '0.0.0.0',
  baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dbPath: env.DB_PATH || './data/agrohands.db',
  backupDir: env.BACKUP_DIR || './backups',
  backupKeepDays: int('BACKUP_KEEP_DAYS', 14, { min: 1, max: 3650 }),
  // Signs session cookies and hashes NINs. MUST be set (and kept stable) in production.
  secret: env.SESSION_SECRET || randomBytes(32).toString('hex'),
  secretIsEphemeral: !env.SESSION_SECRET,
  production,
  // Only trust X-Forwarded-For when a reverse proxy (Caddy, nginx, a load balancer) sits in front.
  // Otherwise anyone can fake the IP recorded on e-signatures and dodge rate limits.
  trustProxy: bool('TRUST_PROXY', false),
  logLevel: env.LOG_LEVEL || (production ? 'info' : 'debug'),
  logFormat: env.LOG_FORMAT || (production ? 'json' : 'pretty'),
  // Bearer token for GET /metrics (Prometheus). Empty = metrics endpoint disabled.
  metricsToken: env.METRICS_TOKEN || '',
  rateLimit: {
    // Auth attempts (login/register/PIN) per IP per window.
    authMax: int('RATE_LIMIT_AUTH_MAX', 20, { min: 1 }),
    // All POSTs per IP per window.
    writeMax: int('RATE_LIMIT_WRITE_MAX', 120, { min: 1 }),
    windowSec: int('RATE_LIMIT_WINDOW_SEC', 300, { min: 1 }),
  },
  shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10000, { min: 0 }),
  // Verification provider: manual (agent checks the NIN slip — free), mock (demo/testing), dojah (paid API)
  ninProvider: env.NIN_PROVIDER || 'manual',
  dojah: {
    baseUrl: env.DOJAH_BASE_URL || 'https://api.dojah.io',
    appId: env.DOJAH_APP_ID || '',
    secretKey: env.DOJAH_SECRET_KEY || '',
  },
  // Phone numbers (comma-separated, local 0XXXXXXXXXX format) that become admins on registration.
  adminPhones: list('ADMIN_PHONES'),
  // Shared secret Africa's Talking must send as ?key= on the USSD callback URL.
  ussdKey: env.USSD_KEY || '',
  // Outbound SMS: sign-up codes, PIN reset codes and job/contract notifications.
  //   log            : dev only. Messages (and codes) are written to the log and codes are shown on screen.
  //   africastalking : production. Use username "sandbox" with a sandbox key for testing.
  //   memory         : automated tests.
  sms: {
    provider: env.SMS_PROVIDER || (production ? 'africastalking' : 'log'),
    username: env.AT_USERNAME || '',
    apiKey: env.AT_API_KEY || '',
    // Registered alphanumeric sender id (e.g. AgroHands). Empty = the provider's default shared sender.
    senderId: env.SMS_SENDER_ID || '',
  },
  // Platform fee shown to farmers (managed payroll, phase 2) and placement fee rules.
  fees: { payrollPct: 10, placementPct: 25, placementMin: 12000 },
  minWageMonthly: 70000,
  supportWhatsApp: env.SUPPORT_WHATSAPP || '',
  supportEmail: env.SUPPORT_EMAIL || '',
  // Google Play (Trusted Web Activity). The fingerprints prove the Android app and this site belong together,
  // which removes the browser URL bar inside the app. Use the Play App Signing key AND your upload key.
  android: {
    packageName: env.ANDROID_PACKAGE || 'ng.agrohands.app',
    certFingerprints: list('ANDROID_CERT_SHA256').map((s) => s.toUpperCase()),
  },
};

/** Returns a list of problems; empty means the config is safe to run with. */
export function validateConfig(c = config) {
  const errors = [];
  if (!['manual', 'mock', 'dojah'].includes(c.ninProvider)) errors.push(`NIN_PROVIDER must be manual, mock or dojah (got "${c.ninProvider}")`);
  if (c.ninProvider === 'dojah' && (!c.dojah.appId || !c.dojah.secretKey)) errors.push('NIN_PROVIDER=dojah needs DOJAH_APP_ID and DOJAH_SECRET_KEY');
  if (!['log', 'memory', 'africastalking'].includes(c.sms.provider)) errors.push(`SMS_PROVIDER must be log, memory or africastalking (got "${c.sms.provider}")`);
  if (c.sms.provider === 'africastalking' && (!c.sms.username || !c.sms.apiKey)) errors.push("SMS_PROVIDER=africastalking needs AT_USERNAME and AT_API_KEY (Africa's Talking dashboard → Settings → API Key)");
  if (c.sms.senderId && !/^[A-Za-z0-9 ]{1,11}$/.test(c.sms.senderId)) errors.push('SMS_SENDER_ID must be 1 to 11 letters, digits or spaces');
  if (!['debug', 'info', 'warn', 'error'].includes(c.logLevel)) errors.push('LOG_LEVEL must be debug, info, warn or error');
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(c.android.packageName)) errors.push('ANDROID_PACKAGE must look like ng.agrohands.app');
  for (const f of c.android.certFingerprints) {
    if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)) errors.push(`ANDROID_CERT_SHA256 entry is not a SHA-256 fingerprint (AA:BB:…, 32 pairs): ${f}`);
  }
  if (c.production) {
    if (c.secretIsEphemeral) errors.push('SESSION_SECRET must be set in production');
    else if (c.secret.length < 32) errors.push('SESSION_SECRET must be at least 32 characters');
    if (c.ninProvider === 'mock') errors.push('NIN_PROVIDER=mock is for testing only — use manual or dojah in production');
    if (!/^https:\/\//.test(c.baseUrl)) errors.push('BASE_URL must start with https:// in production');
    if (c.sms.provider !== 'africastalking') errors.push(`SMS_PROVIDER=${c.sms.provider} cannot deliver sign-up codes — use africastalking in production`);
  }
  return errors;
}

/** Non-fatal advice, logged at start-up. */
export function configWarnings(c = config) {
  const warnings = [];
  if (c.secretIsEphemeral) warnings.push('SESSION_SECRET not set — using a temporary secret (dev only). Sessions reset on restart.');
  if (c.production && !c.ussdKey) warnings.push('USSD_KEY not set — the /ussd endpoint is disabled until you set it.');
  if (c.production && !c.trustProxy) warnings.push('TRUST_PROXY is off — set TRUST_PROXY=true when running behind Caddy/nginx so client IPs are recorded correctly.');
  if (c.production && !c.adminPhones.length) warnings.push('ADMIN_PHONES is empty — nobody can become admin.');
  if (c.production && !c.android.certFingerprints.length) warnings.push('ANDROID_CERT_SHA256 not set — the Play Store app will show a browser URL bar until it is.');
  if (c.production && c.sms.username === 'sandbox') warnings.push('AT_USERNAME=sandbox — SMS go to the Africa\'s Talking simulator, not real phones.');
  if (c.production && !c.sms.senderId) warnings.push('SMS_SENDER_ID not set — messages use a shared sender and may be blocked by DND filtering. Register a sender id with Africa\'s Talking.');
  if (c.production && !c.supportEmail) warnings.push('SUPPORT_EMAIL not set — Google Play requires a contact on the privacy and account-deletion pages.');
  return warnings;
}
