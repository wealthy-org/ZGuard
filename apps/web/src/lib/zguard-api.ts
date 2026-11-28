/**
 * Browser-safe live client for ZGuard `/v1/*` API (proxied via Next.js rewrites — never calls localhost directly).
 * Defaults to Robinhood Chain Testnet (`46630`) for zero-fee web testing, with seamless Mainnet (`4663`) switching.
 */

const STORAGE_KEY = "zguard_tenant_api_key_v1";

export interface RuntimeConfigSummary {
  chainId: number;
  network: string;
  isTestnet: boolean;
  chainName: string;
  explorerUrl: string;
  faucetUrl: string | null;
  zk?: {
    verifierAddress: string | null;
    onchainBroadcastEnabled: boolean;
    defaultSystem?: string;
    /** Halo2 attestation path (GitHub Actions prover + ZGuardHalo2QuoteVerifier). */
    halo2?: {
      workerReady: boolean;
      verifierAddress: string | null;
      dispatchConfigured: boolean;
    } | null;
  };
  sequencer?: {
    status: "up" | "down" | "grace_period";
    latestBlockNumber: string | null;
    blockAgeSeconds: number | null;
  } | null;
}

export interface TenantBalanceInfo {
  tenantId: string;
  apiKeyHint: string;
  creditMicroUsdg: string;
  totalSpentMicroUsdg?: string;
  asset: string;
  unit: string;
  network: string;
  chainId?: number;
}

export interface StoredReceiptItem {
  decisionId: string;
  endpoint: string;
  network: string;
  decision: "allow" | "deny" | "abstain";
  reason: string;
  codes: string[];
  flags: string[];
  payloadHash: string;
  expiresAt: string | null;
  chargedMicroUsdg: string;
  buybackMicroUsdg: string;
  response: Record<string, unknown>;
  createdAt: string;
}

export interface RegistryListingResponse {
  chainId: number;
  network: string;
  isTestnet: boolean;
  explorerUrl: string;
  canonical: {
    usdg: string;
    weth: string;
  };
  stockTokens: Array<{
    symbol: string;
    name: string;
    address: string;
    chainId: number;
  }>;
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  return eth ?? null;
}

export function getSavedApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setSavedApiKey(key: string | null): void {
  if (typeof window === "undefined") return;
  if (!key) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, key.trim());
  }
}

export async function fetchRuntimeConfig(): Promise<RuntimeConfigSummary | null> {
  const resp = await fetch("/v1/config").catch(() => null);
  if (!resp || !resp.ok) return null;
  return (await resp.json()) as RuntimeConfigSummary;
}

export async function fetchRegistryListing(
  chainId = 46630
): Promise<RegistryListingResponse | null> {
  const resp = await fetch(`/v1/registry?chainId=${chainId}`).catch(() => null);
  if (!resp || !resp.ok) return null;
  return (await resp.json()) as RegistryListingResponse;
}

export async function registerTenantKey(): Promise<{
  apiKey: string;
  tenantId: string;
  apiKeyHint: string;
  creditMicroUsdg: string;
}> {
  const resp = await fetch("/v1/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`POST /v1/register failed (${resp.status})`);
  }
  const data = (await resp.json()) as {
    apiKey: string;
    tenantId: string;
    apiKeyHint: string;
    creditMicroUsdg: string;
  };
  setSavedApiKey(data.apiKey);
  return data;
}

export async function ensureTenantApiKey(): Promise<string> {
  const existing = getSavedApiKey();
  if (existing) {
    const bal = await fetch("/v1/balance", {
      headers: { Authorization: `Bearer ${existing}` },
    }).catch(() => null);
    if (bal && bal.ok) {
      const json = (await bal.json()) as TenantBalanceInfo;
      if (BigInt(json.creditMicroUsdg || "0") >= 15000n) {
        return existing;
      }
    }
  }
  const fresh = await registerTenantKey();
  return fresh.apiKey;
}

export async function fetchTenantBalance(apiKey: string): Promise<TenantBalanceInfo> {
  const resp = await fetch("/v1/balance", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    throw new Error(`GET /v1/balance returned ${resp.status}`);
  }
  return (await resp.json()) as TenantBalanceInfo;
}

export async function fetchTenantReceipts(apiKey?: string | null): Promise<{
  tenant: TenantBalanceInfo | null;
  revenue: { totalChargedMicroUsdg: string; totalBuybackMicroUsdg: string; receiptCount: number };
  receipts: StoredReceiptItem[];
}> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const resp = await fetch("/v1/receipts?limit=20", { headers });
  if (!resp.ok) {
    throw new Error(`GET /v1/receipts returned ${resp.status}`);
  }
  return (await resp.json()) as {
    tenant: TenantBalanceInfo | null;
    revenue: { totalChargedMicroUsdg: string; totalBuybackMicroUsdg: string; receiptCount: number };
    receipts: StoredReceiptItem[];
  };
}

