import { decodeFunctionData, getAbiItem, getAddress, isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { permRouterAbi } from "@/lib/web3/abis";

/**
 * ZGuard default-on gate for Perm swaps (ZGuard gap C8 / brief §9.5).
 *
 * This module is shared by the browser (TradeApp) and the server route (/api/zguard), so both
 * sides build the guard request from the SAME bytes with the SAME code. The browser then checks
 * that ZGuard's `payload_hash` equals the hash of the exact transaction it is about to send.
 *
 * `computeZGuardPayloadHash` is a byte-for-byte port of `computePayloadHash` in
 * `@zguard/sdk` (packages/sdk/src/hash.ts). `scripts/test-zguard-gate.ts` pins it to a vector
 * produced by the ZGuard SDK; if ZGuard changes its canonical form, that test fails.
 */

export const ZGUARD_SWAP_FUNCTION = "swapExactInput" as const;
export const ZGUARD_CHECKS = ["quote", "simulation", "token_risk"] as const;
const ZERO = "0x0000000000000000000000000000000000000000";

const swapAbiItem = getAbiItem({ abi: permRouterAbi, name: ZGUARD_SWAP_FUNCTION });

export type ZGuardSwapTx = {
  chainId: number;
  router: Address;
  from: Address;
  data: Hex;
  value: bigint;
};

export type ZGuardGuardRequest = {
  network: string;
  token: string;
  checks: string[];
  payload: {
    type: "intent";
    tx: { from: string; to: string; data: string; value: string; chainId: number };
    intent: {
      chainId: number;
      to: string;
      function: string;
      abi: unknown[];
      args: unknown[];
      value: string;
      from: string;
      expectedOut: { token: string; recipient: string; minAmountOut: string };
    };
  };
};

export type ZGuardReceipt = {
  decisionId?: string;
  decision: "allow" | "deny" | "abstain" | string;
  reason?: string;
  codes?: string[];
  payload_hash: string;
  expires_at: string | null;
  network?: string;
};

export class ZGuardRequestError extends Error {}

/** ABI values → JSON-safe positional values (bigint → decimal string, tuples → arrays in ABI order). */
function toJsonArg(value: unknown, components?: readonly { name?: string; components?: readonly unknown[] }[]): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map((item, index) => toJsonArg(item, components?.[index]?.components as never));
  if (value && typeof value === "object") {
    if (!components) throw new ZGuardRequestError("Unexpected tuple without ABI components");
    const record = value as Record<string, unknown>;
    return components.map((component) => {
      if (!component.name || !(component.name in record)) throw new ZGuardRequestError("Tuple field missing in decoded calldata");
      return toJsonArg(record[component.name], component.components as never);
    });
  }
  return value;
}

/**
 * Builds the ZGuard /v1/guard request for a Perm Router swap from the raw transaction bytes.
 * Throws when the bytes are not a `swapExactInput` call for this chain, so the server route
 * cannot be used to spend ZGuard credit on arbitrary transactions.
 */
export function buildZGuardSwapRequest(tx: ZGuardSwapTx): ZGuardGuardRequest {
  if (!Number.isSafeInteger(tx.chainId) || tx.chainId <= 0) throw new ZGuardRequestError("Invalid chain id");
  if (!isAddress(tx.router) || getAddress(tx.router) === ZERO) throw new ZGuardRequestError("Invalid router address");
  if (!isAddress(tx.from) || getAddress(tx.from) === ZERO) throw new ZGuardRequestError("Invalid sender address");
  if (typeof tx.data !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(tx.data)) throw new ZGuardRequestError("Invalid calldata");
  if (typeof tx.value !== "bigint" || tx.value < 0n) throw new ZGuardRequestError("Invalid value");

  let decoded;
  try {
    decoded = decodeFunctionData({ abi: permRouterAbi, data: tx.data });
  } catch {
    throw new ZGuardRequestError("Calldata is not a Perm Router call");
  }
  if (decoded.functionName !== ZGUARD_SWAP_FUNCTION) throw new ZGuardRequestError("Only swapExactInput is guarded through this route");

  const [request] = decoded.args as unknown as [{
    tokenIn: Address; tokenOut: Address; amountIn: bigint; minAmountOut: bigint; recipient: Address; chainId: bigint;
  }];
  if (request.chainId !== BigInt(tx.chainId)) throw new ZGuardRequestError("Swap request chain id does not match the network");
  const nativeIn = getAddress(request.tokenIn) === ZERO;
  if (nativeIn ? tx.value !== request.amountIn : tx.value !== 0n) throw new ZGuardRequestError("Transaction value does not match the swap input");

  const args = toJsonArg(decoded.args, swapAbiItem.inputs as never) as unknown[];
  const router = getAddress(tx.router);
  const from = getAddress(tx.from);
  const value = tx.value.toString(10);
  const tokenOut = getAddress(request.tokenOut);
  const riskToken = tokenOut !== ZERO ? tokenOut : getAddress(request.tokenIn);

  return {
    network: `eip155:${tx.chainId}`,
    token: riskToken,
    checks: [...ZGUARD_CHECKS],
    payload: {
      type: "intent",
      tx: { from, to: router, data: tx.data, value, chainId: tx.chainId },
      intent: {
        chainId: tx.chainId,
        to: router,
        function: ZGUARD_SWAP_FUNCTION,
        abi: [swapAbiItem],
        args,
        value,
        from,
        expectedOut: { token: tokenOut, recipient: getAddress(request.recipient), minAmountOut: request.minAmountOut.toString(10) },
      },
    },
  };
}

