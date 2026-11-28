/**
 * Halo2-KZG attestation path (brief §8.3 path 2, gap H7 → H5 integration).
 *
 *   API decision ──► buildHalo2Job (canonical JSON + hints, same as the SP1 guest input)
 *                ──► dispatchHalo2Prover (GitHub repository_dispatch → .github/workflows/halo2-prover.yml)
 *   worker       ──► `zguard-halo2 prove-jobs` (packages/zk/halo2-quote-circuit) ──► POST proof to the API
 *   API          ──► verifyHalo2Proof: eth_call ZGuardHalo2QuoteVerifier.verifyQuote → `proven`
 *                ──► checkHalo2RecordTx: receipt of verifyAndRecord with our decisionId → `verified`
 *
 * Nothing here trusts the worker: the API re-derives the expected public values from its own decision and
 * accepts a proof only if the onchain verifier returns exactly those bytes.
 */
import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { canonicalQuoteAndTxJson, type Decision, type GuardRequest, type ReasonCode } from "@zguard/sdk";
import { HALO2_VERIFIER_CODEHASH, ZGUARD_HALO2_VERIFIER_ABI } from "./halo2-artifact.js";

export {
  HALO2_VERIFIER_BYTECODE,
  HALO2_VERIFIER_CODEHASH,
  HALO2_VERIFIER_DEPLOYED_BYTECODE,
  ZGUARD_HALO2_VERIFIER_ABI,
  ZGUARD_HALO2_VERIFIER_BYTECODE,
} from "./halo2-artifact.js";

/** Region sizes of the circuit (`MAX_QUOTE` / `MAX_TX` in lib.rs); JSON must be strictly shorter. */
export const HALO2_MAX_QUOTE_BYTES = 279;
export const HALO2_MAX_TX_BYTES = 496;
export const HALO2_DISPATCH_EVENT = "halo2-prove";

/**
 * Regex mirror of the circuit's canonical-JSON automaton (`halo2-quote-circuit/src/template.rs`).
 * Used only to decide coverage up front; the circuit itself is the authority (the prover re-checks).
 */
const QUOTE_RE =
  /^\{"intent":null,"network":"eip155:[0-9]+","quote":\{"amount":"[0-9]{1,38}","asset":"0x[0-9a-f]{40}","chainId":"[0-9]+","payTo":"0x[0-9a-f]{40}"\}\}$/;
const TX_RE =
  /^\{"network":"eip155:[0-9]+","payload":\{"authorization":\{"from":"0x[0-9a-f]{40}","kind":"(TransferWithAuthorization|ReceiveWithAuthorization)","nonce":"(0x[0-9a-f]*)?","to":"0x[0-9a-f]{40}","validAfter":"[0-9]+","validBefore":(null|"[0-9]+"),"value":"[0-9]{1,38}"\},"intent":null,"tx":null,"type":"eip3009"\}\}$/;

export interface Halo2Hints {
  asset_mismatch: boolean;
  chain_mismatch: boolean;
  unexpected_approval: boolean;
  domain_verified: boolean;
}

/** Prover input stored with the attestation (internal: never returned by public endpoints). */
export interface Halo2Job {
  quoteJson: string;
  txJson: string;
  hints: Halo2Hints;
  /** 1 allow, 2 deny, 3 abstain (quote-rules encoding). */
  verdict: 1 | 2 | 3;
  /** quote-rules bitmask (Q-001 0x01 … Q-007 0x40). */
  mask: number;
  requestedAt: string;
  dispatches?: number;
}

export type Halo2Coverage = { covered: true } | { covered: false; reason: string };

export function halo2Coverage(quoteJson: string, txJson: string): Halo2Coverage {
  const qLen = toBytes(quoteJson).length;
  const tLen = toBytes(txJson).length;
  if (qLen >= HALO2_MAX_QUOTE_BYTES) return { covered: false, reason: `quote JSON is ${qLen} bytes (max ${HALO2_MAX_QUOTE_BYTES - 1})` };
  if (tLen >= HALO2_MAX_TX_BYTES) return { covered: false, reason: `tx JSON is ${tLen} bytes (max ${HALO2_MAX_TX_BYTES - 1})` };
  if (!QUOTE_RE.test(quoteJson)) return { covered: false, reason: "quote is not a complete eip3009 quote (Q-005 / missing fields)" };
  if (!TX_RE.test(txJson)) return { covered: false, reason: "payload is not a canonical eip3009 authorization (other rail / Q-DECODE)" };
  return { covered: true };
}

