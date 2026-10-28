-- 004: payments (Paystack). One row per checkout attempt; only 'success' rows unlock anything.
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reference     TEXT NOT NULL UNIQUE,              -- ours, sent to Paystack: AHP-…
  user_id       INTEGER NOT NULL REFERENCES users(id),
  purpose       TEXT NOT NULL CHECK (purpose IN ('course')),
  item          TEXT NOT NULL,                     -- course id
  amount_kobo   INTEGER NOT NULL CHECK (amount_kobo > 0),
  currency      TEXT NOT NULL DEFAULT 'NGN',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','abandoned')),
  provider      TEXT NOT NULL DEFAULT 'paystack',
  access_code   TEXT,
  channel       TEXT,                              -- card, bank_transfer, ussd …
  provider_id   TEXT,                              -- Paystack transaction id
  gateway_note  TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  paid_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, purpose, item, status);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);
