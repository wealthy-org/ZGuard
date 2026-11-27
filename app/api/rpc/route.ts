import { NextResponse, type NextRequest } from "next/server";
import { PERM_FALLBACK_RPC, PERM_RPC } from "@/lib/web3/config";
import { RequestBodyTooLargeError, consumeRateLimit, readJsonBody, requestIdentity, safeServerError } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Same-origin, read-only JSON-RPC relay for the browser. Some wallets' browsers, privacy
// extensions and networks block direct calls to the chain RPC host ("HTTP request failed"),
// so on-page reads (policy, balances, allowances, receipts) go through the Perm origin first.
// Only read methods are relayed; signing and sending stay in the user's wallet.
const READ_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
]);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 10;
const UPSTREAM_TIMEOUT_MS = 15_000;

type RpcRequest = { jsonrpc: "2.0"; id: number | string | null; method: string; params?: unknown };

function isRpcRequest(value: unknown): value is RpcRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.jsonrpc === "2.0"
    && typeof item.method === "string"
    && (item.params === undefined || Array.isArray(item.params))
    && (item.id === null || typeof item.id === "number" || typeof item.id === "string");
}

function rpcError(id: RpcRequest["id"] | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

const noStore = { "cache-control": "no-store" };

async function forward(url: string, body: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Perm/2.0" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Upstream RPC returned ${response.status}`);
  return response.text();
}

export async function POST(request: NextRequest) {
  try {
    const limit = await consumeRateLimit(`rpc:${requestIdentity(request)}`, 120, 8);
    if (!limit.allowed) {
      return NextResponse.json(rpcError(null, -32005, "Too many RPC requests"), {
        status: 429,
        headers: { ...noStore, "retry-after": String(limit.retryAfter) },
      });
    }
  } catch (cause) {
    return NextResponse.json(rpcError(null, -32603, safeServerError("rpc-rate-limit", cause, "Request protection is temporarily unavailable")), {
      status: 503,
      headers: noStore,
    });
  }

  let payload: unknown;
  try {
    payload = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (cause) {
    const tooLarge = cause instanceof RequestBodyTooLargeError;
    return NextResponse.json(rpcError(null, tooLarge ? -32600 : -32700, tooLarge ? "Request too large" : "Invalid JSON"), {
      status: tooLarge ? 413 : 400,
      headers: noStore,
    });
  }

  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length === 0 || items.length > MAX_BATCH || !items.every(isRpcRequest)) {
    return NextResponse.json(rpcError(null, -32600, "Invalid JSON-RPC request"), { status: 400, headers: noStore });
  }
  const blocked = items.find((item) => !READ_METHODS.has(item.method));
  if (blocked) {
    return NextResponse.json(rpcError(blocked.id, -32601, `Method ${blocked.method} is not available on the Perm read relay`), {
      status: 400,
      headers: noStore,
    });
  }

  const body = JSON.stringify(payload);
  const upstreams = [PERM_RPC, PERM_FALLBACK_RPC].filter((url): url is string => Boolean(url));
  for (const url of upstreams) {
    try {
      const text = await forward(url, body);
      return new NextResponse(text, { status: 200, headers: { ...noStore, "content-type": "application/json" } });
    } catch (cause) {
      safeServerError("rpc-relay", cause, "RPC relay failed");
    }
  }
  return NextResponse.json(rpcError(Array.isArray(payload) ? null : (payload as RpcRequest).id, -32603, "Chain RPC is temporarily unreachable"), {
    status: 502,
    headers: noStore,
  });
}
