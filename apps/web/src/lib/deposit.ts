/**
 * Browser top-up for x402 *deposit* settlement (gap X402-4 / I9 #17).
 *
 * The wallet itself sends a USDG `transfer(payTo, amount)`, then signs (EIP-191) the claim message that
 * binds the tx to the payer. The API credits only `Transfer(from = claim signer, to = payTo)` logs after
 * `minConfirmations`. No private key ever leaves the wallet, and nothing is signed until the user clicks.
 */

export interface Eip1193Like {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface DepositRails {
  chainId: number;
  network: string;
  payTo: string;
  usdgAddress: string;
  minConfirmations: number;
}

export type DepositStep =
  | "config"
  | "transfer"
  | "sign"
  | "mined"
  | "confirmations"
  | "claim"
  | "done";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** Must match `depositClaimMessage` in @zguard/sdk (payment-claim.ts) byte for byte. */
export function depositClaimMessage(txHash: string, chainId: number | string): string {
  return `ZGuard credit claim\ntx:${txHash.trim().toLowerCase()}\nchain:${String(chainId).trim()}`;
}

/** "0.10" USDG → 100000 micro-USDG (6 decimals). Rejects more than 6 decimals, negatives, junk. */
export function parseUsdgToMicro(input: string): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error("Amount must be a positive USDG number with at most 6 decimals");
  const [whole, frac = ""] = s.split(".");
  const micro = BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  if (micro <= 0n) throw new Error("Amount must be greater than 0");
  return micro;
}

export function formatMicroUsdg(micro: bigint | string): string {
  const v = BigInt(micro);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** ABI-encodes ERC-20 `transfer(address,uint256)`. */
export function encodeErc20Transfer(to: string, amountMicro: bigint): string {
  if (!ADDR_RE.test(to)) throw new Error(`Invalid recipient address ${to}`);
  if (amountMicro <= 0n) throw new Error("Amount must be greater than 0");
  const addr = to.slice(2).toLowerCase().padStart(64, "0");
  const amt = amountMicro.toString(16).padStart(64, "0");
  return `0xa9059cbb${addr}${amt}`;
}

export function utf8ToHex(text: string): string {
  return "0x" + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildDepositXPayment(network: string, txHash: string, claimSignature: string): string {
  return JSON.stringify({ network, payload: { txHash, claimSignature } });
}

/** Reads the live payment rails from `/v1/config`; refuses unless the API runs in deposit mode with a valid payTo. */
export function railsFromConfig(cfg: Record<string, unknown>): DepositRails {
  const rails = (cfg.paymentRails ?? {}) as Record<string, unknown>;
  const mode = String(rails.effectiveSettlementMode ?? "");
  if (mode !== "deposit") {
    throw new Error(
      mode === "unavailable"
        ? `Payments are unavailable on this deployment: ${String(rails.settlementError ?? "misconfigured")}`
        : `This deployment settles in "${mode}" mode; the browser top-up only supports deposit mode`
    );
  }
  const payTo = String(rails.payTo ?? "");
  const usdgAddress = String(rails.usdgAddress ?? "");
  if (!ADDR_RE.test(payTo)) throw new Error("Deployment has no valid payTo treasury address; payment refused");
  if (!ADDR_RE.test(usdgAddress)) throw new Error("Deployment config has no USDG address");
  return {
    chainId: Number(cfg.chainId),
    network: String(cfg.network ?? `eip155:${String(cfg.chainId)}`),
    payTo,
    usdgAddress,
    minConfirmations: Math.max(0, Number(rails.minConfirmations ?? 3)),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DepositTopUpResult {
  txHash: string;
  apiKey: string;
  creditMicroUsdg: string;
  creditedMicroUsdg: bigint;
}

/**
 * Full deposit top-up: transfer → sign claim → wait for receipt + confirmations → POST /v1/register with
 * X-PAYMENT. Returns the new tenant key holding (free credit +) the paid credit.
 */
export async function topUpWithUsdgDeposit(params: {
  provider: Eip1193Like;
  walletAddress: string;
  walletChainId: number | null;
  amountMicro: bigint;
  fetchImpl?: typeof fetch;
  onStep?: (step: DepositStep, detail?: string) => void;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<DepositTopUpResult> {
  const f = params.fetchImpl ?? fetch;
  const step = params.onStep ?? (() => {});
  const pollMs = params.pollMs ?? 1500;
  const deadline = Date.now() + (params.timeoutMs ?? 240_000);
  const eth = params.provider;

  step("config");
  const cfgResp = await f("/v1/config");
  if (!cfgResp.ok) throw new Error(`GET /v1/config returned ${cfgResp.status}`);
  const rails = railsFromConfig((await cfgResp.json()) as Record<string, unknown>);
  if (params.walletChainId !== rails.chainId) {
    throw new Error(`Wallet is on chain ${params.walletChainId ?? "?"}; switch to ${rails.chainId} first`);
  }

  step("transfer", `${formatMicroUsdg(params.amountMicro)} USDG → ${rails.payTo}`);
  const txHash = String(
    await eth.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: params.walletAddress,
          to: rails.usdgAddress,
          data: encodeErc20Transfer(rails.payTo, params.amountMicro),
          value: "0x0",
        },
      ],
    })
  );
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error(`Wallet returned an invalid tx hash: ${txHash}`);

  // The claim only depends on the tx hash, so sign right away while the user is at the wallet.
  step("sign", txHash);
  const claimSignature = String(
    await eth.request({
      method: "personal_sign",
      params: [utf8ToHex(depositClaimMessage(txHash, rails.chainId)), params.walletAddress],
    })
  );

  let minedBlock: bigint | null = null;
  while (minedBlock === null) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${txHash} to be mined`);
    const receipt = (await eth.request({ method: "eth_getTransactionReceipt", params: [txHash] })) as {
      status?: string;
      blockNumber?: string;
    } | null;
    if (receipt?.blockNumber) {
      if (receipt.status !== "0x1") throw new Error(`USDG transfer reverted (tx ${txHash})`);
      minedBlock = BigInt(receipt.blockNumber);
      step("mined", String(minedBlock));
      break;
    }
    await sleep(pollMs);
  }

  // One extra block of margin: the API checks confirmations against its own RPC head.
  const need = BigInt(rails.minConfirmations + 1);
  for (;;) {
    const head = BigInt(String(await eth.request({ method: "eth_blockNumber" })));
    const conf = head - minedBlock + 1n;
    step("confirmations", `${conf.toString()}/${rails.minConfirmations}`);
    if (conf >= need) break;
    if (Date.now() > deadline) throw new Error("Timed out waiting for confirmations");
    await sleep(pollMs);
  }

  step("claim");
  const xPayment = buildDepositXPayment(rails.network, txHash, claimSignature);
  for (let attempt = 0; ; attempt++) {
    const resp = await f("/v1/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PAYMENT": xPayment },
      body: "{}",
    });
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.status === 201 && typeof data.apiKey === "string") {
      step("done", String(data.creditMicroUsdg));
      return {
        txHash,
        apiKey: data.apiKey,
        creditMicroUsdg: String(data.creditMicroUsdg ?? "0"),
        creditedMicroUsdg: params.amountMicro,
      };
    }
    const err = String(data.error ?? `HTTP ${resp.status}`);
    // Only a confirmation-count lag is worth one retry; every other rejection is final.
    if (attempt === 0 && /confirmation/i.test(err)) {
      await sleep(Math.max(pollMs * 2, 3000));
      continue;
    }
    throw new Error(`Claim rejected: ${err} (tx ${txHash})`);
  }
}
