const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const RUN = process.env.RUN_FORK_TESTS === "1";
const CHAIN_ID = 46630;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const EXTERNAL_POOL = "0x593e2e0EF3869616Ec3Fbe989dCFf2699D52b69B";
const EXTERNAL_POOL_CODEHASH = "0x957b9c75dd4bb82220fe2058038825c5ba1633543526ef6e3d61c0560d501115";
const EXPECTED_TEST_HOOK_RUNTIME_CODEHASH = "0x3908f518529f4e2e5b961cfed36d44df9c08eee2722cbd5c42e82043f964cdca";
const WETH = "0x33e4191705c386532ba27cBF171Db86919200B94";
const TSLA = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";
const FEE = 3000;
const TICK_SPACING = 60;
const REQUIRED_FLAGS = 0x2888n;
const HOOK_MASK = 0x3fffn;
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };
const DIRECT_PROVIDER = ethers.id("UNISWAP_V4_DIRECT");
const TEST_HOOK_PROVIDER = ethers.id("PERM_TEST_AGGREGATOR_HOOK");
const HOOK_SWAP_TOPIC = ethers.id("HookSwap(bytes32,address,int256,int256,uint24)");
const EXTERNAL_SWAP_TOPIC = ethers.id("Swap(address,address,int256,int256,uint160,uint128,int24)");

async function signedRequest(router, signer, account, values) {
  const request = { gasEstimate: 600_000n, ...values, quoteId: ethers.ZeroHash };
  const domain = { name: "Perm", version: "2", chainId: CHAIN_ID, verifyingContract: await router.getAddress() };
  const types = { PermQuote: [
    { name: "account", type: "address" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" }, { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" }, { name: "quotedAt", type: "uint64" },
    { name: "policyVersion", type: "uint32" }, { name: "chainId", type: "uint256" },
    { name: "referrer", type: "address" }, { name: "routeHash", type: "bytes32" },
  ] };
  const value = {
    account, tokenIn: request.tokenIn, tokenOut: request.tokenOut, amountIn: request.amountIn,
    minAmountOut: request.minAmountOut, gasEstimate: request.gasEstimate, recipient: request.recipient,
    deadline: request.deadline, quotedAt: request.quotedAt, policyVersion: request.policyVersion,
    chainId: request.chainId, referrer: request.referrer, routeHash: ethers.keccak256(request.routeData),
  };
  return {
    request: { ...request, quoteId: ethers.TypedDataEncoder.hash(domain, types, value) },
    signature: await signer.signTypedData(domain, types, value),
  };
}

function mineHookSalt(initCode) {
  const initCodeHash = ethers.keccak256(initCode);
  for (let nonce = 0n; nonce < 1_000_000n; nonce += 1n) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(nonce), 32);
    const address = ethers.getCreate2Address(CREATE2_DEPLOYER, salt, initCodeHash);
    if ((BigInt(address) & HOOK_MASK) === REQUIRED_FLAGS) return { address, salt };
  }
  throw new Error("Unable to mine the required test-hook flags");
}

async function deployMinedHook(signer, externalPool = EXTERNAL_POOL, externalPoolCodehash = EXTERNAL_POOL_CODEHASH) {
  const Hook = await ethers.getContractFactory("PermTestAggregatorHook");
  const deployment = await Hook.getDeployTransaction(POOL_MANAGER, externalPool, externalPoolCodehash);
  const mined = mineHookSalt(deployment.data);
  expect(await ethers.provider.getCode(mined.address)).to.equal("0x");
  await (await signer.sendTransaction({
    to: CREATE2_DEPLOYER,
    data: ethers.concat([mined.salt, deployment.data]),
    gasLimit: 6_000_000,
  })).wait();
  expect((BigInt(mined.address) & HOOK_MASK)).to.equal(REQUIRED_FLAGS);
  expect((await ethers.provider.getCode(mined.address)).length).to.be.greaterThan(1000);
  return Hook.attach(mined.address);
}

