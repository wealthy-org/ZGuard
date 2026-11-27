import assert from "node:assert/strict";
import { allowlistedStagingConfiguration, isAllowlistedStagingWallet } from "../lib/server/staging-policy";
import { ALLOWLISTED_STAGING_MODE } from "../lib/web3/execution-mode";

const walletA = `0x${"11".repeat(20)}`;
const walletB = `0x${"22".repeat(20)}`;
const base = {
  PERM_EXECUTION_MODE: ALLOWLISTED_STAGING_MODE,
  NEXT_PUBLIC_PERM_EXECUTION_MODE: ALLOWLISTED_STAGING_MODE,
  PERM_STAGING_CHAIN_ID: "46630",
  PERM_STAGING_WALLET_ALLOWLIST: `${walletA},${walletB}`,
  PERM_STAGING_ALLOW_BURNER_SIGNER: "1",
};

const configured = allowlistedStagingConfiguration(base);
assert.equal(configured.configured, true);
assert.equal(configured.chainPinned, true);
assert.equal(configured.allowlist.length, 2);
assert.equal(configured.localBurnerSignerAllowed, true);
assert.equal(isAllowlistedStagingWallet(walletA, configured), true);
assert.equal(isAllowlistedStagingWallet(`0x${"33".repeat(20)}`, configured), false);

const deduplicated = allowlistedStagingConfiguration({ ...base, PERM_STAGING_WALLET_ALLOWLIST: `${walletA},${walletA.toUpperCase().replace("0X", "0x")}` });
assert.equal(deduplicated.configured, true);
assert.equal(deduplicated.allowlist.length, 1);

for (const [environment, expected] of [
  [{ ...base, PERM_EXECUTION_MODE: "disabled" }, /PERM_EXECUTION_MODE/],
  [{ ...base, NEXT_PUBLIC_PERM_EXECUTION_MODE: "disabled" }, /NEXT_PUBLIC_PERM_EXECUTION_MODE/],
  [{ ...base, PERM_STAGING_CHAIN_ID: "1" }, /46630/],
  [{ ...base, PERM_STAGING_WALLET_ALLOWLIST: "" }, /empty/],
  [{ ...base, PERM_STAGING_WALLET_ALLOWLIST: "0x1234" }, /invalid/],
  [{ ...base, PERM_STAGING_WALLET_ALLOWLIST: `0x${"0".repeat(40)}` }, /zero/],
] as const) {
  const value = allowlistedStagingConfiguration(environment);
  assert.equal(value.configured, false);
  assert.match(value.reason || "", expected);
}

const withEvidence = allowlistedStagingConfiguration({
  ...base,
  PERM_STAGING_E2E_TX_HASH: `0x${"44".repeat(32)}`,
  NEXT_PUBLIC_PERM_STAGING_E2E_PASSED: "1",
});
assert.equal(withEvidence.e2eDeclared, true);
assert.equal(withEvidence.e2eTransactionHash, `0x${"44".repeat(32)}`);

console.log("Allowlisted staging policy: exact dual-mode flags, chain pin, bounded wallet allowlist, burner opt-in and E2E declaration fail closed");
