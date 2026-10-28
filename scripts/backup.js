// Online SQLite backup (safe while the app serves traffic) with retention, an encrypted off-site copy,
// a heartbeat ping and an error alert.
//   npm run backup                    one-off backup into BACKUP_DIR (+ off-site when BACKUP_S3_BUCKET is set)
//   node scripts/backup.js --loop     backup now, then every 24h (used by the Docker "backup" service)
// Restore: see scripts/restore.js and docs/DEPLOYMENT.md.
import { readdirSync, statSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { config, validateConfig } from '../src/config.js';
import { openDb, backupTo, closeDb } from '../src/db.js';
import { log } from '../src/lib/log.js';
import { uploadBackup, heartbeat } from '../src/lib/offsite.js';
import { startAlerts } from '../src/lib/alerts.js';

const DAY = 86400 * 1000;

async function runOnce() {
  if (!existsSync(config.dbPath)) {
    log.warn('no database yet — skipping backup', { db: config.dbPath });
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(config.backupDir, `agrohands-${stamp}.db`);
  openDb(config.dbPath, { migrate: false });
  try {
    backupTo(file);
  } finally {
    closeDb();
  }
  log.info('backup written', { file, bytes: statSync(file).size });

  if (config.offsite.bucket) {
    const { key, bytes } = await uploadBackup(config.offsite, config.backupEncryptionKey, readFileSync(file), basename(file));
    log.info('off-site backup uploaded', { bucket: config.offsite.bucket, key, bytes });
  }

  const cutoff = Date.now() - config.backupKeepDays * DAY;
  for (const f of readdirSync(config.backupDir)) {
    if (!/^agrohands-.*\.db$/.test(f)) continue;
    const p = join(config.backupDir, f);
    if (statSync(p).mtimeMs < cutoff) {
      unlinkSync(p);
      log.info('old backup removed', { file: p });
    }
  }
}

async function safely() {
  try {
    await runOnce();
    await heartbeat(config.backupHeartbeatUrl, true);
  } catch (err) {
    log.error('backup failed', { err });
    await heartbeat(config.backupHeartbeatUrl, false);
    if (!process.argv.includes('--loop')) process.exitCode = 1;
  }
}

// Only the backup-related settings matter here; refuse to run with an unsafe off-site setup.
const problems = validateConfig().filter((p) => /BACKUP_|ALERT_/.test(p));
if (problems.length) {
  for (const p of problems) log.error('config error', { problem: p });
  process.exit(1);
}
startAlerts();
await safely();
if (process.argv.includes('--loop')) {
  const every = Number(process.env.BACKUP_INTERVAL_HOURS || 24) * 3600 * 1000;
  setInterval(safely, every);
  process.on('SIGTERM', () => process.exit(0));
}
