/**
 * Wallets (MetaMask, Rabby, …) reject with plain EIP-1193 error objects `{ code, message, data }`, not
 * `Error` instances, so `String(err)` renders "[object Object]". This turns any of them into readable text.
 */
export function walletErrorCode(err: unknown): number | null {
  const e = err as { code?: unknown; data?: { code?: unknown; originalError?: { code?: unknown } } } | null;
  const raw = e?.code ?? e?.data?.originalError?.code ?? e?.data?.code;
  return typeof raw === "number" ? raw : null;
}

function rawMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as {
      shortMessage?: unknown;
      message?: unknown;
      reason?: unknown;
      data?: { message?: unknown; originalError?: { message?: unknown } };
      error?: { message?: unknown };
    };
    for (const m of [e.shortMessage, e.data?.originalError?.message, e.data?.message, e.error?.message, e.reason, e.message]) {
      if (typeof m === "string" && m.trim()) return m.trim();
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json.slice(0, 300);
    } catch {
      // circular → fall through
    }
  }
  return String(err);
}

export function describeWalletError(err: unknown): string {
  const code = walletErrorCode(err);
  const msg = rawMessage(err);
  if (code === 4001 || /user (rejected|denied)/i.test(msg)) return "Rejected in wallet.";
  if (code === 4100) return "The wallet has not authorized this site/account. Reconnect the wallet and retry.";
  if (code === 4902) return "This network is not added to the wallet yet. Add RHC Testnet (chain 46630) manually.";
  if (code === -32002) return "A wallet request is already pending. Open the wallet extension and finish it.";
  if (code === -32603 || /failed to fetch|could not (fetch|connect)|network error|unable to connect/i.test(msg)) {
    return `The wallet could not reach the chain RPC (${msg}). In the wallet, switch the network's RPC URL or retry.`;
  }
  if (/insufficient funds/i.test(msg)) return `Not enough ETH for gas on this network (${msg}).`;
  if (/transfer amount exceeds balance|exceeds balance|execution reverted/i.test(msg)) {
    return `The transfer would fail onchain, most likely not enough USDG in this wallet (${msg}).`;
  }
  return code !== null ? `${msg} (code ${code})` : msg;
}
