// Perm remote quote signer — policy core (framework-free, shared by server.mjs and api/sign.mjs).
//
// Contract (matches lib/server/quote-signer.ts → signPermQuote, mode "remote"):
//   POST  Authorization: Bearer <PERM_QUOTE_SIGNER_TOKEN>   Content-Type: application/json
//   body  { schemaVersion: 1, purpose: "perm-eip712-quote", domain, types, primaryType: "PermQuote", message }
//   200   { address, signature }   (application/json)
//
// The signer is NOT a blind oracle. Even with a stolen bearer token it only signs a PermQuote that:
//   - uses the exact Perm EIP-712 type set and domain {name "Perm", version "2"},
//   - is pinned to SIGNER_CHAIN_ID and SIGNER_ROUTER_ADDRESS (both required),
//   - has message.chainId == domain.chainId, a deadline in (now, now + SIGNER_MAX_TTL_SECONDS],
//     quotedAt not in the future (beyond SIGNER_MAX_CLOCK_SKEW_SECONDS),
//   - optionally: account ∈ SIGNER_ACCOUNT_ALLOWLIST and amountIn ≤ SIGNER_MAX_AMOUNT_IN_WEI.
//
// Key custody: SIGNER_PRIVATE_KEY lives ONLY in this service's secret store (never in the web app,
// never NEXT_PUBLIC_*). It must be a dedicated key that holds no funds and is used for nothing else.
// For a hardware-backed key, replace `loadAccount` with a KMS-backed viem account; the policy stays.
import { timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const PERM_QUOTE_TYPES = {
  PermQuote: [
    { name: "account", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "gasEstimate", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" },
    { name: "quotedAt", type: "uint64" },
    { name: "policyVersion", type: "uint32" },
    { name: "chainId", type: "uint256" },
    { name: "referrer", type: "address" },
    { name: "routeHash", type: "bytes32" },
  ],
};

export const MAX_BODY_BYTES = 16_384;
const UINT = /^[0-9]{1,78}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export class SignerConfigError extends Error {}

/** Validates and freezes configuration once at boot so a bad deploy fails loudly, not per request. */
export function loadConfig(env = process.env) {
  const fail = (message) => { throw new SignerConfigError(message); };
  const key = env.SIGNER_PRIVATE_KEY || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("SIGNER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  const token = env.PERM_QUOTE_SIGNER_TOKEN || "";
  if (token.length < 32) fail("PERM_QUOTE_SIGNER_TOKEN must be at least 32 characters (use: openssl rand -hex 32)");
  const chainId = Number(env.SIGNER_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) fail("SIGNER_CHAIN_ID is required (4663 for Robinhood Chain mainnet)");
  if (!isAddress(env.SIGNER_ROUTER_ADDRESS || "")) fail("SIGNER_ROUTER_ADDRESS is required (PermRouter from deployments/robinhood-mainnet.json)");
  const maxTtl = Number(env.SIGNER_MAX_TTL_SECONDS || 180);
  const maxSkew = Number(env.SIGNER_MAX_CLOCK_SKEW_SECONDS || 30);
  if (!Number.isSafeInteger(maxTtl) || maxTtl < 30 || maxTtl > 900) fail("SIGNER_MAX_TTL_SECONDS must be 30..900");
  if (!Number.isSafeInteger(maxSkew) || maxSkew < 0 || maxSkew > 300) fail("SIGNER_MAX_CLOCK_SKEW_SECONDS must be 0..300");
  let allowlist = null;
  if (env.SIGNER_ACCOUNT_ALLOWLIST) {
    const entries = env.SIGNER_ACCOUNT_ALLOWLIST.split(",").map((entry) => entry.trim()).filter(Boolean);
    if (!entries.length || entries.some((entry) => !isAddress(entry))) fail("SIGNER_ACCOUNT_ALLOWLIST must be comma-separated addresses");
    allowlist = new Set(entries.map((entry) => getAddress(entry)));
  }
  let maxAmountIn = null;
  if (env.SIGNER_MAX_AMOUNT_IN_WEI) {
    if (!UINT.test(env.SIGNER_MAX_AMOUNT_IN_WEI)) fail("SIGNER_MAX_AMOUNT_IN_WEI must be a base-unit integer");
    maxAmountIn = BigInt(env.SIGNER_MAX_AMOUNT_IN_WEI);
  }
  const account = privateKeyToAccount(key);
  if (env.SIGNER_EXPECTED_ADDRESS && (!isAddress(env.SIGNER_EXPECTED_ADDRESS) || getAddress(env.SIGNER_EXPECTED_ADDRESS) !== account.address)) {
    fail(`SIGNER_EXPECTED_ADDRESS does not match the key (key address ${account.address})`);
  }
  return Object.freeze({
    account,
    token: Buffer.from(token),
    chainId,
    router: getAddress(env.SIGNER_ROUTER_ADDRESS),
    maxTtl,
    maxSkew,
    allowlist,
    maxAmountIn,
  });
}

function bearerMatches(header, expected) {
  const match = /^Bearer (.+)$/.exec(header || "");
  if (!match) return false;
  const given = Buffer.from(match[1]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sameTypes(types) {
  if (!types || typeof types !== "object" || Array.isArray(types)) return false;
  const keys = Object.keys(types).filter((key) => key !== "EIP712Domain");
  if (keys.length !== 1 || keys[0] !== "PermQuote" || !Array.isArray(types.PermQuote)) return false;
  const expected = PERM_QUOTE_TYPES.PermQuote;
  return types.PermQuote.length === expected.length
    && types.PermQuote.every((field, index) => field && field.name === expected[index].name && field.type === expected[index].type);
}

const reject = (status, error) => ({ status, body: { error } });

/**
 * @param {{ authorization?: string, contentType?: string, bodyText: string, config: ReturnType<typeof loadConfig>, now?: number }} input
 * @returns {Promise<{ status: number, body: object, audit?: object }>}
 */
export async function handleSignRequest({ authorization, contentType, bodyText, config, now = Math.floor(Date.now() / 1000) }) {
  if (!bearerMatches(authorization, config.token)) return reject(401, "unauthorized");
  if (!/^application\/json(?:;|$)/i.test(contentType || "")) return reject(415, "content-type must be application/json");
  if (Buffer.byteLength(bodyText || "") > MAX_BODY_BYTES) return reject(413, "body too large");
  let body;
  try { body = JSON.parse(bodyText); } catch { return reject(400, "invalid json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reject(400, "body must be an object");
  if (body.schemaVersion !== 1 || body.purpose !== "perm-eip712-quote" || body.primaryType !== "PermQuote") return reject(422, "unsupported request type");
  if (!sameTypes(body.types)) return reject(422, "types do not match the Perm quote schema");

  const domain = body.domain || {};
  if (domain.name !== "Perm" || domain.version !== "2") return reject(422, "domain name/version mismatch");
  if (Number(domain.chainId) !== config.chainId) return reject(422, `domain chainId must be ${config.chainId}`);
  if (!isAddress(domain.verifyingContract || "") || getAddress(domain.verifyingContract) !== config.router) return reject(422, "domain verifyingContract is not the pinned PermRouter");
  if (Object.keys(domain).some((key) => !["name", "version", "chainId", "verifyingContract"].includes(key))) return reject(422, "unexpected domain field");

  const raw = body.message || {};
  const expectedFields = PERM_QUOTE_TYPES.PermQuote.map((field) => field.name);
  if (Object.keys(raw).length !== expectedFields.length || expectedFields.some((name) => !(name in raw))) return reject(422, "message fields do not match the schema");
  let message;
  try {
    message = {};
    for (const { name, type } of PERM_QUOTE_TYPES.PermQuote) {
      const value = raw[name];
      if (type === "address") {
        if (typeof value !== "string" || !isAddress(value)) throw new Error(name);
        message[name] = getAddress(value);
      } else if (type === "bytes32") {
        if (typeof value !== "string" || !BYTES32.test(value)) throw new Error(name);
        message[name] = value;
      } else if (type === "uint32") {
        const number = typeof value === "string" ? Number(value) : value;
        if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) throw new Error(name);
        message[name] = number;
      } else {
        const text = typeof value === "number" ? String(value) : value;
        if (typeof text !== "string" || !UINT.test(text)) throw new Error(name);
        message[name] = BigInt(text);
      }
    }
  } catch (cause) {
    return reject(422, `invalid message field ${cause instanceof Error ? cause.message : ""}`.trim());
  }

  if (message.chainId !== BigInt(config.chainId)) return reject(422, "message chainId mismatch");
  if (message.account === "0x0000000000000000000000000000000000000000" || message.recipient === "0x0000000000000000000000000000000000000000") return reject(422, "account and recipient are required");
  if (message.amountIn === 0n) return reject(422, "amountIn must be positive");
  if (message.deadline <= BigInt(now)) return reject(422, "quote already expired");
  if (message.deadline > BigInt(now + config.maxTtl)) return reject(422, `deadline exceeds ${config.maxTtl}s`);
  if (message.quotedAt > BigInt(now + config.maxSkew)) return reject(422, "quotedAt is in the future");
  if (message.deadline <= message.quotedAt) return reject(422, "deadline must follow quotedAt");
  if (config.allowlist && !config.allowlist.has(message.account)) return reject(403, "account is not on the signer allowlist");
  if (config.maxAmountIn !== null && message.amountIn > config.maxAmountIn) return reject(422, "amountIn exceeds the signer cap");

  const typedDomain = { name: "Perm", version: "2", chainId: config.chainId, verifyingContract: config.router };
  const signature = await config.account.signTypedData({ domain: typedDomain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message });
  const recovered = await recoverTypedDataAddress({ domain: typedDomain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message, signature });
  if (recovered !== config.account.address) return reject(500, "self-check failed");
  return {
    status: 200,
    body: { address: config.account.address, signature },
    // Audit line: enough to correlate with the onchain SwapSettled event, never the signature.
    audit: {
      at: new Date(now * 1000).toISOString(),
      account: message.account,
      tokenIn: message.tokenIn,
      tokenOut: message.tokenOut,
      amountIn: message.amountIn.toString(),
      minAmountOut: message.minAmountOut.toString(),
      deadline: message.deadline.toString(),
      routeHash: message.routeHash,
    },
  };
}
