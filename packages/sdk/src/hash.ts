import { keccak256, toHex } from "viem";
import type { GuardPayload, GuardRequest, QuoteInput, RouterIntent } from "./types.js";

function normalizeHexOrString(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^0x[0-9a-fA-F]*$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return normalizeHexOrString(value);
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      if (obj[k] !== undefined) {
        out[k] = canonicalizeValue(obj[k]);
      }
    }
    return out;
  }
  return String(value);
}

function pickCanonicalQuote(quote?: QuoteInput): Record<string, unknown> | null {
  if (!quote) return null;
  return {
    asset: normalizeHexOrString(quote.asset),
    payTo: normalizeHexOrString(quote.payTo),
    amount: String(quote.amount ?? ""),
    chainId: quote.chainId !== undefined ? Number(quote.chainId) : null,
  };
}

function pickCanonicalIntent(intent?: RouterIntent): Record<string, unknown> | null {
  if (!intent) return null;
  return {
    chainId: Number(intent.chainId),
    to: normalizeHexOrString(intent.to),
    function: intent.function,
    args: canonicalizeValue(intent.args ?? []),
    value: String(intent.value ?? "0"),
  };
}

function pickCanonicalPayload(payload?: GuardPayload): Record<string, unknown> | null {
  if (!payload) return null;
  const authorization = payload.authorization
    ? {
        kind: payload.authorization.kind ?? "TransferWithAuthorization",
        from: normalizeHexOrString(payload.authorization.from),
        to: normalizeHexOrString(payload.authorization.to),
        value: String(payload.authorization.value ?? ""),
        validAfter:
          payload.authorization.validAfter !== undefined
            ? String(payload.authorization.validAfter)
            : "0",
        validBefore:
          payload.authorization.validBefore !== undefined
            ? String(payload.authorization.validBefore)
            : null,
        nonce: normalizeHexOrString(payload.authorization.nonce ?? ""),
      }
    : null;

  const tx =
    typeof payload.tx === "string"
      ? normalizeHexOrString(payload.tx)
      : payload.tx && typeof payload.tx === "object"
        ? {
            from: normalizeHexOrString(payload.tx.from ?? ""),
            to: normalizeHexOrString(payload.tx.to),
            data: normalizeHexOrString(payload.tx.data ?? "0x"),
            value: String(payload.tx.value ?? "0"),
            chainId: payload.tx.chainId !== undefined ? Number(payload.tx.chainId) : null,
          }
        : null;

  return {
    type: payload.type,
    authorization,
    tx,
    intent: pickCanonicalIntent(payload.intent),
  };
}

/**
 * Computes the deterministic canonical payload hash (§4.5 & §5.2 Dev Brief).
 * Unknown top-level or nested fields are ignored and NEVER mutate payload_hash.
 */
export function computePayloadHash(
  input: Pick<GuardRequest, "network" | "quote" | "payload" | "token">
): `0x${string}` {
  const canonical = canonicalizeValue({
    network: normalizeHexOrString(input.network ?? ""),
    quote: pickCanonicalQuote(input.quote),
    payload: pickCanonicalPayload(input.payload),
    token: input.token ? normalizeHexOrString(input.token) : null,
  });
  return keccak256(toHex(JSON.stringify(canonical)));
}

/**
 * Computes deterministic commitment hashes for ZK publicInputs (§8.3) so raw intent/quote
 * parameters remain private off-chain while commitments are bound on-chain.
 */
export function canonicalQuoteAndTxJson(
  input: Pick<GuardRequest, "network" | "quote" | "payload">
): { quoteJson: string; txJson: string } {
  const quoteCanonical = canonicalizeValue({
    network: normalizeHexOrString(input.network ?? ""),
    quote: pickCanonicalQuote(input.quote),
    intent: pickCanonicalIntent(input.payload?.intent),
  });
  const txCanonical = canonicalizeValue({
    network: normalizeHexOrString(input.network ?? ""),
    payload: pickCanonicalPayload(input.payload),
  });
  return { quoteJson: JSON.stringify(quoteCanonical), txJson: JSON.stringify(txCanonical) };
}

/** quoteHash/txHash = keccak256(utf8(canonical JSON)). The SP1 guest hashes the same bytes (zk/quote-rules). */
export function computeQuoteAndTxCommitments(
  input: Pick<GuardRequest, "network" | "quote" | "payload">
): { quoteHash: `0x${string}`; txHash: `0x${string}` } {
  const { quoteJson, txJson } = canonicalQuoteAndTxJson(input);
  return {
    quoteHash: keccak256(toHex(quoteJson)),
    txHash: keccak256(toHex(txJson)),
  };
}
