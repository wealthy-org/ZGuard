import { NETWORK_RHC_TESTNET } from "./constants.js";
import { aggregateDecision } from "./decision.js";
import { scanContent } from "./content-scan.js";
import { computePayloadHash } from "./hash.js";
import { evaluateQuoteMatch } from "./quote-match.js";
import type {
  ContentCheckResult,
  GuardRequest,
  GuardResponse,
  TokenRiskCheckResult,
  X402QuoteResponse,
  ZkAttestation,
} from "./types.js";

export interface ZGuardClientOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Optional x402 payment callback: receives HTTP 402 quote and returns X-PAYMENT header value */
  onPaymentRequired?: (quote: X402QuoteResponse) => Promise<string | null>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class X402PaymentRequiredError extends Error {
  public readonly quote: X402QuoteResponse;
  constructor(quote: X402QuoteResponse) {
    super(quote.error || "HTTP 402 Payment Required");
    this.name = "X402PaymentRequiredError";
    this.quote = quote;
  }
}

/**
 * Pure offline guard evaluation (no API key, no RPC, no network telemetry — §4.1).
 * Evaluates `quote` and optional `content` locally; marks `simulation` / `token_risk` as
 * `abstain` if requested offline so fail-closed semantics are preserved.
 */
export function guardOffline(req: GuardRequest): GuardResponse {
  const requested = req.checks ?? ["quote"];
  const payloadHash = computePayloadHash(req);
  const checks: GuardResponse["checks"] = {};

  if (requested.includes("quote")) {
    checks.quote = evaluateQuoteMatch({
      network: req.network,
      quote: req.quote,
      payload: req.payload,
      spendPolicy: req.options?.spendPolicy,
    });
  }

  if (requested.includes("simulation")) {
    checks.simulation = {
      decision: "abstain",
      codes: ["S-FAIL"],
      status: "unknown",
      gasUsed: null,
      balanceChanges: [],
      approvals: [],
      calls: [],
      notes: ["Offline SDK mode cannot run RHC 4663 state simulation; configure ZGuardClient or RPC"],
    };
  }

  if (requested.includes("token_risk")) {
    checks.token_risk = {
      decision: "abstain",
      codes: ["T-UNKNOWN"],
      token: req.token ?? req.quote?.asset ?? null,
      kind: "other",
      holders: { count: null, top10Bps: null },
      liquidity: { venue: "unknown", locked: null, detail: {} },
      tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
      authorities: { owner: null, mintable: null, pausable: null },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
    };
  }

  if (req.content || requested.includes("content")) {
    checks.content = scanContent(req.content);
  }

  const agg = aggregateDecision({
    checks,
    modes: req.options?.checkModes,
    ttlSeconds: req.options?.ttlSeconds,
  });

  return {
    decision: agg.decision,
    reason: agg.reason,
    codes: agg.codes,
    payload_hash: payloadHash,
    expires_at: agg.expires_at,
    network: req.network,
    checks,
    flags: agg.flags,
    charged: null,
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * SDK-1: a bearer API key is spendable credit; never send it in cleartext. Plain http is only allowed to
 * loopback (local dev). Inside guard() this error becomes a fail-closed abstain.
 */
export function assertKeySafeTransport(baseUrl: string): void {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid ZGuard API URL: ${baseUrl}`);
  }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (LOOPBACK_HOSTS.has(u.hostname) || u.hostname.endsWith(".localhost"))) return;
  throw new Error(`Refusing to send the ZGuard API key over ${u.protocol}//${u.hostname}; use https`);
}

/**
 * ZGuard Hosted API client with fail-closed behavior and x402 payment loop (§4.3, §5, §8.1).
 */
export class ZGuardClient {
  private readonly baseUrl: string;
  private apiKey?: string;
  private readonly onPaymentRequired?: (quote: X402QuoteResponse) => Promise<string | null>;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: ZGuardClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.ZGUARD_API_URL ?? "http://localhost:8787").replace(
      /\/+$/,
      ""
    );
    this.apiKey = opts.apiKey ?? process.env.ZGUARD_API_KEY;
    this.onPaymentRequired = opts.onPaymentRequired;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.fetchFn = opts.fetchImpl ?? fetch;
  }

  public setApiKey(key: string): void {
    this.apiKey = key;
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    paymentHeader?: string
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (paymentHeader) {
      headers["X-PAYMENT"] = paymentHeader;
    }

    if (this.apiKey) assertKeySafeTransport(this.baseUrl);
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (res.status === 402) {
      const quote = (await res.json()) as X402QuoteResponse;
      if (!paymentHeader && this.onPaymentRequired) {
        const signedPayment = await this.onPaymentRequired(quote);
        if (signedPayment) {
          return this.requestJson<T>(method, path, body, signedPayment);
        }
      }
      throw new X402PaymentRequiredError(quote);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`ZGuard API HTTP ${res.status}: ${errBody || res.statusText}`);
    }

    return (await res.json()) as T;
  }

  public async register(paymentHeader?: string): Promise<{
    tenantId: string;
    apiKey: string;
    creditMicroUsdg: string;
  }> {
    const out = await this.requestJson<{
      tenantId: string;
      apiKey: string;
      creditMicroUsdg: string;
    }>("POST", "/v1/register", {}, paymentHeader);
    this.apiKey = out.apiKey;
    return out;
  }

  public async balance(): Promise<{
    tenantId: string;
    creditMicroUsdg: string;
    totalSpentMicroUsdg: string;
    asset: "USDG";
    network: string;
    chainId?: number;
  }> {
    return this.requestJson("GET", "/v1/balance");
  }

  /**
   * Calls POST /v1/guard.
   * Criterion §9 #8 (Fail-closed): if the API is unreachable or times out (other than 402),
   * returns an `abstain` verdict (NEVER `allow`), so the signer wrapper refuses to sign.
   */
  public async guard(req: GuardRequest, paymentHeader?: string): Promise<GuardResponse> {
    try {
      return await this.requestJson<GuardResponse>("POST", "/v1/guard", req, paymentHeader);
    } catch (err) {
      if (err instanceof X402PaymentRequiredError) {
        throw err;
      }
      const payloadHash = computePayloadHash(req);
      return {
        decision: "abstain",
        reason: `Hosted API unreachable (${err instanceof Error ? err.message : "unknown error"}) · fail-closed abstain`,
        codes: ["S-FAIL"],
        payload_hash: payloadHash,
        expires_at: null,
        network: req.network,
        checks: {},
        flags: ["api:unreachable"],
        charged: null,
      };
    }
  }

  public async verify(req: GuardRequest, paymentHeader?: string): Promise<GuardResponse> {
    return this.requestJson<GuardResponse>("POST", "/v1/verify", req, paymentHeader);
  }

  public async simulate(req: GuardRequest, paymentHeader?: string): Promise<GuardResponse> {
    return this.requestJson<GuardResponse>("POST", "/v1/simulate", req, paymentHeader);
  }

  public async tokenRisk(
    token: string,
    network: string = NETWORK_RHC_TESTNET,
    paymentHeader?: string
  ): Promise<{ decision: string; token_risk: TokenRiskCheckResult }> {
    return this.requestJson("POST", "/v1/token-risk", { network, token }, paymentHeader);
  }

  public async checkContent(
    content: NonNullable<GuardRequest["content"]>,
    paymentHeader?: string
  ): Promise<{ decision: string; content: ContentCheckResult }> {
    return this.requestJson("POST", "/v1/check", { content }, paymentHeader);
  }

  public async lookupToken(
    chainId: number,
    address: string
  ): Promise<{ observed: boolean; data: unknown }> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/token/${chainId}/${address}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 404) {
      // §5.1: 404 = not observed yet, NEVER allow
      return { observed: false, data: null };
    }
    if (!res.ok) {
      throw new Error(`Token lookup failed with HTTP ${res.status}`);
    }
    return { observed: true, data: await res.json() };
  }

  public async getAttestation(decisionId: string): Promise<ZkAttestation> {
    return this.requestJson<ZkAttestation>("GET", `/v1/attestation/${decisionId}`);
  }
}

