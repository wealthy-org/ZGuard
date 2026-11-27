const hre = require("hardhat");
const { ethers } = hre;
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CHAIN_ID = 46630n;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const V4_QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const SYNTHRA = {
  factory: "0x911b4000D3422F482F4062a913885f7b035382Df",
  swapRouter02: "0x3Ce954107b1A675826B33bF23060Dd655e3758fE",
  quoterV2: "0x231606c321A99DE81e28fE48B07a93F1ba49e713",
  quoterShim: "0xb3C009aECAeDd5ccC62Ec12eDAAA55F19C4A1eFb",
  weth: "0x33e4191705c386532ba27cBF171Db86919200B94",
};

function address(label, value) {
  if (!value || !ethers.isAddress(value)) throw new Error(`${label} must be a valid address`);
  return ethers.getAddress(value);
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

async function requireCode(label, value) {
  if ((await ethers.provider.getCode(value)) === "0x") throw new Error(`${label} has no code on chain ${CHAIN_ID}`);
}

async function requireNoCode(label, value) {
  if ((await ethers.provider.getCode(value)) !== "0x") throw new Error(`${label} must be an EOA on chain ${CHAIN_ID}`);
}

function assertSame(label, actual, expected) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

async function verify(entry) {
  try {
    await hre.run("verify:verify", entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("already verified")) throw error;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("DEPLOYER_PRIVATE_KEY is required in the process environment");
  const rehearsal = process.env.DEPLOYMENT_REHEARSAL === "1";
  const staging = process.env.DEPLOYMENT_STAGING === "1";
  if (rehearsal && staging) throw new Error("DEPLOYMENT_REHEARSAL and DEPLOYMENT_STAGING are mutually exclusive");
  if (staging && process.env.CONFIRM_NON_RELEASE_STAGING !== "1") {
    throw new Error("CONFIRM_NON_RELEASE_STAGING=1 is required for a testnet-only staging deployment");
  }
  if (rehearsal && process.env.VERIFY === "1") throw new Error("Source verification is disabled during a fork rehearsal");
  const repositoryRoot = path.resolve(__dirname, "../..");
  const releaseCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const repositoryChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/i.test(releaseCommitSha)) throw new Error("Unable to bind deployment to a Git commit");
  if (!rehearsal && !staging && repositoryChanges) throw new Error("Shared candidate deployment requires a clean committed repository");
  if (process.env.RELEASE_COMMIT_SHA && process.env.RELEASE_COMMIT_SHA.toLowerCase() !== releaseCommitSha.toLowerCase()) {
    throw new Error("RELEASE_COMMIT_SHA does not match the checked-out commit");
  }
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) throw new Error(`Refusing deployment on chain ${network.chainId}; expected ${CHAIN_ID}`);

  const dependencyAddresses = {
    poolManager: POOL_MANAGER,
    v4Quoter: V4_QUOTER,
    permit2: PERMIT2,
    synthraFactory: SYNTHRA.factory,
    synthraSwapRouter: SYNTHRA.swapRouter02,
    synthraQuoter: SYNTHRA.quoterV2,
    synthraQuoterShim: SYNTHRA.quoterShim,
    synthraWeth: SYNTHRA.weth,
  };
  for (const [label, value] of Object.entries(dependencyAddresses)) await requireCode(label, value);
  const dependencyCodehashes = Object.fromEntries(await Promise.all(Object.entries(dependencyAddresses)
    .map(async ([label, value]) => [label, ethers.keccak256(await ethers.provider.getCode(value))])));

  if (!rehearsal && !staging) {
    for (const name of [
      "QUOTE_SIGNER_ADDRESS", "OWNER_ADDRESS", "TREASURY_ADDRESS", "PAUSE_GUARDIAN_ADDRESS",
      "TIMELOCK_PROPOSER_ADDRESS", "TIMELOCK_DELAY_SECONDS",
    ]) {
      if (!process.env[name]) throw new Error(`${name} is required for a shared candidate deployment`);
    }
    if (process.env.QUOTE_SIGNER_PRIVATE_KEY) throw new Error("Use only QUOTE_SIGNER_ADDRESS during shared deployment; the signer private key belongs only in the quote service");
  }
  if (staging) {
    for (const name of ["QUOTE_SIGNER_ADDRESS", "OWNER_ADDRESS", "TREASURY_ADDRESS", "PAUSE_GUARDIAN_ADDRESS"]) {
      if (!process.env[name]) throw new Error(`${name} is required for an explicit staging deployment`);
    }
    if (process.env.QUOTE_SIGNER_PRIVATE_KEY) throw new Error("Staging deployment accepts only QUOTE_SIGNER_ADDRESS; keep its burner key in the quote service environment");
  }
  const quoteSigner = process.env.QUOTE_SIGNER_ADDRESS
    || (process.env.QUOTE_SIGNER_PRIVATE_KEY ? new ethers.Wallet(process.env.QUOTE_SIGNER_PRIVATE_KEY).address : undefined)
    || (rehearsal ? deployer.address : undefined);
  address("QUOTE_SIGNER_ADDRESS (or QUOTE_SIGNER_PRIVATE_KEY)", quoteSigner);

  const requestedOwner = address("OWNER_ADDRESS", process.env.OWNER_ADDRESS || deployer.address);
  const treasury = address("TREASURY_ADDRESS", process.env.TREASURY_ADDRESS || requestedOwner);
  const pauseGuardian = address("PAUSE_GUARDIAN_ADDRESS", process.env.PAUSE_GUARDIAN_ADDRESS || requestedOwner);
  let finalOwner = requestedOwner;
  let timelock;
  let timelockReceipt;
  const timelockDelay = boundedInteger("TIMELOCK_DELAY_SECONDS", 0, 0, 31_536_000);
  const proposer = process.env.TIMELOCK_PROPOSER_ADDRESS;
  if (!proposer && timelockDelay !== 0) throw new Error("TIMELOCK_PROPOSER_ADDRESS is required when TIMELOCK_DELAY_SECONDS is set");
  const proposerAddress = proposer ? address("TIMELOCK_PROPOSER_ADDRESS", proposer) : undefined;

  if (!rehearsal && !staging) {
    if (!proposerAddress) throw new Error("A timelock proposer is required for a shared candidate deployment");
    if (requestedOwner.toLowerCase() !== proposerAddress.toLowerCase()) {
      throw new Error("OWNER_ADDRESS must equal the reviewed timelock proposer/multisig");
    }
    const roles = [
      ["deployer", deployer.address], ["quote signer", quoteSigner], ["treasury", treasury],
      ["pause guardian", pauseGuardian], ["timelock proposer", proposerAddress],
    ];
    for (let i = 0; i < roles.length; i += 1) {
      for (let j = i + 1; j < roles.length; j += 1) {
        if (roles[i][1].toLowerCase() === roles[j][1].toLowerCase()) {
          throw new Error(`${roles[i][0]} and ${roles[j][0]} must use separate identities`);
        }
      }
    }
    await requireCode("TIMELOCK_PROPOSER_ADDRESS multisig", proposerAddress);
    await requireCode("TREASURY_ADDRESS multisig", treasury);
    await requireCode("PAUSE_GUARDIAN_ADDRESS multisig", pauseGuardian);
    await requireNoCode("QUOTE_SIGNER_ADDRESS", quoteSigner);
  }
  if (staging) {
    if (deployer.address.toLowerCase() === quoteSigner.toLowerCase()) {
      throw new Error("The staging deployer and burner quote signer must use separate fresh testnet-only keys");
    }
    await requireNoCode("QUOTE_SIGNER_ADDRESS", quoteSigner);
  }

  if (proposerAddress) {
    const minimumDelay = rehearsal || staging ? 1 : 172_800;
    if (timelockDelay < minimumDelay) throw new Error(`TIMELOCK_DELAY_SECONDS must be at least ${minimumDelay} for this deployment`);
    const Timelock = await ethers.getContractFactory("PermTimelock");
    timelock = await Timelock.deploy(timelockDelay, [proposerAddress], [ethers.ZeroAddress], ethers.ZeroAddress);
    await timelock.waitForDeployment();
    timelockReceipt = await timelock.deploymentTransaction().wait();
    finalOwner = await timelock.getAddress();
  }

  console.log(`Deploying from ${deployer.address}`);
  console.log(`Final owner: ${finalOwner}${timelock ? ` (timelock ${timelockDelay}s)` : ""}`);
  console.log(`Treasury: ${treasury}`);
  console.log(`Quote signer: ${quoteSigner}`);
  console.log(`Emergency pause guardian: ${pauseGuardian}`);

  const Router = await ethers.getContractFactory("PermRouter");
  const router = await Router.deploy(deployer.address, treasury, quoteSigner, PERMIT2);
  await router.waitForDeployment();
  const routerReceipt = await router.deploymentTransaction().wait();

  const V4Adapter = await ethers.getContractFactory("PermV4Adapter");
  const v4Adapter = await V4Adapter.deploy(deployer.address, await router.getAddress(), POOL_MANAGER);
  await v4Adapter.waitForDeployment();
  const v4Receipt = await v4Adapter.deploymentTransaction().wait();

  const V3Adapter = await ethers.getContractFactory("PermV3Adapter");
  const v3Adapter = await V3Adapter.deploy(deployer.address, await router.getAddress(), SYNTHRA.swapRouter02, SYNTHRA.weth);
  await v3Adapter.waitForDeployment();
  const v3Receipt = await v3Adapter.deploymentTransaction().wait();

  const configureV4Receipt = await (await router.configureAdapter(
    await v4Adapter.getAddress(), ethers.id("UNISWAP_V4_DIRECT"), true,
  )).wait();
  const configureV3Receipt = await (await router.configureAdapter(
    await v3Adapter.getAddress(), ethers.id("SYNTHRA_V3"), true,
  )).wait();
  // No Aggregator Hook is approved. Governance configures the distinct hook
  // provider identity only after the onboarding and canonical-E2E gate passes.
  const guardianReceipt = pauseGuardian.toLowerCase() === deployer.address.toLowerCase()
    ? null
    : await (await router.setPauseGuardian(pauseGuardian)).wait();

  const ownershipTransactions = [];
  if (finalOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    for (const contract of [router, v4Adapter, v3Adapter]) {
      ownershipTransactions.push((await (await contract.transferOwnership(finalOwner)).wait()).hash);
    }
    console.log("Ownership transfers are pending acceptance by the final owner.");
    if (timelock) {
      console.log("The proposer must schedule acceptOwnership() for Router, V4Adapter and V3Adapter through the timelock.");
    }
  }

  const [
    policyVersion, policy, routerSigner, routerTreasury, routerGuardian, routerPermit2,
    v4Config, v3Config, hookProviderId, v4PinnedCodehash, v3PinnedCodehash,
  ] = await Promise.all([
    router.activePolicyVersion(), router.feePolicies(1), router.quoteSigner(), router.treasury(), router.pauseGuardian(), router.permit2(),
    router.adapters(await v4Adapter.getAddress()), router.adapters(await v3Adapter.getAddress()),
    router.hookProviderIds(await v4Adapter.getAddress()),
    router.adapterCodehashes(await v4Adapter.getAddress()), router.adapterCodehashes(await v3Adapter.getAddress()),
  ]);
  if (policyVersion !== 1n || policy.platformFeeBps !== 20n || policy.rebateShareBps !== 2_500n || !policy.enabled || !policy.exists) {
    throw new Error("Router fee-policy post-deployment check failed");
  }
  assertSame("quote signer", routerSigner, quoteSigner);
  assertSame("treasury", routerTreasury, treasury);
  assertSame("pause guardian", routerGuardian, pauseGuardian);
  assertSame("Permit2", routerPermit2, PERMIT2);
  if (!v4Config.enabled || v4Config.providerId !== ethers.id("UNISWAP_V4_DIRECT")) throw new Error("V4 adapter registry check failed");
  if (!v3Config.enabled || v3Config.providerId !== ethers.id("SYNTHRA_V3")) throw new Error("V3 adapter registry check failed");
  if (v4PinnedCodehash !== ethers.keccak256(await ethers.provider.getCode(await v4Adapter.getAddress()))) throw new Error("V4 adapter codehash pin failed");
  if (v3PinnedCodehash !== ethers.keccak256(await ethers.provider.getCode(await v3Adapter.getAddress()))) throw new Error("V3 adapter codehash pin failed");
  if (hookProviderId !== ethers.ZeroHash) throw new Error("Unreviewed hook provider identity must remain disabled");
  assertSame("V4 router", await v4Adapter.permRouter(), await router.getAddress());
  assertSame("V4 PoolManager", await v4Adapter.poolManager(), POOL_MANAGER);
  assertSame("V3 router", await v3Adapter.permRouter(), await router.getAddress());
  assertSame("V3 SwapRouter02", await v3Adapter.swapRouter(), SYNTHRA.swapRouter02);
  assertSame("V3 WETH", await v3Adapter.weth(), SYNTHRA.weth);
  if (finalOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    assertSame("Router pending owner", await router.pendingOwner(), finalOwner);
    assertSame("V4 pending owner", await v4Adapter.pendingOwner(), finalOwner);
    assertSame("V3 pending owner", await v3Adapter.pendingOwner(), finalOwner);
  }

  const runtimeAddresses = {
    permRouter: await router.getAddress(),
    v4Adapter: await v4Adapter.getAddress(),
    v3Adapter: await v3Adapter.getAddress(),
    ...(timelock ? { timelock: await timelock.getAddress() } : {}),
  };
  const runtimeCodehashes = Object.fromEntries(await Promise.all(Object.entries(runtimeAddresses)
    .map(async ([label, value]) => [label, ethers.keccak256(await ethers.provider.getCode(value))])));

  const deployment = {
    schemaVersion: 2,
    routerVersion: 2,
    network: "Robinhood Chain Testnet",
    chainId: Number(CHAIN_ID),
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
    poolManager: POOL_MANAGER,
    poolDiscoveryStartBlock: 121317900,
    v4Quoter: V4_QUOTER,
    permit2: PERMIT2,
    permRouter: await router.getAddress(),
    v4Adapter: await v4Adapter.getAddress(),
    v3Adapter: await v3Adapter.getAddress(),
    runtimeCodehashes,
    dependencyCodehashes,
    quoteSigner,
    owner: finalOwner,
    currentOwner: finalOwner.toLowerCase() === deployer.address.toLowerCase() ? finalOwner : deployer.address,
    treasury,
    pauseGuardian,
    timelock: timelock ? await timelock.getAddress() : null,
    timelockDelaySeconds: timelock ? timelockDelay : null,
    venues: { synthraV3: SYNTHRA },
    providers: {
      uniswapV4Direct: ethers.id("UNISWAP_V4_DIRECT"),
      synthraV3: ethers.id("SYNTHRA_V3"),
    },
    reservedProviderIds: {
      uniswapV4AggregatorHook: ethers.id("UNISWAP_V4_AGGREGATOR_HOOK"),
    },
    hookProviderStatus: "disabled-pending-review",
    aggregatorHooks: [],
    aggregatorHookVerification: "pending",
    e2eVerification: "pending",
    operationsVerification: "pending",
    releaseEvidence: {},
    releaseCommitSha,
    repositoryDirtyAtDeployment: Boolean(repositoryChanges),
    policy: { version: 1, platformFeeBps: 20, rebateShareBps: 2500 },
    deploymentBlock: Number(routerReceipt.blockNumber),
    ownershipStatus: finalOwner.toLowerCase() === deployer.address.toLowerCase() ? "accepted" : "pending-acceptance",
    sourceVerification: rehearsal ? "skipped-rehearsal" : staging ? "skipped-non-release-staging" : "pending",
    releaseStatus: rehearsal ? "rehearsal" : staging ? "non-release-allowlisted-staging" : "candidate",
    nonRelease: staging,
    stagingExecutionPolicy: staging ? "server-wallet-allowlist-required" : null,
    stagingRoutePolicy: staging ? "direct-v4-v3-only" : null,
    postDeploymentChecks: "passed",
    executionReady: false,
    deploymentTransactions: [
      ...(timelockReceipt ? [timelockReceipt.hash] : []),
      routerReceipt.hash,
      v4Receipt.hash,
      v3Receipt.hash,
      configureV4Receipt.hash,
      configureV3Receipt.hash,
      ...(guardianReceipt ? [guardianReceipt.hash] : []),
      ...ownershipTransactions,
    ],
    generatedAt: new Date().toISOString(),
  };
  const defaultOutput = path.join(__dirname, rehearsal
    ? "../../deployments/robinhood-testnet.rehearsal.json"
    : staging
      ? "../../deployments/robinhood-testnet.staging.json"
      : "../../deployments/robinhood-testnet.v2-candidate.json");
  const output = process.env.DEPLOYMENT_OUTPUT ? path.resolve(process.cwd(), process.env.DEPLOYMENT_OUTPUT) : defaultOutput;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`PermRouter v2: ${deployment.permRouter}`);
  console.log(`PermV4Adapter: ${deployment.v4Adapter}`);
  console.log(`PermV3Adapter: ${deployment.v3Adapter}`);
  console.log(`${rehearsal ? "Rehearsal" : staging ? "Non-release staging" : "Candidate"} manifest written to ${output}`);

  if (process.env.VERIFY === "1") {
    if (timelock) await verify({
      address: deployment.timelock,
      constructorArguments: [timelockDelay, [address("TIMELOCK_PROPOSER_ADDRESS", proposer)], [ethers.ZeroAddress], ethers.ZeroAddress],
    });
    await verify({ address: deployment.permRouter, constructorArguments: [deployer.address, treasury, quoteSigner, PERMIT2] });
    await verify({ address: deployment.v4Adapter, constructorArguments: [deployer.address, deployment.permRouter, POOL_MANAGER] });
    await verify({ address: deployment.v3Adapter, constructorArguments: [deployer.address, deployment.permRouter, SYNTHRA.swapRouter02, SYNTHRA.weth] });
    deployment.sourceVerification = "submitted";
    fs.writeFileSync(output, `${JSON.stringify(deployment, null, 2)}\n`);
  } else if (!staging) {
    console.log("Set VERIFY=1 for Blockscout source publication before public enablement.");
  } else {
    console.log("Source publication is optional for this non-release allowlisted staging deployment and remains mandatory before any release promotion.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
