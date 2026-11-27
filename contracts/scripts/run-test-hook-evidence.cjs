const hre = require("hardhat");
const { ethers } = hre;
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CHAIN_ID = 46_630n;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const POOL_MANAGER_CODEHASH = "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const EXTERNAL_POOL = "0x593e2e0EF3869616Ec3Fbe989dCFf2699D52b69B";
const EXTERNAL_POOL_CODEHASH = "0x957b9c75dd4bb82220fe2058038825c5ba1633543526ef6e3d61c0560d501115";
const WETH = "0x33e4191705c386532ba27cBF171Db86919200B94";
const TSLA = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";
const FEE = 3_000;
const TICK_SPACING = 60;
const EXPECTED_HOOK = "0x4B6aDd241E2bF18Fdd570b664a8fc642Ff0D6888";
const EXPECTED_SALT = "0x000000000000000000000000000000000000000000000000000000000000184a";
const EXPECTED_INIT_CODE_HASH = "0x5d33494be3c63be9cf163d217a3e74ef1360e525ea2380c3bf7c9d2e15a78a63";
const EXPECTED_HOOK_CODEHASH = "0x3908f518529f4e2e5b961cfed36d44df9c08eee2722cbd5c42e82043f964cdca";
const TEST_ONLY_LABEL = "Perm test hook - not an official Aggregator Hook";
const TEST_HOOK_PROVIDER = ethers.id("PERM_TEST_AGGREGATOR_HOOK");
const DIRECT_PROVIDER = ethers.id("UNISWAP_V4_DIRECT");
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };
const HOOK_SWAP_TOPIC = ethers.id("HookSwap(bytes32,address,int256,int256,uint24)");
const EXTERNAL_SWAP_TOPIC = ethers.id("Swap(address,address,int256,int256,uint160,uint128,int24)");
const CONFIRMATION = "I_UNDERSTAND_THIS_IS_A_NON_OFFICIAL_TESTNET_FIXTURE";

const cleanupState = {};
let operationJournalPath = null;
let operationState = null;

