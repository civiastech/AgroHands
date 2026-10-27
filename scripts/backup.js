// Online SQLite backup (safe while the app serves traffic) with retention.
//   npm run backup                    one-off backup into BACKUP_DIR
//   node scripts/backup.js --loop     backup now, then every 24h (used by the Docker "backup" service)
// Restore: stop the app, copy a backup file over DB_PATH, start the app.
import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { openDb, backupTo, closeDb } from '../src/db.js';
import { log } from '../src/lib/log.js';

const DAY = 86400 * 1000;

function runOnce() {
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

const safely = () => {
  try {
    runOnce();
  } catch (err) {
    log.error('backup failed', { err });
    if (!process.argv.includes('--loop')) process.exitCode = 1;
  }
};

safely();
if (process.argv.includes('--loop')) {
  const every = Number(process.env.BACKUP_INTERVAL_HOURS || 24) * 3600 * 1000;
  setInterval(safely, every);
  process.on('SIGTERM', () => process.exit(0));
}
