/**
 * Gap H3: the shared SP1 fixture file must be exactly what the TypeScript pipeline produces today
 * (evaluateQuoteMatch → buildInitialZkAttestation → encodeQuotePublicValues + buildSp1GuestInput).
 * The same file is checked natively in Rust (quote-rules `cargo test`) and through the real guest ELF in
 * the zkVM (.github/workflows/sp1.yml `parity`), so TS ↔ guest parity holds end to end.
 * Regenerate after an intended change: pnpm --filter @zguard/zk build && pnpm --filter @zguard/zk fixtures:sp1
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSp1QuoteFixtures } from "@zguard/zk";

const committed = JSON.parse(
  readFileSync(new URL("../../../packages/zk/fixtures/sp1-quote-fixtures.json", import.meta.url), "utf8")
) as ReturnType<typeof buildSp1QuoteFixtures>;

describe("[H3] SP1 shared fixtures", () => {
  it("committed fixtures equal the current TypeScript pipeline output", () => {
    assert.deepEqual(committed, buildSp1QuoteFixtures());
  });

  it("cover allow, deny Q-001/Q-002/Q-005/Q-003 and abstain Q-DECODE/Q-007", () => {
    const byName = Object.fromEntries(committed.map((f) => [f.name, f]));
    assert.equal(byName["allow"]?.tsVerdict, "allow");
    assert.deepEqual(byName["deny-q001-recipient"]?.tsCodes, ["Q-001"]);
    assert.deepEqual(byName["deny-q002-amount"]?.tsCodes, ["Q-002"]);
    assert.deepEqual(byName["deny-q005-no-quote"]?.tsCodes, ["Q-005"]);
    assert.deepEqual(byName["deny-q003-asset-hinted"]?.tsCodes, ["Q-003"]);
    assert.equal(byName["abstain-qdecode-evm-tx"]?.tsVerdict, "abstain");
    assert.equal(byName["abstain-q007-domain-unverified"]?.tsVerdict, "abstain");
  });

  it("public values are scope=keccak256('quote') and 160 bytes", () => {
    for (const f of committed) {
      assert.equal(f.expectedPublicValues.length, 2 + 160 * 2, f.name);
      assert.ok(f.expectedPublicValues.startsWith("0x238ad53218834f943da60c8bafd36c36692dcb35e6d76bdd93202f5c04c0baff"), f.name);
    }
  });
});