function persistOperation() {
  if (!operationJournalPath || !operationState) return;
  fs.mkdirSync(path.dirname(operationJournalPath), { recursive: true });
  const temporary = `${operationJournalPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(operationState, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, operationJournalPath);
}

function updateOperation(values) {
  if (!operationState) return;
  Object.assign(operationState, values, { updatedAt: new Date().toISOString() });
  persistOperation();
}

function recordOperationTransaction(name, hash, status = "submitted") {
  if (!operationState) return;
  operationState.transactions[name] = { hash, status };
  updateOperation({});
}

async function waitAndRecord(name, transactionOrPromise) {
  const transaction = await transactionOrPromise;
  required(transaction && transaction.hash, `${name} transaction was not submitted`);
  recordOperationTransaction(name, transaction.hash);
  const receipt = await transaction.wait();
  recordOperationTransaction(name, receipt.hash, "confirmed");
  return receipt;
}

function same(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function required(condition, message) {
  if (!condition) throw new Error(message);
}

async function runtimeCodehash(address) {
  const code = await ethers.provider.getCode(address);
  required(code !== "0x", `${address} has no runtime code`);
  return ethers.keccak256(code);
}

function parseAmount() {
  const raw = process.env.TEST_HOOK_AMOUNT_IN_WEI || "100000000000000";
  required(/^\d+$/.test(raw), "TEST_HOOK_AMOUNT_IN_WEI must be an integer");
  const amount = BigInt(raw);
  required(amount >= 1_000_000_000_000n && amount <= 1_000_000_000_000_000n, "Test input must be between 0.000001 and 0.001 WETH");
  return amount;
}

async function signedRequest(router, signer, values) {
  const request = { gasEstimate: 800_000n, ...values, quoteId: ethers.ZeroHash };
  const domain = { name: "Perm", version: "2", chainId: Number(CHAIN_ID), verifyingContract: router.target };
  const types = { PermQuote: [
    { name: "account", type: "address" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" },
    { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" },
    { name: "quotedAt", type: "uint64" }, { name: "policyVersion", type: "uint32" },
    { name: "chainId", type: "uint256" }, { name: "referrer", type: "address" },
    { name: "routeHash", type: "bytes32" },
  ] };
  const value = {
    account: signer.address,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    minAmountOut: request.minAmountOut,
    gasEstimate: request.gasEstimate,
    recipient: request.recipient,
    deadline: request.deadline,
    quotedAt: request.quotedAt,
    policyVersion: request.policyVersion,
    chainId: request.chainId,
    referrer: request.referrer,
    routeHash: ethers.keccak256(request.routeData),
  };
  return {
    request: { ...request, quoteId: ethers.TypedDataEncoder.hash(domain, types, value) },
    signature: await signer.signTypedData(domain, types, value),
  };
}

function parsedEvents(contract, receipt) {
  return receipt.logs
    .filter((log) => same(log.address, contract.target))
    .map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .filter(Boolean);
}

async function emergencyFreeze() {
  const { router, adapter, operator } = cleanupState;
  if (!router || !operator) return { attempted: false, secure: true, outcomes: [] };
  const outcomes = [];

  try {
    const claimable = await router.claimableFees(WETH, operator.address);
    if (claimable > 0n) {
      await waitAndRecord("emergencyClaimIsolatedFees", router.claimFees(WETH, operator.address));
      outcomes.push("claimed-isolated-fees");
    }
  } catch (error) {
    outcomes.push(`fee-cleanup-failed:${error.shortMessage || error.message}`);
  }

  try {
    if (!(await router.paused())) {
      await waitAndRecord("emergencyPauseIsolatedRouter", router.pause());
      outcomes.push("paused-router");
    }
  } catch (error) {
    outcomes.push(`router-pause-failed:${error.shortMessage || error.message}`);
  }

  if (adapter) {
    try {
      if (same(await adapter.owner(), operator.address)) {
        await waitAndRecord("emergencyRenounceAdapterOwnership", adapter.renounceOwnership());
        outcomes.push("renounced-adapter-ownership");
      }
    } catch (error) {
      outcomes.push(`adapter-freeze-failed:${error.shortMessage || error.message}`);
    }
  }

  try {
    if (same(await router.owner(), operator.address) && await router.paused()) {
      await waitAndRecord("emergencyRenounceRouterOwnership", router.renounceOwnership());
      outcomes.push("renounced-router-ownership");
    }
  } catch (error) {
    outcomes.push(`router-freeze-failed:${error.shortMessage || error.message}`);
  }

  let secure = false;
  try {
    const routerSecure = await router.paused() && same(await router.owner(), ethers.ZeroAddress);
    const adapterSecure = !adapter || same(await adapter.owner(), ethers.ZeroAddress);
    secure = routerSecure && adapterSecure;
  } catch (error) {
    outcomes.push(`cleanup-verification-failed:${error.shortMessage || error.message}`);
  }
  return { attempted: true, secure, outcomes };
}

async function main() {
  const rehearsal = hre.network.name === "hardhat";
  if (rehearsal) await ethers.provider.send("evm_mine", []);
  const network = await ethers.provider.getNetwork();
  required(network.chainId === CHAIN_ID, `Refusing chain ${network.chainId}; expected ${CHAIN_ID}`);
  if (!rehearsal) {
    required(process.env.CONFIRM_NON_OFFICIAL_TEST_HOOK === CONFIRMATION, `Set CONFIRM_NON_OFFICIAL_TEST_HOOK=${CONFIRMATION}`);
  }
  const amountIn = parseAmount();

  const repositoryRoot = path.resolve(__dirname, "../..");
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const repositoryChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  if (!rehearsal) required(!repositoryChanges, "Live test-hook evidence requires a clean committed checkout");

  const [operator] = await ethers.getSigners();
  required(operator, "A testnet-only DEPLOYER_PRIVATE_KEY is required in the local environment");
  cleanupState.operator = operator;
  operationJournalPath = path.join(repositoryRoot, ".staging", rehearsal
    ? "test-hook-operation.rehearsal.json"
    : "test-hook-operation.json");
  operationState = {
    schemaVersion: 1,
    classification: "isolated-non-official-test-hook-operation",
    status: "preflight-passed",
    rehearsal,
    chainId: Number(CHAIN_ID),
    commitSha,
    operator: operator.address,
    hook: EXPECTED_HOOK,
    isolatedStack: { router: null, adapter: null },
    transactions: {},
    startedAt: new Date().toISOString(),
  };
  persistOperation();
  required(await ethers.provider.getCode(CREATE2_DEPLOYER) !== "0x", "CREATE2 singleton deployer is missing");
  required(same(await runtimeCodehash(POOL_MANAGER), POOL_MANAGER_CODEHASH), "PoolManager codehash mismatch");
  required(same(await runtimeCodehash(EXTERNAL_POOL), EXTERNAL_POOL_CODEHASH), "External pool codehash mismatch");
  required(await ethers.provider.getCode(PERMIT2) !== "0x", "Permit2 runtime is missing");

  const external = await ethers.getContractAt([
    "function token0() view returns(address)",
    "function token1() view returns(address)",
    "function fee() view returns(uint24)",
    "function tickSpacing() view returns(int24)",
    "function slot0() view returns(uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
  ], EXTERNAL_POOL);
  required(same(await external.token0(), WETH) && same(await external.token1(), TSLA), "External pool token pair changed");
  required(await external.fee() === BigInt(FEE) && await external.tickSpacing() === BigInt(TICK_SPACING), "External pool configuration changed");

  const Hook = await ethers.getContractFactory("PermTestAggregatorHook");
  const deployment = await Hook.getDeployTransaction(POOL_MANAGER, EXTERNAL_POOL, EXTERNAL_POOL_CODEHASH);
  const initCodeHash = ethers.keccak256(deployment.data);
  required(same(initCodeHash, EXPECTED_INIT_CODE_HASH), "Hook init-code hash differs from reviewed plan");
  required(same(ethers.getCreate2Address(CREATE2_DEPLOYER, EXPECTED_SALT, initCodeHash), EXPECTED_HOOK), "CREATE2 plan does not resolve to reviewed hook address");

  let hookDeploymentReceipt = null;
  if (await ethers.provider.getCode(EXPECTED_HOOK) === "0x") {
    hookDeploymentReceipt = await waitAndRecord("hookDeployment", operator.sendTransaction({
      to: CREATE2_DEPLOYER,
      data: ethers.concat([EXPECTED_SALT, deployment.data]),
      gasLimit: 6_000_000,
    }));
  }
  required(same(await runtimeCodehash(EXPECTED_HOOK), EXPECTED_HOOK_CODEHASH), "Deployed hook runtime codehash mismatch");
  const hook = Hook.attach(EXPECTED_HOOK);
  required(await hook.isTestOnly(), "Hook lacks the test-only marker");
  required((await hook.TEST_ONLY_LABEL()) === TEST_ONLY_LABEL, "Hook test-only label mismatch");
  required(same(await hook.poolManager(), POOL_MANAGER), "Hook PoolManager mismatch");
  required(same(await hook.externalPool(), EXTERNAL_POOL), "Hook external pool mismatch");
  required(same(await hook.externalPoolCodehash(), EXTERNAL_POOL_CODEHASH), "Hook external codehash mismatch");

  const key = { currency0: WETH, currency1: TSLA, fee: FEE, tickSpacing: TICK_SPACING, hooks: EXPECTED_HOOK };
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const poolId = ethers.keccak256(coder.encode(
    ["address", "address", "uint24", "int24", "address"],
    [WETH, TSLA, FEE, TICK_SPACING, EXPECTED_HOOK],
  ));
  const manager = await ethers.getContractAt([
    "function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) returns(int24)",
  ], POOL_MANAGER);
  let initializationReceipt = null;
  const registeredPoolId = await hook.registeredPoolId();
  if (registeredPoolId === ethers.ZeroHash) {
    const slot0 = await external.slot0();
    initializationReceipt = await waitAndRecord(
      "poolInitialization",
      manager.initialize(key, slot0.sqrtPriceX96, { gasLimit: 1_500_000 }),
    );
  }
  required((await hook.registeredPoolId()) === poolId, "Hook registered PoolId mismatch");

  const Router = await ethers.getContractFactory("PermRouter");
  const router = await Router.deploy(operator.address, operator.address, operator.address, PERMIT2);
  cleanupState.router = router;
  operationState.isolatedStack.router = router.target;
  persistOperation();
  const routerDeploymentReceipt = await waitAndRecord("routerDeployment", router.deploymentTransaction());
  await router.waitForDeployment();
  const Adapter = await ethers.getContractFactory("PermV4Adapter");
  const adapter = await Adapter.deploy(operator.address, router.target, POOL_MANAGER);
  cleanupState.adapter = adapter;
  operationState.isolatedStack.adapter = adapter.target;
  persistOperation();
  const adapterDeploymentReceipt = await waitAndRecord("adapterDeployment", adapter.deploymentTransaction());
  await adapter.waitForDeployment();
  const configureAdapterReceipt = await waitAndRecord(
    "configureAdapter",
    router.configureAdapter(adapter.target, DIRECT_PROVIDER, true),
  );
  const configureProviderReceipt = await waitAndRecord(
    "configureHookProvider",
    router.configureHookProvider(adapter.target, TEST_HOOK_PROVIDER),
  );
  const verifyHookReceipt = await waitAndRecord(
    "verifyHook",
    adapter.setVerifiedHook(EXPECTED_HOOK, true),
  );
  required((await adapter.verifiedHookCodehashes(EXPECTED_HOOK)) === EXPECTED_HOOK_CODEHASH, "Adapter hook pin mismatch");

  const weth = await ethers.getContractAt([
    "function deposit() payable",
    "function approve(address,uint256) returns(bool)",
    "function balanceOf(address) view returns(uint256)",
  ], WETH);
  const tsla = await ethers.getContractAt(["function balanceOf(address) view returns(uint256)"], TSLA);
  const depositReceipt = await waitAndRecord("wrapInput", weth.deposit({ value: amountIn }));
  const approvalReceipt = await waitAndRecord("approveInput", weth.approve(router.target, amountIn));
  const beforeOutput = await tsla.balanceOf(operator.address);

  const v4Data = coder.encode(
    ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
    [key, "0x"],
  );
  const routeData = coder.encode(
    ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
    [[{ adapter: adapter.target, tokenIn: WETH, tokenOut: TSLA, data: v4Data }]],
  );
  const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
  const signed = await signedRequest(router, operator, {
    tokenIn: WETH,
    tokenOut: TSLA,
    amountIn,
    minAmountOut: 1n,
    recipient: operator.address,
    deadline: quotedAt + 120,
    quotedAt,
    policyVersion: 1,
    chainId: Number(CHAIN_ID),
    referrer: ethers.ZeroAddress,
    routeData,
  });
  const swapReceipt = await waitAndRecord("swap", router.swapExactInput(
    signed.request,
    signed.signature,
    EMPTY_PERMIT,
    { gasLimit: 3_000_000 },
  ));

  const events = parsedEvents(router, swapReceipt);
  const routeStep = events.find((event) => event.name === "RouteStepSettled");
  const settlement = events.find((event) => event.name === "SwapSettled");
  required(routeStep && settlement, "Router settlement events are missing");
  required(routeStep.args.providerId === TEST_HOOK_PROVIDER, "Wrong test-hook provider identity");
  required(routeStep.args.stepRouteId === poolId, "Wrong PoolId in route evidence");
  required(same(routeStep.args.hook, EXPECTED_HOOK), "Route evidence used the wrong hook");
  required(routeStep.args.hookCodehash === EXPECTED_HOOK_CODEHASH, "Route evidence hook codehash mismatch");
  required(settlement.args.receiptId === routeStep.args.receiptId, "Settlement receipt linkage mismatch");
  required(settlement.args.quoteId === signed.request.quoteId, "Settlement quote linkage mismatch");
  const outputReceived = (await tsla.balanceOf(operator.address)) - beforeOutput;
  required(outputReceived === settlement.args.amountOut && outputReceived > 0n, "Recipient output mismatch");
  required(swapReceipt.logs.some((log) => same(log.address, EXPECTED_HOOK) && log.topics[0] === HOOK_SWAP_TOPIC), "HookSwap evidence is missing");
  required(swapReceipt.logs.some((log) => same(log.address, EXTERNAL_POOL) && log.topics[0] === EXTERNAL_SWAP_TOPIC), "External Swap evidence is missing");

  required(
    settlement.args.referralFee === 0n && settlement.args.treasuryFee === settlement.args.netFee,
    "Unexpected isolated Router fee allocation",
  );
  const claimReceipt = await waitAndRecord(
    "claimIsolatedFees",
    router.claimFees(WETH, operator.address),
  );
  const feeClaim = parsedEvents(router, claimReceipt).find((event) => event.name === "FeeClaimed");
  required(
    feeClaim
      && same(feeClaim.args.token, WETH)
      && same(feeClaim.args.beneficiary, operator.address)
      && same(feeClaim.args.recipient, operator.address)
      && feeClaim.args.amount === settlement.args.netFee,
    "Isolated Router fee cleanup mismatch",
  );
  required(await weth.balanceOf(router.target) === 0n, "Isolated Router retained WETH after fee cleanup");
  required(await tsla.balanceOf(router.target) === 0n, "Isolated Router retained TSLA after settlement");
  required(await weth.balanceOf(adapter.target) === 0n, "Isolated adapter retained WETH after settlement");
  required(await tsla.balanceOf(adapter.target) === 0n, "Isolated adapter retained TSLA after settlement");

  const pauseReceipt = await waitAndRecord("pauseIsolatedRouter", router.pause());
  required(await router.paused(), "Isolated evidence Router did not pause after the swap");
  const adapterRenounceReceipt = await waitAndRecord(
    "renounceAdapterOwnership",
    adapter.renounceOwnership(),
  );
  const routerRenounceReceipt = await waitAndRecord(
    "renounceRouterOwnership",
    router.renounceOwnership(),
  );
  required(await adapter.owner() === ethers.ZeroAddress, "Isolated adapter ownership was not renounced");
  required(await router.owner() === ethers.ZeroAddress, "Isolated Router ownership was not renounced");
  required(await router.paused(), "Isolated Router did not remain paused after ownership renunciation");

  const evidence = {
    schemaVersion: 2,
    classification: "isolated-non-official-test-hook-evidence",
    label: TEST_ONLY_LABEL,
    nonOfficial: true,
    nonRelease: true,
    rehearsal,
    chainId: Number(CHAIN_ID),
    commitSha,
    operator: operator.address,
    generatedAt: new Date().toISOString(),
    hook: {
      address: EXPECTED_HOOK,
      runtimeCodehash: EXPECTED_HOOK_CODEHASH,
      initCodeHash: EXPECTED_INIT_CODE_HASH,
      create2Deployer: CREATE2_DEPLOYER,
      salt: EXPECTED_SALT,
      poolManager: POOL_MANAGER,
      externalPool: EXTERNAL_POOL,
      externalPoolCodehash: EXTERNAL_POOL_CODEHASH,
      poolId,
      poolKey: key,
    },
    isolatedStack: {
      router: router.target,
      adapter: adapter.target,
      providerId: TEST_HOOK_PROVIDER,
      pausedAfterEvidence: true,
      frozenAfterEvidence: true,
      zeroTokenBalanceAfterEvidence: true,
      productionRoutingChanged: false,
    },
    transactions: {
      hookDeployment: hookDeploymentReceipt?.hash || null,
      poolInitialization: initializationReceipt?.hash || null,
      routerDeployment: routerDeploymentReceipt.hash,
      adapterDeployment: adapterDeploymentReceipt.hash,
      configureAdapter: configureAdapterReceipt.hash,
      configureHookProvider: configureProviderReceipt.hash,
      verifyHook: verifyHookReceipt.hash,
      wrapInput: depositReceipt.hash,
      approveInput: approvalReceipt.hash,
      swap: swapReceipt.hash,
      claimIsolatedFees: claimReceipt.hash,
      pauseIsolatedRouter: pauseReceipt.hash,
      renounceAdapterOwnership: adapterRenounceReceipt.hash,
      renounceRouterOwnership: routerRenounceReceipt.hash,
    },
    settlement: {
      receiptId: settlement.args.receiptId,
      quoteId: settlement.args.quoteId,
      amountIn: amountIn.toString(),
      routedInput: settlement.args.routedInput.toString(),
      amountOut: settlement.args.amountOut.toString(),
      grossFee: settlement.args.grossFee.toString(),
      rebate: settlement.args.rebate.toString(),
      netFee: settlement.args.netFee.toString(),
      referralFee: settlement.args.referralFee.toString(),
      treasuryFee: settlement.args.treasuryFee.toString(),
      gasUsed: swapReceipt.gasUsed.toString(),
      blockNumber: Number(swapReceipt.blockNumber),
    },
    productionManifestChanged: false,
    executionReadyChanged: false,
  };

  const defaultOutput = path.join(repositoryRoot, ".staging", rehearsal
    ? "test-hook-evidence.rehearsal.json"
    : "test-hook-evidence.json");
  const output = process.env.TEST_HOOK_EVIDENCE_OUTPUT
    ? path.resolve(process.cwd(), process.env.TEST_HOOK_EVIDENCE_OUTPUT)
    : defaultOutput;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  updateOperation({
    status: "completed-frozen",
    evidenceFile: output,
    isolatedStackFrozen: true,
  });
  console.log(JSON.stringify({
    status: "passed",
    classification: evidence.classification,
    rehearsal,
    hook: evidence.hook.address,
    router: evidence.isolatedStack.router,
    adapter: evidence.isolatedStack.adapter,
    swap: evidence.transactions.swap,
    receiptId: evidence.settlement.receiptId,
    amountOut: evidence.settlement.amountOut,
    evidenceFile: output,
    isolatedStackFrozen: true,
    productionRoutingChanged: false,
  }, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  let cleanup = { attempted: false, secure: false, outcomes: ["cleanup-not-run"] };
  try {
    cleanup = await emergencyFreeze();
  } catch (cleanupError) {
    cleanup = {
      attempted: true,
      secure: false,
      outcomes: [`cleanup-threw:${cleanupError.shortMessage || cleanupError.message}`],
    };
  }
  updateOperation({
    status: cleanup.secure ? "failed-frozen" : "failed-cleanup-required",
    failure: error.shortMessage || error.message,
    emergencyCleanup: cleanup,
  });
  console.error(JSON.stringify({
    status: "failed",
    isolatedStackSecure: cleanup.secure,
    operationJournal: operationJournalPath,
    emergencyCleanup: cleanup,
  }, null, 2));
  process.exitCode = 1;
});