// ---- Port of @zguard/sdk computePayloadHash (packages/sdk/src/hash.ts) ----

function normalizeHexOrString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]*$/.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return normalizeHexOrString(value);
  if (Array.isArray(value)) return value.map((item) => canonicalizeValue(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) out[key] = canonicalizeValue(record[key]);
    }
    return out;
  }
  return String(value);
}

/** Same canonical form as ZGuard: network, quote (null for Perm), payload {type, authorization, tx, intent}, token. */
export function computeZGuardPayloadHash(request: Pick<ZGuardGuardRequest, "network" | "payload" | "token">): Hex {
  const { payload } = request;
  const tx = payload.tx;
  const intent = payload.intent;
  const canonical = canonicalizeValue({
    network: normalizeHexOrString(request.network ?? ""),
    quote: null,
    payload: {
      type: payload.type,
      authorization: null,
      tx: {
        from: normalizeHexOrString(tx.from ?? ""),
        to: normalizeHexOrString(tx.to),
        data: normalizeHexOrString(tx.data ?? "0x"),
        value: String(tx.value ?? "0"),
        chainId: tx.chainId !== undefined ? Number(tx.chainId) : null,
      },
      intent: {
        chainId: Number(intent.chainId),
        to: normalizeHexOrString(intent.to),
        function: intent.function,
        args: canonicalizeValue(intent.args ?? []),
        value: String(intent.value ?? "0"),
      },
    },
    token: request.token ? normalizeHexOrString(request.token) : null,
  });
  return keccak256(toHex(JSON.stringify(canonical)));
}

export type ZGuardVerdict =
  | { ok: true; decisionId?: string; expiresAt: string }
  | { ok: false; decision: string; codes: string[]; message: string };

/**
 * Fail-closed verdict check, mirroring `verifyReceiptForSigning` in @zguard/sdk:
 * only a non-expired `allow` whose payload_hash equals the local hash may reach the wallet.
 * `abstain` is never permission.
 */
export function evaluateZGuardReceipt(receipt: unknown, expectedHash: Hex, nowMs = Date.now()): ZGuardVerdict {
  if (!receipt || typeof receipt !== "object") {
    return { ok: false, decision: "missing", codes: [], message: "ZGuard returned no verdict. The swap was not sent." };
  }
  const r = receipt as ZGuardReceipt;
  const codes = Array.isArray(r.codes) ? r.codes.filter((code): code is string => typeof code === "string") : [];
  const codeText = codes.length ? ` [${codes.join(", ")}]` : "";
  if (typeof r.payload_hash !== "string" || r.payload_hash.toLowerCase() !== expectedHash.toLowerCase()) {
    return { ok: false, decision: "mismatch", codes, message: "ZGuard checked a different transaction than the one about to be signed (payload_hash mismatch). The swap was not sent." };
  }
  if (r.decision === "deny") {
    return { ok: false, decision: "deny", codes, message: `ZGuard blocked this swap${codeText}: ${r.reason || "denied"}` };
  }
  if (r.decision !== "allow") {
    return { ok: false, decision: String(r.decision || "abstain"), codes, message: `ZGuard could not confirm this swap is safe${codeText}: ${r.reason || "abstain"}. Abstain is not permission; the swap was not sent.` };
  }
  const expiry = typeof r.expires_at === "string" ? Date.parse(r.expires_at) : Number.NaN;
  if (!Number.isFinite(expiry) || nowMs >= expiry) {
    return { ok: false, decision: "expired", codes, message: "The ZGuard verdict expired before signing. Press Swap again for a fresh check." };
  }
  return { ok: true, decisionId: r.decisionId, expiresAt: r.expires_at as string };
}