function routerEvents(router, receipt) {
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === router.target.toLowerCase())
    .map((log) => { try { return router.interface.parseLog(log); } catch { return null; } })
    .filter(Boolean);
}

function errorData(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.info?.error?.data?.data,
  ];
  return candidates.find((value) => typeof value === "string" && value.startsWith("0x"));
}

async function expectWrappedHookError(action, hook, expectedError) {
  try {
    const result = await action();
    if (result?.wait) await result.wait();
    expect.fail(`expected ${expectedError}`);
  } catch (error) {
    const data = errorData(error);
    expect(data, error.message).to.be.a("string");
    const wrapperInterface = new ethers.Interface([
      "error WrappedError(address target,bytes4 selector,bytes reason,bytes details)",
    ]);
    const wrapper = wrapperInterface.parseError(data);
    expect(wrapper.name).to.equal("WrappedError");
    expect(wrapper.args.target).to.equal(hook.target);
    expect(wrapper.args.selector).to.equal(hook.interface.getFunction("beforeSwap").selector);

    let reason = wrapper.args.reason;
    for (let depth = 0; depth < 4; depth += 1) {
      let parsed;
      try { parsed = hook.interface.parseError(reason); } catch {}
      if (parsed) {
        expect(parsed.name).to.equal(expectedError);
        return;
      }
      const nested = wrapperInterface.parseError(reason);
      expect(nested.name).to.equal("WrappedError");
      expect(nested.args.target).to.equal(hook.target);
      reason = nested.args.reason;
    }
    expect.fail(`unable to find wrapped ${expectedError}`);
  }
}

