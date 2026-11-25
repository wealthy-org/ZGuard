-- Gap C1/C9: attestation status reason (e.g. SP1 prover not configured)
ALTER TABLE zguard_zk_attestations ADD COLUMN IF NOT EXISTS note TEXT;
