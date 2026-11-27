import type { Hex } from "viem";

type RecoveryOptions = {
  submit: () => Promise<Hex>;
  findCanonicalHash: () => Promise<Hex | undefined>;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

function abortError() {
  const error = new Error("Canonical transaction recovery was cancelled");
  error.name = "AbortError";
  return error;
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", cancelled, { once: true });

    function done() {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      reject(abortError());
    }
  });
}

async function waitForCanonicalHash(
  findCanonicalHash: () => Promise<Hex | undefined>,
  signal: AbortSignal,
  timeoutMs: number,
  pollIntervalMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw abortError();
    const hash = await findCanonicalHash();
    if (hash) return hash;
    await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), signal);
  }
  throw new Error("Wallet response timed out and no canonical settlement was found. Check the wallet or explorer before retrying.");
}

export async function submitWalletTransactionWithRecovery({
  submit,
  findCanonicalHash,
  timeoutMs = 120_000,
  pollIntervalMs = 1_500,
}: RecoveryOptions): Promise<Hex> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("Wallet transaction recovery timing is invalid");
  }
  const recovery = new AbortController();
  try {
    return await Promise.race([
      submit(),
      waitForCanonicalHash(findCanonicalHash, recovery.signal, timeoutMs, pollIntervalMs),
    ]);
  } finally {
    recovery.abort();
  }
}
