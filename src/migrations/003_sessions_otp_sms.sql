-- 003: server-side sessions (revocable), one-time codes (phone ownership, PIN reset) and an SMS outbox.

-- Sessions are looked up by the SHA-256 of the cookie token, so a database leak does not leak live cookies.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,                -- sha256(token), hex
  user_id       INTEGER NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- A code sent by SMS. The code is stored only as a keyed hash; the token in the URL ties the browser to the row.
CREATE TABLE IF NOT EXISTS otp_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token        TEXT NOT NULL UNIQUE,
  phone        TEXT NOT NULL,
  purpose      TEXT NOT NULL CHECK (purpose IN ('register','reset')),
  code_hash    TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}',     -- register: name, role, pin hash, lang. reset: user id
  attempts     INTEGER NOT NULL DEFAULT 0,
  sent         INTEGER NOT NULL DEFAULT 0,     -- 0 when the number is unknown (reset) so nothing was sent
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, purpose, created_at);

-- Every outbound SMS is queued here first, then delivered (with retries) by the sender in src/lib/sms.js.
CREATE TABLE IF NOT EXISTS sms_outbox (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER REFERENCES users(id),
  phone            TEXT NOT NULL,
  kind             TEXT NOT NULL,              -- otp, offer, offer_accepted, contract_sign, ...
  body             TEXT NOT NULL,              -- one-time codes are blanked once sent
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  provider_ref     TEXT,
  error            TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sms_due ON sms_outbox(status, next_attempt_at);

ALTER TABLE users ADD COLUMN phone_verified_at INTEGER;
