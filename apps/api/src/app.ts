import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { PublicClient } from "viem";
import {
  RHC_MAINNET_CHAIN_ID,
  RHC_TESTNET_CHAIN_ID,
  aggregateDecision,
  computePayloadHash,
  evaluateQuoteMatch,
  getRhcChainProfile,
  isSupportedRhcChainId,
  parseChainIdFromNetwork,
  type ChargedInfo,
  type CheckMode,
  type CheckName,
  type GuardRequest,
  type GuardResponse,
  getEip712DomainStatus,
} from "@zguard/sdk";
import { buildInitialZkAttestation, buildSp1GuestInput, proveQuoteAttestationAsync } from "@zguard/zk";
import { loadConfig, type ZGuardAppConfig } from "./config.js";
import {
  StorageUnavailableError,
  createStore,
  type StorageStore,
  type TenantRecord,
} from "./db/store.js";
import { RhcRegistryService } from "./services/registry.js";
import {
  createRhcClientForChain,
  getRpcUrlsForChain,
  refreshVerifiedUsdgDomain,
} from "./services/rhc-rpc.js";
import { checkSequencerHealth } from "./services/sequencer.js";
import { simulateOnRhc } from "./services/simulate.js";
import { evaluateTokenRiskRhc } from "./services/token-risk.js";
import { scanContentWithRemoteUrl } from "./services/url-scanner.js";
import {
  LatencyRecorder,
  MemoryRateLimiter,
  clientIp,
  isPublicReadRoute,
  routeLabel,
  safeEqual,
} from "./services/ops.js";
import {
  buildX402Quote,
  peekXPaymentPayer,
  resolveSettlementMode,
  verifyAndConsumeXPayment,
} from "./services/x402.js";

const KNOWN_CHECKS: CheckName[] = ["quote", "simulation", "token_risk", "content"];

/**
 * Merges client-supplied check modes so they can only TIGHTEN server policy (advisory -> required),
 * never loosen it (required -> advisory). Gap C4.
 */
export function tightenCheckModes(
  serverModes: Record<CheckName, CheckMode>,
  clientModes?: Partial<Record<CheckName, CheckMode>> | null
): Record<CheckName, CheckMode> {
  const out = { ...serverModes };
  if (clientModes && typeof clientModes === "object") {
    for (const name of KNOWN_CHECKS) {
      if (clientModes[name] === "required") out[name] = "required";
    }
  }
  return out;
}

export interface AppDependencies {
  config?: ZGuardAppConfig;
  store?: StorageStore;
}

function extractBearerKey(c: Context): string | null {
  const auth = c.req.header("authorization") || c.req.header("x-api-key");
  if (!auth) return null;
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return auth.trim();
}