export async function postLiveGuard(body: Record<string, unknown>): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const apiKey = await ensureTenantApiKey();
  const resp = await fetch("/v1/guard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as Record<string, unknown>;
  return { status: resp.status, data };
}

export async function postLiveVerify(body: Record<string, unknown>): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const apiKey = await ensureTenantApiKey();
  const resp = await fetch("/v1/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await resp.json()) as Record<string, unknown>;
  return { status: resp.status, data };
}

export async function postLiveTokenRisk(
  tokenAddress: string,
  network = "eip155:46630"
): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const apiKey = await ensureTenantApiKey();
  const resp = await fetch("/v1/token-risk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      network,
      token: tokenAddress,
    }),
  });
  const data = (await resp.json()) as Record<string, unknown>;
  return { status: resp.status, data };
}

export async function pollZkAttestation(
  decisionId: string,
  maxAttempts = 14,
  intervalMs = 350
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(`/v1/attestation/${encodeURIComponent(decisionId)}`).catch(
      () => null
    );
    if (resp && resp.ok) {
      const att = (await resp.json()) as Record<string, unknown>;
      // Settled, or the server recorded why it stays pending (e.g. no SP1 prover configured).
      if (att.status === "proven" || att.status === "verified" || att.status === "failed" || typeof att.note === "string") {
        return att;
      }
      if (i === maxAttempts - 1) return att;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// Wallet connection lives in ./wallet.ts (shared store; eth_requestAccounts + wallet_switchEthereumChain only).

/**
 * Executes an end-to-end guarded browser wallet EIP-712 signature on RHC Testnet (46630) with ZERO gas fees:
 * 1. Calls `POST /v1/guard` first.
 * 2. Refuses to invoke `eth_signTypedData_v4` if `decision !== "allow"`.
 * 3. Only prompts the user's wallet to sign when `decision === "allow"` and TTL is active.
 */
export async function runGuardedWalletEip3009Demo(params: {
  walletAddress: string;
  chainId: 46630 | 4663;
  tamperPayTo?: boolean;
}): Promise<{
  decision: string;
  signature: string | null;
  reason: string;
  guardResponse: Record<string, unknown>;
}> {
  const eth = getInjectedProvider();
  if (!eth) {
    throw new Error("No EIP-1193 browser wallet detected.");
  }

  const usdgAddress =
    params.chainId === 46630
      ? "0x7E955252E15c84f5768B83c41a71F9eba181802F"
      : "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
  const quotedPayTo = "0x000000000000000000000000000000000000aAaA";
  const actualTo = params.tamperPayTo
    ? "0x000000000000000000000000000000000000bBbB"
    : quotedPayTo;
  const nonceHex =
    "0x" +
    Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const validBefore = Math.floor(Date.now() / 1000) + 3600;

  const domain = {
    name: "Global Dollar",
    version: "1",
    chainId: params.chainId,
    verifyingContract: usdgAddress,
  };

  // Zero-value EIP-3009 authorization so simulation succeeds even on a brand-new wallet with 0 USDG & 0 ETH!
  const guardReq = {
    network: `eip155:${params.chainId}`,
    quote: {
      asset: usdgAddress,
      payTo: quotedPayTo,
      amount: "0",
      chainId: params.chainId,
    },
    payload: {
      type: "eip3009",
      authorization: {
        from: params.walletAddress,
        to: actualTo,
        value: "0",
        validAfter: "0",
        validBefore: String(validBefore),
        nonce: nonceHex,
        domain,
      },
    },
    checks: ["quote", "simulation", "token_risk"],
  };

  const { data } = await postLiveGuard(guardReq);
  const decision = String(data.decision ?? "abstain");
  const reason = String(data.reason ?? "guard check completed");

  // Fail-closed: NEVER invoke the wallet signer unless decision === "allow"!
  if (decision !== "allow") {
    return {
      decision,
      signature: null,
      reason: `Blocked before wallet popup: ${reason}`,
      guardResponse: data,
    };
  }

  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    domain,
    message: {
      from: params.walletAddress,
      to: actualTo,
      value: "0",
      validAfter: "0",
      validBefore: String(validBefore),
      nonce: nonceHex,
    },
  };

  const sig = (await eth.request({
    method: "eth_signTypedData_v4",
    params: [params.walletAddress, JSON.stringify(typedData)],
  })) as string;

  return {
    decision,
    signature: sig,
    reason,
    guardResponse: data,
  };
}
