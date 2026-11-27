#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  decodeAbiParameters,
  defineChain,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { LIVE_TOKENS } from "../lib/web3/tokens";

const FACTORY = "0x6C4cA684D84761E193cB23d62b22fA83bB35E54E" as Address;
const WETH = "0x33e4191705c386532ba27cBF171Db86919200B94" as Address;
const EXPECTED_FACTORY_CODEHASH = "0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0" as Hex;
const EXPECTED_PAIR_CODEHASH = "0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5" as Hex;
const SWAP_TOPIC = keccak256(new TextEncoder().encode("Swap(address,uint256,uint256,uint256,uint256,address)"));
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const RPC = process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const outputPath = path.resolve(process.cwd(), process.env.V2_REVIEW_OUTPUT || "deployments/robinhood-testnet.v2-venue-review.json");

const factoryAbi = parseAbi([
  "function allPairsLength() view returns (uint256)",
  "function allPairs(uint256) view returns (address)",
  "function feeTo() view returns (address)",
  "function feeToSetter() view returns (address)",
]);
const pairAbi = parseAbi([
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
  "function totalSupply() view returns (uint256)",
  "function kLast() view returns (uint256)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

type ExplorerLog = {
  blockNumber: Hex;
  data: Hex;
  timeStamp: Hex;
  transactionHash: Hex;
};

type ContractSource = {
  file_path: string;
  source_code: string;
  additional_sources: Array<{ file_path: string; source_code: string }>;
  compiler_version: string;
  optimization_enabled: boolean;
  optimization_runs: number;
  evm_version: string;
  is_verified: boolean;
  is_fully_verified: boolean;
  is_changed_bytecode: boolean;
};

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "PermV2VenueReview/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  required(response.ok, `${url} returned HTTP ${response.status}`);
  return await response.json() as T;
}

async function main() {
  const chain = defineChain({
    id: 46_630,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Testnet Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
    blockExplorers: { default: { name: "Robinhood Testnet Explorer", url: EXPLORER } },
    contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
    testnet: true,
  });
  const client = createPublicClient({ chain, transport: http(RPC, { retryCount: 2, timeout: 30_000 }) });
  required(await client.getChainId() === 46_630, "RPC is not chain 46630");
  const latestBlock = await client.getBlock({ blockTag: "latest" });
  const [factoryCode, feeTo, feeToSetter, allPairsLength] = await Promise.all([
    client.getCode({ address: FACTORY }),
    client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "feeTo" }),
    client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "feeToSetter" }),
    client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "allPairsLength" }),
  ]);
  required(factoryCode, "Factory has no code");
  const factoryCodehash = keccak256(factoryCode);
  required(factoryCodehash === EXPECTED_FACTORY_CODEHASH, "Factory runtime codehash changed");

  const pairAddresses = await client.multicall({
    contracts: Array.from({ length: Number(allPairsLength) }, (_, index) => ({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "allPairs" as const,
      args: [BigInt(index)] as const,
    })),
    allowFailure: false,
    batchSize: 4_096,
  });
  const pairReads = await client.multicall({
    contracts: pairAddresses.flatMap((address) => ([
      { address, abi: pairAbi, functionName: "factory" as const },
      { address, abi: pairAbi, functionName: "token0" as const },
      { address, abi: pairAbi, functionName: "token1" as const },
      { address, abi: pairAbi, functionName: "getReserves" as const },
      { address, abi: pairAbi, functionName: "totalSupply" as const },
      { address, abi: pairAbi, functionName: "kLast" as const },
    ])),
    allowFailure: false,
    batchSize: 4_096,
  });

  const supportedByAddress = new Map(LIVE_TOKENS
    .filter((token) => token.address !== "0x0000000000000000000000000000000000000000")
    .map((token) => [token.address.toLowerCase(), token]));
  const supportedPairs: Array<{
    index: number;
    pair: Address;
    token0: Address;
    token1: Address;
    symbol0: string;
    symbol1: string;
    reserves: readonly [bigint, bigint, number];
    totalSupply: bigint;
    kLast: bigint;
  }> = [];
  for (let index = 0; index < pairAddresses.length; index += 1) {
    const [venueFactory, token0, token1, reserves, totalSupply, kLast] = pairReads.slice(index * 6, index * 6 + 6) as [
      Address, Address, Address, readonly [bigint, bigint, number], bigint, bigint,
    ];
    required(getAddress(venueFactory) === getAddress(FACTORY), `Pair ${pairAddresses[index]} reports another factory`);
    const supported0 = supportedByAddress.get(token0.toLowerCase());
    const supported1 = supportedByAddress.get(token1.toLowerCase());
    if (!supported0 && !supported1) continue;
    supportedPairs.push({
      index,
      pair: pairAddresses[index],
      token0,
      token1,
      symbol0: token0.toLowerCase() === WETH.toLowerCase() ? "WETH" : supported0?.symbol || "UNSUPPORTED",
      symbol1: token1.toLowerCase() === WETH.toLowerCase() ? "WETH" : supported1?.symbol || "UNSUPPORTED",
      reserves,
      totalSupply,
      kLast,
    });
  }

  const reviewedPairs = [];
  const supportedSymbolsWithPairs = new Set<string>();
  for (const entry of supportedPairs) {
    const [pairCode, balance0, balance1, addressMetadata] = await Promise.all([
      client.getCode({ address: entry.pair }),
      client.readContract({ address: entry.token0, abi: erc20Abi, functionName: "balanceOf", args: [entry.pair] }),
      client.readContract({ address: entry.token1, abi: erc20Abi, functionName: "balanceOf", args: [entry.pair] }),
      fetchJson<{ creation_transaction_hash: Hex }>(`${EXPLORER}/api/v2/addresses/${entry.pair}`),
    ]);
    required(pairCode, `Pair ${entry.pair} has no code`);
    const pairCodehash = keccak256(pairCode);
    const creation = await fetchJson<{ block_number: number; timestamp: string }>(
      `${EXPLORER}/api/v2/transactions/${addressMetadata.creation_transaction_hash}`,
    );
    const logUrl = new URL(`${EXPLORER}/api`);
    for (const [key, value] of Object.entries({
      module: "logs",
      action: "getLogs",
      fromBlock: String(creation.block_number),
      toBlock: "latest",
      address: entry.pair,
      topic0: SWAP_TOPIC,
    })) logUrl.searchParams.set(key, value);
    const logResult = await fetchJson<{ status: string; message: string; result: ExplorerLog[] | string }>(logUrl.toString());
    required(logResult.status === "1" && Array.isArray(logResult.result), `Could not read Swap logs for ${entry.pair}`);
    let volume0 = 0n;
    let volume1 = 0n;
    let swapsLast30Days = 0;
    for (const log of logResult.result) {
      if (Number(latestBlock.timestamp) - Number(log.timeStamp) <= 30 * 86_400) swapsLast30Days += 1;
      const [amount0In, amount1In, amount0Out, amount1Out] = decodeAbiParameters(
        parseAbiParameters("uint256,uint256,uint256,uint256"),
        log.data,
      );
      volume0 += amount0In + amount0Out;
      volume1 += amount1In + amount1Out;
    }
    const lastLog = logResult.result.at(-1);
    const lastSwapTimestamp = lastLog ? Number(lastLog.timeStamp) : null;
    const secondsSinceLastSwap = lastSwapTimestamp === null ? null : Number(latestBlock.timestamp) - lastSwapTimestamp;
    if (entry.symbol0 !== "WETH" && entry.symbol0 !== "UNSUPPORTED") supportedSymbolsWithPairs.add(entry.symbol0);
    if (entry.symbol1 !== "WETH" && entry.symbol1 !== "UNSUPPORTED") supportedSymbolsWithPairs.add(entry.symbol1);
    reviewedPairs.push({
      factoryIndex: entry.index,
      address: entry.pair,
      pairRuntimeCodehash: pairCodehash,
      canonicalPairRuntimeMatch: pairCodehash === EXPECTED_PAIR_CODEHASH,
      token0: { address: entry.token0, symbol: entry.symbol0, reserve: entry.reserves[0].toString() },
      token1: { address: entry.token1, symbol: entry.symbol1, reserve: entry.reserves[1].toString() },
      balancesEqualReserves: balance0 === entry.reserves[0] && balance1 === entry.reserves[1],
      totalSupply: entry.totalSupply.toString(),
      kLast: entry.kLast.toString(),
      creationBlock: creation.block_number,
      creationTimestamp: creation.timestamp,
      swapCountAllTime: logResult.result.length,
      swapCountLast30Days: swapsLast30Days,
      lastSwapBlock: lastLog ? Number(lastLog.blockNumber) : null,
      lastSwapTimestamp: lastSwapTimestamp === null ? null : new Date(lastSwapTimestamp * 1_000).toISOString(),
      daysSinceLastSwap: secondsSinceLastSwap === null ? null : Number((secondsSinceLastSwap / 86_400).toFixed(2)),
      volume0BaseUnits: volume0.toString(),
      volume1BaseUnits: volume1.toString(),
      volume0Formatted18Decimals: formatUnits(volume0, 18),
      volume1Formatted18Decimals: formatUnits(volume1, 18),
      lastSwapTransactionHash: lastLog?.transactionHash || null,
    });
  }

  const source = await fetchJson<ContractSource>(`${EXPLORER}/api/v2/smart-contracts/${FACTORY}`);
  const publishedSources = [{ file_path: source.file_path, source_code: source.source_code }, ...source.additional_sources];
  const sourceComparisons = [];
  for (const item of publishedSources) {
    const upstreamUrl = `https://raw.githubusercontent.com/Uniswap/v2-core/master/${item.file_path}`;
    const upstream = await fetch(upstreamUrl, {
      headers: { "user-agent": "PermV2VenueReview/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    required(upstream.ok, `Could not fetch ${upstreamUrl}`);
    const upstreamSource = await upstream.text();
    sourceComparisons.push({
      file: item.file_path,
      exactUpstreamMatch: upstreamSource === item.source_code,
      publishedSha256: createHash("sha256").update(item.source_code).digest("hex"),
      upstreamSha256: createHash("sha256").update(upstreamSource).digest("hex"),
    });
  }
  const factoryAddress = await fetchJson<{ creator_address_hash: Address; creation_transaction_hash: Hex }>(
    `${EXPLORER}/api/v2/addresses/${FACTORY}`,
  );

  const allExact = sourceComparisons.every((item) => item.exactUpstreamMatch);
  const pairCodeExact = reviewedPairs.every((pair) => pair.canonicalPairRuntimeMatch);
  const recentSwapCount30Days = reviewedPairs.reduce((sum, pair) => sum + pair.swapCountLast30Days, 0);
  const supportedWithoutPairs = LIVE_TOKENS
    .filter((token) => token.address !== "0x0000000000000000000000000000000000000000")
    .map((token) => token.symbol)
    .filter((symbol) => !supportedSymbolsWithPairs.has(symbol));
  const reasons = [
    "No official or protocol-owner attribution was found for the factory; creator and fee setter are the same unattributed EOA.",
    recentSwapCount30Days === 0
      ? "No reviewed supported-token pair has Swap activity in the last 30 days."
      : null,
    "The only supported-token reserves are approximately 0.001604 and 0.015 alternate WETH, with no approved liquidity threshold or independent market-depth evidence.",
    "Exact upstream source proves implementation integrity, not venue ownership, operations, liquidity durability, or production suitability.",
  ].filter((item): item is string => Boolean(item));
  const result = {
    schemaVersion: 1,
    purpose: "perm-chain-46630-v2-venue-admission-review",
    chainId: 46_630,
    reviewedAt: new Date().toISOString(),
    latestBlock: latestBlock.number.toString(),
    latestBlockTimestamp: new Date(Number(latestBlock.timestamp) * 1_000).toISOString(),
    factory: {
      address: FACTORY,
      runtimeCodehash: factoryCodehash,
      expectedRuntimeCodehash: EXPECTED_FACTORY_CODEHASH,
      creator: factoryAddress.creator_address_hash,
      creationTransactionHash: factoryAddress.creation_transaction_hash,
      feeTo,
      feeToSetter,
      allPairsLength: allPairsLength.toString(),
      sourceVerification: {
        isVerified: source.is_verified,
        isFullyVerified: source.is_fully_verified,
        isChangedBytecode: source.is_changed_bytecode,
        compilerVersion: source.compiler_version,
        optimizerEnabled: source.optimization_enabled,
        optimizerRuns: source.optimization_runs,
        evmVersion: source.evm_version,
        publishedFiles: publishedSources.length,
        exactUniswapV2CoreFiles: sourceComparisons.filter((item) => item.exactUpstreamMatch).length,
        allPublishedSourcesExactUpstreamMatch: allExact,
        files: sourceComparisons,
      },
      publicProtocolAttribution: null,
      officialUniswapDeployment: false,
    },
    weth: WETH,
    expectedPairRuntimeCodehash: EXPECTED_PAIR_CODEHASH,
    supportedPairCount: reviewedPairs.length,
    supportedPairs: reviewedPairs,
    supportedTokensWithoutFactoryPair: supportedWithoutPairs,
    recentSwapCount30Days,
    findings: {
      factorySourceExactMatch: allExact,
      supportedPairRuntimeExactMatch: pairCodeExact,
      implementationIntegrityEstablished: allExact && pairCodeExact,
      officialProvenanceEstablished: false,
      recentIndependentActivityEstablished: recentSwapCount30Days > 0,
      meaningfulLiquidityEstablished: false,
    },
    admissionDecision: "withhold",
    adapterDeploymentAuthorized: false,
    reasons,
    reconsiderationGates: [
      "Credible public venue ownership or protocol attribution.",
      "A reviewed quantitative liquidity and price-impact threshold.",
      "Recent independent Swap activity and sustained volume, not activity created by Perm evidence transactions.",
      "Fresh source, bytecode, reserve, and fork-execution review before any deployment or router registration.",
    ],
    boundary: "This review permits dormant adapter development and fork testing only. It does not authorize deployment, router registration, hosted quoting, or release claims.",
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "reviewed",
    admissionDecision: result.admissionDecision,
    adapterDeploymentAuthorized: result.adapterDeploymentAuthorized,
    factory: FACTORY,
    supportedPairCount: reviewedPairs.length,
    recentSwapCount30Days,
    output: path.relative(process.cwd(), outputPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
