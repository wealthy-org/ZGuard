/**
 * Browser-safe live client for ZGuard `/v1/*` API (proxied via Next.js rewrites — never calls localhost directly).
 */

const STORAGE_KEY = "zguard_tenant_api_key_v1";

export interface TenantBalanceInfo {
  tenantId: string;
  apiKeyHint: string;
  creditMicroUsdg: string;
  totalSpentMicroUsdg?: string;
  asset: string;
  unit: string;
  network: string;
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

export async function postLiveTokenRisk(tokenAddress: string): Promise<{
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
      network: "eip155:4663",
      token: tokenAddress,
    }),
  });
  const data = (await resp.json()) as Record<string, unknown>;
  return { status: resp.status, data };
}

export async function pollZkAttestation(
  decisionId: string,
  maxAttempts = 12,
  intervalMs = 350
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(`/v1/attestation/${encodeURIComponent(decisionId)}`).catch(
      () => null
    );
    if (resp && resp.ok) {
      const att = (await resp.json()) as Record<string, unknown>;
      if (att.status === "proven" || att.status === "verified" || att.status === "failed") {
        return att;
      }
      if (i === maxAttempts - 1) return att;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
