import { NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { PERM_CHAIN_ID, PERM_ROUTER_ADDRESS } from "@/lib/web3/config";
import { RequestBodyTooLargeError, consumeRateLimit, readJsonBody, requestIdentity, safeServerError } from "@/lib/server/runtime";
import { callZGuard, zguardServerConfig } from "@/lib/server/zguard";
import { ZGuardRequestError, buildZGuardSwapRequest } from "@/lib/zguard/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-side ZGuard gate for /trade. The browser sends only the exact swap bytes; this route
// rebuilds the guard request with the shared builder, pins it to the official Perm Router and
// chain, and forwards it with the server-held ZGuard API key. The browser re-hashes the same
// bytes and refuses to sign unless ZGuard's payload_hash matches (see lib/zguard/request.ts).
const MAX_BODY_BYTES = 32 * 1024;
const noStore = { "cache-control": "no-store" };

function status() {
  const config = zguardServerConfig();
  return {
    mode: config.mode,
    ready: config.ready,
    network: `eip155:${PERM_CHAIN_ID}`,
    router: PERM_ROUTER_ADDRESS ?? null,
    // Exposes only the kind of problem, never the key or URL credentials.
    problem: config.problem ?? null,
  };
}

export async function GET() {
  return NextResponse.json(status(), { headers: noStore });
}

export async function POST(request: NextRequest) {
  const config = zguardServerConfig();
  if (config.mode === "off") {
    return NextResponse.json({ error: "ZGuard is switched off for this deployment (PERM_ZGUARD_MODE=off)", mode: "off" }, { status: 409, headers: noStore });
  }
  if (!config.ready) {
    return NextResponse.json({ error: `ZGuard is required but not ready: ${config.problem}`, mode: "enforce" }, { status: 503, headers: noStore });
  }
  if (!PERM_ROUTER_ADDRESS) {
    return NextResponse.json({ error: "No official Perm Router is configured" }, { status: 503, headers: noStore });
  }

  try {
    // Each call spends ZGuard credit, so the bucket is tight: burst 6, one new check every 5 s.
    const limit = await consumeRateLimit(`zguard:${requestIdentity(request)}`, 6, 0.2);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many ZGuard checks; retry shortly" }, { status: 429, headers: { ...noStore, "retry-after": String(limit.retryAfter) } });
    }
  } catch (cause) {
    return NextResponse.json({ error: safeServerError("zguard-rate-limit", cause, "Request protection is temporarily unavailable") }, { status: 503, headers: noStore });
  }

  let body: unknown;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (cause) {
    const tooLarge = cause instanceof RequestBodyTooLargeError;
    return NextResponse.json({ error: tooLarge ? "Request too large" : "Invalid JSON" }, { status: tooLarge ? 413 : 400, headers: noStore });
  }

  const input = (body && typeof body === "object" ? body : {}) as { from?: unknown; to?: unknown; data?: unknown; value?: unknown };
  if (typeof input.to !== "string" || !isAddress(input.to) || getAddress(input.to) !== getAddress(PERM_ROUTER_ADDRESS)) {
    return NextResponse.json({ error: "Only transactions to the official Perm Router are guarded here" }, { status: 400, headers: noStore });
  }
  if (typeof input.value !== "string" || !/^\d{1,78}$/.test(input.value)) {
    return NextResponse.json({ error: "value must be a decimal wei string" }, { status: 400, headers: noStore });
  }

  let guardRequest;
  try {
    guardRequest = buildZGuardSwapRequest({
      chainId: PERM_CHAIN_ID,
      router: PERM_ROUTER_ADDRESS as Address,
      from: input.from as Address,
      data: input.data as Hex,
      value: BigInt(input.value),
    });
  } catch (cause) {
    if (cause instanceof ZGuardRequestError) return NextResponse.json({ error: cause.message }, { status: 400, headers: noStore });
    return NextResponse.json({ error: safeServerError("zguard-build", cause, "Could not build the ZGuard request") }, { status: 400, headers: noStore });
  }

  const result = await callZGuard(config, guardRequest);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, mode: "enforce" }, { status: result.status, headers: noStore });
  }
  return NextResponse.json({ mode: "enforce", receipt: result.receipt }, { headers: noStore });
}
