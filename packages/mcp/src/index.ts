#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DEFAULT_ACTIVE_RHC_CHAIN_ID,
  RHC_CANONICAL_ASSETS,
  RHC_TESTNET_ASSETS,
  X402PaymentRequiredError,
  ZGuardClient,
  aggregateDecision,
  computePayloadHash,
  getRhcChainProfile,
  guardOffline,
  isSupportedRhcChainId,
  parseChainIdFromNetwork,
  scanContent,
  type ContentCheckResult,
  type GuardRequest,
  type GuardResponse,
  type TokenRiskCheckResult,
} from "@zguard/sdk";

/** Cached token observations older than this are not trusted as an allow (authorities can change). */
const MAX_CACHED_TOKEN_RISK_AGE_MS = 15 * 60_000;

function unknownTokenRisk(token: string, note: string): TokenRiskCheckResult {
  return {
    decision: "abstain",
    codes: ["T-UNKNOWN"],
    token,
    kind: "other",
    holders: { count: null, top10Bps: null },
    liquidity: { venue: "unknown", locked: null, detail: { note } },
    tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
    authorities: { owner: null, mintable: null, pausable: null },
    pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
  };
}

function canonicalTokenRisk(token: string, kind: "usdg" | "stock_token" | "other", name: string, symbol: string, decimals: number): TokenRiskCheckResult {
  return {
    decision: "allow",
    codes: [],
    token,
    name,
    symbol,
    decimals,
    kind,
    holders: { count: null, top10Bps: null },
    liquidity: { venue: "canonical", locked: null, detail: {} },
    tax: { buyBps: 0, sellBps: 0, snipeTaxBps: 0 },
    authorities: { owner: null, mintable: false, pausable: null },
    pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
  };
}

/**
 * MCP-2: the free GET /v1/token lookup is a registry/observation record, not a §5.3 verdict. Convert it
 * into a token_risk result: registry-canonical entries (USDG/WETH of this chain, registered Stock Tokens)
 * allow; a cached observation is used only when it is for this exact chain + address and fresh; anything
 * else is abstain T-UNKNOWN.
 */
function tokenRiskFromLookup(
  data: unknown,
  chainId: number,
  token: string
): { risk: TokenRiskCheckResult; flag?: string } {
  const d = (data ?? {}) as {
    chainId?: number;
    address?: string;
    kind?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    updatedAt?: string;
    token_risk?: TokenRiskCheckResult;
  };
  const lower = token.trim().toLowerCase();
  if (d.chainId !== chainId || typeof d.address !== "string" || d.address.toLowerCase() !== lower) {
    return { risk: unknownTokenRisk(token, "lookup record does not match the requested chain/address") };
  }
  const profile = getRhcChainProfile(chainId);
  if (d.kind === "usdg" && lower === profile.usdgAddress.toLowerCase()) {
    return { risk: canonicalTokenRisk(token, "usdg", "Global Dollar", "USDG", 6) };
  }
  if (d.symbol === "WETH" && lower === profile.wethAddress.toLowerCase()) {
    return { risk: canonicalTokenRisk(token, "other", "Wrapped Ether", "WETH", 18) };
  }
  if (d.kind === "stock_token") {
    return { risk: canonicalTokenRisk(token, "stock_token", d.name ?? "", d.symbol ?? "", d.decimals ?? 18) };
  }
  if (d.token_risk && typeof d.token_risk.decision === "string") {
    const ts = d.updatedAt ? Date.parse(d.updatedAt) : NaN;
    const fresh = Number.isFinite(ts) && Date.now() - ts <= MAX_CACHED_TOKEN_RISK_AGE_MS;
    if (d.token_risk.decision === "allow" && !fresh) {
      return { risk: unknownTokenRisk(token, `cached observation from ${d.updatedAt ?? "unknown time"} is stale`) };
    }
    return { risk: d.token_risk, flag: `token_risk:cached@${d.updatedAt ?? "unknown"}` };
  }
  return { risk: unknownTokenRisk(token, "lookup returned no verdict") };
}

