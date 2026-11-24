-- ZGuard Neon Serverless Postgres Schema (§4.3, §5, §8.1, §8.3 Dev Brief)

CREATE TABLE IF NOT EXISTS zguard_tenants (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL UNIQUE,
  api_key_hint TEXT NOT NULL,
  credit_micro_usdg BIGINT NOT NULL DEFAULT 0,
  total_spent_micro_usdg BIGINT NOT NULL DEFAULT 0,
  spend_policy JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zguard_receipts (
  decision_id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES zguard_tenants(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  network TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  charged_micro_usdg BIGINT NOT NULL DEFAULT 0,
  buyback_micro_usdg BIGINT NOT NULL DEFAULT 0,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zguard_receipts_tenant ON zguard_receipts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zguard_receipts_payload_hash ON zguard_receipts(payload_hash);

CREATE TABLE IF NOT EXISTS zguard_zk_attestations (
  decision_id TEXT PRIMARY KEY REFERENCES zguard_receipts(decision_id) ON DELETE CASCADE,
  system TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'quote' CHECK (scope = 'quote'),
  program_vkey TEXT NOT NULL,
  proof TEXT,
  public_inputs JSONB NOT NULL,
  verifier_address TEXT,
  verify_tx TEXT,
  bn254_precompile_verified BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zguard_payment_nonces (
  nonce_key TEXT PRIMARY KEY,
  tenant_id TEXT,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  payer TEXT NOT NULL,
  amount_micro BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zguard_token_observations (
  chain_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  kind TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address)
);
