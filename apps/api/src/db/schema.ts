import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type {
  GuardResponse,
  ReasonCode,
  SpendPolicy,
  TokenRiskCheckResult,
  ZkAttestation,
  ZkPublicInputs,
} from "@zguard/sdk";

export const tenantsTable = pgTable("zguard_tenants", {
  id: text("id").primaryKey(),
  apiKeyHash: text("api_key_hash").notNull().unique(),
  apiKeyHint: text("api_key_hint").notNull(),
  creditMicroUsdg: bigint("credit_micro_usdg", { mode: "bigint" }).notNull().default(0n),
  totalSpentMicroUsdg: bigint("total_spent_micro_usdg", { mode: "bigint" })
    .notNull()
    .default(0n),
  spendPolicy: jsonb("spend_policy").$type<SpendPolicy | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const receiptsTable = pgTable("zguard_receipts", {
  decisionId: text("decision_id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
  endpoint: text("endpoint").notNull(),
  network: text("network").notNull(),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  codes: jsonb("codes").$type<ReasonCode[]>().notNull(),
  flags: jsonb("flags").$type<string[]>().notNull(),
  payloadHash: text("payload_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  chargedMicroUsdg: bigint("charged_micro_usdg", { mode: "bigint" }).notNull().default(0n),
  buybackMicroUsdg: bigint("buyback_micro_usdg", { mode: "bigint" }).notNull().default(0n),
  responseJson: jsonb("response_json").$type<GuardResponse>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const zkAttestationsTable = pgTable("zguard_zk_attestations", {
  decisionId: text("decision_id")
    .primaryKey()
    .references(() => receiptsTable.decisionId, { onDelete: "cascade" }),
  system: text("system").notNull(),
  scope: text("scope").notNull().default("quote"),
  programVKey: text("program_vkey").notNull(),
  proof: text("proof"),
  publicInputs: jsonb("public_inputs").$type<ZkPublicInputs>().notNull(),
  verifierAddress: text("verifier_address"),
  verifyTx: text("verify_tx"),
  bn254PrecompileVerified: boolean("bn254_precompile_verified").notNull().default(false),
  status: text("status").$type<ZkAttestation["status"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentNoncesTable = pgTable("zguard_payment_nonces", {
  nonceKey: text("nonce_key").primaryKey(),
  tenantId: text("tenant_id"),
  network: text("network").notNull(),
  asset: text("asset").notNull(),
  payer: text("payer").notNull(),
  amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tokenObservationsTable = pgTable(
  "zguard_token_observations",
  {
    chainId: integer("chain_id").notNull(),
    address: text("address").notNull(),
    kind: text("kind").notNull(),
    symbol: text("symbol"),
    name: text("name"),
    snapshot: jsonb("snapshot").$type<TokenRiskCheckResult>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.address] })]
);