describe(RUN ? "Perm test Aggregator Hook · Robinhood testnet fork" : "Perm test Aggregator Hook fork (skipped)", function () {
  if (!RUN) {
    it.skip("set RUN_FORK_TESTS=1 to run the chain-46630 isolated test-hook suite", function () {});
    return;
  }

  it("settles both directions through an immutable, codehash-pinned Synthra test hook", async function () {
    this.timeout(180_000);
    const [owner, quoteSigner, user, treasury] = await ethers.getSigners();
    expect((await ethers.provider.getNetwork()).chainId).to.equal(46630n);
    await ethers.provider.send("evm_mine", []);
    for (const target of [POOL_MANAGER, PERMIT2, CREATE2_DEPLOYER, EXTERNAL_POOL, WETH, TSLA]) {
      expect((await ethers.provider.getCode(target)).length).to.be.greaterThan(100);
    }
    expect(ethers.keccak256(await ethers.provider.getCode(EXTERNAL_POOL))).to.equal(EXTERNAL_POOL_CODEHASH);

    const external = await ethers.getContractAt([
      "function token0() view returns(address)", "function token1() view returns(address)",
      "function fee() view returns(uint24)", "function tickSpacing() view returns(int24)",
      "function slot0() view returns(uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
    ], EXTERNAL_POOL);
    expect(await external.token0()).to.equal(WETH);
    expect(await external.token1()).to.equal(TSLA);
    expect(await external.fee()).to.equal(FEE);
    expect(await external.tickSpacing()).to.equal(TICK_SPACING);

    const hook = await deployMinedHook(owner);
    expect(await hook.isTestOnly()).to.equal(true);
    expect(await hook.TEST_ONLY_LABEL()).to.equal("Perm test hook - not an official Aggregator Hook");
    expect(await hook.CANONICAL_POOL_MANAGER()).to.equal(ethers.getAddress(POOL_MANAGER));
    expect(await hook.CANONICAL_POOL_MANAGER_CODEHASH()).to.equal(
      ethers.keccak256(await ethers.provider.getCode(POOL_MANAGER)),
    );
    expect(await hook.poolManager()).to.equal(ethers.getAddress(POOL_MANAGER));
    expect(await hook.externalPool()).to.equal(EXTERNAL_POOL);
    expect(await hook.externalPoolCodehash()).to.equal(EXTERNAL_POOL_CODEHASH);
    expect(await hook.token0()).to.equal(WETH);
    expect(await hook.token1()).to.equal(TSLA);
    expect(await hook.externalFee()).to.equal(FEE);
    expect(await hook.externalTickSpacing()).to.equal(TICK_SPACING);
    await expect(hook.connect(user).uniswapV3SwapCallback(1, -1, ethers.ZeroHash))
      .to.be.revertedWithCustomError(hook, "UnauthorizedCallback");

    const poolKey = { currency0: WETH, currency1: TSLA, fee: FEE, tickSpacing: TICK_SPACING, hooks: hook.target };
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const poolId = ethers.keccak256(coder.encode(
      ["address", "address", "uint24", "int24", "address"],
      [WETH, TSLA, FEE, TICK_SPACING, hook.target],
    ));
    const manager = await ethers.getContractAt([
      "function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) returns(int24)",
    ], POOL_MANAGER);
    const slot0 = await external.slot0();
    await expect(manager.initialize(poolKey, slot0.sqrtPriceX96))
      .to.emit(hook, "AggregatorPoolRegistered")
      .withArgs(poolId);
    expect(await hook.registeredPoolId()).to.equal(poolId);
    await expect(manager.initialize(poolKey, slot0.sqrtPriceX96)).to.be.reverted;

    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, PERMIT2);
    const Adapter = await ethers.getContractFactory("PermV4Adapter");
    const adapter = await Adapter.deploy(owner.address, await router.getAddress(), POOL_MANAGER);
    await router.configureAdapter(await adapter.getAddress(), DIRECT_PROVIDER, true);
    await router.configureHookProvider(await adapter.getAddress(), TEST_HOOK_PROVIDER);
    await adapter.setVerifiedHook(hook.target, true);
    const hookCodehash = ethers.keccak256(await ethers.provider.getCode(hook.target));
    if (!hre.__SOLIDITY_COVERAGE_RUNNING) {
      expect(hookCodehash).to.equal(EXPECTED_TEST_HOOK_RUNTIME_CODEHASH);
    }
    expect(await adapter.verifiedHookCodehashes(hook.target)).to.equal(hookCodehash);

    const v4Data = coder.encode(
      ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
      [poolKey, "0x"],
    );
    const route = (tokenIn, tokenOut) => coder.encode(
      ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
      [[{ adapter: adapter.target, tokenIn, tokenOut, data: v4Data }]],
    );

    const weth = await ethers.getContractAt([
      "function deposit() payable", "function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)",
    ], WETH);
    const tsla = await ethers.getContractAt([
      "function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)",
    ], TSLA);
    const amountIn = ethers.parseEther("0.001");
    await weth.connect(user).deposit({ value: amountIn });
    await weth.connect(user).approve(await router.getAddress(), amountIn);

    const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
    const buy = await signedRequest(router, quoteSigner, user.address, {
      tokenIn: WETH, tokenOut: TSLA, amountIn, minAmountOut: 1n, recipient: user.address,
      deadline: quotedAt + 90, quotedAt, policyVersion: 1, chainId: CHAIN_ID,
      referrer: ethers.ZeroAddress, routeData: route(WETH, TSLA),
    });
    const buyReceipt = await (await router.connect(user).swapExactInput(
      buy.request, buy.signature, EMPTY_PERMIT, { gasLimit: 2_000_000 },
    )).wait();
    const buyEvents = routerEvents(router, buyReceipt);
    const buyStep = buyEvents.find((event) => event.name === "RouteStepSettled");
    const buySettlement = buyEvents.find((event) => event.name === "SwapSettled");
    expect(buyStep.args.providerId).to.equal(TEST_HOOK_PROVIDER);
    expect(buyStep.args.stepRouteId).to.equal(poolId);
    expect(buyStep.args.hook).to.equal(hook.target);
    expect(buyStep.args.hookCodehash).to.equal(hookCodehash);
    expect(buySettlement.args.receiptId).to.equal(buyStep.args.receiptId);
    expect(buySettlement.args.quoteId).to.equal(buy.request.quoteId);
    expect(buySettlement.args.account).to.equal(user.address);
    expect(buySettlement.args.tokenIn).to.equal(WETH);
    expect(buySettlement.args.tokenOut).to.equal(TSLA);
    expect(buySettlement.args.amountIn).to.equal(amountIn);
    expect(buySettlement.args.routedInput).to.equal(buyStep.args.amountIn);
    expect(buySettlement.args.amountOut).to.equal(buyStep.args.amountOut);
    expect(buySettlement.args.routeHash).to.equal(ethers.keccak256(buy.request.routeData));

    const buyHookLog = buyReceipt.logs.find((log) =>
      log.address.toLowerCase() === hook.target.toLowerCase() && log.topics[0] === HOOK_SWAP_TOPIC
    );
    const buyHookSwap = hook.interface.parseLog(buyHookLog);
    expect(buyHookSwap.args.poolId).to.equal(poolId);
    expect(buyHookSwap.args.sender).to.equal(adapter.target);
    expect(buyHookSwap.args.amount0).to.be.greaterThan(0n);
    expect(buyHookSwap.args.amount1).to.be.lessThan(0n);
    expect(buyHookSwap.args.swapFee).to.equal(0n);

    const externalSwapInterface = new ethers.Interface([
      "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
    ]);
    const buyExternalLog = buyReceipt.logs.find((log) =>
      log.address.toLowerCase() === EXTERNAL_POOL.toLowerCase() && log.topics[0] === EXTERNAL_SWAP_TOPIC
    );
    const buyExternalSwap = externalSwapInterface.parseLog(buyExternalLog);
    expect(buyExternalSwap.args.sender).to.equal(hook.target);
    expect(buyExternalSwap.args.recipient).to.equal(ethers.getAddress(POOL_MANAGER));
    expect(buyExternalSwap.args.amount0).to.equal(buyHookSwap.args.amount0);
    expect(buyExternalSwap.args.amount1).to.equal(buyHookSwap.args.amount1);

    const bought = await tsla.balanceOf(user.address);
    expect(bought).to.be.greaterThan(0n);
    await tsla.connect(user).approve(await router.getAddress(), bought);
    const quotedAt2 = (await ethers.provider.getBlock("latest")).timestamp;
    const wethBefore = await weth.balanceOf(user.address);
    const sell = await signedRequest(router, quoteSigner, user.address, {
      tokenIn: TSLA, tokenOut: WETH, amountIn: bought, minAmountOut: 1n, recipient: user.address,
      deadline: quotedAt2 + 90, quotedAt: quotedAt2, policyVersion: 1, chainId: CHAIN_ID,
      referrer: ethers.ZeroAddress, routeData: route(TSLA, WETH),
    });
    const sellReceipt = await (await router.connect(user).swapExactInput(sell.request, sell.signature, EMPTY_PERMIT)).wait();
    const sellEvents = routerEvents(router, sellReceipt);
    const sellStep = sellEvents.find((event) => event.name === "RouteStepSettled");
    const sellSettlement = sellEvents.find((event) => event.name === "SwapSettled");
    expect(sellStep.args.providerId).to.equal(TEST_HOOK_PROVIDER);
    expect(sellStep.args.stepRouteId).to.equal(poolId);
    expect(sellStep.args.hook).to.equal(hook.target);
    expect(sellStep.args.hookCodehash).to.equal(hookCodehash);
    expect(sellSettlement.args.receiptId).to.equal(sellStep.args.receiptId);
    expect(sellSettlement.args.quoteId).to.equal(sell.request.quoteId);
    expect(sellSettlement.args.tokenIn).to.equal(TSLA);
    expect(sellSettlement.args.tokenOut).to.equal(WETH);
    expect(sellSettlement.args.amountIn).to.equal(bought);
    expect(sellSettlement.args.routedInput).to.equal(sellStep.args.amountIn);
    expect(sellSettlement.args.amountOut).to.equal(sellStep.args.amountOut);

    const sellHookLog = sellReceipt.logs.find((log) =>
      log.address.toLowerCase() === hook.target.toLowerCase() && log.topics[0] === HOOK_SWAP_TOPIC
    );
    const sellHookSwap = hook.interface.parseLog(sellHookLog);
    expect(sellHookSwap.args.poolId).to.equal(poolId);
    expect(sellHookSwap.args.sender).to.equal(adapter.target);
    expect(sellHookSwap.args.amount0).to.be.lessThan(0n);
    expect(sellHookSwap.args.amount1).to.be.greaterThan(0n);
    const sellExternalLog = sellReceipt.logs.find((log) =>
      log.address.toLowerCase() === EXTERNAL_POOL.toLowerCase() && log.topics[0] === EXTERNAL_SWAP_TOPIC
    );
    const sellExternalSwap = externalSwapInterface.parseLog(sellExternalLog);
    expect(sellExternalSwap.args.sender).to.equal(hook.target);
    expect(sellExternalSwap.args.recipient).to.equal(ethers.getAddress(POOL_MANAGER));
    expect(sellExternalSwap.args.amount0).to.equal(sellHookSwap.args.amount0);
    expect(sellExternalSwap.args.amount1).to.equal(sellHookSwap.args.amount1);
    expect(await weth.balanceOf(user.address)).to.be.greaterThan(wethBefore);
  });

  it("rejects non-manager entry points, bad keys, liquidity, exact-output, callback abuse, and venue drift", async function () {
    this.timeout(180_000);
    const [owner, attacker] = await ethers.getSigners();
    await ethers.provider.send("evm_mine", []);

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("Fixture A", "FA", 18);
    const tokenB = await Token.deploy("Fixture B", "FB", 18);
    const Pool = await ethers.getContractFactory("MockTestAggregatorV3Pool");
    const external = await Pool.deploy(tokenA.target, tokenB.target, FEE, TICK_SPACING);
    await tokenA.mint(external.target, ethers.parseEther("100"));
    await tokenB.mint(external.target, ethers.parseEther("100"));
    const externalCodehash = ethers.keccak256(await ethers.provider.getCode(external.target));
    const hook = await deployMinedHook(owner, external.target, externalCodehash);
    const [currency0, currency1] = tokenA.target.toLowerCase() < tokenB.target.toLowerCase()
      ? [tokenA.target, tokenB.target] : [tokenB.target, tokenA.target];
    const key = { currency0, currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: hook.target };
    const manager = await ethers.getContractAt([
      "function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) returns(int24)",
    ], POOL_MANAGER);
    await expect(manager.initialize({ ...key, fee: 500 }, 1n << 96n)).to.be.reverted;
    expect(await hook.registeredPoolId()).to.equal(ethers.ZeroHash);
    await expect(manager.initialize(key, 1n << 96n)).to.emit(hook, "AggregatorPoolRegistered");

    const sender = attacker.address;
    const exactInput = { zeroForOne: true, amountSpecified: -1n, sqrtPriceLimitX96: 0 };
    const exactOutput = { zeroForOne: true, amountSpecified: 1n, sqrtPriceLimitX96: 0 };
    const badKey = { ...key, fee: 500 };
    await expect(hook.connect(attacker).beforeSwap(sender, key, exactInput, "0x"))
      .to.be.revertedWithCustomError(hook, "NotPoolManager");
    await expect(hook.connect(attacker).beforeAddLiquidity(sender, key, { tickLower: -60, tickUpper: 60, liquidityDelta: 1n, salt: ethers.ZeroHash }, "0x"))
      .to.be.revertedWithCustomError(hook, "NotPoolManager");
    await expect(hook.connect(attacker).uniswapV3SwapCallback(1, -1, "0x"))
      .to.be.revertedWithCustomError(hook, "UnauthorizedCallback");
    await expect(hook.connect(attacker).synthraV3SwapCallback(1, -1, "0x"))
      .to.be.revertedWithCustomError(hook, "UnauthorizedCallback");

    await ethers.provider.send("hardhat_setBalance", [POOL_MANAGER, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [POOL_MANAGER]);
    const managerSigner = await ethers.getSigner(POOL_MANAGER);
    await expect(hook.connect(managerSigner).beforeSwap(sender, badKey, exactInput, "0x"))
      .to.be.revertedWithCustomError(hook, "InvalidPoolKey");
    await expect(hook.connect(managerSigner).beforeSwap(sender, key, exactInput, "0x01"))
      .to.be.revertedWithCustomError(hook, "HookDataUnsupported");
    await expect(hook.connect(managerSigner).beforeSwap(sender, key, exactOutput, "0x"))
      .to.be.revertedWithCustomError(hook, "ExactInputOnly");
    await expect(hook.connect(managerSigner).beforeAddLiquidity(sender, key, { tickLower: -60, tickUpper: 60, liquidityDelta: 1n, salt: ethers.ZeroHash }, "0x"))
      .to.be.revertedWithCustomError(hook, "LiquidityNotAllowed");
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [POOL_MANAGER]);

    await ethers.provider.send("hardhat_setBalance", [external.target, "0x56BC75E2D63100000"]);
    await ethers.provider.send("hardhat_impersonateAccount", [external.target]);
    const externalSigner = await ethers.getSigner(external.target);
    const callbackData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32"],
      [await hook.registeredPoolId()],
    );
    await expect(hook.connect(externalSigner).synthraV3SwapCallback(1, -1, callbackData))
      .to.be.revertedWithCustomError(hook, "UnauthorizedCallback");
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [external.target]);

    await ethers.provider.send("hardhat_setCode", [external.target, "0x60006000fd"]);
    await ethers.provider.send("hardhat_impersonateAccount", [POOL_MANAGER]);
    const driftSigner = await ethers.getSigner(POOL_MANAGER);
    await expect(hook.connect(driftSigner).beforeSwap(sender, key, exactInput, "0x"))
      .to.be.revertedWithCustomError(hook, "ExternalPoolChanged");
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [POOL_MANAGER]);

    const Adapter = await ethers.getContractFactory("PermV4Adapter");
    const adapter = await Adapter.deploy(owner.address, attacker.address, POOL_MANAGER);
    await adapter.setVerifiedHook(hook.target, true);
    const pinnedHookCodehash = await adapter.verifiedHookCodehashes(hook.target);
    await ethers.provider.send("hardhat_setCode", [hook.target, "0x60006000fd"]);
    const changedHookCodehash = ethers.keccak256(await ethers.provider.getCode(hook.target));
    const routeData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
      [key, "0x"],
    );
    await expect(adapter.connect(attacker).swapExactInput(currency0, currency1, 1, attacker.address, routeData))
      .to.be.revertedWithCustomError(adapter, "HookCodeChanged")
      .withArgs(hook.target, pinnedHookCodehash, changedHookCodehash);
  });

  it("fails atomically on callback replay, reentrancy, wrong currency, partial payment, and short output", async function () {
    this.timeout(180_000);
    const [owner, quoteSigner, user, treasury] = await ethers.getSigners();
    await ethers.provider.send("evm_mine", []);

    const Token = await ethers.getContractFactory("MockERC20");
    const first = await Token.deploy("Adversarial A", "AA", 18);
    const second = await Token.deploy("Adversarial B", "AB", 18);
    const Pool = await ethers.getContractFactory("MockTestAggregatorV3Pool");
    const external = await Pool.deploy(first.target, second.target, FEE, TICK_SPACING);
    const externalCodehash = ethers.keccak256(await ethers.provider.getCode(external.target));
    const hook = await deployMinedHook(owner, external.target, externalCodehash);
    const [currency0, currency1] = first.target.toLowerCase() < second.target.toLowerCase()
      ? [first.target, second.target] : [second.target, first.target];
    const input = currency0 === first.target ? first : second;
    const output = currency1 === first.target ? first : second;
    await input.mint(user.address, ethers.parseEther("20"));
    await input.mint(POOL_MANAGER, ethers.parseEther("100"));
    await output.mint(external.target, ethers.parseEther("100"));

    const key = { currency0, currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: hook.target };
    const manager = await ethers.getContractAt([
      "function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) returns(int24)",
    ], POOL_MANAGER);
    await manager.initialize(key, 1n << 96n);

    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, PERMIT2);
    const Adapter = await ethers.getContractFactory("PermV4Adapter");
    const adapter = await Adapter.deploy(owner.address, router.target, POOL_MANAGER);
    await router.configureAdapter(adapter.target, DIRECT_PROVIDER, true);
    await router.configureHookProvider(adapter.target, TEST_HOOK_PROVIDER);
    await adapter.setVerifiedHook(hook.target, true);
    await input.connect(user).approve(router.target, ethers.MaxUint256);

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const v4Data = coder.encode(
      ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
      [key, "0x"],
    );
    const routeData = coder.encode(
      ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
      [[{ adapter: adapter.target, tokenIn: currency0, tokenOut: currency1, data: v4Data }]],
    );
    const requestFor = async (amountIn) => {
      const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
      return signedRequest(router, quoteSigner, user.address, {
        tokenIn: currency0, tokenOut: currency1, amountIn, minAmountOut: 1n, recipient: user.address,
        deadline: quotedAt + 90, quotedAt, policyVersion: 1, chainId: CHAIN_ID,
        referrer: ethers.ZeroAddress, routeData,
      });
    };

    const normal = await requestFor(ethers.parseEther("1"));
    await expect(router.connect(user).swapExactInput(normal.request, normal.signature, EMPTY_PERMIT))
      .to.emit(router, "SwapSettled");

    await external.setBehavior(1);
    const repeated = await requestFor(ethers.parseEther("1.1"));
    await expectWrappedHookError(
      () => router.connect(user).swapExactInput(repeated.request, repeated.signature, EMPTY_PERMIT),
      hook,
      "Reentrancy",
    );

    await external.setBehavior(4);
    const nestedSwap = await requestFor(ethers.parseEther("1.15"));
    await expectWrappedHookError(
      () => router.connect(user).swapExactInput(nestedSwap.request, nestedSwap.signature, EMPTY_PERMIT),
      hook,
      "Reentrancy",
    );

    await external.setBehavior(5);
    const wrongCurrency = await requestFor(ethers.parseEther("1.18"));
    await expectWrappedHookError(
      () => router.connect(user).swapExactInput(wrongCurrency.request, wrongCurrency.signature, EMPTY_PERMIT),
      hook,
      "UnexpectedInputCurrency",
    );

    await external.setBehavior(2);
    const partial = await requestFor(ethers.parseEther("1.2"));
    await expectWrappedHookError(
      () => router.connect(user).swapExactInput(partial.request, partial.signature, EMPTY_PERMIT),
      hook,
      "InputMismatch",
    );

    await external.setBehavior(3);
    const short = await requestFor(ethers.parseEther("1.3"));
    await expectWrappedHookError(
      () => router.connect(user).swapExactInput(short.request, short.signature, EMPTY_PERMIT),
      hook,
      "OutputMismatch",
    );
  });
});
