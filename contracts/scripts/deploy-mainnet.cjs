// Perm Router v2 deployment for Robinhood Chain MAINNET (4663).
//
// Modes
//   Estimate (no broadcast, no key needed beyond an address):
//     ESTIMATE_ONLY=1 DEPLOYER_ADDRESS=0x… QUOTE_SIGNER_ADDRESS=0x… TREASURY_ADDRESS=0x… \
//       npx hardhat run contracts/scripts/deploy-mainnet.cjs --network robinhoodMainnet
//   Fork rehearsal (in-process fork of 4663, Hardhat test key, writes *.rehearsal.json):
//     RUN_MAINNET_FORK_TESTS=1 MAINNET_DEPLOY_REHEARSAL=1 QUOTE_SIGNER_ADDRESS=0x… TREASURY_ADDRESS=0x… \
//       npx hardhat run contracts/scripts/deploy-mainnet.cjs --network hardhat
//   Broadcast (real ETH):
//     CONFIRM_MAINNET=1 VERIFY=1 MAINNET_DEPLOYER_PRIVATE_KEY=… QUOTE_SIGNER_ADDRESS=0x… TREASURY_ADDRESS=0x… \
//       npx hardhat run contracts/scripts/deploy-mainnet.cjs --network robinhoodMainnet
//
// Venues on 4663 (see deployments/mainnet/liquidity-report.md):
//   - Uniswap v4 direct pools via PoolManager      → PermV4Adapter, provider UNISWAP_V4_DIRECT
//   - Uniswap V3 (official, labs-supported)        → PermV3Adapter(SwapRouter02, WETH9), provider UNISWAP_V3
//   - Uniswap V2 (official factory, labs-supported)→ PermV2Adapter(factory, WETH9, pair codehash), provider UNISWAP_V2
//                                                    (DEPLOY_V2=0 skips it)
//   - v4 Aggregator Hooks (WETH pools)             → PermWethAdapter (1:1 wrap step, provider WETH_WRAP) +
//                                                    PermV4Adapter.setVerifiedHook(hook) for every hook in
//                                                    deployments/mainnet/aggregator-hooks.json (runtime codehash
//                                                    pinned) + hook provider UNISWAP_V4_AGGREGATOR_HOOK
//                                                    (ENABLE_AGGREGATOR_HOOKS=0 skips all of it)
//   - Synthra V3 has no pools on mainnet           → not deployed, never shown
//
// The deployer stays owner after this script so the quote signer, referral and treasury can
// be configured with contracts/scripts/mainnet-admin.cjs. Ownership can later be moved to a
// multisig/timelock with ACTION=transfer-ownership; do all setup first (a timelock delays it).

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CHAIN_ID = 4663n;
const M = {
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  v4Quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  v4StateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  v3SwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  v3QuoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  v2Factory: "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",
  v2Router02: "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba",
  // Runtime codehash shared by every Uniswap V2 pair (identical to Uniswap/v2-core UniswapV2Pair).
  v2PairCodehash: "0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5",
  v2FactoryCodehash: "0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0",
  // A live pair used to prove the pinned pair codehash before deploying (WETH/USDG).
  v2ReferencePair: "0x8803c117ccae7B5146297876c2A25DF135141C4d",
};
const PROVIDERS = {
  uniswapV4Direct: ethers.id("UNISWAP_V4_DIRECT"),
  uniswapV3: ethers.id("UNISWAP_V3"),
  uniswapV2: ethers.id("UNISWAP_V2"),
  wethWrap: ethers.id("WETH_WRAP"),
  aggregatorHook: ethers.id("UNISWAP_V4_AGGREGATOR_HOOK"),
};
const HOOKS_FILE = "deployments/mainnet/aggregator-hooks.json";

function requireAddress(label, value) {
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) throw new Error(`${label} must be a non-zero address`);
  return ethers.getAddress(value);
}

function assertSame(label, actual, expected) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
}