const CIRCUIT_CODES: Partial<Record<ReasonCode, number>> = {
  "Q-001": 0x01,
  "Q-002": 0x02,
  "Q-003": 0x04,
  "Q-004": 0x08,
  "Q-006": 0x20,
  "Q-007": 0x40,
};
const VERDICT_CODE: Record<Decision, 1 | 2 | 3> = { allow: 1, deny: 2, abstain: 3 };

/**
 * Builds the prover job for a quote decision, or explains why the Halo2 circuit cannot attest it.
 * The circuit's verdict formula is quote-rules': deny if Q-001/002/003/004/006, else abstain if Q-007,
 * else allow. A decision that differs (policy codes, decode errors) is reported as not coverable.
 */
export function buildHalo2Job(
  request: Pick<GuardRequest, "network" | "quote" | "payload">,
  quoteCodes: ReasonCode[],
  quoteVerdict: Decision,
  now: Date = new Date()
): { job: Halo2Job } | { unsupported: string } {
  let quoteJson: string;
  let txJson: string;
  try {
    ({ quoteJson, txJson } = canonicalQuoteAndTxJson(request));
  } catch (e) {
    return { unsupported: `canonical JSON failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const cov = halo2Coverage(quoteJson, txJson);
  if (!cov.covered) return { unsupported: cov.reason };
  const foreign = quoteCodes.filter((c) => CIRCUIT_CODES[c] === undefined);
  if (foreign.length) return { unsupported: `codes outside the circuit: ${foreign.join(",")}` };

  const mask = quoteCodes.reduce((m, c) => m | (CIRCUIT_CODES[c] ?? 0), 0);
  const denied = (mask & 0x2f) !== 0;
  const circuitVerdict: 1 | 2 | 3 = denied ? 2 : mask & 0x40 ? 3 : 1;
  // quote-rules only sets Q-007 when nothing denies; mirror that so the mask matches the circuit's.
  const circuitMask = denied ? mask & ~0x40 : mask;
  if (circuitVerdict !== VERDICT_CODE[quoteVerdict] || circuitMask !== mask) {
    return { unsupported: `decision ${quoteVerdict} [${quoteCodes.join(",")}] is not the circuit's quote-rules verdict` };
  }
  return {
    job: {
      quoteJson,
      txJson,
      hints: {
        asset_mismatch: quoteCodes.includes("Q-003"),
        chain_mismatch: quoteCodes.includes("Q-004"),
        unexpected_approval: quoteCodes.includes("Q-006"),
        domain_verified: !quoteCodes.includes("Q-007"),
      },
      verdict: circuitVerdict,
      mask,
      requestedAt: now.toISOString(),
    },
  };
}

/** The 160-byte public values `verifyQuote` returns (identical layout to the SP1 path). */
export function halo2PublicValues(job: Pick<Halo2Job, "quoteJson" | "txJson" | "verdict" | "mask">): Hex {
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint32" }],
    [keccak256(toHex("quote")), keccak256(toHex(job.quoteJson)), keccak256(toHex(job.txJson)), job.verdict, job.mask]
  );
}

export const halo2DecisionKey = (decisionId: string): Hex => keccak256(toHex(decisionId));

