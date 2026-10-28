// Creates the first admin (or promotes an existing account) from the server's command line, so you can
// sign in before SMS is set up. Prints a one-time PIN; change it after logging in (account menu → Change PIN).
//   Docker: docker compose -f docker-compose.yml -f docker-compose.prod.yml exec app node scripts/create-admin.js 08031234567 "Your Name"
//   Host:   npm run create-admin -- 08031234567 "Your Name"
import { randomInt } from 'node:crypto';
import { config } from '../src/config.js';
import { openDb, closeDb, q, audit } from '../src/db.js';
import { normalisePhone } from '../src/auth.js';
import { createUser, setPin } from '../src/lib/services.js';

const [rawPhone, ...nameParts] = process.argv.slice(2);
const phone = normalisePhone(rawPhone);
const name = nameParts.join(' ').trim() || 'Administrator';
if (!phone) {
  console.error('usage: node scripts/create-admin.js <Nigerian phone number> "<Full name>"');
  process.exit(2);
}

openDb(config.dbPath);
const pin = String(randomInt(100000, 1000000));
const existing = q.get("SELECT * FROM users WHERE phone = ? AND status != 'deleted'", phone);
let id;
if (existing) {
  id = existing.id;
  q.run("UPDATE users SET role = 'admin', status = 'active', phone_verified_at = COALESCE(phone_verified_at, unixepoch()) WHERE id = ?", id);
  setPin(id, pin, { actorId: null, reason: 'reset_cli' });
} else {
  // The operator vouches for the number, so it counts as verified.
  id = createUser({ phone, pin, role: 'admin', name, phoneVerified: true });
  q.run("UPDATE users SET role = 'admin' WHERE id = ?", id);
}
audit(null, 'cli.admin', `user:${id}`, { promoted: !!existing });
closeDb();

console.log(`\n✔ ${existing ? 'Promoted' : 'Created'} admin ${phone}${existing ? '' : ` (${name})`}`);
console.log(`  One-time PIN: ${pin}`);
console.log('  Log in, then change it: account menu → Change PIN.\n');
