// Turns an encrypted off-site backup back into a SQLite database file.
//   node scripts/restore.js <file.db.gz.enc> <out.db>               from a downloaded file
//   node scripts/restore.js --s3 <object key> <out.db>              straight from the bucket (BACKUP_S3_* set)
// Needs BACKUP_ENCRYPTION_KEY. Then: stop the app, copy out.db over DB_PATH, start the app (see docs/DEPLOYMENT.md).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';
import { decryptBackup, getObject } from '../src/lib/offsite.js';

const args = process.argv.slice(2);
const fromS3 = args[0] === '--s3';
const [source, out] = fromS3 ? args.slice(1) : args;
if (!source || !out) {
  console.error('usage: node scripts/restore.js <file.db.gz.enc> <out.db>\n       node scripts/restore.js --s3 <object key> <out.db>');
  process.exit(2);
}
if (!/^[0-9a-f]{64}$/i.test(config.backupEncryptionKey)) {
  console.error('Set BACKUP_ENCRYPTION_KEY (the 64-hex-character key used when the backup was made).');
  process.exit(2);
}
if (existsSync(out)) {
  console.error(`${out} already exists. Choose a new file name; never restore over the live database while the app runs.`);
  process.exit(2);
}

const blob = fromS3 ? await getObject(config.offsite, source) : readFileSync(source);
let db;
try {
  db = decryptBackup(blob, config.backupEncryptionKey);
} catch (err) {
  console.error(`Could not decrypt: ${err.message}. Wrong key, or the file is damaged.`);
  process.exit(1);
}
if (!db.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) {
  console.error('Decrypted data is not a SQLite database.');
  process.exit(1);
}
writeFileSync(out, db);
const check = new DatabaseSync(out, { readOnly: true });
const ok = check.prepare('PRAGMA integrity_check').get();
const users = check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const schema = check.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
check.close();
console.log(`Restored ${out}: ${db.length} bytes, integrity ${Object.values(ok)[0]}, schema ${schema}, ${users} users.`);
