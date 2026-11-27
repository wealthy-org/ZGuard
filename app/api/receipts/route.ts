import { NextResponse, type NextRequest } from "next/server";
import {
  decodeEventLog,
  formatEther,
  isHash,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { permRouterAbi, permRouterV1Abi } from "@/lib/web3/abis";
import {
  PERM_ROUTER_ADDRESS,
  PERM_CHAIN_ID,
  PERM_EXPLORER,
  ROUTER_VERSION,
  createRobinhoodPublicClient,
} from "@/lib/web3/config";
import { boundedEnvironmentInteger, consumeRateLimit, requestIdentity, safeServerError } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RECEIPT_MIN_CONFIRMATIONS = BigInt(boundedEnvironmentInteger("RECEIPT_MIN_CONFIRMATIONS", 12, 1, 10_000));

const PROVIDERS: Record<string, string> = {
  [keccak256(toHex("UNISWAP_V4_DIRECT"))]: "Uniswap v4 direct pool",
  [keccak256(toHex("UNISWAP_V4_AGGREGATOR_HOOK"))]: "Verified v4 Aggregator Hook",
  [keccak256(toHex("SYNTHRA_V3"))]: "Synthra v3 pool",
  [keccak256(toHex("UNISWAP_V3"))]: "Uniswap v3 pool",
  [keccak256(toHex("REVIEWED_V2_THIRD_PARTY"))]: "Source-reviewed third-party V2 pool",
};

function providerLabel(providerId: Hex) {
  return PROVIDERS[providerId.toLowerCase()] || "Approved Perm adapter";
}

export async function GET(request: NextRequest) {
  try {
    const limit = await consumeRateLimit(`receipt:${requestIdentity(request)}`, 30, 1);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many receipt requests" }, {
        status: 429,
        headers: { "retry-after": String(limit.retryAfter), "cache-control": "no-store" },
      });
    }
  } catch (cause) {
    return NextResponse.json({ error: safeServerError("receipt-rate-limit", cause, "Request protection is temporarily unavailable") }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const tx = request.nextUrl.searchParams.get("tx") as Hex | null;
  if (request.nextUrl.searchParams.has("router")) {
    return NextResponse.json({ error: "Router overrides are not accepted; proofs use the official deployment manifest" }, { status: 400 });
  }
  if (!tx || !isHash(tx)) return NextResponse.json({ error: "A valid transaction hash is required" }, { status: 400 });
  if (!PERM_ROUTER_ADDRESS) return NextResponse.json({ error: "PermRouter deployment is not configured" }, { status: 503 });
  const routerAddress = PERM_ROUTER_ADDRESS;

  const client = createRobinhoodPublicClient();
  try {
    const receipt = await client.getTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "The transaction reverted and cannot produce a Perm settlement proof" }, { status: 422 });
    }
    const [block, latest] = await Promise.all([
      client.getBlock({ blockNumber: receipt.blockNumber }),
      client.getBlockNumber(),
    ]);
    if (!block.hash || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      return NextResponse.json({ error: "The receipt block is no longer canonical" }, { status: 409 });
    }
    const confirmations = latest - receipt.blockNumber + 1n;
    if (confirmations < RECEIPT_MIN_CONFIRMATIONS) {
      return NextResponse.json({ error: `Receipt is awaiting ${RECEIPT_MIN_CONFIRMATIONS} confirmations`, confirmations: confirmations.toString() }, { status: 409 });
    }

    const routerLogs = receipt.logs.filter((log) => log.address.toLowerCase() === routerAddress.toLowerCase());
    const stepEvents = new Map<string, Array<Record<string, unknown>>>();
    if (ROUTER_VERSION >= 2) {
      for (const log of routerLogs) {
        try {
          const decoded = decodeEventLog({ abi: permRouterAbi, eventName: "RouteStepSettled", data: log.data, topics: log.topics });
          const args = decoded.args;
          const key = args.receiptId.toLowerCase();
          const current = stepEvents.get(key) || [];
          current.push({
            stepIndex: Number(args.stepIndex),
            providerId: args.providerId,
            providerLabel: providerLabel(args.providerId),
            adapter: args.adapter,
            tokenIn: args.tokenIn,
            tokenOut: args.tokenOut,
            amountIn: args.amountIn.toString(),
            amountOut: args.amountOut.toString(),
            stepRouteId: args.stepRouteId,
            hook: args.hook,
            hookCodehash: args.hookCodehash,
            logIndex: log.logIndex,
          });
          stepEvents.set(key, current);
        } catch {
          // This router log is not a RouteStepSettled event.
        }
      }
    }

    const settlements: Array<Record<string, unknown>> = [];
    for (const log of routerLogs) {
      try {
        if (ROUTER_VERSION >= 2) {
          const decoded = decodeEventLog({ abi: permRouterAbi, eventName: "SwapSettled", data: log.data, topics: log.topics });
          const args = decoded.args;
          const steps = (stepEvents.get(args.receiptId.toLowerCase()) || []).sort((a, b) => Number(a.stepIndex) - Number(b.stepIndex));
          settlements.push({
            receiptId: args.receiptId,
            quoteId: args.quoteId,
            account: args.account,
            recipient: args.recipient,
            tokenIn: args.tokenIn,
            tokenOut: args.tokenOut,
            amountIn: args.amountIn.toString(),
            routedInput: args.routedInput.toString(),
            amountOut: args.amountOut.toString(),
            grossFee: args.grossFee.toString(),
            rebate: args.rebate.toString(),
            netFee: args.netFee.toString(),
            referralFee: args.referralFee.toString(),
            treasuryFee: args.treasuryFee.toString(),
            policyVersion: Number(args.policyVersion),
            routeId: args.routeId,
            routeHash: args.routeHash,
            steps,
            logIndex: log.logIndex,
          });
        } else {
          const decoded = decodeEventLog({ abi: permRouterV1Abi, eventName: "SwapSettled", data: log.data, topics: log.topics });
          const args = decoded.args;
          settlements.push({
            receiptId: args.receiptId,
            quoteId: args.quoteId,
            account: args.account,
            recipient: args.recipient,
            tokenIn: args.tokenIn,
            tokenOut: args.tokenOut,
            amountIn: args.amountIn.toString(),
            routedInput: args.routedInput.toString(),
            amountOut: args.amountOut.toString(),
            grossFee: args.grossFee.toString(),
            rebate: args.rebate.toString(),
            netFee: args.netFee.toString(),
            referralFee: args.referralFee.toString(),
            treasuryFee: undefined,
            policyVersion: Number(args.policyVersion),
            routeId: args.providerId,
            routeHash: undefined,
            steps: [{
              stepIndex: 0,
              providerId: args.providerId,
              providerLabel: providerLabel(args.providerId),
              adapter: args.adapter,
              tokenIn: args.tokenIn,
              tokenOut: args.tokenOut,
              amountIn: args.routedInput.toString(),
              amountOut: args.amountOut.toString(),
              stepRouteId: undefined,
              hook: args.hook,
              hookCodehash: undefined,
              logIndex: log.logIndex,
            }],
            logIndex: log.logIndex,
            legacy: true,
          });
        }
      } catch {
        // Filter by the exact event ABI rather than accepting an arbitrary router-address log.
      }
    }
    if (!settlements.length) {
      return NextResponse.json({ error: "No valid SwapSettled event from the official PermRouter exists in this transaction" }, { status: 404 });
    }

    const transaction = {
      chainId: PERM_CHAIN_ID,
      routerVersion: ROUTER_VERSION,
      router: routerAddress as Address,
      transactionHash: receipt.transactionHash,
      transactionIndex: receipt.transactionIndex,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      blockTimestamp: Number(block.timestamp),
      status: receipt.status,
      confirmations: confirmations.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      actualNetworkFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
      actualNetworkFeeEth: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
      explorerUrl: `${PERM_EXPLORER.replace(/\/$/, "")}/tx/${receipt.transactionHash}`,
    };
    return NextResponse.json({ transaction, settlements }, { headers: { "cache-control": "public, max-age=15, stale-while-revalidate=30" } });
  } catch (cause) {
    const name = (cause as { name?: string }).name || "";
    if (name.includes("TransactionReceiptNotFound")) {
      return NextResponse.json({ error: "Transaction receipt was not found on Robinhood Chain testnet" }, { status: 404 });
    }
    return NextResponse.json({ error: safeServerError("receipts", cause, "Receipt lookup failed") }, { status: 502 });
  }
}
