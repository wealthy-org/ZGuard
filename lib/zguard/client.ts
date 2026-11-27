import type { Address, Hex } from "viem";
import {
  buildZGuardSwapRequest,
  computeZGuardPayloadHash,
  evaluateZGuardReceipt,
  type ZGuardVerdict,
} from "@/lib/zguard/request";

export type ZGuardStatus = {
  mode: "enforce" | "off";
  ready: boolean;
  network: string;
  problem: string | null;
};

/** Unknown or unreachable status is treated as enforce (fail-closed), never as off. */
export async function fetchZGuardStatus(fetchImpl: typeof fetch = fetch): Promise<ZGuardStatus> {
  try {
    const response = await fetchImpl("/api/zguard", { cache: "no-store" });
    const body = (await response.json()) as Partial<ZGuardStatus>;
    return {
      mode: body.mode === "off" ? "off" : "enforce",
      ready: body.mode === "off" ? false : body.ready === true,
      network: typeof body.network === "string" ? body.network : "",
      problem: typeof body.problem === "string" ? body.problem : null,
    };
  } catch {
    return { mode: "enforce", ready: false, network: "", problem: "ZGuard status is unavailable" };
  }
}

export type GuardedSwapResult =
  | { verdict: Extract<ZGuardVerdict, { ok: true }>; mode: "enforce" }
  | { verdict: { ok: true }; mode: "off" };

export class ZGuardBlockedError extends Error {
  constructor(message: string, readonly decision: string, readonly codes: string[] = []) {
    super(message);
    this.name = "ZGuardBlockedError";
  }
}

/**
 * Asks ZGuard about the exact swap bytes and returns only if they may be signed.
 * Throws ZGuardBlockedError for deny / abstain / mismatch / expiry / any transport error.
 * The only path that skips the check is an explicit server-side PERM_ZGUARD_MODE=off.
 */
export async function guardPermSwap(
  tx: { chainId: number; router: Address; from: Address; data: Hex; value: bigint },
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): Promise<GuardedSwapResult> {
  // Build locally first: the same builder runs on the server, and its hash is what we sign against.
  const local = buildZGuardSwapRequest(tx);
  const expectedHash = computeZGuardPayloadHash(local);

  let response: Response;
  try {
    response = await fetchImpl("/api/zguard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ from: tx.from, to: tx.router, data: tx.data, value: tx.value.toString(10) }),
    });
  } catch {
    throw new ZGuardBlockedError("ZGuard could not be reached. The swap was not sent.", "unreachable");
  }

  let body: { mode?: string; receipt?: unknown; error?: string } = {};
  try {
    body = await response.json();
  } catch {
    /* handled below */
  }

  if (response.status === 409 && body.mode === "off") {
    return { verdict: { ok: true }, mode: "off" };
  }
  if (!response.ok) {
    throw new ZGuardBlockedError(`${body.error || `ZGuard check failed (HTTP ${response.status})`}. The swap was not sent.`, "unavailable");
  }

  const verdict = evaluateZGuardReceipt(body.receipt, expectedHash, nowMs());
  if (!verdict.ok) throw new ZGuardBlockedError(verdict.message, verdict.decision, verdict.codes);
  return { verdict, mode: "enforce" };
}
