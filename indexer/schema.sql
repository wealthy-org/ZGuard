CREATE TABLE IF NOT EXISTS perm_indexer_state (
  chain_id INTEGER NOT NULL,
  router TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, router, key)
);

CREATE TABLE IF NOT EXISTS perm_settlements (
  chain_id INTEGER NOT NULL,
  router TEXT NOT NULL,
  router_version INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT,
  block_timestamp BIGINT,
  receipt_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  account TEXT NOT NULL,
  recipient TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78,0) NOT NULL,
  routed_input NUMERIC(78,0) NOT NULL,
  amount_out NUMERIC(78,0) NOT NULL,
  gross_fee NUMERIC(78,0) NOT NULL,
  rebate NUMERIC(78,0) NOT NULL,
  net_fee NUMERIC(78,0) NOT NULL,
  referral_fee NUMERIC(78,0) NOT NULL,
  treasury_fee NUMERIC(78,0) NOT NULL DEFAULT 0,
  policy_version INTEGER NOT NULL,
  route_id TEXT NOT NULL,
  route_hash TEXT,
  legacy BOOLEAN NOT NULL DEFAULT FALSE,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, router, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS perm_settlements_account_history
  ON perm_settlements (chain_id, router, account, block_number DESC, log_index DESC);
CREATE UNIQUE INDEX IF NOT EXISTS perm_settlements_event_identity
  ON perm_settlements (chain_id, router, transaction_hash, receipt_id);
CREATE INDEX IF NOT EXISTS perm_settlements_receipt
  ON perm_settlements (chain_id, router, receipt_id);

CREATE TABLE IF NOT EXISTS perm_route_steps (
  chain_id INTEGER NOT NULL,
  router TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT,
  receipt_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78,0) NOT NULL,
  amount_out NUMERIC(78,0) NOT NULL,
  step_route_id TEXT NOT NULL,
  hook TEXT NOT NULL,
  hook_codehash TEXT,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, router, transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS perm_route_steps_receipt
  ON perm_route_steps (chain_id, router, receipt_id, step_index);
CREATE UNIQUE INDEX IF NOT EXISTS perm_route_steps_identity
  ON perm_route_steps (chain_id, router, receipt_id, step_index);

-- Shared API rate-limit state. Keys are SHA-256 digests, never raw IP addresses.
-- The atomic function gives every serverless instance one token-bucket view.
CREATE TABLE IF NOT EXISTS perm_rate_limits (
  key_hash TEXT PRIMARY KEY CHECK (char_length(key_hash) = 64),
  tokens DOUBLE PRECISION NOT NULL CHECK (tokens >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS perm_rate_limits_updated_at
  ON perm_rate_limits (updated_at);

CREATE OR REPLACE FUNCTION perm_consume_rate_limit(
  p_key_hash TEXT,
  p_capacity DOUBLE PRECISION,
  p_refill_per_second DOUBLE PRECISION
) RETURNS TABLE (allowed BOOLEAN, retry_after INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  current_tokens DOUBLE PRECISION;
  current_updated_at TIMESTAMPTZ;
  replenished DOUBLE PRECISION;
BEGIN
  IF p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid rate-limit key hash';
  END IF;
  IF p_capacity < 1 OR p_refill_per_second <= 0
     OR p_capacity <> p_capacity OR p_refill_per_second <> p_refill_per_second THEN
    RAISE EXCEPTION 'invalid rate-limit parameters';
  END IF;

  INSERT INTO perm_rate_limits (key_hash, tokens, updated_at)
  VALUES (p_key_hash, p_capacity, NOW())
  ON CONFLICT (key_hash) DO NOTHING;

  SELECT tokens, updated_at
  INTO current_tokens, current_updated_at
  FROM perm_rate_limits
  WHERE key_hash = p_key_hash
  FOR UPDATE;

  replenished := LEAST(
    p_capacity,
    current_tokens + GREATEST(0, EXTRACT(EPOCH FROM (NOW() - current_updated_at))) * p_refill_per_second
  );

  IF replenished >= 1 THEN
    UPDATE perm_rate_limits
    SET tokens = replenished - 1, updated_at = NOW()
    WHERE key_hash = p_key_hash;
    allowed := TRUE;
    retry_after := 0;
  ELSE
    UPDATE perm_rate_limits
    SET tokens = replenished, updated_at = NOW()
    WHERE key_hash = p_key_hash;
    allowed := FALSE;
    retry_after := GREATEST(1, CEIL((1 - replenished) / p_refill_per_second)::INTEGER);
  END IF;

  -- Bound stale state without putting an unbounded cleanup on the request path.
  IF random() < 0.01 THEN
    DELETE FROM perm_rate_limits
    WHERE key_hash IN (
      SELECT key_hash FROM perm_rate_limits
      WHERE updated_at < NOW() - INTERVAL '1 day'
      ORDER BY updated_at
      LIMIT 1000
    );
  END IF;
  RETURN NEXT;
END;
$$;

ALTER TABLE perm_settlements ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE perm_route_steps ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE perm_route_steps ADD COLUMN IF NOT EXISTS hook_codehash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'perm_route_steps_settlement_fk'
  ) THEN
    ALTER TABLE perm_route_steps
      ADD CONSTRAINT perm_route_steps_settlement_fk
      FOREIGN KEY (chain_id, router, transaction_hash, receipt_id)
      REFERENCES perm_settlements (chain_id, router, transaction_hash, receipt_id)
      ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
