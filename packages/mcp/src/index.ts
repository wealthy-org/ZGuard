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
  parseChainIdFromNetwork,
  scanContent,
  type GuardRequest,
  type GuardResponse,
} from "@zguard/sdk";

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

  // 1. guard_payment: Offline quote-match when no API key or simulate=false; Hosted API when simulate=true + API key
  server.tool(
    "guard_payment",
    "Verify an x402 payment authorization or EVM payment transaction against the quoted payment on Robinhood Chain (Testnet 46630 or Mainnet 4663). Runs offline without API key unless simulate=true.",
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
      simulate: z.boolean().default(false),
    },
    async (args) => {
      const req: GuardRequest = {
        network: args.network,
        quote: args.quote,
        payload: args.payload as GuardRequest["payload"],
        checks: args.simulate ? ["quote", "simulation"] : ["quote"],
      };

      if (!args.simulate || !apiKey) {
        const localRes = guardOffline({ ...req, checks: ["quote"] });
        return formatToolJson(localRes);
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
      tx: z.any().optional(),
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

      const chainId = parseChainIdFromNetwork(args.network) ?? activeChainId;
      const profile = getRhcChainProfile(chainId);

      // Without API key: resolve local canonical USDG/Testnet Stock cache or free GET /v1/token lookup, else fail-closed abstain
      if (!apiKey) {
        const lower = args.token.trim().toLowerCase();
        const contentRes = scanContent(contentInput);
        const isCanonicalUsdg =
          lower === profile.usdgAddress.toLowerCase() ||
          lower === RHC_CANONICAL_ASSETS.USDG.address.toLowerCase() ||
          lower === RHC_TESTNET_ASSETS.USDG.address.toLowerCase();

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
            return formatToolJson(lookup.data);
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
        const res = await client.guard({
          network: args.network,
          token: args.token,
          content: contentInput,
          checks: ["token_risk"],
        });
        return formatToolJson(res);
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
      if (!apiKey) {
        const local = scanContent(args);
        return formatToolJson({
          decision: local.decision,
          reason:
            local.verdict === "findings"
              ? "content rules matched suspicious patterns"
              : "clean_by_rules",
          codes: local.codes,
          checks: { content: local },
          flags: [],
          charged: null,
        });
      }

      try {
        const remote = await client.checkContent(args);
        return formatToolJson(remote);
      } catch {
        const local = scanContent(args);
        return formatToolJson({
          decision: local.decision,
          codes: local.codes,
          checks: { content: local },
        });
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
