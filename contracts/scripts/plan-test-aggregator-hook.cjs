const hre = require("hardhat");
const { ethers } = hre;

const CHAIN_ID = 46_630n;
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const POOL_MANAGER_CODEHASH = "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626";
const EXTERNAL_POOL = "0x593e2e0EF3869616Ec3Fbe989dCFf2699D52b69B";
const EXTERNAL_POOL_CODEHASH = "0x957b9c75dd4bb82220fe2058038825c5ba1633543526ef6e3d61c0560d501115";
const EXPECTED_RUNTIME_CODEHASH = "0x3908f518529f4e2e5b961cfed36d44df9c08eee2722cbd5c42e82043f964cdca";
const WETH = "0x33e4191705c386532ba27cBF171Db86919200B94";
const TSLA = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";
const FEE = 3_000n;
const TICK_SPACING = 60n;
const REQUIRED_FLAGS = 0x2888n;
const HOOK_MASK = 0x3fffn;
const TEST_ONLY_LABEL = "Perm test hook - not an official Aggregator Hook";

function assertEqual(label, actual, expected) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function mineSalt(initCodeHash) {
  for (let nonce = 0n; nonce < 1_000_000n; nonce += 1n) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(nonce), 32);
    const address = ethers.getCreate2Address(CREATE2_DEPLOYER, salt, initCodeHash);
    if ((BigInt(address) & HOOK_MASK) === REQUIRED_FLAGS) return { address, salt, nonce };
  }
  throw new Error("No CREATE2 salt found within the bounded search");
}

async function codehash(address) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${address} has no runtime code`);
  return ethers.keccak256(code);
}

async function main() {
  if (hre.network.name === "hardhat") await ethers.provider.send("evm_mine", []);
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    throw new Error(`Refusing to plan this chain-46630-only fixture on chain ${network.chainId}`);
  }

  assertEqual("CREATE2 deployer code", (await ethers.provider.getCode(CREATE2_DEPLOYER)) === "0x" ? "missing" : "present", "present");
  assertEqual("PoolManager codehash", await codehash(POOL_MANAGER), POOL_MANAGER_CODEHASH);
  assertEqual("external pool codehash", await codehash(EXTERNAL_POOL), EXTERNAL_POOL_CODEHASH);

  const venue = new ethers.Contract(EXTERNAL_POOL, [
    "function token0() view returns(address)",
    "function token1() view returns(address)",
    "function fee() view returns(uint24)",
    "function tickSpacing() view returns(int24)",
  ], ethers.provider);
  assertEqual("external token0", await venue.token0(), WETH);
  assertEqual("external token1", await venue.token1(), TSLA);
  assertEqual("external fee", await venue.fee(), FEE);
  assertEqual("external tick spacing", await venue.tickSpacing(), TICK_SPACING);

  const artifact = await hre.artifacts.readArtifact("PermTestAggregatorHook");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const deployment = await factory.getDeployTransaction(POOL_MANAGER, EXTERNAL_POOL, EXTERNAL_POOL_CODEHASH);
  const initCodeHash = ethers.keccak256(deployment.data);
  const mined = mineSalt(initCodeHash);
  const deployCalldata = ethers.concat([mined.salt, deployment.data]);
  const existingCode = await ethers.provider.getCode(mined.address);

  let status = "vacant";
  let runtimeCodehash = null;
  if (existingCode !== "0x") {
    const hook = new ethers.Contract(mined.address, artifact.abi, ethers.provider);
    assertEqual("test-only label", await hook.TEST_ONLY_LABEL(), TEST_ONLY_LABEL);
    assertEqual("hook PoolManager", await hook.poolManager(), POOL_MANAGER);
    assertEqual("hook external pool", await hook.externalPool(), EXTERNAL_POOL);
    assertEqual("hook external codehash", await hook.externalPoolCodehash(), EXTERNAL_POOL_CODEHASH);
    if (!await hook.isTestOnly()) throw new Error("Existing hook does not expose the required test-only marker");
    runtimeCodehash = ethers.keccak256(existingCode);
    assertEqual("hook runtime codehash", runtimeCodehash, EXPECTED_RUNTIME_CODEHASH);
    status = "matching-test-fixture-already-deployed";
  }

  console.log(JSON.stringify({
    label: TEST_ONLY_LABEL,
    status,
    chainId: Number(CHAIN_ID),
    create2Deployer: CREATE2_DEPLOYER,
    predictedAddress: mined.address,
    permissionBits: ethers.toBeHex(BigInt(mined.address) & HOOK_MASK),
    salt: mined.salt,
    saltNonce: mined.nonce.toString(),
    initCodeHash,
    initCodeBytes: (deployment.data.length - 2) / 2,
    deployCalldataHash: ethers.keccak256(deployCalldata),
    deployCalldataBytes: (deployCalldata.length - 2) / 2,
    expectedRuntimeCodehash: EXPECTED_RUNTIME_CODEHASH,
    observedRuntimeCodehash: runtimeCodehash,
    poolManager: POOL_MANAGER,
    poolManagerCodehash: POOL_MANAGER_CODEHASH,
    externalPool: EXTERNAL_POOL,
    externalPoolCodehash: EXTERNAL_POOL_CODEHASH,
    poolKey: { currency0: WETH, currency1: TSLA, fee: Number(FEE), tickSpacing: Number(TICK_SPACING), hooks: mined.address },
    transactionSent: false,
    productionRoutingChanged: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
