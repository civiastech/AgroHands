-- 001: initial AgroHands schema (SQLite). Uses IF NOT EXISTS so databases created before migrations existed upgrade cleanly.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT NOT NULL UNIQUE,          -- normalised 0XXXXXXXXXX
  pin_hash      TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('worker','farmer','agent','admin')),
  name          TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  failed_pins   INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER,
  created_by    INTEGER REFERENCES users(id),   -- agent who did assisted sign-up
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS consents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  purpose     TEXT NOT NULL,                     -- terms, privacy, nin_check, data_sharing
  granted_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS workers (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id),
  gender              TEXT,
  dob                 TEXT,                      -- YYYY-MM-DD
  state               TEXT,
  lga                 TEXT,
  town                TEXT,
  lat                 REAL,
  lng                 REAL,
  radius_km           INTEGER NOT NULL DEFAULT 30,
  will_relocate       INTEGER NOT NULL DEFAULT 0, -- will live on farm if housing provided
  skills              TEXT NOT NULL DEFAULT '[]', -- JSON array of skill keys
  primary_skill       TEXT,
  years_exp           INTEGER NOT NULL DEFAULT 0,
  expected_wage       INTEGER,
  wage_period         TEXT NOT NULL DEFAULT 'day' CHECK (wage_period IN ('day','month')),
  available           INTEGER NOT NULL DEFAULT 1,
  languages           TEXT NOT NULL DEFAULT '[]',
  -- identity (we never store the full NIN: only a keyed hash for de-duplication + last 4 digits)
  nin_hash            TEXT UNIQUE,
  nin_last4           TEXT,
  nin_status          TEXT NOT NULL DEFAULT 'none' CHECK (nin_status IN ('none','pending_agent','verified','failed')),
  nin_provider        TEXT,
  nin_ref             TEXT,
  nin_verified_at     INTEGER,
  guarantor_name      TEXT,
  guarantor_phone     TEXT,
  guarantor_relation  TEXT,
  guarantor_status    TEXT NOT NULL DEFAULT 'none' CHECK (guarantor_status IN ('none','pending','verified','failed')),
  address_status      TEXT NOT NULL DEFAULT 'none' CHECK (address_status IN ('none','verified','failed')),
  assessed_skills     TEXT NOT NULL DEFAULT '[]', -- skills passed in a practical assessment
  tier                TEXT NOT NULL DEFAULT 'registered' CHECK (tier IN ('registered','bronze','silver','gold')),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS farms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  state       TEXT,
  lga         TEXT,
  address     TEXT,
  lat         REAL,
  lng         REAL,
  size_ha     REAL,
  crops       TEXT,
  cac_number  TEXT,
  verified    INTEGER NOT NULL DEFAULT 0,
  verified_by INTEGER REFERENCES users(id),
  plan        TEXT NOT NULL DEFAULT 'payg' CHECK (plan IN ('payg','basic','pro','enterprise')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id          INTEGER NOT NULL REFERENCES farms(id),
  title            TEXT NOT NULL,
  skill            TEXT NOT NULL,
  headcount        INTEGER NOT NULL DEFAULT 1,
  employment_type  TEXT NOT NULL CHECK (employment_type IN ('casual','seasonal','permanent')),
  start_date       TEXT NOT NULL,
  duration_days    INTEGER,
  wage_amount      INTEGER NOT NULL,
  wage_period      TEXT NOT NULL CHECK (wage_period IN ('day','month')),
  hours_per_day    INTEGER NOT NULL DEFAULT 8,
  accommodation    INTEGER NOT NULL DEFAULT 0,
  meals            INTEGER NOT NULL DEFAULT 0,
  min_tier         TEXT NOT NULL DEFAULT 'bronze',
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','closed')),
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  filled_at        INTEGER
);

CREATE TABLE IF NOT EXISTS matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES jobs(id),
  worker_id   INTEGER NOT NULL REFERENCES users(id),
  score       REAL NOT NULL,
  breakdown   TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'shortlisted'
              CHECK (status IN ('shortlisted','offered','accepted','declined','withdrawn','expired')),
  offered_at  INTEGER,
  responded_at INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (job_id, worker_id)
);

CREATE TABLE IF NOT EXISTS contracts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  job_id           INTEGER NOT NULL REFERENCES jobs(id),
  match_id         INTEGER REFERENCES matches(id),
  worker_id        INTEGER NOT NULL REFERENCES users(id),
  farm_id          INTEGER NOT NULL REFERENCES farms(id),
  terms            TEXT NOT NULL,              -- JSON snapshot of all terms at signing time
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','completed','terminated','cancelled')),
  worker_signed_at INTEGER,
  worker_sig_meta  TEXT,
  farmer_signed_at INTEGER,
  farmer_sig_meta  TEXT,
  start_date       TEXT,
  end_date         TEXT,
  ended_at         INTEGER,
  end_reason       TEXT CHECK (end_reason IN ('completed','worker_left','no_show','dismissed','mutual','farm_closed') OR end_reason IS NULL),
  ended_by         INTEGER REFERENCES users(id),
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ratings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id  INTEGER NOT NULL REFERENCES contracts(id),
  from_user    INTEGER NOT NULL REFERENCES users(id),
  to_user      INTEGER NOT NULL REFERENCES users(id),
  stars        INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment      TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (contract_id, from_user)
);

CREATE TABLE IF NOT EXISTS disputes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id  INTEGER NOT NULL REFERENCES contracts(id),
  raised_by    INTEGER NOT NULL REFERENCES users(id),
  category     TEXT NOT NULL,
  description  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
  resolution   TEXT,
  resolved_by  INTEGER REFERENCES users(id),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at  INTEGER
);

CREATE TABLE IF NOT EXISTS course_progress (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  course_id    TEXT NOT NULL,
  score        INTEGER,
  passed       INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  cert_code    TEXT UNIQUE,
  completed_at INTEGER,
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  subject    TEXT,
  meta       TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_workers_state ON workers(state, available);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_matches_worker ON matches(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_worker ON contracts(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_farm ON contracts(farm_id, status);
