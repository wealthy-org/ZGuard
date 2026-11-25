-- Gap C5: shared fixed-window rate limit counters (works across serverless instances)
CREATE TABLE IF NOT EXISTS zguard_rate_limits (
  bucket_key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
