import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type {
  GuardResponse,
  SpendPolicy,
  TokenRiskCheckResult,
  ZkAttestation,
} from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";
import {
  paymentNoncesTable,
  receiptsTable,
  tenantsTable,
  tokenObservationsTable,
  zkAttestationsTable,
} from "./schema.js";

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export interface TenantRecord {
  id: string;
  apiKeyHash: string;
  apiKeyHint: string;
  creditMicroUsdg: bigint;
  totalSpentMicroUsdg: bigint;
  spendPolicy: SpendPolicy | null;
  createdAt: string;
}

export interface ReceiptRecord {
  decisionId: string;
  tenantId: string | null;
  endpoint: string;
  network: string;
  decision: string;
  reason: string;
  codes: string[];
  flags: string[];
  payloadHash: string;
  expiresAt: string | null;
  chargedMicroUsdg: string;
  buybackMicroUsdg: string;
  response: GuardResponse;
  createdAt: string;
}

export interface StorageStore {
  readonly driver: "neon-postgres" | "local-json";
  createTenant(initialCreditMicroUsdg: bigint): Promise<{ tenant: TenantRecord; rawApiKey: string }>;
  getTenantByApiKey(rawApiKey: string): Promise<TenantRecord | null>;
  getTenantById(tenantId: string): Promise<TenantRecord | null>;
  addCredit(tenantId: string, deltaMicroUsdg: bigint): Promise<TenantRecord>;
  chargeCredit(tenantId: string, costMicroUsdg: bigint): Promise<{ ok: boolean; tenant: TenantRecord }>;
  consumePaymentNonce(entry: {
    nonceKey: string;
    tenantId: string | null;
    network: string;
    asset: string;
    payer: string;
    amountMicro: bigint;
  }): Promise<boolean>;
  saveReceipt(params: {
    decisionId: string;
    tenantId: string | null;
    endpoint: string;
    chargedMicroUsdg: bigint;
    buybackMicroUsdg: bigint;
    response: GuardResponse;
  }): Promise<void>;
  listReceipts(tenantId: string | null, limit?: number): Promise<ReceiptRecord[]>;
  /** Revenue totals. `tenantId` given = only that tenant's receipts; omitted = global (admin only). */
  getRevenueSummary(tenantId?: string | null): Promise<{
    totalChargedMicroUsdg: string;
    totalBuybackMicroUsdg: string;
    receiptCount: number;
  }>;
  /**
   * Fixed-window counter shared by every serverless instance (gap C5). Increments `key` in the
   * current window and reports whether the caller is still within `limit`.
   */
  hitRateLimit(
    key: string,
    windowSeconds: number,
    limit: number
  ): Promise<{ allowed: boolean; count: number; resetAt: string }>;
  upsertZkAttestation(att: ZkAttestation): Promise<void>;
  getZkAttestation(decisionId: string): Promise<ZkAttestation | null>;
  upsertTokenObservation(chainId: number, address: string, risk: TokenRiskCheckResult): Promise<void>;
  getTokenObservation(
    chainId: number,
    address: string
  ): Promise<{ risk: TokenRiskCheckResult; updatedAt: string } | null>;
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateApiKey(prefix: string): { id: string; rawKey: string; hash: string; hint: string } {
  const id = `tnt_${randomBytes(8).toString("hex")}`;
  const secret = randomBytes(20).toString("hex");
  const normalizedPrefix = prefix.endsWith("_") ? prefix : `${prefix}_`;
  const rawKey = `${normalizedPrefix}live_${secret}`;
  const hint = `${rawKey.slice(0, normalizedPrefix.length + 9)}…${rawKey.slice(-4)}`;
  return { id, rawKey, hash: hashApiKey(rawKey), hint };
}

/**
 * Production Neon Serverless Postgres store (`@neondatabase/serverless` + Drizzle ORM).
 */
export class NeonPostgresStore implements StorageStore {
  public readonly driver = "neon-postgres" as const;
  private readonly sqlClient: ReturnType<typeof neon>;
  private readonly db: ReturnType<typeof drizzle>;
  private readonly keyPrefix: string;
  private initialized = false;