/** Minimal client surface (viem PublicClient compatible, mockable). */
export interface Halo2ChainClient {
  readContract(args: { address: Address; abi: typeof ZGUARD_HALO2_VERIFIER_ABI; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    status: "success" | "reverted";
    gasUsed: bigint;
    logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[];
  }>;
}

/** Checks that `wrapper` points at a Halo2Verifier whose runtime code is exactly our circuit's verifier. */
export async function checkHalo2Deployment(client: Halo2ChainClient, wrapper: Address): Promise<{ ok: boolean; halo2Verifier?: Address; note: string }> {
  try {
    const inner = (await client.readContract({ address: wrapper, abi: ZGUARD_HALO2_VERIFIER_ABI, functionName: "halo2Verifier" })) as Address;
    const code = await client.getBytecode({ address: inner });
    if (!code || code === "0x") return { ok: false, halo2Verifier: inner, note: "halo2Verifier has no code" };
    const hash = keccak256(code);
    if (hash.toLowerCase() !== HALO2_VERIFIER_CODEHASH.toLowerCase()) {
      return { ok: false, halo2Verifier: inner, note: `halo2Verifier codehash ${hash} != ${HALO2_VERIFIER_CODEHASH}` };
    }
    return { ok: true, halo2Verifier: inner, note: "codehash matches the circuit's generated verifier" };
  } catch (e) {
    return { ok: false, note: `wrapper unreadable: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` };
  }
}

/** eth_call `verifyQuote`; ok only if the verifier returns exactly the public values we committed to. */
export async function verifyHalo2Proof(
  client: Halo2ChainClient,
  wrapper: Address,
  job: Pick<Halo2Job, "quoteJson" | "txJson" | "verdict" | "mask">,
  proof: Hex
): Promise<{ ok: true; publicValues: Hex } | { ok: false; note: string }> {
  const expected = halo2PublicValues(job).toLowerCase();
  try {
    const out = (await client.readContract({
      address: wrapper,
      abi: ZGUARD_HALO2_VERIFIER_ABI,
      functionName: "verifyQuote",
      args: [toHex(job.quoteJson), toHex(job.txJson), job.verdict, job.mask, proof],
    })) as Hex;
    if (out.toLowerCase() !== expected) return { ok: false, note: "verifier returned different public values" };
    return { ok: true, publicValues: out };
  } catch (e) {
    return { ok: false, note: `verifier rejected the proof: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` };
  }
}

/** A `verifyAndRecord` receipt counts only if it succeeded and the wrapper emitted our decision key. */
export async function checkHalo2RecordTx(
  client: Halo2ChainClient,
  wrapper: Address,
  decisionId: string,
  txHash: Hex,
  job: Pick<Halo2Job, "quoteJson" | "txJson" | "verdict" | "mask">
): Promise<{ ok: true; gasUsed: string } | { ok: false; note: string }> {
  try {
    const r = await client.getTransactionReceipt({ hash: txHash });
    if (r.status !== "success") return { ok: false, note: "record tx reverted" };
    const key = halo2DecisionKey(decisionId).toLowerCase();
    for (const log of r.logs) {
      if (log.address.toLowerCase() !== wrapper.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: ZGUARD_HALO2_VERIFIER_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName !== "QuoteVerdictVerified") continue;
        const a = ev.args as unknown as { decisionId: Hex; quoteHash: Hex; txHash: Hex; verdict: number; ruleBitmask: number };
        if (
          a.decisionId.toLowerCase() === key &&
          a.quoteHash.toLowerCase() === keccak256(toHex(job.quoteJson)).toLowerCase() &&
          a.txHash.toLowerCase() === keccak256(toHex(job.txJson)).toLowerCase() &&
          Number(a.verdict) === job.verdict &&
          Number(a.ruleBitmask) === job.mask
        ) {
          return { ok: true, gasUsed: r.gasUsed.toString() };
        }
      } catch {
        /* not our event */
      }
    }
    return { ok: false, note: "record tx has no matching QuoteVerdictVerified event from the wrapper" };
  } catch (e) {
    return { ok: false, note: `record tx not found: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` };
  }
}

/** Triggers the GitHub Actions prover (repository_dispatch). Needs a token with Contents: write on `repo`. */
export async function dispatchHalo2Prover(opts: {
  repo: string;
  token: string;
  decisionId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ ok: boolean; note: string }> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) return { ok: false, note: "invalid dispatch repo" };
  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://api.github.com/repos/${opts.repo}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
        "User-Agent": "zguard-api",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ event_type: HALO2_DISPATCH_EVENT, client_payload: { decisionId: opts.decisionId } }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    return res.status === 204 ? { ok: true, note: "prover dispatched" } : { ok: false, note: `dispatch HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, note: `dispatch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
