// Apply pending database migrations and print the schema version. The server also does this on start.
//   npm run migrate            apply
//   npm run migrate -- --status  list applied / pending without changing anything
import { config } from '../src/config.js';
import { openDb, migrate, migrationFiles, closeDb, q } from '../src/db.js';

openDb(config.dbPath, { migrate: false });
if (process.argv.includes('--status')) {
  q.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))');
  const done = new Map(q.all('SELECT version, applied_at FROM schema_migrations').map((r) => [r.version, r.applied_at]));
  for (const m of migrationFiles()) {
    const at = done.get(m.version);
    console.log(`${at ? '✔ applied ' + new Date(at * 1000).toISOString() : '… pending              '}  ${m.name}`);
  }
} else {
  const applied = migrate();
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
}
closeDb();
