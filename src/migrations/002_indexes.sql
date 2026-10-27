-- 002: indexes for hot lookups (ratings in every match score, disputes on the admin desk, audit by subject).
CREATE INDEX IF NOT EXISTS idx_ratings_to_user ON ratings(to_user);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_log(subject);
CREATE INDEX IF NOT EXISTS idx_matches_job ON matches(job_id, status);