  constructor(databaseUrl: string, keyPrefix: string) {
    this.sqlClient = neon(databaseUrl);
    this.db = drizzle(this.sqlClient);
    this.keyPrefix = keyPrefix;
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.sqlClient`
        CREATE TABLE IF NOT EXISTS zguard_tenants (
          id TEXT PRIMARY KEY,
          api_key_hash TEXT NOT NULL UNIQUE,
          api_key_hint TEXT NOT NULL,
          credit_micro_usdg BIGINT NOT NULL DEFAULT 0,
          total_spent_micro_usdg BIGINT NOT NULL DEFAULT 0,
          spend_policy JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sqlClient`
        CREATE TABLE IF NOT EXISTS zguard_receipts (
          decision_id TEXT PRIMARY KEY,
          tenant_id TEXT REFERENCES zguard_tenants(id) ON DELETE SET NULL,
          endpoint TEXT NOT NULL,
          network TEXT NOT NULL,
          decision TEXT NOT NULL,
          reason TEXT NOT NULL,
          codes JSONB NOT NULL DEFAULT '[]'::jsonb,
          flags JSONB NOT NULL DEFAULT '[]'::jsonb,
          payload_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ,
          charged_micro_usdg BIGINT NOT NULL DEFAULT 0,
          buyback_micro_usdg BIGINT NOT NULL DEFAULT 0,
          response_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sqlClient`
        CREATE TABLE IF NOT EXISTS zguard_zk_attestations (
          decision_id TEXT PRIMARY KEY REFERENCES zguard_receipts(decision_id) ON DELETE CASCADE,
          system TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'quote' CHECK (scope = 'quote'),
          program_vkey TEXT NOT NULL,
          proof TEXT,
          public_inputs JSONB NOT NULL,
          verifier_address TEXT,
          verify_tx TEXT,
          bn254_precompile_verified BOOLEAN NOT NULL DEFAULT FALSE,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sqlClient`
        CREATE TABLE IF NOT EXISTS zguard_payment_nonces (
          nonce_key TEXT PRIMARY KEY,
          tenant_id TEXT,
          network TEXT NOT NULL,
          asset TEXT NOT NULL,
          payer TEXT NOT NULL,
          amount_micro BIGINT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await this.sqlClient`
        CREATE TABLE IF NOT EXISTS zguard_token_observations (
          chain_id INTEGER NOT NULL,
          address TEXT NOT NULL,
          kind TEXT NOT NULL,
          symbol TEXT,
          name TEXT,
          snapshot JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (chain_id, address)
        )
      `;
      await this.sqlClient`
        CREATE TABLE IF NOT EXISTS zguard_rate_limits (
          bucket_key TEXT NOT NULL,
          window_start BIGINT NOT NULL,
          hits INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (bucket_key, window_start)
        )
      `;
      await this.sqlClient`
        ALTER TABLE zguard_zk_attestations ADD COLUMN IF NOT EXISTS note TEXT
      `;
      this.initialized = true;
    } catch (err) {
      throw new StorageUnavailableError(
        `Neon database schema initialization failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public async createTenant(initialCreditMicroUsdg: bigint) {
    await this.ensureSchema();
    const { id, rawKey, hash, hint } = generateApiKey(this.keyPrefix);
    const [row] = await this.db
      .insert(tenantsTable)
      .values({
        id,
        apiKeyHash: hash,
        apiKeyHint: hint,
        creditMicroUsdg: initialCreditMicroUsdg,
        totalSpentMicroUsdg: 0n,
      })
      .returning();

    return {
      rawApiKey: rawKey,
      tenant: {
        id: row.id,
        apiKeyHash: row.apiKeyHash,
        apiKeyHint: row.apiKeyHint,
        creditMicroUsdg: row.creditMicroUsdg,
        totalSpentMicroUsdg: row.totalSpentMicroUsdg,
        spendPolicy: row.spendPolicy ?? null,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }

  public async getTenantByApiKey(rawApiKey: string): Promise<TenantRecord | null> {
    await this.ensureSchema();
    try {
      const h = hashApiKey(rawApiKey.trim());
      const rows = await this.db
        .select()
        .from(tenantsTable)
        .where(eq(tenantsTable.apiKeyHash, h))
        .limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        apiKeyHash: r.apiKeyHash,
        apiKeyHint: r.apiKeyHint,
        creditMicroUsdg: r.creditMicroUsdg,
        totalSpentMicroUsdg: r.totalSpentMicroUsdg,
        spendPolicy: r.spendPolicy ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    } catch (err) {
      throw new StorageUnavailableError(
        `Neon tenant lookup failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public async getTenantById(tenantId: string): Promise<TenantRecord | null> {
    await this.ensureSchema();
    const rows = await this.db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      apiKeyHash: r.apiKeyHash,
      apiKeyHint: r.apiKeyHint,
      creditMicroUsdg: r.creditMicroUsdg,
      totalSpentMicroUsdg: r.totalSpentMicroUsdg,
      spendPolicy: r.spendPolicy ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  public async addCredit(tenantId: string, deltaMicroUsdg: bigint): Promise<TenantRecord> {
    await this.ensureSchema();
    const [r] = await this.db
      .update(tenantsTable)
      .set({
        creditMicroUsdg: sql`${tenantsTable.creditMicroUsdg} + ${deltaMicroUsdg}`,
      })
      .where(eq(tenantsTable.id, tenantId))
      .returning();

    return {
      id: r.id,
      apiKeyHash: r.apiKeyHash,
      apiKeyHint: r.apiKeyHint,
      creditMicroUsdg: r.creditMicroUsdg,
      totalSpentMicroUsdg: r.totalSpentMicroUsdg,
      spendPolicy: r.spendPolicy ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  public async chargeCredit(
    tenantId: string,
    costMicroUsdg: bigint
  ): Promise<{ ok: boolean; tenant: TenantRecord }> {
    await this.ensureSchema();
    const updated = await this.db
      .update(tenantsTable)
      .set({
        creditMicroUsdg: sql`${tenantsTable.creditMicroUsdg} - ${costMicroUsdg}`,
        totalSpentMicroUsdg: sql`${tenantsTable.totalSpentMicroUsdg} + ${costMicroUsdg}`,
      })
      .where(
        and(
          eq(tenantsTable.id, tenantId),
          sql`${tenantsTable.creditMicroUsdg} >= ${costMicroUsdg}`
        )
      )
      .returning();

    if (updated.length > 0) {
      const r = updated[0];
      return {
        ok: true,
        tenant: {
          id: r.id,
          apiKeyHash: r.apiKeyHash,
          apiKeyHint: r.apiKeyHint,
          creditMicroUsdg: r.creditMicroUsdg,
          totalSpentMicroUsdg: r.totalSpentMicroUsdg,
          spendPolicy: r.spendPolicy ?? null,
          createdAt: r.createdAt.toISOString(),
        },
      };
    }

    const existing = await this.getTenantById(tenantId);
    if (!existing) {
      throw new StorageUnavailableError(`Tenant ${tenantId} not found`);
    }
    return { ok: false, tenant: existing };
  }

  public async consumePaymentNonce(entry: {
    nonceKey: string;
    tenantId: string | null;
    network: string;
    asset: string;
    payer: string;
    amountMicro: bigint;
  }): Promise<boolean> {
    await this.ensureSchema();
    const inserted = await this.db
      .insert(paymentNoncesTable)
      .values({
        nonceKey: entry.nonceKey.toLowerCase(),
        tenantId: entry.tenantId,
        network: entry.network,
        asset: entry.asset.toLowerCase(),
        payer: entry.payer.toLowerCase(),
        amountMicro: entry.amountMicro,
      })
      .onConflictDoNothing()
      .returning();
    return inserted.length > 0;
  }

  public async saveReceipt(params: {
    decisionId: string;
    tenantId: string | null;
    endpoint: string;
    chargedMicroUsdg: bigint;
    buybackMicroUsdg: bigint;
    response: GuardResponse;
  }): Promise<void> {
    await this.ensureSchema();
    await this.db
      .insert(receiptsTable)
      .values({
        decisionId: params.decisionId,
        tenantId: params.tenantId,
        endpoint: params.endpoint,
        network: params.response.network,
        decision: params.response.decision,
        reason: params.response.reason,
        codes: params.response.codes,
        flags: params.response.flags,
        payloadHash: params.response.payload_hash,
        expiresAt: params.response.expires_at ? new Date(params.response.expires_at) : null,
        chargedMicroUsdg: params.chargedMicroUsdg,
        buybackMicroUsdg: params.buybackMicroUsdg,
        responseJson: params.response,
      })
      .onConflictDoNothing();
  }

  public async listReceipts(tenantId: string | null, limit = 25): Promise<ReceiptRecord[]> {
    await this.ensureSchema();
    const query = tenantId
      ? this.db
          .select()
          .from(receiptsTable)
          .where(eq(receiptsTable.tenantId, tenantId))
          .orderBy(desc(receiptsTable.createdAt))
          .limit(limit)
      : this.db
          .select()
          .from(receiptsTable)
          .orderBy(desc(receiptsTable.createdAt))
          .limit(limit);

    const rows = await query;
    return rows.map((r) => ({
      decisionId: r.decisionId,
      tenantId: r.tenantId,
      endpoint: r.endpoint,
      network: r.network,
      decision: r.decision,
      reason: r.reason,
      codes: r.codes,
      flags: r.flags,
      payloadHash: r.payloadHash,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      chargedMicroUsdg: r.chargedMicroUsdg.toString(),
      buybackMicroUsdg: r.buybackMicroUsdg.toString(),
      response: r.responseJson,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  public async getRevenueSummary(tenantId?: string | null) {
    await this.ensureSchema();
    const res = tenantId
      ? await this.sqlClient`
          SELECT
            COALESCE(SUM(charged_micro_usdg), 0)::text AS charged,
            COALESCE(SUM(buyback_micro_usdg), 0)::text AS buyback,
            COUNT(*)::int AS cnt
          FROM zguard_receipts
          WHERE tenant_id = ${tenantId}
        `
      : await this.sqlClient`
          SELECT
            COALESCE(SUM(charged_micro_usdg), 0)::text AS charged,
            COALESCE(SUM(buyback_micro_usdg), 0)::text AS buyback,
            COUNT(*)::int AS cnt
          FROM zguard_receipts
        `;
    const row = (res as unknown as Array<{ charged: string; buyback: string; cnt: number }>)[0];
    return {
      totalChargedMicroUsdg: row?.charged ?? "0",
      totalBuybackMicroUsdg: row?.buyback ?? "0",
      receiptCount: Number(row?.cnt ?? 0),
    };
  }

  public async hitRateLimit(key: string, windowSeconds: number, limit: number) {
    await this.ensureSchema();
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % windowSeconds);
    const res = await this.sqlClient`
      INSERT INTO zguard_rate_limits (bucket_key, window_start, hits)
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET hits = zguard_rate_limits.hits + 1
      RETURNING hits
    `;
    const hits = Number((res as unknown as Array<{ hits: number }>)[0]?.hits ?? limit + 1);
    // Opportunistic cleanup of old windows (cheap, bounded)
    if (hits === 1) {
      void this.sqlClient`
        DELETE FROM zguard_rate_limits WHERE window_start < ${windowStart - 86_400}
      `.catch(() => undefined);
    }
    return {
      allowed: hits <= limit,
      count: hits,
      resetAt: new Date((windowStart + windowSeconds) * 1000).toISOString(),
    };
  }

  public async upsertZkAttestation(att: ZkAttestation): Promise<void> {
    await this.ensureSchema();
    await this.db
      .insert(zkAttestationsTable)
      .values({
        decisionId: att.decisionId,
        system: att.system,
        scope: "quote",
        programVKey: att.programVKey,
        proof: att.proof,
        publicInputs: att.publicInputs,
        verifierAddress: att.verifierAddress,
        verifyTx: att.verifyTx,
        bn254PrecompileVerified: Boolean(att.bn254PrecompileVerified),
        status: att.status,
        note: att.note ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: zkAttestationsTable.decisionId,
        set: {
          proof: att.proof,
          verifyTx: att.verifyTx,
          bn254PrecompileVerified: Boolean(att.bn254PrecompileVerified),
          status: att.status,
          note: att.note ?? null,
          updatedAt: new Date(),
        },
      });
  }

  public async getZkAttestation(decisionId: string): Promise<ZkAttestation | null> {
    await this.ensureSchema();
    const rows = await this.db
      .select()
      .from(zkAttestationsTable)
      .where(eq(zkAttestationsTable.decisionId, decisionId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      decisionId: r.decisionId,
      system: r.system as ZkAttestation["system"],
      scope: "quote",
      programVKey: r.programVKey,
      proof: r.proof,
      publicInputs: r.publicInputs,
      verifierAddress: r.verifierAddress,
      verifyTx: r.verifyTx,
      bn254PrecompileVerified: r.bn254PrecompileVerified,
      status: r.status,
      ...(r.note ? { note: r.note } : {}),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  public async upsertTokenObservation(
    chainId: number,
    address: string,
    risk: TokenRiskCheckResult
  ): Promise<void> {
    await this.ensureSchema();
    const addrLower = address.toLowerCase();
    await this.db
      .insert(tokenObservationsTable)
      .values({
        chainId,
        address: addrLower,
        kind: risk.kind,
        symbol: risk.symbol ?? null,
        name: risk.name ?? null,
        snapshot: risk,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [tokenObservationsTable.chainId, tokenObservationsTable.address],
        set: {
          kind: risk.kind,
          symbol: risk.symbol ?? null,
          name: risk.name ?? null,
          snapshot: risk,
          updatedAt: new Date(),
        },
      });
  }

  public async getTokenObservation(chainId: number, address: string) {
    await this.ensureSchema();
    const rows = await this.db
      .select()
      .from(tokenObservationsTable)
      .where(
        and(
          eq(tokenObservationsTable.chainId, chainId),
          eq(tokenObservationsTable.address, address.toLowerCase())
        )
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      risk: r.snapshot,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

interface PersistedJsonState {
  tenants: Array<Omit<TenantRecord, "creditMicroUsdg" | "totalSpentMicroUsdg"> & {
    creditMicroUsdg: string;
    totalSpentMicroUsdg: string;
  }>;
  receipts: ReceiptRecord[];
  zkAttestations: Record<string, ZkAttestation>;
  paymentNonces: Record<string, { createdAt: string; amountMicro: string }>;
  tokenObservations: Record<string, { risk: TokenRiskCheckResult; updatedAt: string }>;
}

/**
 * Zero-config JSON-persisted store used ONLY when `DATABASE_URL` is not yet provided in `auto` dev mode.
 * Mirrors the exact same `StorageStore` contract as `NeonPostgresStore`.
 */
export class LocalJsonStore implements StorageStore {
  public readonly driver = "local-json" as const;
  private readonly filePath: string;
  private readonly keyPrefix: string;
  private state: PersistedJsonState;

  constructor(keyPrefix: string, filePath = resolve(process.cwd(), ".data/zguard-dev-store.json")) {
    this.keyPrefix = keyPrefix;
    this.filePath = filePath;
    this.state = this.load();
  }

  private load(): PersistedJsonState {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, "utf8")) as PersistedJsonState;
      }
    } catch {
      // Start clean if corrupted
    }
    return {
      tenants: [],
      receipts: [],
      zkAttestations: {},
      paymentNonces: {},
      tokenObservations: {},
    };
  }

  private flush(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
      // Non-fatal in ephemeral sandbox
    }
  }

  public async createTenant(initialCreditMicroUsdg: bigint) {
    const { id, rawKey, hash, hint } = generateApiKey(this.keyPrefix);
    const createdAt = new Date().toISOString();
    this.state.tenants.push({
      id,
      apiKeyHash: hash,
      apiKeyHint: hint,
      creditMicroUsdg: initialCreditMicroUsdg.toString(),
      totalSpentMicroUsdg: "0",
      spendPolicy: null,
      createdAt,
    });
    this.flush();
    return {
      rawApiKey: rawKey,
      tenant: {
        id,
        apiKeyHash: hash,
        apiKeyHint: hint,
        creditMicroUsdg: initialCreditMicroUsdg,
        totalSpentMicroUsdg: 0n,
        spendPolicy: null,
        createdAt,
      },
    };
  }

  public async getTenantByApiKey(rawApiKey: string): Promise<TenantRecord | null> {
    const h = hashApiKey(rawApiKey.trim());
    const found = this.state.tenants.find((t) => t.apiKeyHash === h);
    if (!found) return null;
    return {
      ...found,
      creditMicroUsdg: BigInt(found.creditMicroUsdg),
      totalSpentMicroUsdg: BigInt(found.totalSpentMicroUsdg),
    };
  }

  public async getTenantById(tenantId: string): Promise<TenantRecord | null> {
    const found = this.state.tenants.find((t) => t.id === tenantId);
    if (!found) return null;
    return {
      ...found,
      creditMicroUsdg: BigInt(found.creditMicroUsdg),
      totalSpentMicroUsdg: BigInt(found.totalSpentMicroUsdg),
    };
  }

  public async addCredit(tenantId: string, deltaMicroUsdg: bigint): Promise<TenantRecord> {
    const found = this.state.tenants.find((t) => t.id === tenantId);
    if (!found) throw new StorageUnavailableError(`Tenant ${tenantId} not found`);
    const next = BigInt(found.creditMicroUsdg) + deltaMicroUsdg;
    found.creditMicroUsdg = next.toString();
    this.flush();
    return {
      ...found,
      creditMicroUsdg: next,
      totalSpentMicroUsdg: BigInt(found.totalSpentMicroUsdg),
    };
  }

  public async chargeCredit(
    tenantId: string,
    costMicroUsdg: bigint
  ): Promise<{ ok: boolean; tenant: TenantRecord }> {
    const found = this.state.tenants.find((t) => t.id === tenantId);
    if (!found) throw new StorageUnavailableError(`Tenant ${tenantId} not found`);
    const current = BigInt(found.creditMicroUsdg);
    const spent = BigInt(found.totalSpentMicroUsdg);
    if (current < costMicroUsdg) {
      return {
        ok: false,
        tenant: {
          ...found,
          creditMicroUsdg: current,
          totalSpentMicroUsdg: spent,
        },
      };
    }
    const nextCredit = current - costMicroUsdg;
    const nextSpent = spent + costMicroUsdg;
    found.creditMicroUsdg = nextCredit.toString();
    found.totalSpentMicroUsdg = nextSpent.toString();
    this.flush();
    return {
      ok: true,
      tenant: {
        ...found,
        creditMicroUsdg: nextCredit,
        totalSpentMicroUsdg: nextSpent,
      },
    };
  }

  public async consumePaymentNonce(entry: {
    nonceKey: string;
    tenantId: string | null;
    network: string;
    asset: string;
    payer: string;
    amountMicro: bigint;
  }): Promise<boolean> {
    const k = entry.nonceKey.toLowerCase();
    if (this.state.paymentNonces[k]) return false;
    this.state.paymentNonces[k] = {
      createdAt: new Date().toISOString(),
      amountMicro: entry.amountMicro.toString(),
    };
    this.flush();
    return true;
  }

  public async saveReceipt(params: {
    decisionId: string;
    tenantId: string | null;
    endpoint: string;
    chargedMicroUsdg: bigint;
    buybackMicroUsdg: bigint;
    response: GuardResponse;
  }): Promise<void> {
    const rec: ReceiptRecord = {
      decisionId: params.decisionId,
      tenantId: params.tenantId,
      endpoint: params.endpoint,
      network: params.response.network,
      decision: params.response.decision,
      reason: params.response.reason,
      codes: params.response.codes,
      flags: params.response.flags,
      payloadHash: params.response.payload_hash,
      expiresAt: params.response.expires_at,
      chargedMicroUsdg: params.chargedMicroUsdg.toString(),
      buybackMicroUsdg: params.buybackMicroUsdg.toString(),
      response: params.response,
      createdAt: new Date().toISOString(),
    };
    this.state.receipts.unshift(rec);
    if (this.state.receipts.length > 500) {
      this.state.receipts.length = 500;
    }
    this.flush();
  }

  public async listReceipts(tenantId: string | null, limit = 25): Promise<ReceiptRecord[]> {
    const list = tenantId
      ? this.state.receipts.filter((r) => r.tenantId === tenantId)
      : this.state.receipts;
    return list.slice(0, limit);
  }

  public async getRevenueSummary(tenantId?: string | null) {
    let totalCharged = 0n;
    let totalBuyback = 0n;
    const list = tenantId
      ? this.state.receipts.filter((r) => r.tenantId === tenantId)
      : this.state.receipts;
    for (const r of list) {
      totalCharged += BigInt(r.chargedMicroUsdg);
      totalBuyback += BigInt(r.buybackMicroUsdg);
    }
    return {
      totalChargedMicroUsdg: totalCharged.toString(),
      totalBuybackMicroUsdg: totalBuyback.toString(),
      receiptCount: list.length,
    };
  }

  private readonly rateBuckets = new Map<string, { windowStart: number; hits: number }>();

  public async hitRateLimit(key: string, windowSeconds: number, limit: number) {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % windowSeconds);
    const prev = this.rateBuckets.get(key);
    const hits = prev && prev.windowStart === windowStart ? prev.hits + 1 : 1;
    this.rateBuckets.set(key, { windowStart, hits });
    if (this.rateBuckets.size > 10_000) {
      for (const [k, v] of this.rateBuckets) {
        if (v.windowStart < windowStart) this.rateBuckets.delete(k);
      }
    }
    return {
      allowed: hits <= limit,
      count: hits,
      resetAt: new Date((windowStart + windowSeconds) * 1000).toISOString(),
    };
  }

  public async upsertZkAttestation(att: ZkAttestation): Promise<void> {
    this.state.zkAttestations[att.decisionId] = { ...att, scope: "quote" };
    const rec = this.state.receipts.find((r) => r.decisionId === att.decisionId);
    if (rec) {
      rec.response = {
        ...rec.response,
        attestation: { zk: { ...att, scope: "quote" } },
      };
    }
    this.flush();
  }

  public async getZkAttestation(decisionId: string): Promise<ZkAttestation | null> {
    return this.state.zkAttestations[decisionId] ?? null;
  }

  public async upsertTokenObservation(
    chainId: number,
    address: string,
    risk: TokenRiskCheckResult
  ): Promise<void> {
    const key = `${chainId}:${address.toLowerCase()}`;
    this.state.tokenObservations[key] = {
      risk,
      updatedAt: new Date().toISOString(),
    };
    this.flush();
  }

  public async getTokenObservation(chainId: number, address: string) {
    return this.state.tokenObservations[`${chainId}:${address.toLowerCase()}`] ?? null;
  }
}

export function createStore(config: ZGuardAppConfig): StorageStore {
  if (config.databaseUrl && config.databaseUrl.trim().length > 0) {
    return new NeonPostgresStore(config.databaseUrl.trim(), config.apiKeyPrefix);
  }
  if (config.storageMode === "neon") {
    throw new StorageUnavailableError(
      "ZGUARD_STORAGE_MODE=neon requires DATABASE_URL (Neon Postgres connection string)"
    );
  }
  // C6-table: a serverless instance writing credits/nonces to a local JSON file loses them on every
  // cold start (replayable payments, vanishing credit). Production must use Neon.
  if (config.isProduction && !config.allowLocalStoreInProduction) {
    throw new StorageUnavailableError(
      "NODE_ENV=production requires DATABASE_URL (Neon). The local JSON store is dev-only; set ZGUARD_ALLOW_LOCAL_STORE_IN_PRODUCTION=true only for throwaway demos."
    );
  }
  return new LocalJsonStore(config.apiKeyPrefix);
}
