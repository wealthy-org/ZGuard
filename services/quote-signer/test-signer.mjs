// Policy tests for the remote quote signer. Run: node services/quote-signer/test-signer.mjs
import assert from "node:assert/strict";
import { recoverTypedDataAddress } from "viem";
import { PERM_QUOTE_TYPES, SignerConfigError, handleSignRequest, loadConfig } from "./signer-core.mjs";

const KEY = `0x${"42".repeat(32)}`;
const TOKEN = "t".repeat(40);
const ROUTER = "0x8F9DedBD504580f9E966C006dad0E51EA8CC5A00";
const WALLET = "0x1111111111111111111111111111111111111111";
const NOW = 2_000_000_000;
const env = { SIGNER_PRIVATE_KEY: KEY, PERM_QUOTE_SIGNER_TOKEN: TOKEN, SIGNER_CHAIN_ID: "4663", SIGNER_ROUTER_ADDRESS: ROUTER };
const config = loadConfig(env);

// Exactly the body shape lib/server/quote-signer.ts sends (bigints stringified, policyVersion number).
const domain = { name: "Perm", version: "2", chainId: 4663, verifyingContract: ROUTER };
const message = {
  account: WALLET,
  tokenIn: "0x0000000000000000000000000000000000000000",
  tokenOut: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  amountIn: "1000000000000000",
  minAmountOut: "12000000000000000",
  gasEstimate: "330000",
  recipient: WALLET,
  deadline: String(NOW + 90),
  quotedAt: String(NOW),
  policyVersion: 1,
  chainId: "4663",
  referrer: "0x0000000000000000000000000000000000000000",
  routeHash: `0x${"ab".repeat(32)}`,
};
const body = (patch = {}) => JSON.stringify({ schemaVersion: 1, purpose: "perm-eip712-quote", domain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message, ...patch });
const call = (overrides = {}, cfg = config) => handleSignRequest({ authorization: `Bearer ${TOKEN}`, contentType: "application/json", bodyText: body(), config: cfg, now: NOW, ...overrides });

// happy path + recovery with the same typed data the web app recovers
const ok = await call();
assert.equal(ok.status, 200);
assert.equal(ok.body.address, config.account.address);
const typedMessage = { ...message, amountIn: BigInt(message.amountIn), minAmountOut: BigInt(message.minAmountOut), gasEstimate: BigInt(message.gasEstimate), deadline: BigInt(message.deadline), quotedAt: BigInt(message.quotedAt), chainId: 4663n };
assert.equal(await recoverTypedDataAddress({ domain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message: typedMessage, signature: ok.body.signature }), config.account.address);
assert.equal(ok.audit.account, WALLET);
assert.ok(!JSON.stringify(ok.audit).includes(ok.body.signature));

const expectReject = async (overrides, status, pattern, cfg) => {
  const result = await call(overrides, cfg);
  assert.equal(result.status, status, `${pattern}: got ${result.status} ${result.body.error}`);
  assert.match(result.body.error, pattern);
};
await expectReject({ authorization: "Bearer wrong" }, 401, /unauthorized/);
await expectReject({ authorization: undefined }, 401, /unauthorized/);
await expectReject({ contentType: "text/plain" }, 415, /content-type/);
await expectReject({ bodyText: "{" }, 400, /invalid json/);
await expectReject({ bodyText: "x".repeat(20_000) }, 413, /too large/);
await expectReject({ bodyText: body({ purpose: "anything" }) }, 422, /unsupported/);
await expectReject({ bodyText: body({ domain: { ...domain, chainId: 46630 } }) }, 422, /chainId must be 4663/);
await expectReject({ bodyText: body({ domain: { ...domain, verifyingContract: WALLET } }) }, 422, /pinned PermRouter/);
await expectReject({ bodyText: body({ domain: { ...domain, salt: "0x00" } }) }, 422, /unexpected domain/);
await expectReject({ bodyText: body({ domain: { ...domain, version: "1" } }) }, 422, /version/);
await expectReject({ bodyText: body({ types: { PermQuote: PERM_QUOTE_TYPES.PermQuote.slice(1) } }) }, 422, /types/);
await expectReject({ bodyText: body({ types: { ...PERM_QUOTE_TYPES, Extra: [] } }) }, 422, /types/);
await expectReject({ bodyText: body({ message: { ...message, chainId: "46630" } }) }, 422, /chainId mismatch/);
await expectReject({ bodyText: body({ message: { ...message, deadline: String(NOW - 1) } }) }, 422, /expired/);
await expectReject({ bodyText: body({ message: { ...message, deadline: String(NOW + 3600) } }) }, 422, /deadline exceeds/);
await expectReject({ bodyText: body({ message: { ...message, quotedAt: String(NOW + 600) } }) }, 422, /future/);
await expectReject({ bodyText: body({ message: { ...message, amountIn: "0" } }) }, 422, /positive/);
await expectReject({ bodyText: body({ message: { ...message, account: "0x0000000000000000000000000000000000000000" } }) }, 422, /required/);
await expectReject({ bodyText: body({ message: { ...message, routeHash: "0x12" } }) }, 422, /routeHash/);
await expectReject({ bodyText: body({ message: { ...message, extra: "1" } }) }, 422, /fields/);

const gated = loadConfig({ ...env, SIGNER_ACCOUNT_ALLOWLIST: "0x2222222222222222222222222222222222222222", SIGNER_MAX_AMOUNT_IN_WEI: "100" });
await expectReject({}, 403, /allowlist/, gated);
const capped = loadConfig({ ...env, SIGNER_MAX_AMOUNT_IN_WEI: "100" });
await expectReject({}, 422, /cap/, capped);

for (const [patch, pattern] of [
  [{ SIGNER_PRIVATE_KEY: "0x12" }, /SIGNER_PRIVATE_KEY/],
  [{ PERM_QUOTE_SIGNER_TOKEN: "short" }, /at least 32/],
  [{ SIGNER_CHAIN_ID: "" }, /SIGNER_CHAIN_ID/],
  [{ SIGNER_ROUTER_ADDRESS: "" }, /SIGNER_ROUTER_ADDRESS/],
  [{ SIGNER_EXPECTED_ADDRESS: WALLET }, /does not match/],
]) {
  assert.throws(() => loadConfig({ ...env, ...patch }), (error) => error instanceof SignerConfigError && pattern.test(error.message));
}
console.log("Remote quote signer: bearer auth, exact Perm schema, chain/router pin, TTL/skew, allowlist, amount cap and config validation fail closed");