/**
 * Default-on helper for Perm DEX router (§1.1, §7.4, §9 #5).
 * Ensures every candidate route assembled by Perm router code is checked by ZGuard before signing.
 */
export async function guardPermRoute(params: {
  client: ZGuardClient;
  intent: NonNullable<GuardRequest["payload"]>["intent"];
  tx?: NonNullable<GuardRequest["payload"]>["tx"];
  tokenOut?: string;
  spendPolicy?: NonNullable<GuardRequest["options"]>["spendPolicy"];
  enabled?: boolean;
}): Promise<GuardResponse> {
  if (params.enabled === false) {
    throw new Error(
      "[ZGuard:Perm] Guard disabled in config. Perm refuses to sign routes without an active guard verdict."
    );
  }
  if (!params.intent) {
    throw new Error("[ZGuard:Perm] Router intent is required and must be built by router code.");
  }
  if (!params.tx) {
    // QM-2: the guard compares the intent against the bytes that will be signed; without them the
    // verdict would be abstain anyway, so fail early with a clear message.
    throw new Error("[ZGuard:Perm] The exact transaction to be signed (tx) is required alongside the router intent.");
  }
  return params.client.guard({
    network: `eip155:${params.intent.chainId}`,
    payload: {
      type: "intent",
      intent: params.intent,
      tx: params.tx,
    },
    token: params.tokenOut,
    checks: ["quote", "simulation", "token_risk"],
    options: {
      spendPolicy: params.spendPolicy,
    },
  });
}
