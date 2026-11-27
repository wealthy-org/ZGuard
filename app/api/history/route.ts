import { NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { permRouterAbi, permRouterV1Abi } from "@/lib/web3/abis";
import { DEPLOYMENT_BLOCK, PERM_ROUTER_ADDRESS, ROUTER_VERSION, createRobinhoodPublicClient } from "@/lib/web3/config";
import { boundedEnvironmentInteger, consumeRateLimit, requestIdentity, safeServerError } from "@/lib/server/runtime";
import { indexedHistoryAvailable, readIndexedHistory } from "@/lib/server/indexer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HISTORY_CONFIRMATIONS = BigInt(boundedEnvironmentInteger("HISTORY_CONFIRMATIONS", 12, 1, 10_000));

export async function GET(request: NextRequest) {
  try {
    const limit = await consumeRateLimit(`history:${requestIdentity(request)}`, 15, 0.25);
    if (!limit.allowed) return NextResponse.json({ error: "Too many history requests" }, { status: 429, headers: { "retry-after": String(limit.retryAfter) } });
  } catch (cause) {
    return NextResponse.json({ error: safeServerError("history-rate-limit", cause, "Request protection is temporarily unavailable") }, { status: 503 });
  }
  if (!PERM_ROUTER_ADDRESS || !DEPLOYMENT_BLOCK) return NextResponse.json({ error: "Official deployment is not configured" }, { status: 503 });

  const accountParam = request.nextUrl.searchParams.get("account");
  if (accountParam && !isAddress(accountParam)) return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  const account = accountParam ? getAddress(accountParam) as Address : undefined;
  const cursorParam = request.nextUrl.searchParams.get("before");
  if (cursorParam && !/^\d+(?::\d+)?$/.test(cursorParam)) return NextResponse.json({ error: "Invalid history cursor" }, { status: 400 });
  const [cursorBlock, cursorLogIndex] = cursorParam?.split(":") || [];
  const requestedBefore = cursorBlock ? {
    blockNumber: BigInt(cursorBlock),
    logIndex: cursorLogIndex === undefined ? undefined : Number(cursorLogIndex),
  } : undefined;
  if (requestedBefore?.logIndex !== undefined && (!Number.isSafeInteger(requestedBefore.logIndex) || requestedBefore.logIndex < 0)) {
    return NextResponse.json({ error: "Invalid history cursor" }, { status: 400 });
  }

  if (indexedHistoryAvailable()) {
    try {
      const indexed = await readIndexedHistory(account, requestedBefore, 50);
      // An indexer that has never indexed this chain + router (e.g. a fresh mainnet deploy) falls back to router logs.
      if (indexed && indexed.indexedThrough) return NextResponse.json({
        items: indexed.items,
        indexedThrough: indexed.indexedThrough,
        nextBefore: indexed.nextBefore,
        source: "postgres-indexer",
      }, { headers: { "cache-control": "private, max-age=10" } });
    } catch (cause) {
      const message = safeServerError("history-indexer", cause, "Indexed history is temporarily unavailable");
      if (process.env.PERM_REQUIRE_INDEXER === "1") return NextResponse.json({ error: message }, { status: 503 });
    }
  }

  const client = createRobinhoodPublicClient();
  try {
    const latest = await client.getBlockNumber();
    const confirmedTip = latest > HISTORY_CONFIRMATIONS ? latest - HISTORY_CONFIRMATIONS : 0n;
    const deploymentBlock = BigInt(DEPLOYMENT_BLOCK);
    if (confirmedTip < deploymentBlock) {
      return NextResponse.json({ items: [], nextBefore: null, source: "official-router-logs", confirmedThrough: confirmedTip.toString() }, { headers: { "cache-control": "private, max-age=10" } });
    }
    const requestedTo = requestedBefore
      ? requestedBefore.logIndex === undefined ? requestedBefore.blockNumber - 1n : requestedBefore.blockNumber
      : confirmedTip;
    if (requestedTo < deploymentBlock) {
      return NextResponse.json({ items: [], nextBefore: null, source: "official-router-logs", confirmedThrough: confirmedTip.toString() }, { headers: { "cache-control": "private, max-age=10" } });
    }
    let toBlock = requestedTo < confirmedTip ? requestedTo : confirmedTip;
    const initialTo = toBlock;
    let scannedFloor = toBlock;
    let reachedDeployment = false;
    const abi = ROUTER_VERSION >= 2 ? permRouterAbi : permRouterV1Abi;
    type SettlementLog = { args: Record<string, unknown>; transactionHash: Hex; logIndex: number; blockNumber: bigint };
    const found: SettlementLog[] = [];
    let batches = 0;

    while (toBlock >= deploymentBlock && found.length < 50 && batches < 20) {
      const tentative = toBlock > 9_999n ? toBlock - 9_999n : 0n;
      const fromBlock = tentative < deploymentBlock ? deploymentBlock : tentative;
      const logs = await client.getContractEvents({
        address: PERM_ROUTER_ADDRESS,
        abi,
        eventName: "SwapSettled",
        args: account ? { account } : undefined,
        fromBlock,
        toBlock,
        strict: true,
      }) as unknown as SettlementLog[];
      found.push(...logs.filter((log) => {
        if (!requestedBefore || requestedBefore.logIndex === undefined) return true;
        return log.blockNumber < requestedBefore.blockNumber
          || (log.blockNumber === requestedBefore.blockNumber && log.logIndex < requestedBefore.logIndex);
      }));
      batches += 1;
      scannedFloor = fromBlock;
      if (fromBlock === deploymentBlock) {
        reachedDeployment = true;
        break;
      }
      toBlock = fromBlock - 1n;
    }

    found.sort((left, right) => left.blockNumber === right.blockNumber
      ? right.logIndex - left.logIndex
      : left.blockNumber > right.blockNumber ? -1 : 1);
    const selectedLogs = found.slice(0, 50);
    const items = selectedLogs.map((log) => {
      const args = log.args as Record<string, unknown>;
      return {
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber.toString(),
        receiptId: args.receiptId,
        quoteId: args.quoteId,
        account: args.account,
        recipient: args.recipient,
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        amountIn: String(args.amountIn),
        routedInput: String(args.routedInput),
        amountOut: String(args.amountOut),
        grossFee: String(args.grossFee),
        rebate: String(args.rebate),
        netFee: String(args.netFee),
        referralFee: String(args.referralFee),
        treasuryFee: ROUTER_VERSION >= 2 ? String(args.treasuryFee) : "0",
        policyVersion: Number(args.policyVersion),
        routeId: ROUTER_VERSION >= 2 ? args.routeId : args.providerId,
        routeHash: ROUTER_VERSION >= 2 ? args.routeHash : null,
        legacy: ROUTER_VERSION < 2,
      };
    });
    const lastSelected = selectedLogs.at(-1);
    const nextBefore = selectedLogs.length >= 50 && lastSelected
      ? `${lastSelected.blockNumber}:${lastSelected.logIndex}`
      : reachedDeployment ? null : scannedFloor.toString();
    return NextResponse.json({
      items,
      scanned: {
        fromBlock: scannedFloor.toString(),
        toBlock: initialTo.toString(),
        batches,
      },
      nextBefore,
      confirmedThrough: confirmedTip.toString(),
      source: "official-router-logs",
    }, { headers: { "cache-control": "private, max-age=10" } });
  } catch (cause) {
    return NextResponse.json({ error: safeServerError("history", cause, "Onchain history lookup failed") }, { status: 502 });
  }
}
