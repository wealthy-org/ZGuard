import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublicClient } from "viem";
import { createZGuardApp } from "../src/app.js";
import { loadConfig, type ZGuardAppConfig } from "../src/config.js";
import { LocalJsonStore } from "../src/db/store.js";

/** Unroutable endpoint: every RPC/HTTP call fails fast, so these tests never depend on the network. */
export const DEAD_URL = "http://127.0.0.1:9";

export const PAYEE_A = "0x000000000000000000000000000000000000aaaa";
export const PAYEE_B = "0x000000000000000000000000000000000000bbbb";

/** Throwaway, well-known dev keys (never funded on any chain). */
export const PAYER_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
export const THIEF_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;
export const RELAYER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

export function offlineEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    NODE_ENV: "test",
    DATABASE_URL: "",
    ZGUARD_ACTIVE_CHAIN_ID: "46630",
    ZGUARD_DEV_FREE_CREDIT_MICRO_USDG: "60000",
    ZGUARD_X402_PAY_TO: PAYEE_A,
    ZGUARD_RHC_RPC_URL: DEAD_URL,
    ZGUARD_RHC_FALLBACK_RPC_URL: DEAD_URL,
    ZGUARD_RHC_TESTNET_RPC_URL: DEAD_URL,
    ZGUARD_RHC_TESTNET_FALLBACK_RPC_URL: DEAD_URL,
    ZGUARD_RHC_MAINNET_RPC_URL: DEAD_URL,
    ZGUARD_RHC_MAINNET_FALLBACK_RPC_URL: DEAD_URL,
    ZGUARD_STOCK_REGISTRY_URL: DEAD_URL,
    ZGUARD_CHAINLINK_FEEDS_URL: DEAD_URL,
    ZGUARD_HOLDER_INDEXER_URL: DEAD_URL,
    ZGUARD_ENABLE_URL_FETCH: "false",
    ZGUARD_ZK_ENABLED: "false",
    ZGUARD_X402_MIN_CONFIRMATIONS: "3",
    ...overrides,
  };
}

export function offlineConfig(overrides: Record<string, string> = {}): ZGuardAppConfig {
  return loadConfig(offlineEnv(overrides));
}

export function createOfflineApi(overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zguard-offline-"));
  const config = offlineConfig(overrides);
  const store = new LocalJsonStore("zg_", join(dir, "store.json"));
  return createZGuardApp({ config, store });
}

export async function registerTenant(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  ip = "198.51.100.7"
): Promise<{ apiKey: string; tenantId: string }> {
  const res = await app.request("/v1/register", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { apiKey: string; tenantId: string };
  return json;
}

export interface FakeLog {
  address: string;
  topics: string[];
  data: string;
}

/**
 * Minimal stand-in for a viem PublicClient covering the calls the x402 verifier makes.
 * Lets tests describe chain state (receipts, head block, balances) without any RPC.
 */
export function fakeChainClient(state: {
  receipts?: Record<
    string,
    { status: "success" | "reverted"; blockNumber: bigint; from: string; logs: FakeLog[] }
  >;
  head?: bigint;
  balance?: bigint;
  authorizationUsed?: boolean;
}): PublicClient {
  const client = {
    async getTransactionReceipt({ hash }: { hash: string }) {
      const r = state.receipts?.[hash.toLowerCase()];
      if (!r) throw new Error(`receipt not found: ${hash}`);
      return { ...r, transactionHash: hash };
    },
    async getBlockNumber() {
      return state.head ?? 100n;
    },
    async readContract({ functionName }: { functionName: string }) {
      if (functionName === "authorizationState") return state.authorizationUsed ?? false;
      if (functionName === "balanceOf") return state.balance ?? 0n;
      throw new Error(`unexpected readContract ${functionName}`);
    },
    async waitForTransactionReceipt() {
      throw new Error("no chain in offline tests");
    },
  };
  return client as unknown as PublicClient;
}

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function topicAddr(addr: string): string {
  return `0x${"0".repeat(24)}${addr.toLowerCase().replace(/^0x/, "")}`;
}

export function u256(n: bigint): string {
  return `0x${n.toString(16).padStart(64, "0")}`;
}
