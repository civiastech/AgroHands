// Database access using Node's built-in SQLite (node:sqlite). No ORM, no dependencies.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, 'migrations');
let db;

export function openDb(path, { migrate: runMigrations = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  if (runMigrations) migrate();
  return db;
}

export function closeDb() {
  if (!db) return;
  try { db.exec('PRAGMA optimize'); } catch { /* best effort */ }
  db.close();
  db = undefined;
}

export function getDb() {
  if (!db) throw new Error('Database not opened');
  return db;
}

/** Lists migration files in order: 001_init.sql, 002_….sql */
export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: Number(f.slice(0, 3)), name: f }));
}

/** Applies pending migrations, each in its own transaction. Returns the names applied. */
export function migrate() {
  const d = getDb();
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  const done = new Set(d.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const applied = [];
  for (const m of migrationFiles()) {
    if (done.has(m.version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, m.name), 'utf8');
    d.exec('BEGIN');
    try {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
      d.exec('COMMIT');
      applied.push(m.name);
    } catch (e) {
      d.exec('ROLLBACK');
      throw new Error(`Migration ${m.name} failed: ${e.message}`, { cause: e });
    }
  }
  return applied;
}

export function schemaVersion() {
  return getDb().prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
}

/** Cheap readiness probe: the database answers a query. */
export function dbHealthy() {
  try {
    return getDb().prepare('SELECT 1 AS ok').get().ok === 1;
  } catch {
    return false;
  }
}

/** Consistent online backup (safe while the app is serving traffic). */
export function backupTo(file) {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  getDb().prepare('VACUUM INTO ?').run(resolve(file));
}

const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));

export const q = {
  get: (sql, ...params) => getDb().prepare(sql).get(...clean(params)),
  all: (sql, ...params) => getDb().prepare(sql).all(...clean(params)),
  run: (sql, ...params) => getDb().prepare(sql).run(...clean(params)),
  tx(fn) {
    const d = getDb();
    d.exec('BEGIN');
    try {
      const result = fn();
      d.exec('COMMIT');
      return result;
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  },
};

export function audit(actorId, action, subject, meta) {
  q.run(
    'INSERT INTO audit_log (actor_id, action, subject, meta) VALUES (?, ?, ?, ?)',
    actorId ?? null,
    action,
    subject ?? null,
    meta ? JSON.stringify(meta) : null,
  );
}

export const parseJson = (s, fallback = []) => {
  try { return JSON.parse(s ?? ''); } catch { return fallback; }
};
