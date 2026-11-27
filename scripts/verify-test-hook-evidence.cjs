#!/usr/bin/env node
/** Read-only chain verifier for isolated, explicitly non-official chain-46630 test-hook evidence. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  concatHex,
  createPublicClient,
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isHash,
  keccak256,
  parseAbi,
  parseAbiParameters,
} = require("viem");

const CHAIN_ID = 46_630;
const CREATE2_DEPLOYER = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
const EXPECTED_SALT = "0x000000000000000000000000000000000000000000000000000000000000184a";
const EXPECTED_INIT_CODE_HASH = "0x5d33494be3c63be9cf163d217a3e74ef1360e525ea2380c3bf7c9d2e15a78a63";
const HOOK = getAddress("0x4B6aDd241E2bF18Fdd570b664a8fc642Ff0D6888");
const HOOK_CODEHASH = "0x3908f518529f4e2e5b961cfed36d44df9c08eee2722cbd5c42e82043f964cdca";
const POOL_MANAGER = getAddress("0x8366a39CC670B4001A1121B8F6A443A643e40951");
const POOL_MANAGER_CODEHASH = "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626";
const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
const EXTERNAL_POOL = getAddress("0x593e2e0EF3869616Ec3Fbe989dCFf2699D52b69B");
const EXTERNAL_POOL_CODEHASH = "0x957b9c75dd4bb82220fe2058038825c5ba1633543526ef6e3d61c0560d501115";
const WETH = getAddress("0x33e4191705c386532ba27cBF171Db86919200B94");
const TSLA = getAddress("0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E");
const FEE = 3_000;
const TICK_SPACING = 60;
const POOL_ID = "0xdffa836390fce6d1288ea90737aeed11af20557ce24932289ef802a4a4ffd881";
const PROVIDER_ID = keccak256(Buffer.from("PERM_TEST_AGGREGATOR_HOOK"));
const DIRECT_PROVIDER_ID = keccak256(Buffer.from("UNISWAP_V4_DIRECT"));
const TEST_ONLY_LABEL = "Perm test hook - not an official Aggregator Hook";
const OFFICIAL_ROUTER = getAddress("0x3e350b79D4983a0e86Ad4eE25dB1DBBbfB55114d");
const STAGING_ROUTER = getAddress("0xFdC667735C8998fEB83C4c3c7B4eCFB404DAFA87");
const ZERO_HASH = `0x${"00".repeat(32)}`;
const ZERO_ADDRESS = getAddress(`0x${"00".repeat(20)}`);

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function same(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function readJson(filePath, label) {
  required(fs.existsSync(filePath), `${label} not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const repositoryRoot = path.resolve(__dirname, "..");
const evidencePath = path.resolve(
  process.cwd(),
  process.env.TEST_HOOK_EVIDENCE || ".staging/test-hook-evidence.json",
);
const evidence = readJson(evidencePath, "Test-hook evidence");

required(evidence.schemaVersion === 2, "Unsupported test-hook evidence schema");
required(evidence.classification === "isolated-non-official-test-hook-evidence", "Wrong evidence classification");
required(evidence.nonOfficial === true && evidence.nonRelease === true && evidence.rehearsal === false, "Evidence must be live testnet-only and explicitly non-official");
required(evidence.chainId === CHAIN_ID, "Evidence uses the wrong chain");
required(evidence.label === TEST_ONLY_LABEL, "Evidence label mismatch");
required(evidence.productionManifestChanged === false && evidence.executionReadyChanged === false, "Evidence claims a forbidden release-state change");
required(/^[0-9a-f]{40}$/.test(evidence.commitSha), "Evidence commit SHA is invalid");
required(isAddress(evidence.operator), "Evidence operator is invalid");
required(Number.isFinite(Date.parse(evidence.generatedAt)), "Evidence timestamp is invalid");

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const repositoryChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
required(same(currentCommit, evidence.commitSha), "Verifier checkout does not match the evidence commit");
required(!repositoryChanges, "Evidence verification requires the same clean committed checkout");

required(same(evidence.hook.address, HOOK) && same(evidence.hook.runtimeCodehash, HOOK_CODEHASH), "Evidence hook identity mismatch");
required(same(evidence.hook.initCodeHash, EXPECTED_INIT_CODE_HASH), "Evidence hook init-code hash mismatch");
required(same(evidence.hook.create2Deployer, CREATE2_DEPLOYER) && same(evidence.hook.salt, EXPECTED_SALT), "Evidence CREATE2 plan mismatch");
required(same(evidence.hook.poolManager, POOL_MANAGER), "Evidence PoolManager mismatch");
required(same(evidence.hook.externalPool, EXTERNAL_POOL) && same(evidence.hook.externalPoolCodehash, EXTERNAL_POOL_CODEHASH), "Evidence external pool mismatch");
required(same(evidence.hook.poolId, POOL_ID), "Evidence PoolId mismatch");
required(
  evidence.hook.poolKey
    && same(evidence.hook.poolKey.currency0, WETH)
    && same(evidence.hook.poolKey.currency1, TSLA)
    && evidence.hook.poolKey.fee === FEE
    && evidence.hook.poolKey.tickSpacing === TICK_SPACING
    && same(evidence.hook.poolKey.hooks, HOOK),
  "Evidence PoolKey mismatch",
);
required(isAddress(evidence.isolatedStack.router) && isAddress(evidence.isolatedStack.adapter), "Isolated stack addresses are invalid");
required(!same(evidence.isolatedStack.router, evidence.isolatedStack.adapter), "Isolated Router and adapter collide");
required(!same(evidence.isolatedStack.router, OFFICIAL_ROUTER) && !same(evidence.isolatedStack.router, STAGING_ROUTER), "Evidence must not use an official or existing staging Router");
required(same(evidence.isolatedStack.providerId, PROVIDER_ID), "Evidence provider identity mismatch");
required(evidence.isolatedStack.pausedAfterEvidence === true, "Isolated Router was not declared paused after evidence");
required(evidence.isolatedStack.frozenAfterEvidence === true, "Isolated stack was not declared permanently frozen");
required(evidence.isolatedStack.zeroTokenBalanceAfterEvidence === true, "Isolated stack was not declared token-clean");
required(evidence.isolatedStack.productionRoutingChanged === false, "Evidence claims Production routing changed");

const requiredTransactions = [
  "routerDeployment",
  "adapterDeployment",
  "configureAdapter",
  "configureHookProvider",
  "verifyHook",
  "wrapInput",
  "approveInput",
  "swap",
  "claimIsolatedFees",
  "pauseIsolatedRouter",
  "renounceAdapterOwnership",
  "renounceRouterOwnership",
];
required(evidence.transactions && typeof evidence.transactions === "object", "Evidence transaction map is missing");
for (const name of requiredTransactions) required(isHash(evidence.transactions[name]), `${name} transaction hash is invalid`);
for (const name of ["hookDeployment", "poolInitialization"]) {
  required(evidence.transactions[name] === null || isHash(evidence.transactions[name]), `${name} transaction hash is invalid`);
}
required(isHash(evidence.settlement.receiptId) && isHash(evidence.settlement.quoteId), "Settlement hashes are invalid");
for (const field of ["amountIn", "routedInput", "amountOut", "grossFee", "rebate", "netFee", "referralFee", "treasuryFee", "gasUsed"]) {
  required(typeof evidence.settlement[field] === "string" && /^\d+$/.test(evidence.settlement[field]), `Settlement ${field} is invalid`);
}
required(Number.isSafeInteger(evidence.settlement.blockNumber) && evidence.settlement.blockNumber > 0, "Settlement block number is invalid");
const recorded = Object.fromEntries(
  ["amountIn", "routedInput", "amountOut", "grossFee", "rebate", "netFee", "referralFee", "treasuryFee", "gasUsed"]
    .map((field) => [field, BigInt(evidence.settlement[field])]),
);
required(recorded.amountIn >= 1_000_000_000_000n && recorded.amountIn <= 1_000_000_000_000_000n, "Evidence input is outside the bounded 0.000001-0.001 WETH range");
required(recorded.amountOut > 0n, "Evidence output is zero");
required(recorded.grossFee - recorded.rebate === recorded.netFee, "Recorded fee conservation failed");
required(recorded.amountIn - recorded.netFee === recorded.routedInput, "Recorded routed-input conservation failed");
required(recorded.referralFee === 0n && recorded.treasuryFee === recorded.netFee, "Recorded isolated fee allocation mismatch");

const hookArtifact = readJson(
  path.join(repositoryRoot, "contracts/artifacts/contracts/src/test/PermTestAggregatorHook.sol/PermTestAggregatorHook.json"),
  "Compiled hook artifact",
);
const routerArtifact = readJson(
  path.join(repositoryRoot, "contracts/artifacts/contracts/src/PermRouter.sol/PermRouter.json"),
  "Compiled Router artifact",
);
const adapterArtifact = readJson(
  path.join(repositoryRoot, "contracts/artifacts/contracts/src/adapters/PermV4Adapter.sol/PermV4Adapter.json"),
  "Compiled adapter artifact",
);
const hookInitCode = encodeDeployData({
  abi: hookArtifact.abi,
  bytecode: hookArtifact.bytecode,
  args: [POOL_MANAGER, EXTERNAL_POOL, EXTERNAL_POOL_CODEHASH],
});
required(same(keccak256(hookInitCode), EXPECTED_INIT_CODE_HASH), "Clean-checkout hook init code differs from the reviewed plan");
const routerInitCode = encodeDeployData({
  abi: routerArtifact.abi,
  bytecode: routerArtifact.bytecode,
  args: [evidence.operator, evidence.operator, evidence.operator, PERMIT2],
});
const adapterInitCode = encodeDeployData({
  abi: adapterArtifact.abi,
  bytecode: adapterArtifact.bytecode,
  args: [evidence.operator, getAddress(evidence.isolatedStack.router), POOL_MANAGER],
});

const official = readJson(path.join(repositoryRoot, "deployments/robinhood-testnet.json"), "Official manifest");
const staging = readJson(path.join(repositoryRoot, "deployments/robinhood-testnet.v2-staging.json"), "Staging manifest");
required(official.chainId === CHAIN_ID && official.routerVersion === 1 && same(official.permRouter, OFFICIAL_ROUTER), "Official manifest identity changed");
required(Array.isArray(official.aggregatorHooks) && official.aggregatorHooks.length === 0, "Official manifest admits an Aggregator Hook");
required(staging.chainId === CHAIN_ID && staging.nonRelease === true && staging.executionReady === false, "Public staging release boundary changed");
required(same(staging.contracts.permRouter.address, STAGING_ROUTER), "Public staging Router identity changed");
required(staging.providers.uniswapV4AggregatorHook.enabled === false && staging.providers.uniswapV4AggregatorHook.reviewedHooks.length === 0, "Public staging Aggregator Hook boundary changed");
required(staging.boundaries.aggregatorHooksEnabled === false && staging.boundaries.releaseEvidenceComplete === false, "Public staging release boundary changed");
required(!JSON.stringify(official).toLowerCase().includes(HOOK.toLowerCase()), "Official manifest contains the test hook");
required(!JSON.stringify(staging).toLowerCase().includes(HOOK.toLowerCase()), "Public staging manifest contains the isolated test hook");
required(!JSON.stringify(official).toLowerCase().includes(evidence.isolatedStack.router.toLowerCase()), "Official manifest contains the isolated Router");
required(!JSON.stringify(staging).toLowerCase().includes(evidence.isolatedStack.router.toLowerCase()), "Public staging manifest contains the isolated Router");
required(!JSON.stringify(official).toLowerCase().includes(evidence.isolatedStack.adapter.toLowerCase()), "Official manifest contains the isolated adapter");
required(!JSON.stringify(staging).toLowerCase().includes(evidence.isolatedStack.adapter.toLowerCase()), "Public staging manifest contains the isolated adapter");

const rpcUrl = process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const chain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Testnet Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 2, timeout: 20_000 }) });
const confirmationsRequired = BigInt(process.env.TEST_HOOK_EVIDENCE_CONFIRMATIONS || "1");
required(confirmationsRequired >= 1n, "TEST_HOOK_EVIDENCE_CONFIRMATIONS must be at least 1");

const hookAbi = parseAbi([
  "function TEST_ONLY_LABEL() view returns(string)",
  "function isTestOnly() view returns(bool)",
  "function poolManager() view returns(address)",
  "function externalPool() view returns(address)",
  "function externalPoolCodehash() view returns(bytes32)",
  "function registeredPoolId() view returns(bytes32)",
  "event AggregatorPoolRegistered(bytes32 indexed poolId)",
  "event HookSwap(bytes32 indexed poolId,address indexed sender,int256 amount0,int256 amount1,uint24 swapFee)",
]);
const adapterAbi = parseAbi([
  "function owner() view returns(address)",
  "function pendingOwner() view returns(address)",
  "function permRouter() view returns(address)",
  "function poolManager() view returns(address)",
  "function verifiedHookCodehashes(address) view returns(bytes32)",
  "function setVerifiedHook(address hook,bool allowed)",
  "function renounceOwnership()",
  "event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)",
]);
const routerAbi = parseAbi([
  "function owner() view returns(address)",
  "function pendingOwner() view returns(address)",
  "function paused() view returns(bool)",
  "function treasury() view returns(address)",
  "function quoteSigner() view returns(address)",
  "function pauseGuardian() view returns(address)",
  "function permit2() view returns(address)",
  "function adapters(address) view returns(bool enabled,bytes32 providerId)",
  "function adapterCodehashes(address) view returns(bytes32)",
  "function hookProviderIds(address) view returns(bytes32)",
  "function consumedQuotes(bytes32) view returns(bool)",
  "function claimableFees(address,address) view returns(uint256)",
  "function totalClaimableFees(address) view returns(uint256)",
  "function configureAdapter(address adapter,bytes32 providerId,bool enabled)",
  "function configureHookProvider(address adapter,bytes32 providerId)",
  "function claimFees(address token,address recipient) returns(uint256 amount)",
  "function pause()",
  "function renounceOwnership()",
  "event OwnershipTransferred(address indexed previousOwner,address indexed newOwner)",
  "event Paused(address account)",
  "event FeeClaimed(address indexed token,address indexed beneficiary,address indexed recipient,uint256 amount)",
  "event RouteStepSettled(bytes32 indexed receiptId,uint8 indexed stepIndex,bytes32 indexed providerId,address adapter,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,bytes32 stepRouteId,address hook,bytes32 hookCodehash)",
  "event SwapSettled(bytes32 indexed receiptId,bytes32 indexed quoteId,address indexed account,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 routedInput,uint256 amountOut,uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint256 treasuryFee,uint32 policyVersion,bytes32 routeId,bytes32 routeHash)",
]);
const externalAbi = parseAbi([
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function fee() view returns(uint24)",
  "function tickSpacing() view returns(int24)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);
const tokenAbi = parseAbi([
  "function deposit() payable",
  "function approve(address spender,uint256 amount) returns(bool)",
  "function balanceOf(address account) view returns(uint256)",
]);
const managerAbi = parseAbi([
  "function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) returns(int24)",
]);

async function canonicalReceipt(hash, latest, label) {
  required(isHash(hash), `${label} hash is invalid`);
  const receipt = await client.getTransactionReceipt({ hash });
  required(receipt.status === "success", `${label} reverted`);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  required(same(block.hash, receipt.blockHash), `${label} is not canonical`);
  const confirmations = latest >= receipt.blockNumber ? latest - receipt.blockNumber + 1n : 0n;
  required(confirmations >= confirmationsRequired, `${label} has only ${confirmations} confirmations`);
  return { receipt, confirmations };
}

async function canonicalTransaction(hash, latest, label) {
  const [{ receipt, confirmations }, transaction] = await Promise.all([
    canonicalReceipt(hash, latest, label),
    client.getTransaction({ hash }),
  ]);
  required(same(transaction.hash, hash), `${label} transaction hash mismatch`);
  return { receipt, confirmations, transaction };
}

function decodeLogs(receipt, address, abi, eventName) {
  const decoded = [];
  for (const log of receipt.logs.filter((entry) => same(entry.address, address))) {
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
      if (event.eventName === eventName) decoded.push(event.args);
    } catch {
      // Ignore unrelated logs from the exact emitter.
    }
  }
  return decoded;
}

function requireCall(record, target, input, label, value = 0n) {
  required(same(record.transaction.to, target), `${label} target mismatch`);
  required(same(record.transaction.input, input), `${label} calldata mismatch`);
  required(record.transaction.value === value, `${label} value mismatch`);
}

function poolKeyMatches(key) {
  return same(key.currency0, WETH)
    && same(key.currency1, TSLA)
    && Number(key.fee) === FEE
    && Number(key.tickSpacing) === TICK_SPACING
    && same(key.hooks, HOOK);
}

async function main() {
  const [chainId, latest] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  required(chainId === CHAIN_ID, `RPC chain ${chainId} is not Robinhood testnet`);

  const isolatedRouter = getAddress(evidence.isolatedStack.router);
  const isolatedAdapter = getAddress(evidence.isolatedStack.adapter);
  const stagingAdapter = getAddress(staging.contracts.v4Adapter.address);
  const officialAdapter = getAddress(official.v4Adapter);

  required(!same(isolatedAdapter, stagingAdapter) && !same(isolatedAdapter, officialAdapter), "Evidence reuses an official or staging adapter");
  for (const protectedAddress of [HOOK, POOL_MANAGER, EXTERNAL_POOL, PERMIT2, CREATE2_DEPLOYER]) {
    required(!same(isolatedRouter, protectedAddress) && !same(isolatedAdapter, protectedAddress), "Isolated stack collides with a protected dependency");
  }

  const codeAddresses = [
    HOOK,
    isolatedRouter,
    isolatedAdapter,
    POOL_MANAGER,
    EXTERNAL_POOL,
    PERMIT2,
    CREATE2_DEPLOYER,
    OFFICIAL_ROUTER,
    officialAdapter,
    STAGING_ROUTER,
    stagingAdapter,
  ];
  const code = await Promise.all(codeAddresses.map((address) => client.getBytecode({ address, blockNumber: latest })));
  const codeByAddress = new Map(codeAddresses.map((address, index) => [address.toLowerCase(), code[index]]));
  const bytecode = (address) => codeByAddress.get(address.toLowerCase());
  required(bytecode(HOOK) && same(keccak256(bytecode(HOOK)), HOOK_CODEHASH), "Live hook codehash mismatch");
  required(bytecode(POOL_MANAGER) && same(keccak256(bytecode(POOL_MANAGER)), POOL_MANAGER_CODEHASH), "Live PoolManager codehash mismatch");
  required(bytecode(EXTERNAL_POOL) && same(keccak256(bytecode(EXTERNAL_POOL)), EXTERNAL_POOL_CODEHASH), "Live external-pool codehash mismatch");
  for (const address of [isolatedRouter, isolatedAdapter, PERMIT2, CREATE2_DEPLOYER, OFFICIAL_ROUTER, officialAdapter, STAGING_ROUTER, stagingAdapter]) {
    required(bytecode(address) && bytecode(address) !== "0x", `${address} has no runtime code`);
  }
  required(same(keccak256(bytecode(STAGING_ROUTER)), staging.contracts.permRouter.runtimeCodehash), "Public staging Router codehash changed");
  required(same(keccak256(bytecode(stagingAdapter)), staging.contracts.v4Adapter.runtimeCodehash), "Public staging adapter codehash changed");

  const [
    label,
    isTestOnly,
    manager,
    externalPool,
    externalCodehash,
    registeredPoolId,
    externalToken0,
    externalToken1,
    externalFee,
    externalTickSpacing,
    adapterOwner,
    adapterPendingOwner,
    adapterRouter,
    adapterManager,
    pinnedHook,
    routerOwner,
    routerPendingOwner,
    routerPaused,
    routerTreasury,
    routerQuoteSigner,
    routerPauseGuardian,
    routerPermit2,
    adapterConfig,
    configuredAdapterCodehash,
    providerId,
    consumedQuote,
    operatorClaimable,
    totalClaimable,
    routerWeth,
    routerTsla,
    adapterWeth,
    adapterTsla,
    stagingProviderId,
    stagingPinnedHook,
  ] = await Promise.all([
    client.readContract({ address: HOOK, abi: hookAbi, functionName: "TEST_ONLY_LABEL", blockNumber: latest }),
    client.readContract({ address: HOOK, abi: hookAbi, functionName: "isTestOnly", blockNumber: latest }),
    client.readContract({ address: HOOK, abi: hookAbi, functionName: "poolManager", blockNumber: latest }),
    client.readContract({ address: HOOK, abi: hookAbi, functionName: "externalPool", blockNumber: latest }),
    client.readContract({ address: HOOK, abi: hookAbi, functionName: "externalPoolCodehash", blockNumber: latest }),
    client.readContract({ address: HOOK, abi: hookAbi, functionName: "registeredPoolId", blockNumber: latest }),
    client.readContract({ address: EXTERNAL_POOL, abi: externalAbi, functionName: "token0", blockNumber: latest }),
    client.readContract({ address: EXTERNAL_POOL, abi: externalAbi, functionName: "token1", blockNumber: latest }),
    client.readContract({ address: EXTERNAL_POOL, abi: externalAbi, functionName: "fee", blockNumber: latest }),
    client.readContract({ address: EXTERNAL_POOL, abi: externalAbi, functionName: "tickSpacing", blockNumber: latest }),
    client.readContract({ address: isolatedAdapter, abi: adapterAbi, functionName: "owner", blockNumber: latest }),
    client.readContract({ address: isolatedAdapter, abi: adapterAbi, functionName: "pendingOwner", blockNumber: latest }),
    client.readContract({ address: isolatedAdapter, abi: adapterAbi, functionName: "permRouter", blockNumber: latest }),
    client.readContract({ address: isolatedAdapter, abi: adapterAbi, functionName: "poolManager", blockNumber: latest }),
    client.readContract({ address: isolatedAdapter, abi: adapterAbi, functionName: "verifiedHookCodehashes", args: [HOOK], blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "owner", blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "pendingOwner", blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "paused", blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "treasury", blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "quoteSigner", blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "pauseGuardian", blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "permit2", blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "adapters", args: [isolatedAdapter], blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "adapterCodehashes", args: [isolatedAdapter], blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "hookProviderIds", args: [isolatedAdapter], blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "consumedQuotes", args: [evidence.settlement.quoteId], blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "claimableFees", args: [WETH, evidence.operator], blockNumber: latest }),
    client.readContract({ address: isolatedRouter, abi: routerAbi, functionName: "totalClaimableFees", args: [WETH], blockNumber: latest }),
    client.readContract({ address: WETH, abi: tokenAbi, functionName: "balanceOf", args: [isolatedRouter], blockNumber: latest }),
    client.readContract({ address: TSLA, abi: tokenAbi, functionName: "balanceOf", args: [isolatedRouter], blockNumber: latest }),
    client.readContract({ address: WETH, abi: tokenAbi, functionName: "balanceOf", args: [isolatedAdapter], blockNumber: latest }),
    client.readContract({ address: TSLA, abi: tokenAbi, functionName: "balanceOf", args: [isolatedAdapter], blockNumber: latest }),
    client.readContract({ address: STAGING_ROUTER, abi: routerAbi, functionName: "hookProviderIds", args: [stagingAdapter], blockNumber: latest }),
    client.readContract({ address: stagingAdapter, abi: adapterAbi, functionName: "verifiedHookCodehashes", args: [HOOK], blockNumber: latest }),
  ]);

  required(label === TEST_ONLY_LABEL && isTestOnly === true, "Live hook is not explicitly test-only");
  required(same(manager, POOL_MANAGER) && same(externalPool, EXTERNAL_POOL), "Live hook immutable address mismatch");
  required(same(externalCodehash, EXTERNAL_POOL_CODEHASH) && same(registeredPoolId, POOL_ID), "Live hook immutable codehash or PoolId mismatch");
  required(same(externalToken0, WETH) && same(externalToken1, TSLA), "External pool token pair changed");
  required(Number(externalFee) === FEE && Number(externalTickSpacing) === TICK_SPACING, "External pool configuration changed");
  required(same(adapterOwner, ZERO_ADDRESS) && same(adapterPendingOwner, ZERO_ADDRESS), "Isolated adapter ownership is not permanently renounced");
  required(same(routerOwner, ZERO_ADDRESS) && same(routerPendingOwner, ZERO_ADDRESS) && routerPaused === true, "Isolated Router is not permanently paused and ownerless");
  required(same(adapterRouter, isolatedRouter) && same(adapterManager, POOL_MANAGER), "Isolated adapter immutable mismatch");
  required(same(pinnedHook, HOOK_CODEHASH), "Isolated adapter hook pin mismatch");
  required(same(routerTreasury, evidence.operator) && same(routerQuoteSigner, evidence.operator) && same(routerPauseGuardian, evidence.operator), "Isolated Router role identity mismatch");
  required(same(routerPermit2, PERMIT2), "Isolated Router Permit2 mismatch");
  required(adapterConfig[0] === true && same(adapterConfig[1], DIRECT_PROVIDER_ID), "Isolated Router adapter configuration mismatch");
  required(same(configuredAdapterCodehash, keccak256(bytecode(isolatedAdapter))), "Isolated Router adapter codehash pin mismatch");
  required(same(providerId, PROVIDER_ID), "Isolated Router hook-provider identity mismatch");
  required(consumedQuote === true, "Evidence quote is not marked consumed");
  required(operatorClaimable === 0n && totalClaimable === 0n, "Isolated Router retained claimable WETH fees");
  required(routerWeth === 0n && routerTsla === 0n && adapterWeth === 0n && adapterTsla === 0n, "Isolated stack retained route tokens");
  required(same(stagingProviderId, ZERO_HASH) && same(stagingPinnedHook, ZERO_HASH), "Existing public staging stack admitted the test hook");

  const transactionOrder = [
    ...(evidence.transactions.hookDeployment ? ["hookDeployment"] : []),
    ...(evidence.transactions.poolInitialization ? ["poolInitialization"] : []),
    ...requiredTransactions,
  ];
  const records = {};
  let minimumConfirmations = null;
  let previousNonce = null;
  for (const name of transactionOrder) {
    const record = await canonicalTransaction(evidence.transactions[name], latest, name);
    records[name] = record;
    required(same(record.transaction.from, evidence.operator), `${name} used the wrong operator`);
    if (previousNonce !== null) required(record.transaction.nonce === previousNonce + 1, `${name} is not the next operator transaction`);
    previousNonce = record.transaction.nonce;
    minimumConfirmations = minimumConfirmations === null || record.confirmations < minimumConfirmations
      ? record.confirmations
      : minimumConfirmations;
  }

  if (records.hookDeployment) {
    requireCall(records.hookDeployment, CREATE2_DEPLOYER, concatHex([EXPECTED_SALT, hookInitCode]), "Hook deployment");
  }
  if (records.poolInitialization) {
    required(same(records.poolInitialization.transaction.to, POOL_MANAGER), "Pool initialization target mismatch");
    required(records.poolInitialization.transaction.value === 0n, "Pool initialization sent value");
    const decoded = decodeFunctionData({ abi: managerAbi, data: records.poolInitialization.transaction.input });
    required(decoded.functionName === "initialize" && poolKeyMatches(decoded.args[0]), "Pool initialization calldata mismatch");
    const registrations = decodeLogs(records.poolInitialization.receipt, HOOK, hookAbi, "AggregatorPoolRegistered");
    required(registrations.length === 1 && same(registrations[0].poolId, POOL_ID), "AggregatorPoolRegistered evidence mismatch");
  }

  required(records.routerDeployment.transaction.to === null, "Router deployment is not contract creation");
  required(same(records.routerDeployment.transaction.input, routerInitCode), "Router deployment init code mismatch");
  required(same(records.routerDeployment.receipt.contractAddress, isolatedRouter), "Router deployment address mismatch");
  required(records.adapterDeployment.transaction.to === null, "Adapter deployment is not contract creation");
  required(same(records.adapterDeployment.transaction.input, adapterInitCode), "Adapter deployment init code mismatch");
  required(same(records.adapterDeployment.receipt.contractAddress, isolatedAdapter), "Adapter deployment address mismatch");

  requireCall(records.configureAdapter, isolatedRouter, encodeFunctionData({
    abi: routerAbi,
    functionName: "configureAdapter",
    args: [isolatedAdapter, DIRECT_PROVIDER_ID, true],
  }), "Adapter configuration");
  requireCall(records.configureHookProvider, isolatedRouter, encodeFunctionData({
    abi: routerAbi,
    functionName: "configureHookProvider",
    args: [isolatedAdapter, PROVIDER_ID],
  }), "Hook-provider configuration");
  requireCall(records.verifyHook, isolatedAdapter, encodeFunctionData({
    abi: adapterAbi,
    functionName: "setVerifiedHook",
    args: [HOOK, true],
  }), "Hook-codehash pinning");
  requireCall(records.wrapInput, WETH, encodeFunctionData({ abi: tokenAbi, functionName: "deposit" }), "Bounded WETH wrapping", recorded.amountIn);
  requireCall(records.approveInput, WETH, encodeFunctionData({
    abi: tokenAbi,
    functionName: "approve",
    args: [isolatedRouter, recorded.amountIn],
  }), "Bounded WETH approval");

  required(same(records.swap.transaction.to, isolatedRouter) && records.swap.transaction.value === 0n, "Swap used the wrong Router or value");
  const decodedSwap = decodeFunctionData({ abi: routerArtifact.abi, data: records.swap.transaction.input });
  required(decodedSwap.functionName === "swapExactInput", "Evidence transaction is not swapExactInput");
  const [request, signature, permit] = decodedSwap.args;
  required(
    same(request.tokenIn, WETH)
      && same(request.tokenOut, TSLA)
      && request.amountIn === recorded.amountIn
      && request.minAmountOut === 1n
      && request.gasEstimate === 800_000n
      && same(request.recipient, evidence.operator)
      && request.deadline === request.quotedAt + 120n
      && Number(request.policyVersion) === 1
      && request.chainId === BigInt(CHAIN_ID)
      && same(request.quoteId, evidence.settlement.quoteId)
      && same(request.referrer, ZERO_ADDRESS),
    "Bounded signed swap request mismatch",
  );
  required(typeof signature === "string" && signature.length === 132, "Swap quote signature is invalid");
  required(permit.nonce === 0n && permit.deadline === 0n && permit.signature === "0x", "Unexpected Permit2 input");
  const [route] = decodeAbiParameters(
    parseAbiParameters("(address adapter,address tokenIn,address tokenOut,bytes data)[]"),
    request.routeData,
  );
  required(route.length === 1 && same(route[0].adapter, isolatedAdapter) && same(route[0].tokenIn, WETH) && same(route[0].tokenOut, TSLA), "Swap route is not the isolated one-step route");
  const [routeKey, hookData] = decodeAbiParameters(
    parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks), bytes"),
    route[0].data,
  );
  required(poolKeyMatches(routeKey) && hookData === "0x", "Swap PoolKey or hook data mismatch");
  const expectedCombinedRouteId = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32, bytes32, bytes32"),
    [ZERO_HASH, PROVIDER_ID, POOL_ID],
  ));

  const steps = decodeLogs(records.swap.receipt, isolatedRouter, routerAbi, "RouteStepSettled");
  const settlements = decodeLogs(records.swap.receipt, isolatedRouter, routerAbi, "SwapSettled");
  const hookSwaps = decodeLogs(records.swap.receipt, HOOK, hookAbi, "HookSwap");
  const externalSwaps = decodeLogs(records.swap.receipt, EXTERNAL_POOL, externalAbi, "Swap");
  required(steps.length === 1 && settlements.length === 1 && hookSwaps.length === 1 && externalSwaps.length === 1, "Canonical one-step settlement event count mismatch");
  const [step] = steps;
  const [settlement] = settlements;
  const [hookSwap] = hookSwaps;
  const [externalSwap] = externalSwaps;
  required(same(step.receiptId, evidence.settlement.receiptId) && step.stepIndex === 0 && same(step.providerId, PROVIDER_ID), "RouteStep identity mismatch");
  required(same(step.adapter, isolatedAdapter) && same(step.hook, HOOK), "RouteStep adapter or hook mismatch");
  required(same(step.tokenIn, WETH) && same(step.tokenOut, TSLA), "RouteStep pair mismatch");
  required(step.amountIn === recorded.routedInput && step.amountOut === recorded.amountOut, "RouteStep amounts mismatch");
  required(same(step.hookCodehash, HOOK_CODEHASH) && same(step.stepRouteId, POOL_ID), "RouteStep codehash or PoolId mismatch");
  required(same(settlement.receiptId, evidence.settlement.receiptId) && same(settlement.quoteId, evidence.settlement.quoteId), "SwapSettled receipt or quote mismatch");
  required(same(settlement.account, evidence.operator) && same(settlement.recipient, evidence.operator), "SwapSettled account or recipient mismatch");
  required(same(settlement.tokenIn, WETH) && same(settlement.tokenOut, TSLA), "SwapSettled pair mismatch");
  required(settlement.amountIn === recorded.amountIn && settlement.routedInput === recorded.routedInput && settlement.amountOut === recorded.amountOut, "SwapSettled amounts mismatch");
  required(settlement.grossFee === recorded.grossFee && settlement.rebate === recorded.rebate && settlement.netFee === recorded.netFee, "SwapSettled core fees mismatch");
  required(settlement.referralFee === recorded.referralFee && settlement.treasuryFee === recorded.treasuryFee, "SwapSettled fee allocation mismatch");
  required(settlement.grossFee - settlement.rebate === settlement.netFee && settlement.amountIn - settlement.netFee === settlement.routedInput, "SwapSettled conservation failed");
  required(Number(settlement.policyVersion) === 1, "SwapSettled policy version mismatch");
  required(same(settlement.routeId, expectedCombinedRouteId) && same(settlement.routeHash, keccak256(request.routeData)), "SwapSettled route commitment mismatch");
  required(same(hookSwap.poolId, POOL_ID) && same(hookSwap.sender, isolatedAdapter), "HookSwap identity mismatch");
  required(hookSwap.amount0 === recorded.routedInput && hookSwap.amount1 === -recorded.amountOut && Number(hookSwap.swapFee) === 0, "HookSwap amounts mismatch");
  required(same(externalSwap.sender, HOOK) && same(externalSwap.recipient, POOL_MANAGER), "External Swap identity mismatch");
  required(externalSwap.amount0 === recorded.routedInput && externalSwap.amount1 === -recorded.amountOut, "External Swap amounts mismatch");
  required(records.swap.receipt.gasUsed === recorded.gasUsed, "Swap gas-used evidence mismatch");
  required(Number(records.swap.receipt.blockNumber) === evidence.settlement.blockNumber, "Swap block-number evidence mismatch");

  requireCall(records.claimIsolatedFees, isolatedRouter, encodeFunctionData({
    abi: routerAbi,
    functionName: "claimFees",
    args: [WETH, getAddress(evidence.operator)],
  }), "Isolated fee cleanup");
  const claims = decodeLogs(records.claimIsolatedFees.receipt, isolatedRouter, routerAbi, "FeeClaimed");
  required(
    claims.length === 1
      && same(claims[0].token, WETH)
      && same(claims[0].beneficiary, evidence.operator)
      && same(claims[0].recipient, evidence.operator)
      && claims[0].amount === recorded.treasuryFee,
    "Canonical isolated fee cleanup mismatch",
  );
  requireCall(records.pauseIsolatedRouter, isolatedRouter, encodeFunctionData({ abi: routerAbi, functionName: "pause" }), "Isolated Router pause");
  const pauses = decodeLogs(records.pauseIsolatedRouter.receipt, isolatedRouter, routerAbi, "Paused");
  required(pauses.length === 1 && same(pauses[0].account, evidence.operator), "Canonical Router-pause event is missing");
  requireCall(records.renounceAdapterOwnership, isolatedAdapter, encodeFunctionData({ abi: adapterAbi, functionName: "renounceOwnership" }), "Adapter ownership renunciation");
  const adapterRenunciations = decodeLogs(records.renounceAdapterOwnership.receipt, isolatedAdapter, adapterAbi, "OwnershipTransferred");
  required(adapterRenunciations.some((entry) => same(entry.previousOwner, evidence.operator) && same(entry.newOwner, ZERO_ADDRESS)), "Canonical adapter ownership renunciation is missing");
  requireCall(records.renounceRouterOwnership, isolatedRouter, encodeFunctionData({ abi: routerAbi, functionName: "renounceOwnership" }), "Router ownership renunciation");
  const routerRenunciations = decodeLogs(records.renounceRouterOwnership.receipt, isolatedRouter, routerAbi, "OwnershipTransferred");
  required(routerRenunciations.some((entry) => same(entry.previousOwner, evidence.operator) && same(entry.newOwner, ZERO_ADDRESS)), "Canonical Router ownership renunciation is missing");

  console.log(JSON.stringify({
    status: "passed",
    classification: evidence.classification,
    chainId,
    verifiedCommit: currentCommit,
    latestBlock: latest.toString(),
    minimumConfirmations: minimumConfirmations.toString(),
    hook: HOOK,
    hookCodehash: HOOK_CODEHASH,
    router: isolatedRouter,
    adapter: isolatedAdapter,
    swap: evidence.transactions.swap,
    receiptId: evidence.settlement.receiptId,
    amountOut: evidence.settlement.amountOut,
    isolatedStackPaused: true,
    isolatedStackOwnerless: true,
    isolatedStackTokenBalancesZero: true,
    productionRoutingChanged: false,
    officialAdmissionClaimed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
