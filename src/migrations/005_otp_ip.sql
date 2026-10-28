-- 005: remember which IP asked for each one-time code, so one source can't request codes for many numbers
-- (SMS pumping: running up the SMS bill by asking for codes to numbers the attacker profits from).
ALTER TABLE otp_codes ADD COLUMN ip TEXT;
CREATE INDEX IF NOT EXISTS idx_otp_ip ON otp_codes(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_created ON sms_outbox(created_at);