/**
 * MCP-4: a URL whose content was never fetched (no API key, or the hosted scan failed) cannot be called
 * clean. Mirrors the server: findings → deny; URL only → abstain "unchecked"; with inline text → the
 * inline verdict plus `urlFetch.fetched=false`.
 */
function localContentScan(args: { text?: string; url?: string; symbol?: string; name?: string; tokenAddress?: string }, why: string): ContentCheckResult {
  const local = scanContent(args);
  if (!args.url) return local;
  const hasInline = Boolean(args.text?.trim() || args.name?.trim() || args.symbol?.trim());
  const findings = local.verdict === "findings";
  return {
    ...local,
    decision: findings ? "deny" : hasInline ? local.decision : "abstain",
    verdict: findings ? "findings" : hasInline ? local.verdict : "unchecked",
    urlFetch: { url: args.url, fetched: false, httpStatus: null, blockedReason: why },
  };
}

export interface ZGuardMcpOptions {
  apiUrl?: string;
  apiKey?: string;
  defaultChainId?: number;
  fetchImpl?: typeof fetch;
}

function formatToolJson(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function createZGuardMcpServer(opts: ZGuardMcpOptions = {}) {
  const apiKey = opts.apiKey ?? process.env.ZGUARD_API_KEY;
  const apiUrl = opts.apiUrl ?? process.env.ZGUARD_API_URL ?? "http://localhost:8787";
  const activeChainId =
    opts.defaultChainId ??
    Number(process.env.ZGUARD_ACTIVE_CHAIN_ID || DEFAULT_ACTIVE_RHC_CHAIN_ID);
  const defaultNetwork = `eip155:${activeChainId}`;

  const client = new ZGuardClient({
    baseUrl: apiUrl,
    apiKey,
    fetchImpl: opts.fetchImpl,
  });

  const server = new McpServer({
    name: "zguard",
    version: "0.1.0",
  });

  // 1. guard_payment: hosted /v1/guard (quote + simulation + server-required checks) whenever an API key is set,
  //    unless the caller passes simulate=false; offline quote-match otherwise (flagged, never silently "full").
  server.tool(
    "guard_payment",
    "Verify an x402 payment authorization or EVM payment transaction against the quoted payment on Robinhood Chain (Testnet 46630 or Mainnet 4663). With an API key it runs the hosted guard (quote + simulation) by default; simulate=false or no key = offline quote-match only (flag offline:quote-only). simulate=true without a key never returns allow.",
    {
      network: z.string().default(defaultNetwork),
      quote: z.object({
        asset: z.string(),
        payTo: z.string(),
        amount: z.string(),
        chainId: z.number().optional(),
        description: z.string().optional(),
        memo: z.string().optional(),
      }),
      payload: z.object({
        type: z.enum(["eip3009", "evm_tx"]),
        authorization: z
          .object({
            kind: z.enum(["TransferWithAuthorization", "ReceiveWithAuthorization"]).optional(),
            from: z.string(),
            to: z.string(),
            value: z.string(),
            validAfter: z.union([z.string(), z.number()]).optional(),
            validBefore: z.union([z.string(), z.number()]).optional(),
            nonce: z.string().optional(),
            domain: z
              .object({
                name: z.string().optional(),
                version: z.string().optional(),
                chainId: z.number().optional(),
                verifyingContract: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
        tx: z.any().optional(),
      }),
      simulate: z.boolean().optional(),
    },
    async (args) => {
      const hosted = args.simulate ?? Boolean(apiKey);
      const req: GuardRequest = {
        network: args.network,
        quote: args.quote,
        payload: args.payload as GuardRequest["payload"],
        checks: hosted ? ["quote", "simulation"] : ["quote"],
      };

      if (!hosted || !apiKey) {
        const localRes = guardOffline({ ...req, checks: ["quote"] });
        const flags = [...(localRes.flags ?? []), "offline:quote-only"];
        if (args.simulate === true && localRes.decision === "allow") {
          // Simulation was requested but cannot run without a key: fail closed instead of a quote-only allow.
          return formatToolJson({
            ...localRes,
            decision: "abstain",
            reason: "simulation requested but no ZGUARD_API_KEY: only the offline quote-match ran",
            expires_at: null,
            flags: [...flags, "simulation:skipped"],
          });
        }
        return formatToolJson({ ...localRes, flags });
      }

      try {
        const remote = await client.guard(req);
        return formatToolJson(remote);
      } catch (err) {
        if (err instanceof X402PaymentRequiredError) {
          return formatToolJson({
            status: 402,
            paymentRequired: err.quote,
          });
        }
        throw err;
      }
    }
  );

  // 2. guard_transaction: Simulation + intent/quote parity on RHC (46630 / 4663)
  server.tool(
    "guard_transaction",
    "Simulate an RHC (46630/4663) swap or general EVM transaction and verify it matches the router intent before signing.",
    {
      network: z.string().default(defaultNetwork),
      intent: z.object({
        chainId: z.number().default(activeChainId),
        to: z.string(),
        function: z.string(),
        args: z.array(z.any()).optional(),
        value: z.string().default("0"),
        from: z.string().optional(),
      }),
      tx: z
        .any()
        .describe(
          "Exact transaction that will be signed ({to,data,value,chainId} or raw hex). Required: an intent alone is never compared with itself (abstain Q-DECODE)."
        ),
      token: z.string().optional(),
    },
    async (args) => {
      const req: GuardRequest = {
        network: args.network,
        payload: {
          type: "intent",
          intent: args.intent,
          tx: args.tx,
        },
        token: args.token,
        checks: ["quote", "simulation"],
      };

      if (!apiKey) {
        return formatToolJson(guardOffline(req));
      }

      try {
        return formatToolJson(await client.guard(req));
      } catch (err) {
        if (err instanceof X402PaymentRequiredError) {
          return formatToolJson({ status: 402, paymentRequired: err.quote });
        }
        throw err;
      }
    }
  );

  // 3. check_token: Returns canonical §5.3 GuardResponse schema for RHC token risk + metadata scan (§9 #6)
  server.tool(
    "check_token",
    "Evaluate Robinhood Chain (46630 / 4663) token risk (kind: usdg | stock_token | pons_curve | pons_graduated_v4 | other, holders, LP, tax, authorities, pons state) and scan metadata before reading.",
    {
      token: z.string(),
      network: z.string().default(defaultNetwork),
      metadataText: z.string().optional(),
      symbol: z.string().optional(),
      name: z.string().optional(),
    },
    async (args) => {
      const contentInput =
        args.metadataText || args.symbol || args.name
          ? {
              text: args.metadataText,
              symbol: args.symbol,
              name: args.name,
              tokenAddress: args.token,
            }
          : undefined;

      const parsedChainId = parseChainIdFromNetwork(args.network);
      if (!isSupportedRhcChainId(parsedChainId)) {
        // MCP-3: an unknown network used to fall back to the testnet profile (so testnet USDG on
        // "eip155:1" was allowed). Only RHC 4663/46630 are evaluated.
        const checks: GuardResponse["checks"] = {
          token_risk: unknownTokenRisk(args.token, `unsupported network ${args.network}`),
        };
        const agg = aggregateDecision({ checks, modes: { token_risk: "required" } });
        return formatToolJson({
          decision: agg.decision,
          reason: `unsupported network ${args.network}; only eip155:4663 and eip155:46630`,
          codes: agg.codes,
          payload_hash: computePayloadHash({ network: args.network, token: args.token }),
          expires_at: null,
          network: args.network,
          checks,
          flags: agg.flags,
          charged: null,
        } satisfies GuardResponse);
      }
      const chainId = parsedChainId;
      const profile = getRhcChainProfile(chainId);

      // Without API key: resolve local canonical USDG/Testnet Stock cache or free GET /v1/token lookup, else fail-closed abstain
      if (!apiKey) {
        const lower = args.token.trim().toLowerCase();
        const contentRes = scanContent(contentInput);
        // MCP-3: only the USDG of the requested chain (the other chain's USDG address is not canonical here).
        const isCanonicalUsdg = lower === profile.usdgAddress.toLowerCase();

        if (isCanonicalUsdg) {
          const checks: GuardResponse["checks"] = {
            token_risk: {
              decision: "allow",
              codes: [],
              token: args.token,
              name: "Global Dollar",
              symbol: "USDG",
              decimals: 6,
              kind: "usdg",
              holders: { count: null, top10Bps: null },
              liquidity: { venue: "canonical", locked: null, detail: {} },
              tax: { buyBps: 0, sellBps: 0, snipeTaxBps: 0 },
              authorities: { owner: null, mintable: false, pausable: null },
              pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
            },
            content: contentRes,
          };
          const agg = aggregateDecision({
            checks,
            modes: { token_risk: "required", content: "advisory" },
          });
          const resp: GuardResponse = {
            decision: agg.decision,
            reason: agg.reason,
            codes: agg.codes,
            payload_hash: computePayloadHash({ network: args.network, token: args.token }),
            expires_at: agg.expires_at,
            network: args.network,
            checks,
            flags: agg.flags,
            charged: null,
          };
          return formatToolJson(resp);
        }

        try {
          const lookup = await client.lookupToken(chainId, args.token);
          if (lookup.observed && lookup.data) {
            const { risk, flag } = tokenRiskFromLookup(lookup.data, chainId, args.token);
            const checks: GuardResponse["checks"] = { token_risk: risk, content: contentRes };
            const agg = aggregateDecision({ checks, modes: { token_risk: "required", content: "advisory" } });
            return formatToolJson({
              decision: agg.decision,
              reason: agg.reason,
              codes: agg.codes,
              payload_hash: computePayloadHash({ network: args.network, token: args.token }),
              expires_at: agg.expires_at,
              network: args.network,
              checks,
              flags: flag ? [...agg.flags, flag] : agg.flags,
              charged: null,
            } satisfies GuardResponse);
          }
        } catch {
          // Ignore network error and return fail-closed abstain
        }

        return formatToolJson(
          guardOffline({
            network: args.network,
            token: args.token,
            content: contentInput,
            checks: ["token_risk"],
          })
        );
      }

      try {
        // MCP-1: use the dedicated POST /v1/token-risk endpoint. POST /v1/guard always adds the
        // server-required checks (quote + simulation, C4), so a token-only call there was denied
        // with Q-005/S-FAIL for EVERY token, including canonical USDG.
        const res = (await client.tokenRisk(args.token, args.network)) as unknown as GuardResponse & {
          token_risk?: GuardResponse["checks"]["token_risk"];
        };
        const { token_risk: _tokenRisk, ...guardShape } = res;
        if (!contentInput || !guardShape.checks?.token_risk) {
          return formatToolJson(guardShape);
        }
        // Caller-supplied metadata is scanned locally (same deterministic rules as /v1/check, no extra
        // charge) and merged with the same modes as the key-less path.
        const checks: GuardResponse["checks"] = {
          ...guardShape.checks,
          content: scanContent(contentInput),
        };
        const agg = aggregateDecision({
          checks,
          modes: { token_risk: "required", content: "advisory" },
        });
        return formatToolJson({
          ...guardShape,
          decision: agg.decision,
          reason: agg.reason,
          codes: agg.codes,
          expires_at: agg.decision === "allow" ? guardShape.expires_at : agg.expires_at,
          checks,
          flags: agg.flags,
        });
      } catch (err) {
        if (err instanceof X402PaymentRequiredError) {
          return formatToolJson({ status: 402, paymentRequired: err.quote });
        }
        throw err;
      }
    }
  );

  // 4. check_before_use: Scan text/URL/metadata before feeding into agent context
  server.tool(
    "check_before_use",
    "Scan untrusted text, token descriptions, tool outputs, or URLs for prompt-injection shapes, invisible Unicode, and canonical RHC ticker impersonation.",
    {
      text: z.string().optional(),
      url: z.string().optional(),
      symbol: z.string().optional(),
      name: z.string().optional(),
      tokenAddress: z.string().optional(),
    },
    async (args) => {
      const localResponse = (why: string, flags: string[]) => {
        const local = localContentScan(args, why);
        return formatToolJson({
          decision: local.decision,
          reason:
            local.verdict === "findings"
              ? "content rules matched suspicious patterns"
              : local.verdict === "unchecked"
                ? `url content not fetched (${why})`
                : "clean_by_rules",
          codes: local.codes,
          payload_hash: computePayloadHash({ network: defaultNetwork }),
          expires_at: null,
          network: defaultNetwork,
          checks: { content: local },
          flags,
          charged: null,
        } satisfies GuardResponse);
      };

      if (!apiKey) {
        return localResponse("offline mode: no API key, URL not fetched", []);
      }

      try {
        const remote = await client.checkContent(args);
        return formatToolJson(remote);
      } catch (err) {
        if (err instanceof X402PaymentRequiredError) {
          return formatToolJson({ status: 402, paymentRequired: err.quote });
        }
        return localResponse(
          `hosted scan failed: ${err instanceof Error ? err.message : "unknown error"}`,
          ["api:unreachable"]
        );
      }
    }
  );

  // 5. guard_bundle: Single call running quote + simulation + token_risk (§4.2 & §9 #6)
  server.tool(
    "guard_bundle",
    "Execute all three ZGuard checks (quote-match, RHC simulation, and RHC token risk) in a single POST /v1/guard call before signing.",
    {
      network: z.string().default(defaultNetwork),
      quote: z
        .object({
          asset: z.string(),
          payTo: z.string(),
          amount: z.string(),
          chainId: z.number().optional(),
        })
        .optional(),
      payload: z.object({
        type: z.enum(["eip3009", "evm_tx", "intent"]),
        authorization: z.any().optional(),
        tx: z.any().optional(),
        intent: z.any().optional(),
      }),
      token: z.string().optional(),
      content: z
        .object({
          text: z.string().optional(),
          url: z.string().optional(),
          symbol: z.string().optional(),
          name: z.string().optional(),
          tokenAddress: z.string().optional(),
        })
        .optional(),
    },
    async (args) => {
      const req: GuardRequest = {
        network: args.network,
        quote: args.quote,
        payload: args.payload as GuardRequest["payload"],
        token: args.token,
        content: args.content,
        checks: ["quote", "simulation", "token_risk"],
      };

      try {
        const resp = await client.guard(req);
        return formatToolJson(resp);
      } catch (err) {
        if (err instanceof X402PaymentRequiredError) {
          return formatToolJson({ status: 402, paymentRequired: err.quote });
        }
        throw err;
      }
    }
  );

  return server;
}

// Run stdio transport when invoked directly as a CLI binary (`npx @zguard/mcp`, Claude Code, Cursor, etc.)
const argv1Norm = (process.argv[1] ?? "").replace(/\\/g, "/");
const isDirectRun =
  argv1Norm.endsWith("/mcp/src/index.ts") ||
  argv1Norm.endsWith("/mcp/dist/index.js") ||
  argv1Norm.endsWith("zguard-mcp");

if (isDirectRun) {
  const srv = createZGuardMcpServer();
  const transport = new StdioServerTransport();
  srv.connect(transport).catch((err) => {
    console.error("[zguard-mcp] fatal:", err);
    process.exit(1);
  });
}
