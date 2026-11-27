const hre = require("hardhat");
const { ethers } = hre;

const CHAIN_ID = 4663;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const HOOK = "0xA1AD09c98710d2C709e3bea03708823255312888";
const HOOK_CODEHASH = "0x537d4b59539aa00520d3f9885e00707e9a7bfe6670455ae54a3099e9b53129c7";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const UP = "0x57C0E45cB534413D1C20A4240955d6bB250BB4F1";
const POOL_ID = "0x9ef343fe68e0702b7013a38444b2123e61e8cab2ede3f575a0d5b77cb1f8c95b";
const COMPATIBILITY_PROVIDER = ethers.id("UNAPPROVED_MAINNET_HOOK_COMPATIBILITY");
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };

async function signedRequest(router, signer, account, values) {
  const request = { gasEstimate: 800_000n, ...values, quoteId: ethers.ZeroHash };
  const domain = { name: "Perm", version: "2", chainId: CHAIN_ID, verifyingContract: router.target };
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
    account,
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

function parsedEvent(contract, receipt, name) {
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === contract.target.toLowerCase())
    .map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .find((event) => event?.name === name);
}

function decimal(value) {
  return ethers.formatUnits(value, 18);
}

async function main() {
  if (hre.network.name !== "hardhat") throw new Error("This comparison is local-fork-only");
  const sourceBlock = await ethers.provider.getBlockNumber();
  await ethers.provider.send("evm_mine", []);
  if ((await ethers.provider.getNetwork()).chainId !== 4663n) {
    throw new Error("RUN_MAINNET_HOOK_FORK_TESTS=1 is required");
  }
  if (ethers.keccak256(await ethers.provider.getCode(HOOK)) !== HOOK_CODEHASH) {
    throw new Error("Mainnet hook runtime codehash changed");
  }

  const [owner, quoteSigner, user, treasury] = await ethers.getSigners();
  const Router = await ethers.getContractFactory("PermRouter");
  const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, PERMIT2);
  const Adapter = await ethers.getContractFactory("PermV4Adapter");
  const permAdapter = await Adapter.deploy(owner.address, router.target, POOL_MANAGER);
  const directAdapter = await Adapter.deploy(owner.address, user.address, POOL_MANAGER);
  for (const adapter of [permAdapter, directAdapter]) await adapter.setVerifiedHook(HOOK, true);
  await router.configureAdapter(permAdapter.target, ethers.id("UNISWAP_V4_DIRECT"), true);
  await router.configureHookProvider(permAdapter.target, COMPATIBILITY_PROVIDER);

  const key = { currency0: WETH, currency1: UP, fee: 0x800000, tickSpacing: 200, hooks: HOOK };
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const v4Data = coder.encode(
    ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
    [key, "0x"],
  );
  const routeData = coder.encode(
    ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
    [[{ adapter: permAdapter.target, tokenIn: WETH, tokenOut: UP, data: v4Data }]],
  );
  if (ethers.keccak256(coder.encode(
    ["address", "address", "uint24", "int24", "address"],
    [WETH, UP, key.fee, key.tickSpacing, HOOK],
  )) !== POOL_ID) throw new Error("PoolKey no longer matches the reviewed PoolId");

  const weth = await ethers.getContractAt([
    "function deposit() payable",
    "function approve(address,uint256) returns(bool)",
  ], WETH);
  const up = await ethers.getContractAt(["function balanceOf(address) view returns(uint256)"], UP);
  const amountIn = ethers.parseEther("0.001");
  await weth.connect(user).deposit({ value: amountIn });
  await weth.connect(user).approve(router.target, amountIn);
  await weth.connect(user).approve(directAdapter.target, amountIn);

  const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
  const signed = await signedRequest(router, quoteSigner, user.address, {
    tokenIn: WETH,
    tokenOut: UP,
    amountIn,
    minAmountOut: 1n,
    recipient: user.address,
    deadline: quotedAt + 90,
    quotedAt,
    policyVersion: 1,
    chainId: CHAIN_ID,
    referrer: ethers.ZeroAddress,
    routeData,
  });
  const snapshot = await ethers.provider.send("evm_snapshot", []);

  const permReceipt = await (await router.connect(user).swapExactInput(
    signed.request,
    signed.signature,
    EMPTY_PERMIT,
    { gasLimit: 3_000_000 },
  )).wait();
  const settlement = parsedEvent(router, permReceipt, "SwapSettled");
  const routeStep = parsedEvent(router, permReceipt, "RouteStepSettled");
  if (!settlement || !routeStep || routeStep.args.hook !== HOOK || routeStep.args.hookCodehash !== HOOK_CODEHASH) {
    throw new Error("Perm comparison leg lacks canonical hook evidence");
  }
  const permOutput = await up.balanceOf(user.address);
  if (permOutput !== settlement.args.amountOut) throw new Error("Perm recipient output mismatch");

  if (!await ethers.provider.send("evm_revert", [snapshot])) throw new Error("Unable to restore comparison snapshot");
  const directBefore = await up.balanceOf(user.address);
  const directReceipt = await (await directAdapter.connect(user).swapExactInput(
    WETH,
    UP,
    amountIn,
    user.address,
    v4Data,
    { gasLimit: 3_000_000 },
  )).wait();
  const directAfter = await up.balanceOf(user.address);
  const directOutput = directAfter - directBefore;
  const directEvent = parsedEvent(directAdapter, directReceipt, "V4StepExecuted");
  if (!directEvent || directEvent.args.amountOut !== directOutput) throw new Error("Direct comparison output mismatch");
  if (directOutput <= permOutput) throw new Error("Expected the full-input direct leg to exceed the fee-adjusted Perm leg");

  const result = {
    scope: "local read-only fork comparison; no mainnet transaction",
    sourceChainId: CHAIN_ID,
    sourceBlock,
    pair: "WETH/UP",
    poolId: POOL_ID,
    hook: HOOK,
    hookCodehash: HOOK_CODEHASH,
    amountInWei: amountIn.toString(),
    amountInWeth: decimal(amountIn),
    perm: {
      routedInputWei: settlement.args.routedInput.toString(),
      routedInputWeth: decimal(settlement.args.routedInput),
      grossFeeWei: settlement.args.grossFee.toString(),
      grossFeeWeth: decimal(settlement.args.grossFee),
      rebateWei: settlement.args.rebate.toString(),
      rebateWeth: decimal(settlement.args.rebate),
      netFeeWei: settlement.args.netFee.toString(),
      netFeeWeth: decimal(settlement.args.netFee),
      outputWei: permOutput.toString(),
      outputUp: decimal(permOutput),
      gasUsed: permReceipt.gasUsed.toString(),
      gasPriceWei: permReceipt.gasPrice.toString(),
      gasCostWei: (permReceipt.gasUsed * permReceipt.gasPrice).toString(),
    },
    directSamePool: {
      routedInputWei: amountIn.toString(),
      routedInputWeth: decimal(amountIn),
      platformFeeWei: "0",
      outputWei: directOutput.toString(),
      outputUp: decimal(directOutput),
      gasUsed: directReceipt.gasUsed.toString(),
      gasPriceWei: directReceipt.gasPrice.toString(),
      gasCostWei: (directReceipt.gasUsed * directReceipt.gasPrice).toString(),
    },
    difference: {
      outputWei: (directOutput - permOutput).toString(),
      outputUp: decimal(directOutput - permOutput),
      gasUsed: (permReceipt.gasUsed - directReceipt.gasUsed).toString(),
    },
    liveTransactionSent: false,
    officialHookAdmissionClaimed: false,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