async function codehash(address) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${address} has no code on chain ${CHAIN_ID}`);
  return ethers.keccak256(code);
}

async function verify(entry) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await hre.run("verify:verify", entry);
      return "verified";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already verified/i.test(message)) return "verified";
      if (attempt === 4) { console.warn(`Verification failed for ${entry.address}: ${message}`); return "failed"; }
      await new Promise((resolve) => setTimeout(resolve, 15_000 * attempt));
    }
  }
  return "failed";
}

async function main() {
  const estimateOnly = process.env.ESTIMATE_ONLY === "1";
  const rehearsal = process.env.MAINNET_DEPLOY_REHEARSAL === "1";
  const deployV2 = process.env.DEPLOY_V2 !== "0";
  const enableHooks = process.env.ENABLE_AGGREGATOR_HOOKS !== "0";
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error(`Refusing: connected to chain ${network.chainId}, expected ${CHAIN_ID}`);
  // "localhost" = a `hardhat node` started with RUN_MAINNET_FORK_TESTS=1 (used for the full app E2E rehearsal).
  const isFork = hre.network.name === "hardhat" || hre.network.name === "localhost";
  if (rehearsal && !isFork) throw new Error("MAINNET_DEPLOY_REHEARSAL must run on --network hardhat (or a forked localhost node) with RUN_MAINNET_FORK_TESTS=1");
  // A fresh fork can only execute on blocks it mined itself (no hardfork history for 4663).
  if (isFork) await ethers.provider.send("evm_mine", []);
  // Hardhat automine never produces a second block on its own; mainnet waits for 2.
  const confirmations = isFork ? 1 : 2;
  if (!rehearsal && !estimateOnly && process.env.CONFIRM_MAINNET !== "1") {
    throw new Error("Broadcasting to Robinhood Chain mainnet spends real ETH. Re-run with CONFIRM_MAINNET=1 after reviewing the estimate.");
  }
  if (process.env.QUOTE_SIGNER_PRIVATE_KEY) throw new Error("Never pass the quote signer key to the deployer. Provide QUOTE_SIGNER_ADDRESS only.");

  const signers = await ethers.getSigners();
  const deployerAddress = estimateOnly
    ? requireAddress("DEPLOYER_ADDRESS", process.env.DEPLOYER_ADDRESS || signers[0]?.address)
    : signers[0]?.address;
  if (!deployerAddress) throw new Error("MAINNET_DEPLOYER_PRIVATE_KEY is required to broadcast");
  const deployer = estimateOnly ? undefined : signers[0];

  const quoteSigner = requireAddress("QUOTE_SIGNER_ADDRESS", process.env.QUOTE_SIGNER_ADDRESS);
  const treasury = requireAddress("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS);
  const pauseGuardian = process.env.PAUSE_GUARDIAN_ADDRESS ? requireAddress("PAUSE_GUARDIAN_ADDRESS", process.env.PAUSE_GUARDIAN_ADDRESS) : deployerAddress;
  const referrer = process.env.REFERRER_ADDRESS ? requireAddress("REFERRER_ADDRESS", process.env.REFERRER_ADDRESS) : undefined;
  const referralShareBps = Number(process.env.REFERRAL_SHARE_BPS || 5_000);
  if (referrer && (!Number.isInteger(referralShareBps) || referralShareBps < 1 || referralShareBps > 10_000)) throw new Error("REFERRAL_SHARE_BPS must be 1..10000");

  if (quoteSigner.toLowerCase() === deployerAddress.toLowerCase()) throw new Error("The quote signer must be a separate key from the deployer");
  if ((await ethers.provider.getCode(quoteSigner)) !== "0x") throw new Error("QUOTE_SIGNER_ADDRESS must be an EOA/KMS key address, not a contract");
  if (referrer && referrer.toLowerCase() === deployerAddress.toLowerCase()) console.warn("⚠ Referrer equals deployer; Klip 08 needs a separate referrer wallet.");
  if (treasury.toLowerCase() === deployerAddress.toLowerCase()) console.warn("⚠ Treasury equals deployer. Recording guide: skip Klip 09 in that case.");

  // Dependency identity: code present + WETH binding consistent across venues.
  const dependencies = {
    poolManager: M.poolManager, v4Quoter: M.v4Quoter, v4StateView: M.v4StateView, permit2: M.permit2,
    weth: M.weth, v3Factory: M.v3Factory, v3SwapRouter02: M.v3SwapRouter02, v3QuoterV2: M.v3QuoterV2,
    ...(deployV2 ? { v2Factory: M.v2Factory, v2Router02: M.v2Router02 } : {}),
  };
  const dependencyCodehashes = {};
  for (const [label, address] of Object.entries(dependencies)) dependencyCodehashes[label] = await codehash(address);
  const swapRouter = await ethers.getContractAt(["function WETH9() view returns(address)", "function factoryV2() view returns(address)"], M.v3SwapRouter02);
  assertSame("SwapRouter02.WETH9", await swapRouter.WETH9(), M.weth);
  if (deployV2) {
    if (dependencyCodehashes.v2Factory !== M.v2FactoryCodehash) throw new Error(`Uniswap V2 factory codehash ${dependencyCodehashes.v2Factory} is not the reviewed v2-core factory`);
    if ((await codehash(M.v2ReferencePair)) !== M.v2PairCodehash) throw new Error("Uniswap V2 reference pair codehash differs from the pinned pair codehash");
    const v2Router = await ethers.getContractAt(["function factory() view returns(address)", "function WETH() view returns(address)"], M.v2Router02);
    assertSame("UniswapV2Router02.factory", await v2Router.factory(), M.v2Factory);
    assertSame("UniswapV2Router02.WETH", await v2Router.WETH(), M.weth);
  }

  // Aggregator Hooks: only hooks discovered by scripts/mainnet/discover-aggregator-hooks.mjs, re-checked here.
  const repositoryRootForHooks = path.resolve(__dirname, "../..");
  let hookConfig = { hooks: [], pools: [] };
  if (enableHooks) {
    const hooksPath = path.resolve(repositoryRootForHooks, HOOKS_FILE);
    if (!fs.existsSync(hooksPath)) throw new Error(`${HOOKS_FILE} is missing; run node scripts/mainnet/discover-aggregator-hooks.mjs or set ENABLE_AGGREGATOR_HOOKS=0`);
    hookConfig = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    if (hookConfig.chainId !== Number(CHAIN_ID) || !Array.isArray(hookConfig.hooks) || !Array.isArray(hookConfig.pools)) throw new Error(`${HOOKS_FILE} is invalid`);
    if (hookConfig.hooks.length === 0) throw new Error(`${HOOKS_FILE} admits no hook; set ENABLE_AGGREGATOR_HOOKS=0`);
    const hookAbi = ["function poolManager() view returns(address)", "function aggregatorHookVersion() view returns(string)"];
    for (const hook of hookConfig.hooks) {
      const actual = await codehash(hook.address);
      if (actual !== hook.runtimeCodehash) throw new Error(`Hook ${hook.address} runtime codehash changed since discovery (${actual})`);
      if ((BigInt(hook.address) & 0x3fffn) !== 0x2888n) throw new Error(`Hook ${hook.address} permission bits are not 0x2888`);
      const contract = await ethers.getContractAt(hookAbi, hook.address);
      assertSame(`${hook.address}.poolManager`, await contract.poolManager(), M.poolManager);
      if ((await contract.aggregatorHookVersion()) !== hook.version) throw new Error(`Hook ${hook.address} version changed`);
    }
  }

  const repositoryRoot = path.resolve(__dirname, "../..");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  if (!rehearsal && !estimateOnly && dirty && process.env.ALLOW_DIRTY_DEPLOY !== "1") {
    throw new Error("Commit your changes first: the mainnet manifest binds the deployed bytecode to a clean Git commit (ALLOW_DIRTY_DEPLOY=1 overrides).");
  }

  if (!rehearsal && !estimateOnly) {
    // Never silently replace a live deployment: the committed manifest is what the app trusts.
    const existingPath = path.resolve(repositoryRoot, process.env.DEPLOYMENT_OUTPUT || "deployments/robinhood-mainnet.json");
    if (fs.existsSync(existingPath)) {
      const existing = JSON.parse(fs.readFileSync(existingPath, "utf8"));
      if (existing.permRouter && process.env.FORCE_REDEPLOY !== "1") {
        throw new Error(`${path.relative(repositoryRoot, existingPath)} already points to PermRouter ${existing.permRouter}. Set FORCE_REDEPLOY=1 only if you really intend to replace it.`);
      }
    }
  }

  const Router = await ethers.getContractFactory("PermRouter");
  const V4 = await ethers.getContractFactory("PermV4Adapter");
  const V3 = await ethers.getContractFactory("PermV3Adapter");
  const V2 = await ethers.getContractFactory("PermV2Adapter");
  const WethAdapter = await ethers.getContractFactory("PermWethAdapter");

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;

  if (estimateOnly) {
    // Adapters need a router address; a placeholder with the deployer's next-nonce address is exact for estimation.
    const nonce = await ethers.provider.getTransactionCount(deployerAddress);
    const routerAddress = ethers.getCreateAddress({ from: deployerAddress, nonce });
    const items = [
      ["PermRouter", await Router.getDeployTransaction(deployerAddress, treasury, quoteSigner, M.permit2)],
      ["PermV4Adapter", await V4.getDeployTransaction(deployerAddress, routerAddress, M.poolManager)],
      ["PermV3Adapter (Uniswap V3)", await V3.getDeployTransaction(deployerAddress, routerAddress, M.v3SwapRouter02, M.weth)],
      ...(deployV2 ? [["PermV2Adapter (Uniswap V2)", await V2.getDeployTransaction(deployerAddress, routerAddress, M.v2Factory, M.weth, M.v2PairCodehash)]] : []),
      ...(enableHooks ? [["PermWethAdapter (wrap step)", await WethAdapter.getDeployTransaction(routerAddress, M.weth)]] : []),
    ];
    let total = 0n;
    console.log(`Estimate on chain ${CHAIN_ID} · gas price ${ethers.formatUnits(gasPrice, "gwei")} gwei · deployer ${deployerAddress}`);
    for (const [label, tx] of items) {
      const gas = await ethers.provider.estimateGas({ ...tx, from: deployerAddress });
      total += gas;
      console.log(`  ${label.padEnd(28)} ${gas.toString().padStart(10)} gas  ${ethers.formatEther(gas * gasPrice)} ETH`);
    }
    const adapterCount = 2n + (deployV2 ? 1n : 0n) + (enableHooks ? 1n : 0n);
    const hookSetupGas = enableHooks ? BigInt(hookConfig.hooks.length) * 60_000n + 60_000n : 0n;
    const setupGas = adapterCount * 75_000n + hookSetupGas + (pauseGuardian !== deployerAddress ? 50_000n : 0n) + (referrer ? 50_000n : 0n);
    total += setupGas;
    console.log(`  ${"Setup (adapters/guardian/referral)".padEnd(28)} ${setupGas.toString().padStart(10)} gas  ${ethers.formatEther(setupGas * gasPrice)} ETH  (upper bound)`);
    console.log(`  ${"TOTAL".padEnd(28)} ${total.toString().padStart(10)} gas  ${ethers.formatEther(total * gasPrice)} ETH`);
    console.log(`  Recommended deployer balance (×3 buffer): ${ethers.formatEther(total * gasPrice * 3n)} ETH`);
    const balance = await ethers.provider.getBalance(deployerAddress);
    console.log(`  Current deployer balance: ${ethers.formatEther(balance)} ETH ${balance >= total * gasPrice * 3n ? "✅" : "❌ top up first"}`);
    return;
  }

  console.log(`Deploying Perm Router v2 to Robinhood Chain ${rehearsal ? "MAINNET FORK (rehearsal)" : "MAINNET"}`);
  console.log(`  deployer/owner  ${deployerAddress}`);
  console.log(`  treasury        ${treasury}`);
  console.log(`  quote signer    ${quoteSigner}`);
  console.log(`  pause guardian  ${pauseGuardian}`);
  if (referrer) console.log(`  referrer        ${referrer} (${referralShareBps / 100}% of net fee)`);

  const txs = [];
  const router = await Router.connect(deployer).deploy(deployerAddress, treasury, quoteSigner, M.permit2);
  const routerReceipt = await router.deploymentTransaction().wait(confirmations);
  txs.push({ label: "deploy PermRouter (publishes fee policy v1 20 bps / 25% rebate)", hash: routerReceipt.hash, gasUsed: routerReceipt.gasUsed.toString() });
  console.log(`  PermRouter      ${router.target}  tx ${routerReceipt.hash}`);

  const v4 = await V4.connect(deployer).deploy(deployerAddress, router.target, M.poolManager);
  const v4Receipt = await v4.deploymentTransaction().wait(confirmations);
  txs.push({ label: "deploy PermV4Adapter", hash: v4Receipt.hash, gasUsed: v4Receipt.gasUsed.toString() });
  console.log(`  PermV4Adapter   ${v4.target}  tx ${v4Receipt.hash}`);

  const v3 = await V3.connect(deployer).deploy(deployerAddress, router.target, M.v3SwapRouter02, M.weth);
  const v3Receipt = await v3.deploymentTransaction().wait(confirmations);
  txs.push({ label: "deploy PermV3Adapter (Uniswap V3 SwapRouter02)", hash: v3Receipt.hash, gasUsed: v3Receipt.gasUsed.toString() });
  console.log(`  PermV3Adapter   ${v3.target}  tx ${v3Receipt.hash}`);

  let v2;
  if (deployV2) {
    v2 = await V2.connect(deployer).deploy(deployerAddress, router.target, M.v2Factory, M.weth, M.v2PairCodehash);
    const v2Receipt = await v2.deploymentTransaction().wait(confirmations);
    txs.push({ label: "deploy PermV2Adapter (Uniswap V2 factory)", hash: v2Receipt.hash, gasUsed: v2Receipt.gasUsed.toString() });
    console.log(`  PermV2Adapter   ${v2.target}  tx ${v2Receipt.hash}`);
  }
  let wethAdapter;
  if (enableHooks) {
    wethAdapter = await WethAdapter.connect(deployer).deploy(router.target, M.weth);
    const wethReceipt = await wethAdapter.deploymentTransaction().wait(confirmations);
    txs.push({ label: "deploy PermWethAdapter (1:1 ETH<->WETH step)", hash: wethReceipt.hash, gasUsed: wethReceipt.gasUsed.toString() });
    console.log(`  PermWethAdapter ${wethAdapter.target}  tx ${wethReceipt.hash}`);
  }

  const step = async (label, promise) => {
    const receipt = await (await promise).wait(1);
    txs.push({ label, hash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
    console.log(`  ✓ ${label}  ${receipt.hash}`);
  };
  await step("configureAdapter(v4, UNISWAP_V4_DIRECT)", router.connect(deployer).configureAdapter(v4.target, PROVIDERS.uniswapV4Direct, true));
  await step("configureAdapter(v3, UNISWAP_V3)", router.connect(deployer).configureAdapter(v3.target, PROVIDERS.uniswapV3, true));
  if (v2) await step("configureAdapter(v2, UNISWAP_V2)", router.connect(deployer).configureAdapter(v2.target, PROVIDERS.uniswapV2, true));
  if (wethAdapter) {
    await step("configureAdapter(weth, WETH_WRAP)", router.connect(deployer).configureAdapter(wethAdapter.target, PROVIDERS.wethWrap, true));
    for (const hook of hookConfig.hooks) await step(`v4.setVerifiedHook(${hook.address})`, v4.connect(deployer).setVerifiedHook(hook.address, true));
    await step("configureHookProvider(v4, UNISWAP_V4_AGGREGATOR_HOOK)", router.connect(deployer).configureHookProvider(v4.target, PROVIDERS.aggregatorHook));
  }
  if (pauseGuardian.toLowerCase() !== deployerAddress.toLowerCase()) await step("setPauseGuardian", router.connect(deployer).setPauseGuardian(pauseGuardian));
  if (referrer) await step(`configureReferral(${referralShareBps} bps)`, router.connect(deployer).configureReferral(referrer, referralShareBps));

  // Post-deployment invariants.
  const policy = await router.feePolicies(1);
  if ((await router.activePolicyVersion()) !== 1n || policy.platformFeeBps !== 20n || policy.rebateShareBps !== 2_500n || !policy.enabled || !policy.exists) {
    throw new Error("Fee policy v1 is not 20 bps / 25% rebate / enabled");
  }
  assertSame("quoteSigner", await router.quoteSigner(), quoteSigner);
  assertSame("treasury", await router.treasury(), treasury);
  assertSame("pauseGuardian", await router.pauseGuardian(), pauseGuardian);
  assertSame("permit2", await router.permit2(), M.permit2);
  assertSame("owner", await router.owner(), deployerAddress);
  const v4Config = await router.adapters(v4.target);
  const v3Config = await router.adapters(v3.target);
  if (!v4Config.enabled || v4Config.providerId !== PROVIDERS.uniswapV4Direct) throw new Error("V4 adapter registry check failed");
  if (!v3Config.enabled || v3Config.providerId !== PROVIDERS.uniswapV3) throw new Error("V3 adapter registry check failed");
  const hookProvider = await router.hookProviderIds(v4.target);
  if (enableHooks) {
    if (hookProvider !== PROVIDERS.aggregatorHook) throw new Error("Aggregator hook provider is not configured");
    for (const hook of hookConfig.hooks) {
      if ((await v4.verifiedHookCodehashes(hook.address)) !== hook.runtimeCodehash) throw new Error(`Hook ${hook.address} codehash pin failed`);
    }
    const wethConfig = await router.adapters(wethAdapter.target);
    if (!wethConfig.enabled || wethConfig.providerId !== PROVIDERS.wethWrap) throw new Error("WETH adapter registry check failed");
    assertSame("weth.permRouter", await wethAdapter.permRouter(), router.target);
    assertSame("weth.weth", await wethAdapter.weth(), M.weth);
  } else if (hookProvider !== ethers.ZeroHash) {
    throw new Error("Aggregator hook provider must stay disabled");
  }
  if (v2) {
    const v2Config = await router.adapters(v2.target);
    if (!v2Config.enabled || v2Config.providerId !== PROVIDERS.uniswapV2) throw new Error("V2 adapter registry check failed");
    assertSame("v2.factory", await v2.factory(), M.v2Factory);
    assertSame("v2.weth", await v2.weth(), M.weth);
    assertSame("v2.permRouter", await v2.permRouter(), router.target);
    if ((await v2.pairCodehash()) !== M.v2PairCodehash) throw new Error("V2 pair codehash pin failed");
  }
  assertSame("v4.poolManager", await v4.poolManager(), M.poolManager);
  assertSame("v4.permRouter", await v4.permRouter(), router.target);
  assertSame("v3.swapRouter", await v3.swapRouter(), M.v3SwapRouter02);
  assertSame("v3.weth", await v3.weth(), M.weth);
  assertSame("v3.permRouter", await v3.permRouter(), router.target);
  if (referrer && Number(await router.referralShares(referrer)) !== referralShareBps) throw new Error("Referral share check failed");

  const runtimeCodehashes = {
    permRouter: await codehash(router.target),
    v4Adapter: await codehash(v4.target),
    v3Adapter: await codehash(v3.target),
    ...(v2 ? { v2Adapter: await codehash(v2.target) } : {}),
    ...(wethAdapter ? { wethAdapter: await codehash(wethAdapter.target) } : {}),
  };
  if ((await router.adapterCodehashes(v4.target)) !== runtimeCodehashes.v4Adapter) throw new Error("V4 adapter codehash pin failed");
  if ((await router.adapterCodehashes(v3.target)) !== runtimeCodehashes.v3Adapter) throw new Error("V3 adapter codehash pin failed");

  const explorer = (kind, value) => `${M.explorerUrl}/${kind}/${value}`;
  const manifest = {
    schemaVersion: 2,
    routerVersion: 2,
    environment: rehearsal ? "mainnet-fork-rehearsal" : "allowlisted-mainnet",
    network: "Robinhood Chain",
    chainId: Number(CHAIN_ID),
    rpcUrl: M.rpcUrl,
    explorerUrl: M.explorerUrl,
    deploymentCommitSha: commit,
    repositoryDirtyAtDeployment: Boolean(dirty),
    deploymentBlock: Number(routerReceipt.blockNumber),
    poolDiscoveryStartBlock: 0,
    poolManager: M.poolManager,
    v4Quoter: M.v4Quoter,
    v4StateView: M.v4StateView,
    permit2: M.permit2,
    weth: M.weth,
    permRouter: router.target,
    v4Adapter: v4.target,
    v3Adapter: v3.target,
    v2Adapter: v2 ? v2.target : null,
    wethAdapter: wethAdapter ? wethAdapter.target : null,
    contracts: {
      permRouter: { address: router.target, runtimeCodehash: runtimeCodehashes.permRouter, explorerUrl: `${explorer("address", router.target)}?tab=contract` },
      v4Adapter: { address: v4.target, runtimeCodehash: runtimeCodehashes.v4Adapter, explorerUrl: `${explorer("address", v4.target)}?tab=contract` },
      v3Adapter: { address: v3.target, runtimeCodehash: runtimeCodehashes.v3Adapter, explorerUrl: `${explorer("address", v3.target)}?tab=contract` },
      ...(v2 ? { v2Adapter: { address: v2.target, runtimeCodehash: runtimeCodehashes.v2Adapter, explorerUrl: `${explorer("address", v2.target)}?tab=contract` } } : {}),
      ...(wethAdapter ? { wethAdapter: { address: wethAdapter.target, runtimeCodehash: runtimeCodehashes.wethAdapter, explorerUrl: `${explorer("address", wethAdapter.target)}?tab=contract` } } : {}),
    },
    dependencies,
    dependencyCodehashes,
    venues: {
      uniswapV3: { factory: M.v3Factory, swapRouter02: M.v3SwapRouter02, quoterV2: M.v3QuoterV2, weth: M.weth, label: "Uniswap v3" },
      uniswapV2: v2 ? { factory: M.v2Factory, router02: M.v2Router02, weth: M.weth, pairCodehash: M.v2PairCodehash, label: "Uniswap v2" } : null,
      synthraV3: null,
    },
    providers: {
      uniswapV4Direct: PROVIDERS.uniswapV4Direct,
      uniswapV3: PROVIDERS.uniswapV3,
      ...(v2 ? { uniswapV2: PROVIDERS.uniswapV2 } : {}),
      ...(wethAdapter ? { wethWrap: PROVIDERS.wethWrap, uniswapV4AggregatorHook: PROVIDERS.aggregatorHook } : {}),
    },
    hookProviderStatus: enableHooks ? "enabled-codehash-pinned" : "disabled",
    verifiedHooks: enableHooks ? hookConfig.hooks.map(({ address, version, runtimeCodehash }) => ({ address, version, runtimeCodehash })) : [],
    aggregatorHooks: enableHooks ? hookConfig.pools.map(({ id, currency0, currency1, fee, tickSpacing, hooks, hookData, sourceType, initializationBlock, symbol, externalPool, hookVersion }) => (
      { id, currency0, currency1, fee, tickSpacing, hooks, hookData, sourceType, initializationBlock, symbol, externalPool, hookVersion }
    )) : [],
    roles: { owner: deployerAddress, treasury, pauseGuardian, quoteSigner, timelock: null },
    owner: deployerAddress,
    treasury,
    pauseGuardian,
    quoteSigner,
    timelock: null,
    referrals: referrer ? [{ referrer, shareBpsOfNetFee: referralShareBps }] : [],
    policy: { version: 1, platformFeeBps: 20, rebateShareBps: 2500 },
    feePolicy: { version: 1, platformFeeBps: 20, rebateShareBps: 2500, publishedInTx: routerReceipt.hash },
    sourceVerification: "pending",
    releaseStatus: rehearsal ? "rehearsal" : "allowlisted-mainnet",
    nonRelease: true,
    executionReady: false,
    deploymentTransactions: txs,
    generatedAt: new Date().toISOString(),
  };

  const output = path.resolve(repositoryRoot, process.env.DEPLOYMENT_OUTPUT
    || (rehearsal ? "deployments/robinhood-mainnet.rehearsal.json" : "deployments/robinhood-mainnet.json"));
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Manifest written: ${path.relative(repositoryRoot, output)}`);

  if (!rehearsal && process.env.VERIFY === "1") {
    console.log("Verifying sources on Blockscout…");
    const results = {
      permRouter: await verify({ address: router.target, constructorArguments: [deployerAddress, treasury, quoteSigner, M.permit2] }),
      v4Adapter: await verify({ address: v4.target, constructorArguments: [deployerAddress, router.target, M.poolManager] }),
      v3Adapter: await verify({ address: v3.target, constructorArguments: [deployerAddress, router.target, M.v3SwapRouter02, M.weth] }),
      ...(v2 ? { v2Adapter: await verify({ address: v2.target, constructorArguments: [deployerAddress, router.target, M.v2Factory, M.weth, M.v2PairCodehash] }) } : {}),
      ...(wethAdapter ? { wethAdapter: await verify({ address: wethAdapter.target, constructorArguments: [router.target, M.weth] }) } : {}),
    };
    manifest.sourceVerification = Object.values(results).every((r) => r === "verified") ? "verified" : "partial";
    for (const [key, result] of Object.entries(results)) manifest.contracts[key].sourceVerification = result;
    fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Source verification: ${manifest.sourceVerification}`);
  }

  console.log("\nNext:");
  console.log("  1. git add deployments/robinhood-mainnet.json && git commit -m 'chore: publish Perm mainnet 4663 manifest'");
  console.log("  2. Set Vercel env from docs/MAINNET_RUNBOOK.md (§4) and redeploy.");
  console.log("  3. node scripts/mainnet/verify-deployment.mjs   # read-only on-chain check of the manifest");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
