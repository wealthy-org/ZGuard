import assert from "node:assert/strict";
import fs from "node:fs";
import { getAddress, isAddress } from "ethers";

const review = JSON.parse(fs.readFileSync(new URL("../deployments/robinhood-testnet.v2-venue-review.json", import.meta.url), "utf8"));
const staging = JSON.parse(fs.readFileSync(new URL("../deployments/robinhood-testnet.v2-staging.json", import.meta.url), "utf8"));

assert.equal(review.schemaVersion, 1);
assert.equal(review.purpose, "perm-chain-46630-v2-venue-admission-review");
assert.equal(review.chainId, 46630);
assert.equal(review.admissionDecision, "withhold");
assert.equal(review.adapterDeploymentAuthorized, false);
assert.equal(review.factory.officialUniswapDeployment, false);
assert.equal(review.factory.publicProtocolAttribution, null);
assert.equal(review.factory.sourceVerification.isVerified, true);
assert.equal(review.factory.sourceVerification.isFullyVerified, true);
assert.equal(review.factory.sourceVerification.isChangedBytecode, false);
assert.equal(review.factory.sourceVerification.publishedFiles, 11);
assert.equal(review.factory.sourceVerification.exactUniswapV2CoreFiles, 11);
assert.equal(review.factory.sourceVerification.allPublishedSourcesExactUpstreamMatch, true);
assert.equal(review.factory.sourceVerification.files.length, 11);
for (const source of review.factory.sourceVerification.files) {
  assert.equal(source.exactUpstreamMatch, true);
  assert.match(source.publishedSha256, /^[0-9a-f]{64}$/);
  assert.equal(source.publishedSha256, source.upstreamSha256);
}

assert.ok(isAddress(review.factory.address));
assert.ok(isAddress(review.factory.creator));
assert.ok(isAddress(review.factory.feeToSetter));
assert.equal(getAddress(review.factory.creator), getAddress(review.factory.feeToSetter));
assert.equal(review.factory.sourceVerification.compilerVersion, "v0.5.16+commit.9c3226ce");
assert.equal(review.factory.sourceVerification.optimizerEnabled, true);
assert.equal(review.factory.sourceVerification.optimizerRuns, 999999);
assert.equal(review.factory.sourceVerification.evmVersion, "istanbul");
assert.match(review.factory.runtimeCodehash, /^0x[0-9a-f]{64}$/);
assert.equal(review.factory.runtimeCodehash, review.factory.expectedRuntimeCodehash);
assert.match(review.expectedPairRuntimeCodehash, /^0x[0-9a-f]{64}$/);

assert.equal(review.supportedPairCount, 2);
assert.equal(review.supportedPairs.length, 2);
assert.equal(review.recentSwapCount30Days, 0);
assert.deepEqual(review.supportedPairs.map((pair) => pair.swapCountAllTime).sort((a, b) => a - b), [3, 5]);
for (const pair of review.supportedPairs) {
  assert.ok(isAddress(pair.address));
  assert.equal(pair.pairRuntimeCodehash, review.expectedPairRuntimeCodehash);
  assert.equal(pair.canonicalPairRuntimeMatch, true);
  assert.equal(pair.balancesEqualReserves, true);
  assert.equal(pair.swapCountLast30Days, 0);
  assert.ok(pair.daysSinceLastSwap > 30);
  assert.equal(pair.kLast, "0");
  assert.ok(BigInt(pair.token0.reserve) > 0n && BigInt(pair.token1.reserve) > 0n);
}
assert.equal(review.findings.implementationIntegrityEstablished, true);
assert.equal(review.findings.officialProvenanceEstablished, false);
assert.equal(review.findings.recentIndependentActivityEstablished, false);
assert.equal(review.findings.meaningfulLiquidityEstablished, false);
assert.ok(review.reasons.length >= 4);
assert.ok(review.reconsiderationGates.length >= 4);

assert.equal(staging.executionReady, false);
assert.equal(staging.boundaries.reviewedThirdPartyV2Enabled, false);
assert.equal("v2Adapter" in staging.contracts, false);
assert.equal("reviewedThirdPartyV2" in staging.providers, false);

console.log("V2 venue review: exact implementation evidence preserved; provenance, activity and liquidity gates remain fail-closed");