export function createZGuardApp(deps: AppDependencies = {}): {
  app: Hono;
  config: ZGuardAppConfig;
  store: StorageStore;
  registry: RhcRegistryService;
  rhcClient: PublicClient;
} {
  const config = deps.config ?? loadConfig();
  const store = deps.store ?? createStore(config);
  const testnetClient = createRhcClientForChain(config, RHC_TESTNET_CHAIN_ID);
  const mainnetClient = createRhcClientForChain(config, RHC_MAINNET_CHAIN_ID);
  const rhcClient =
    config.activeChainId === RHC_MAINNET_CHAIN_ID ? mainnetClient : testnetClient;
  const registry = new RhcRegistryService(config);

  function getClientForChain(chainId: number): PublicClient {
    return chainId === RHC_MAINNET_CHAIN_ID ? mainnetClient : testnetClient;
  }

  // Kick off non-blocking USDG EIP-712 onchain domain check on both Testnet 46630 & Mainnet 4663 + registry warm-up
  refreshVerifiedUsdgDomain(testnetClient, RHC_TESTNET_CHAIN_ID)
    .then((st) => {
      if (st?.status === "mismatch") {
        console.error(`[zguard] USDG EIP-712 domain on ${RHC_TESTNET_CHAIN_ID} differs from pinned constant; EIP-3009 disabled (Q-007)`);
      }
    })
    .catch(() => undefined);
  if (config.activeChainId === RHC_MAINNET_CHAIN_ID) {
    refreshVerifiedUsdgDomain(mainnetClient, RHC_MAINNET_CHAIN_ID).catch(() => undefined);
  }
  registry.ensureFresh().catch(() => undefined);

  const activeProfile = getRhcChainProfile(config.activeChainId);

  const app = new Hono();

  const metrics = new LatencyRecorder();
  const globalLimiter = new MemoryRateLimiter(config.rateLimitPerMinute, 60);
  const devCorsAny = !config.isProduction && config.corsOrigins.length === 0;

  // Latency metrics + Server-Timing (brief: report p95 < 800 ms)
  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    const ms = performance.now() - t0;
    metrics.record(`${c.req.method} ${routeLabel(c.req.path)}`, ms, c.res.status);
    try {
      c.res.headers.set("Server-Timing", `app;dur=${ms.toFixed(1)}`);
    } catch {
      // immutable response headers (rare) — metrics still recorded
    }
  });

  // CORS (C6-table): free public read routes are open to any origin; keyed/paid routes only to the
  // configured allowlist (ZGUARD_CORS_ORIGINS). The web app calls the API same-origin through its
  // Next.js rewrite, so it needs no CORS at all. Local dev without an allowlist stays permissive.
  app.use("*", async (c, next) => {
    const publicRoute = isPublicReadRoute(c.req.method, c.req.path);
    const handler = cors({
      origin: (origin) => {
        if (!origin) return null;
        if (publicRoute || devCorsAny) return "*";
        return config.corsOrigins.includes(origin.replace(/\/+$/, "")) ? origin : null;
      },
      allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-PAYMENT", "X-Admin-Key"],
      exposeHeaders: ["X-PAYMENT-RESPONSE", "Retry-After", "Server-Timing"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
    });
    return handler(c, next);
  });

  // Global per-IP rate limit (C6-table "tidak ada rate limit global")
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS" || c.req.path === "/health") return next();
    const verdict = globalLimiter.hit(`ip:${clientIp(c)}`);
    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.resetSec));
      return c.json(
        { error: "Rate limit exceeded", limitPerMinute: config.rateLimitPerMinute },
        429
      );
    }
    return next();
  });

  /** Admin requests carry `x-admin-key` equal to ZGUARD_ADMIN_API_KEY (constant-time compare). */
  function isAdmin(c: Context): boolean {
    return Boolean(config.adminApiKey) && safeEqual(c.req.header("x-admin-key"), config.adminApiKey);
  }

  /**
   * Billing & Auth Gate for paid endpoints (§4.3, §5.1, §8.1, §9 #7):
   * - Accepts API key with sufficient USDG credit OR inline `X-PAYMENT` header (USDG on RHC 46630/4663, or optional Base/Solana USDC).
   * - If credit is exhausted / missing and no valid X-PAYMENT is supplied -> returns HTTP 402 with payable quote.
   * - If storage fails -> fail-closed abstain (`P-UNAVAIL`), NEVER allow!
   */
  async function authorizeAndCharge(
    c: Context,
    endpointPath: string,
    costMicroUsdg: bigint,
    description: string
  ): Promise<
    | {
        ok: true;
        tenant: TenantRecord | null;
        chargedMicro: bigint;
        paidViaX402: boolean;
        chargedMeta: ChargedInfo;
      }
    | { ok: false; response: Response }
  > {
    const rawKey = extractBearerKey(c);
    const xPayment = c.req.header("x-payment");

    let tenant: TenantRecord | null = null;
    if (rawKey) {
      tenant = await store.getTenantByApiKey(rawKey);
      if (!tenant) {
        return {
          ok: false,
          response: c.json(
            {
              error: "Invalid API key. Register via POST /v1/register or attach X-PAYMENT.",
            },
            401
          ),
        };
      }
    }

    if (xPayment) {
      const verified = await verifyAndConsumeXPayment({
        config,
        client: rhcClient,
        getRhcClient: getClientForChain,
        store,
        rawHeader: xPayment,
        minimumMicroUsdg: costMicroUsdg,
        tenantId: tenant?.id ?? null,
      });
      if (!verified.ok) {
        return {
          ok: false,
          response: c.json(
            {
              ...buildX402Quote(config, endpointPath, costMicroUsdg, description),
              error: verified.error,
            },
            402
          ),
        };
      }

      if (tenant) {
        const surplus = verified.creditedMicroUsdg - costMicroUsdg;
        if (surplus > 0n) {
          tenant = await store.addCredit(tenant.id, surplus);
        }
      }
      return {
        ok: true,
        tenant,
        chargedMicro: costMicroUsdg,
        paidViaX402: true,
        chargedMeta: {
          asset: verified.assetSymbol,
          amount: costMicroUsdg.toString(),
          unit: "micro",
          rail: verified.rail,
          settlementTxHash: verified.settlementTxHash,
        },
      };
    }

    if (!tenant) {
      return {
        ok: false,
        response: c.json(
          buildX402Quote(config, endpointPath, costMicroUsdg, description),
          402
        ),
      };
    }

    const charged = await store.chargeCredit(tenant.id, costMicroUsdg);
    if (!charged.ok) {
      return {
        ok: false,
        response: c.json(
          buildX402Quote(config, endpointPath, costMicroUsdg, description),
          402
        ),
      };
    }

    return {
      ok: true,
      tenant: charged.tenant,
      chargedMicro: costMicroUsdg,
      paidViaX402: false,
      chargedMeta: {
        asset: "USDG",
        amount: costMicroUsdg.toString(),
        unit: "micro",
        rail: activeProfile.network,
      },
    };
  }

  function computeBuybackShare(chargedMicro: bigint): bigint {
    return (chargedMicro * BigInt(config.buybackRevenueBps)) / 10_000n;
  }

  /** Checks the server policy marks `required` (never influenced by the request body). */
  function requiredChecksFromConfig(): CheckName[] {
    return KNOWN_CHECKS.filter((n) => config.checkModes[n] === "required");
  }

  /** Clients may shorten the allow TTL but never extend it past the server's configured TTL. */
  function clampTtl(requested: unknown): number {
    const n = Number(requested);
    if (!Number.isFinite(n) || n <= 0) return config.allowTtlSeconds;
    return Math.min(Math.floor(n), config.allowTtlSeconds);
  }

  // --- Health & Open Config Readout ---
  app.get("/health", async (c) => {
    const seq = await checkSequencerHealth(config, rhcClient, config.activeChainId).catch(
      () => null
    );
    return c.json({
      status: "ok",
      product: config.productName,
      chainId: config.activeChainId,
      network: activeProfile.network,
      isTestnet: activeProfile.isTestnet,
      explorerUrl: activeProfile.explorerUrl,
      faucetUrl: activeProfile.faucetUrl,
      storageDriver: store.driver,
      sequencer: seq,
      registry: registry.getStats(config.activeChainId),
    });
  });

  app.get("/v1/config", async (c) => {
    await registry.ensureFresh().catch(() => undefined);
    const admin = isAdmin(c);
    const [revenue, sequencer] = await Promise.all([
      // STORE-1: the global revenue ledger is admin-only
      admin
        ? store.getRevenueSummary().catch(() => null)
        : Promise.resolve(null),
      checkSequencerHealth(config, rhcClient, config.activeChainId).catch(() => null),
    ]);
    const settlement = resolveSettlementMode(config);

    return c.json({
      productName: config.productName,
      network: activeProfile.network,
      chainId: config.activeChainId,
      isTestnet: activeProfile.isTestnet,
      chainName: activeProfile.name,
      explorerUrl: activeProfile.explorerUrl,
      faucetUrl: activeProfile.faucetUrl,
      supportedNetworks: ["eip155:46630", "eip155:4663"],
      apiKeyPrefix: config.apiKeyPrefix,
      storageDriver: store.driver,
      neonConfigured: Boolean(config.databaseUrl),
      pricesMicroUsdg: {
        verify: config.pricesMicroUsdg.verify.toString(),
        simulate: config.pricesMicroUsdg.simulate.toString(),
        tokenRisk: config.pricesMicroUsdg.tokenRisk.toString(),
        check: config.pricesMicroUsdg.check.toString(),
        guard: config.pricesMicroUsdg.guard.toString(),
      },
      paymentRails: {
        primaryNetwork: activeProfile.network,
        usdgAddress: activeProfile.usdgAddress,
        wethAddress: activeProfile.wethAddress,
        usdgRhc46630: getRhcChainProfile(RHC_TESTNET_CHAIN_ID).usdgAddress,
        usdgRhc4663: getRhcChainProfile(RHC_MAINNET_CHAIN_ID).usdgAddress,
        payTo: config.x402PayToError ? null : config.x402PayTo,
        settlementMode: config.x402SettlementMode,
        effectiveSettlementMode: settlement.ok ? settlement.mode : "unavailable",
        settlementError: settlement.ok ? null : settlement.error,
        minConfirmations: config.x402MinConfirmations,
        relayerConfigured: Boolean(config.x402RelayerPrivateKey),
        usdcBaseEnabled: config.enableUsdcBase,
        usdcSolanaEnabled: config.enableUsdcSolana,
        // QM-6: pinned EIP-712 domain vs live contract ("mismatch" => EIP-3009 refused with Q-007)
        usdgEip712Domain: getEip712DomainStatus(config.activeChainId, activeProfile.usdgAddress),
      },
      policy: {
        checkModes: config.checkModes,
        allowTtlSeconds: config.allowTtlSeconds,
        allowAbstainOverride: config.allowAbstainOverride,
        maxTaxBps: config.maxTaxBps,
        maxTop10HolderBps: config.maxTop10HolderBps,
      },
      buyback: {
        tokenTicker: config.tokenTicker,
        ponsTokenAddress: config.ponsTokenAddress,
        buybackWallet: config.buybackWallet,
        burnAddress: config.burnAddress,
        buybackRevenueBps: config.buybackRevenueBps,
        configErrors: config.buybackConfigErrors,
        // Global ledger only for admins (x-admin-key); tenants see their own totals via /v1/receipts
        ledger: revenue,
      },
      security: {
        corsRestricted: !devCorsAny,
        rateLimitPerMinute: config.rateLimitPerMinute,
        registerLimitPerIpPerHour: config.registerLimitPerIpPerHour,
        freeCreditMicroUsdg: config.devFreeCreditMicroUsdg.toString(),
      },
      zk: {
        enabled: config.zkEnabled,
        defaultSystem: config.zkSystem,
        halo2Enabled: config.zkHalo2Enabled,
        scope: "quote",
        verifierAddress: config.zkVerifierAddress,
        sp1ProverConfigured: Boolean(config.zkSp1ProverUrl),
        programVKeyIsPlaceholder: !config.zkProgramVKey,
        onchainBroadcastEnabled: Boolean(
          config.zkVerifierAddress && config.zkVerifierPrivateKey
        ),
        batchSize: config.zkBatchSize,
      },
      sequencer,
      registry: registry.getStats(config.activeChainId),
    });
  });

  // --- Public Registry Listing Endpoint for Web Registry View ---
  app.get("/v1/registry", async (c) => {
    await registry.ensureFresh().catch(() => undefined);
    const qChain = Number(c.req.query("chainId") || config.activeChainId);
    const chainId = isSupportedRhcChainId(qChain) ? qChain : config.activeChainId;
    const prof = getRhcChainProfile(chainId);
    return c.json({
      chainId,
      network: prof.network,
      isTestnet: prof.isTestnet,
      explorerUrl: prof.explorerUrl,
      canonical: {
        usdg: prof.usdgAddress,
        weth: prof.wethAddress,
      },
      stockTokens: registry.listStockTokens(chainId),
      stats: registry.getStats(chainId),
    });
  });

  // --- 1. POST /v1/register (Agentless Tenant Registration + Optional X-PAYMENT Top-up) ---
  app.post("/v1/register", async (c) => {
    let initialCredit = config.devFreeCreditMicroUsdg;
    const xPayment = c.req.header("x-payment");

    // C5: store-backed limits (shared across serverless instances) per IP and per payer.
    try {
      if (config.registerLimitPerIpPerHour > 0) {
        const ipHit = await store.hitRateLimit(
          `register:ip:${clientIp(c)}`,
          3600,
          config.registerLimitPerIpPerHour
        );
        if (!ipHit.allowed) {
          c.header("Retry-After", String(Math.max(1, Math.ceil((Date.parse(ipHit.resetAt) - Date.now()) / 1000))));
          return c.json(
            {
              error: "Too many registrations from this IP. Try again later.",
              limitPerHour: config.registerLimitPerIpPerHour,
              resetAt: ipHit.resetAt,
            },
            429
          );
        }
      }
      if (xPayment && config.registerLimitPerPayerPerHour > 0) {
        const payer = await peekXPaymentPayer(xPayment, config.activeChainId);
        if (payer) {
          const payerHit = await store.hitRateLimit(
            `register:payer:${payer}`,
            3600,
            config.registerLimitPerPayerPerHour
          );
          if (!payerHit.allowed) {
            return c.json(
              {
                error: "Too many registrations for this payer. Try again later.",
                limitPerHour: config.registerLimitPerPayerPerHour,
                resetAt: payerHit.resetAt,
              },
              429
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        return c.json({ error: "Registration temporarily unavailable (storage)" }, 503);
      }
      throw err;
    }

    if (xPayment) {
      const verified = await verifyAndConsumeXPayment({
        config,
        client: rhcClient,
        getRhcClient: getClientForChain,
        store,
        rawHeader: xPayment,
        minimumMicroUsdg: 1n,
        tenantId: null,
      });
      if (!verified.ok) {
        return c.json(
          {
            ...buildX402Quote(
              config,
              "/v1/register",
              config.pricesMicroUsdg.guard,
              "Optional initial credit top-up on registration"
            ),
            error: verified.error,
          },
          402
        );
      }
      initialCredit += verified.creditedMicroUsdg;
    }

    const { tenant, rawApiKey } = await store.createTenant(initialCredit);
    return c.json(
      {
        tenantId: tenant.id,
        apiKey: rawApiKey,
        apiKeyHint: tenant.apiKeyHint,
        creditMicroUsdg: tenant.creditMicroUsdg.toString(),
        asset: "USDG",
        unit: "micro",
        network: activeProfile.network,
        chainId: config.activeChainId,
        createdAt: tenant.createdAt,
      },
      201
    );
  });

  // --- 2. GET /v1/balance (Credit Balance) ---
  app.get("/v1/balance", async (c) => {
    const rawKey = extractBearerKey(c);
    if (!rawKey) {
      return c.json({ error: "Missing Authorization Bearer API key" }, 401);
    }
    const tenant = await store.getTenantByApiKey(rawKey);
    if (!tenant) {
      return c.json({ error: "Invalid API key" }, 401);
    }
    return c.json({
      tenantId: tenant.id,
      apiKeyHint: tenant.apiKeyHint,
      creditMicroUsdg: tenant.creditMicroUsdg.toString(),
      totalSpentMicroUsdg: tenant.totalSpentMicroUsdg.toString(),
      asset: "USDG",
      unit: "micro",
      network: activeProfile.network,
      chainId: config.activeChainId,
    });
  });

  // --- Tenant Receipt / Decision Log Endpoint (§8.1 simple receipt/dashboard) ---
  // STORE-1: API key required; a tenant only ever sees its own receipts and totals.
  // The global ledger (all tenants) is available only with `x-admin-key` = ZGUARD_ADMIN_API_KEY.
  app.get("/v1/metrics", (c) => {
    return c.json({ latency: metrics.snapshot(), targetP95Ms: 800 });
  });

  app.get("/v1/receipts", async (c) => {
    const limit = Math.max(1, Math.min(Number(c.req.query("limit") || 25) || 25, 100));
    const rawKey = extractBearerKey(c);

    if (!rawKey) {
      if (isAdmin(c)) {
        const [receipts, revenue] = await Promise.all([
          store.listReceipts(null, limit),
          store.getRevenueSummary(),
        ]);
        return c.json({ scope: "admin-global", tenant: null, revenue, receipts });
      }
      return c.json(
        { error: "Missing API key. Send Authorization: Bearer <apiKey> (from POST /v1/register)." },
        401
      );
    }

    const tenant = await store.getTenantByApiKey(rawKey);
    if (!tenant) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    const [receipts, revenue] = await Promise.all([
      store.listReceipts(tenant.id, limit),
      store.getRevenueSummary(tenant.id),
    ]);

    return c.json({
      scope: "tenant",
      tenant: {
        tenantId: tenant.id,
        apiKeyHint: tenant.apiKeyHint,
        creditMicroUsdg: tenant.creditMicroUsdg.toString(),
        totalSpentMicroUsdg: tenant.totalSpentMicroUsdg.toString(),
      },
      revenue,
      receipts,
    });
  });

  // --- 3. GET /v1/token/:chainId/:address (Free Registry & Observation Lookup — §5.1) ---
  // Rule §5.1: 404 = not observed yet, NEVER `allow`!
  app.get("/v1/token/:chainId/:address", async (c) => {
    const chainId = Number(c.req.param("chainId"));
    const address = c.req.param("address");

    if (!isSupportedRhcChainId(chainId) || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return c.json(
        {
          observed: false,
          note: "Not observed. 404 means unobserved, never allow.",
        },
        404
      );
    }

    await registry.ensureFresh().catch(() => undefined);
    const lower = address.toLowerCase();
    const prof = getRhcChainProfile(chainId);

    if (lower === prof.usdgAddress.toLowerCase()) {
      return c.json({
        observed: true,
        chainId,
        address: prof.usdgAddress,
        kind: "usdg",
        symbol: "USDG",
        name: "Global Dollar",
        decimals: 6,
      });
    }

    if (lower === prof.wethAddress.toLowerCase()) {
      return c.json({
        observed: true,
        chainId,
        address: prof.wethAddress,
        kind: "other",
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
      });
    }

    const stock = registry.getStockTokenByAddress(lower, chainId);
    if (stock) {
      return c.json({
        observed: true,
        chainId,
        address: stock.address,
        kind: "stock_token",
        symbol: stock.symbol,
        name: stock.name,
        decimals: 18,
      });
    }

    const obs = await store.getTokenObservation(chainId, lower);
    if (obs) {
      return c.json({
        observed: true,
        chainId,
        address,
        updatedAt: obs.updatedAt,
        token_risk: obs.risk,
      });
    }

    return c.json(
      {
        observed: false,
        chainId,
        address,
        note: "Token has not been observed yet. 404 is not allow; run POST /v1/token-risk or POST /v1/guard.",
      },
      404
    );
  });

  // --- 4. POST /v1/verify (Quote-match + async ZK quote proof — $0.003) ---
  app.post("/v1/verify", async (c) => {
    const startMs = Date.now();
    try {
      const gate = await authorizeAndCharge(
        c,
        "/v1/verify",
        config.pricesMicroUsdg.verify,
        "ZGuard quote-match verification (/v1/verify)"
      );
      if (!gate.ok) return gate.response;

      const body = (await c.req.json().catch(() => ({}))) as GuardRequest;
      const network = body.network ?? activeProfile.network;
      const reqChainId = parseChainIdFromNetwork(network) ?? config.activeChainId;
      const quoteRes = evaluateQuoteMatch({
        network,
        quote: body.quote,
        payload: body.payload,
        spendPolicy: body.options?.spendPolicy ?? gate.tenant?.spendPolicy ?? undefined,
      });

      const agg = aggregateDecision({
        checks: { quote: quoteRes },
        modes: { quote: "required" },
        ttlSeconds: clampTtl(body.options?.ttlSeconds),
      });

      const decisionId = `dec_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const payloadHash = computePayloadHash({
        network,
        quote: body.quote,
        payload: body.payload,
        token: body.token,
      });

      let zkAttestation = undefined;
      if (config.zkEnabled && body.options?.enableZk !== false) {
        const sys = body.options?.zkSystem ?? config.zkSystem;
        zkAttestation = buildInitialZkAttestation({
          decisionId,
          system: sys,
          request: { network, quote: body.quote, payload: body.payload },
          quoteVerdict: quoteRes.decision,
          quoteCodes: quoteRes.codes,
          verifierAddress: config.zkVerifierAddress,
          programVKeyOverride: config.zkProgramVKey,
        });
      }

      const response: GuardResponse = {
        decisionId,
        decision: agg.decision,
        reason: agg.reason,
        codes: agg.codes,
        payload_hash: payloadHash,
        expires_at: agg.expires_at,
        network,
        checks: { quote: quoteRes },
        flags: agg.flags,
        charged: gate.chargedMeta,
        ...(zkAttestation ? { attestation: { zk: zkAttestation } } : {}),
        receiptMeta: { latencyMs: Date.now() - startMs },
      };

      await store.saveReceipt({
        decisionId,
        tenantId: gate.tenant?.id ?? null,
        endpoint: "/v1/verify",
        chargedMicroUsdg: gate.chargedMicro,
        buybackMicroUsdg: computeBuybackShare(gate.chargedMicro),
        response,
      });

      if (zkAttestation) {
        await store.upsertZkAttestation(zkAttestation);
        const zkRpc = getRpcUrlsForChain(
          config,
          isSupportedRhcChainId(reqChainId) ? reqChainId : config.activeChainId
        )[0];
        void proveQuoteAttestationAsync(zkAttestation, {
          rpcUrl: zkRpc,
          chainId: isSupportedRhcChainId(reqChainId) ? reqChainId : config.activeChainId,
          sp1ProverUrl: config.zkSp1ProverUrl ?? undefined,
          verifierAddress: config.zkVerifierAddress ?? undefined,
          verifierPrivateKey: config.zkVerifierPrivateKey ?? undefined,
          guestInput: buildSp1GuestInput({ network, quote: body.quote, payload: body.payload }, quoteRes.codes),
          onUpdated: (upd) => store.upsertZkAttestation(upd),
        });
      }

      return c.json(response);
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        return c.json(
          {
            decision: "abstain",
            reason: "policy/receipt storage unavailable (fail-closed abstain)",
            codes: ["P-UNAVAIL"],
            payload_hash: "0x" + "0".repeat(64),
            expires_at: null,
            network: activeProfile.network,
            checks: {},
            flags: [],
            charged: null,
          } satisfies GuardResponse,
          200
        );
      }
      throw err;
    }
  });

  // --- 5. POST /v1/simulate (RHC Transaction Simulation — $0.005) ---
  app.post("/v1/simulate", async (c) => {
    const startMs = Date.now();
    const gate = await authorizeAndCharge(
      c,
      "/v1/simulate",
      config.pricesMicroUsdg.simulate,
      "ZGuard RHC transaction simulation (/v1/simulate)"
    );
    if (!gate.ok) return gate.response;

    const body = (await c.req.json().catch(() => ({}))) as GuardRequest;
    const network = body.network ?? activeProfile.network;
    const reqChainId = parseChainIdFromNetwork(network) ?? config.activeChainId;
    const simRes = await simulateOnRhc(
      config,
      getClientForChain(reqChainId),
      { ...body, network }
    );
    const agg = aggregateDecision({
      checks: { simulation: simRes },
      modes: { simulation: "required" },
      ttlSeconds: clampTtl(body.options?.ttlSeconds),
    });

    const decisionId = `dec_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const response: GuardResponse = {
      decisionId,
      decision: agg.decision,
      reason: agg.reason,
      codes: agg.codes,
      payload_hash: computePayloadHash({
        network,
        quote: body.quote,
        payload: body.payload,
        token: body.token,
      }),
      expires_at: agg.expires_at,
      network,
      checks: { simulation: simRes },
      flags: agg.flags,
      charged: gate.chargedMeta,
      receiptMeta: { latencyMs: Date.now() - startMs },
    };

    await store.saveReceipt({
      decisionId,
      tenantId: gate.tenant?.id ?? null,
      endpoint: "/v1/simulate",
      chargedMicroUsdg: gate.chargedMicro,
      buybackMicroUsdg: computeBuybackShare(gate.chargedMicro),
      response,
    });

    return c.json(response);
  });

  // --- 6. POST /v1/token-risk (RHC Token Risk — $0.01) ---
  app.post("/v1/token-risk", async (c) => {
    const startMs = Date.now();
    const gate = await authorizeAndCharge(
      c,
      "/v1/token-risk",
      config.pricesMicroUsdg.tokenRisk,
      "ZGuard RHC token risk scan (/v1/token-risk)"
    );
    if (!gate.ok) return gate.response;

    const body = (await c.req.json().catch(() => ({}))) as {
      network?: string;
      token?: string;
      recipient?: string;
    };
    const network = body.network ?? activeProfile.network;
    const chainId = parseChainIdFromNetwork(network);

    const riskRes = isSupportedRhcChainId(chainId)
      ? await evaluateTokenRiskRhc({
          config,
          client: getClientForChain(chainId),
          registry,
          chainId,
          tokenAddress: body.token,
          recipientForSnipeTax: body.recipient,
        })
      : {
          decision: "abstain" as const,
          codes: ["T-UNKNOWN" as const],
          token: body.token ?? null,
          kind: "other" as const,
          holders: { count: null, top10Bps: null },
          liquidity: {
            venue: "unknown" as const,
            locked: null,
            detail: { note: "Only Robinhood Chain eip155:46630 & eip155:4663 supported" },
          },
          tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
          authorities: { owner: null, mintable: null, pausable: null },
          pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
        };

    if (isSupportedRhcChainId(chainId) && body.token && /^0x[0-9a-fA-F]{40}$/.test(body.token)) {
      await store.upsertTokenObservation(chainId, body.token, riskRes);
    }

    const agg = aggregateDecision({
      checks: { token_risk: riskRes },
      modes: { token_risk: "required" },
      ttlSeconds: config.allowTtlSeconds,
    });

    const decisionId = `dec_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const response: GuardResponse = {
      decisionId,
      decision: agg.decision,
      reason: agg.reason,
      codes: agg.codes,
      payload_hash: computePayloadHash({ network, token: body.token }),
      expires_at: agg.expires_at,
      network,
      checks: {
        token_risk: riskRes,
        ...(riskRes.metadataScan ? { content: riskRes.metadataScan } : {}),
      },
      flags: agg.flags,
      charged: gate.chargedMeta,
      receiptMeta: { latencyMs: Date.now() - startMs },
    };

    await store.saveReceipt({
      decisionId,
      tenantId: gate.tenant?.id ?? null,
      endpoint: "/v1/token-risk",
      chargedMicroUsdg: gate.chargedMicro,
      buybackMicroUsdg: computeBuybackShare(gate.chargedMicro),
      response,
    });

    return c.json({
      ...response,
      token_risk: riskRes,
    });
  });

  // --- 7. POST /v1/check (Content / Metadata / Remote URL Scanner — $0.005; failed/rejected URL is FREE per §2.2!) ---
  app.post("/v1/check", async (c) => {
    const startMs = Date.now();
    const gate = await authorizeAndCharge(
      c,
      "/v1/check",
      config.pricesMicroUsdg.check,
      "ZGuard content & metadata scan (/v1/check)"
    );
    if (!gate.ok) return gate.response;

    await registry.ensureFresh().catch(() => undefined);
    const body = (await c.req.json().catch(() => ({}))) as {
      network?: string;
      content?: GuardRequest["content"];
      text?: string;
      url?: string;
      symbol?: string;
      name?: string;
      tokenAddress?: string;
    };

    const network = body.network ?? activeProfile.network;
    const reqChainId = parseChainIdFromNetwork(network) ?? config.activeChainId;

    const contentInput = body.content ?? {
      text: body.text,
      url: body.url,
      symbol: body.symbol,
      name: body.name,
      tokenAddress: body.tokenAddress,
    };

    const { result: contentRes, waiveCharge } = await scanContentWithRemoteUrl(
      config,
      contentInput,
      registry.getCanonicalTickerMap(reqChainId)
    );

    // §2.2 Dev Brief: "Setiap tautan metadata yang dipindai: $0,005 (tautan gagal/ditolak: gratis)"
    let finalChargedMicro = gate.chargedMicro;
    let finalChargedMeta = gate.chargedMeta;
    if (waiveCharge && gate.chargedMicro > 0n) {
      if (gate.tenant) {
        await store.addCredit(gate.tenant.id, gate.chargedMicro);
      }
      finalChargedMicro = 0n;
      finalChargedMeta = {
        ...gate.chargedMeta,
        amount: "0",
      };
    }

    const decisionId = `dec_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    const response: GuardResponse = {
      decisionId,
      decision: contentRes.decision,
      reason:
        contentRes.verdict === "findings"
          ? "content rules matched suspicious agent-targeted patterns"
          : contentRes.verdict,
      codes: contentRes.codes,
      payload_hash: computePayloadHash({ network }),
      expires_at: null,
      network,
      checks: { content: contentRes },
      flags: [],
      charged: finalChargedMeta,
      receiptMeta: { latencyMs: Date.now() - startMs },
    };

    await store.saveReceipt({
      decisionId,
      tenantId: gate.tenant?.id ?? null,
      endpoint: "/v1/check",
      chargedMicroUsdg: finalChargedMicro,
      buybackMicroUsdg: computeBuybackShare(finalChargedMicro),
      response,
    });

    return c.json({
      ...response,
      content: contentRes,
    });
  });

  // --- 8. POST /v1/guard (Single Call, Three Checks + Content + Async ZK — $0.015) ---
  app.post("/v1/guard", async (c) => {
    const startMs = Date.now();
    try {
      const gate = await authorizeAndCharge(
        c,
        "/v1/guard",
        config.pricesMicroUsdg.guard,
        "ZGuard bundled guard check: quote-match + RHC simulation + RHC token risk (/v1/guard)"
      );
      if (!gate.ok) return gate.response;

      const body = (await c.req.json().catch(() => ({}))) as GuardRequest;
      if (!body.network) {
        return c.json(
          { error: `\`network\` is required (e.g. "${activeProfile.network}")` },
          400
        );
      }

      // C4: the SERVER decides which checks are required (ZGUARD_REQUIRED_CHECKS). The request body may
      // only ADD checks (e.g. "content"); it can never drop a required one.
      const serverRequired = requiredChecksFromConfig();
      const clientRequested = Array.isArray(body.checks)
        ? body.checks.filter((n): n is CheckName => KNOWN_CHECKS.includes(n as CheckName))
        : [];
      const requestedChecks: CheckName[] = Array.from(
        new Set<CheckName>([...serverRequired, ...clientRequested])
      );
      const chainId = parseChainIdFromNetwork(body.network);

      // §5.2: Full guard requires Robinhood Chain (Testnet 46630 or Mainnet 4663), unless quote-only check on enabled payment rail
      const isQuoteOnly =
        requestedChecks.length === 1 && requestedChecks[0] === "quote";
      if (!isSupportedRhcChainId(chainId) && !isQuoteOnly) {
        const abstainResp: GuardResponse = {
          decisionId: `dec_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          decision: "abstain",
          reason: `MVP full guard requires Robinhood Chain eip155:46630 or eip155:4663 (received ${body.network})`,
          codes: ["Q-004"],
          payload_hash: computePayloadHash(body),
          expires_at: null,
          network: body.network,
          checks: {},
          flags: [],
          charged: gate.chargedMeta,
        };
        return c.json(abstainResp);
      }

      const targetRhcChainId = isSupportedRhcChainId(chainId)
        ? chainId
        : config.activeChainId;
      const chainClient = getClientForChain(targetRhcChainId);

      await registry.ensureFresh().catch(() => undefined);

      const derivedToken =
        body.token ??
        body.quote?.asset ??
        body.payload?.intent?.expectedOut?.token ??
        undefined;

      const checksOut: GuardResponse["checks"] = {};

      // 1. Quote-match (fast, synchronous)
      if (requestedChecks.includes("quote")) {
        checksOut.quote = evaluateQuoteMatch({
          network: body.network,
          quote: body.quote,
          payload: body.payload,
          spendPolicy: body.options?.spendPolicy ?? gate.tenant?.spendPolicy ?? undefined,
        });
      }

      // 2, 3 & 4. Run RHC Simulation + RHC Token Risk + Remote Content URL Scan concurrently!
      const upstreamUndecodable =
        checksOut.quote?.codes.includes("Q-DECODE") === true;

      const [simResult, tokenRiskResult, contentWrap] = await Promise.all([
        requestedChecks.includes("simulation")
          ? upstreamUndecodable
            ? Promise.resolve({
                decision: "abstain" as const,
                codes: ["S-FAIL" as const],
                status: "unknown" as const,
                gasUsed: null,
                balanceChanges: [],
                approvals: [],
                calls: [],
                notes: ["Skipped simulation because upstream payload failed to decode"],
              })
            : simulateOnRhc(config, chainClient, body)
          : Promise.resolve(undefined),
        requestedChecks.includes("token_risk")
          ? evaluateTokenRiskRhc({
              config,
              client: chainClient,
              registry,
              chainId: targetRhcChainId,
              tokenAddress: derivedToken,
              // TR-5: pons snipe tax depends on who receives the tokens; default to the actual buyer
              // (intent recipient, then tx sender) instead of a placeholder address.
              recipientForSnipeTax:
                body.options?.recipientForSnipeTax ??
                body.payload?.intent?.expectedOut?.recipient ??
                (typeof body.payload?.tx === "object" ? body.payload.tx.from : undefined) ??
                body.payload?.intent?.from,
            })
          : Promise.resolve(undefined),
        body.content || requestedChecks.includes("content")
          ? scanContentWithRemoteUrl(
              config,
              body.content,
              registry.getCanonicalTickerMap(targetRhcChainId)
            )
          : Promise.resolve(undefined),
      ]);

      if (simResult) checksOut.simulation = simResult;
      if (tokenRiskResult) {
        checksOut.token_risk = tokenRiskResult;
        if (derivedToken && /^0x[0-9a-fA-F]{40}$/.test(derivedToken)) {
          void store
            .upsertTokenObservation(targetRhcChainId, derivedToken, tokenRiskResult)
            .catch(() => undefined);
        }
      }

      if (contentWrap) {
        checksOut.content = contentWrap.result;
      } else if (tokenRiskResult?.metadataScan) {
        checksOut.content = tokenRiskResult.metadataScan;
      } else {
        checksOut.content = {
          decision: "allow",
          verdict: "unchecked",
          codes: [],
        };
      }

      const activeModes = tightenCheckModes(
        {
          ...config.checkModes,
          content:
            config.checkModes.content === "required" || clientRequested.includes("content")
              ? "required"
              : "advisory",
        },
        body.options?.checkModes
      );

      const agg = aggregateDecision({
        checks: checksOut,
        modes: activeModes,
        requiredChecks: serverRequired,
        ttlSeconds: clampTtl(body.options?.ttlSeconds),
      });

      const decisionId = `dec_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const payloadHash = computePayloadHash(body);

      let zkAttestation = undefined;
      if (
        config.zkEnabled &&
        body.options?.enableZk !== false &&
        checksOut.quote !== undefined
      ) {
        const sys = body.options?.zkSystem ?? config.zkSystem;
        zkAttestation = buildInitialZkAttestation({
          decisionId,
          system: sys,
          request: {
            network: body.network,
            quote: body.quote,
            payload: body.payload,
          },
          quoteVerdict: checksOut.quote.decision,
          quoteCodes: checksOut.quote.codes,
          verifierAddress: config.zkVerifierAddress,
          programVKeyOverride: config.zkProgramVKey,
        });
      }

      const response: GuardResponse = {
        decisionId,
        decision: agg.decision,
        reason: agg.reason,
        codes: agg.codes,
        payload_hash: payloadHash,
        expires_at: agg.expires_at,
        network: body.network,
        checks: checksOut,
        flags: agg.flags,
        charged: gate.chargedMeta,
        ...(zkAttestation ? { attestation: { zk: zkAttestation } } : {}),
        receiptMeta: { latencyMs: Date.now() - startMs },
      };

      await store.saveReceipt({
        decisionId,
        tenantId: gate.tenant?.id ?? null,
        endpoint: "/v1/guard",
        chargedMicroUsdg: gate.chargedMicro,
        buybackMicroUsdg: computeBuybackShare(gate.chargedMicro),
        response,
      });

      if (zkAttestation) {
        await store.upsertZkAttestation(zkAttestation);
        const zkRpc = getRpcUrlsForChain(config, targetRhcChainId)[0];
        void proveQuoteAttestationAsync(zkAttestation, {
          rpcUrl: zkRpc,
          chainId: targetRhcChainId,
          sp1ProverUrl: config.zkSp1ProverUrl ?? undefined,
          verifierAddress: config.zkVerifierAddress ?? undefined,
          verifierPrivateKey: config.zkVerifierPrivateKey ?? undefined,
          guestInput: buildSp1GuestInput(
            { network: body.network, quote: body.quote, payload: body.payload },
            checksOut.quote?.codes ?? []
          ),
          onUpdated: (upd) => store.upsertZkAttestation(upd),
        });
      }

      return c.json(response);
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        return c.json(
          {
            decision: "abstain",
            reason: "policy/receipt storage unavailable (fail-closed abstain)",
            codes: ["P-UNAVAIL"],
            payload_hash: "0x" + "0".repeat(64),
            expires_at: null,
            network: activeProfile.network,
            checks: {},
            flags: [],
            charged: null,
          } satisfies GuardResponse,
          200
        );
      }
      throw err;
    }
  });

  // --- 9. GET /v1/attestation/:decisionId (§8.3 Async ZK Attestation Lookup) ---
  app.get("/v1/attestation/:decisionId", async (c) => {
    const decisionId = c.req.param("decisionId");
    const att = await store.getZkAttestation(decisionId);
    if (!att) {
      return c.json({ error: `No ZK attestation found for decisionId ${decisionId}` }, 404);
    }
    return c.json({
      ...att,
      scope: "quote", // §8.3: strictly always "quote"
    });
  });

  return { app, config, store, registry, rhcClient };
}
