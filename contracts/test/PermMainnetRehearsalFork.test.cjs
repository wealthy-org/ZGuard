// Full recording rehearsal on a local fork of Robinhood Chain mainnet (4663).
//
// Mirrors the recording plan exactly (Klip 05 → 09) against the real mainnet PoolManager,
// Uniswap V3 SwapRouter02, Permit2, WETH and Robinhood Stock Tokens. Nothing is broadcast:
// the fork is in-process and every account is a Hardhat test account.
//
//   corepack pnpm contracts:rehearse:mainnet
//
// The test fails if any venue, fee/rebate number, route-step event or claim differs from
// what the video is supposed to show.

const { expect } = require("chai");
const { ethers } = require("hardhat");

const RUN = process.env.RUN_MAINNET_FORK_TESTS === "1";
const CHAIN_ID = 4663;
const M = {
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  v4Quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  v3SwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  v3QuoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  v3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  NVDA: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  AAPL: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
};
// Extra mainnet venues (deployments/mainnet/aggregator-hooks.json and hub-routes.json).
const X = {
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  AMZN: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
  NFLX: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",
  MSFT: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
  SPY: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
  v2Factory: "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",
  v2Router02: "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba",
  v2PairCodehash: "0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5",
  v2WethUsdg: "0x8803c117ccae7B5146297876c2A25DF135141C4d",
  v2UsdgSpy: "0xE59087890579AfEC2CC316c7Db230B2d0945569F",
  slipstreamHook: "0xA117C4f25474b1283345E4DF8D88b9aeC4F62888",
  slipstreamHookCodehash: "0xce96b04fe4d2da5efb36c9f54fe132debb8a3e00bcf9165a9c5326c2815f6135",
};
const HOOK_NVDA_KEY = { currency0: M.weth, currency1: M.NVDA, fee: 0x800000, tickSpacing: 50, hooks: X.slipstreamHook };
const WETH_WRAP = ethers.id("WETH_WRAP");
const UNISWAP_V2 = ethers.id("UNISWAP_V2");
const AGGREGATOR_HOOK = ethers.id("UNISWAP_V4_AGGREGATOR_HOOK");
const erc20 = ["function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function decimals() view returns(uint8)"];
// Curated direct pools from deployments/mainnet/liquidity-report.json.
const NVDA_V4_KEY = { currency0: ethers.ZeroAddress, currency1: M.NVDA, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress };
const NVDA_V4_POOL_ID = "0x71f9660f9535e3e81d720696a58ea80274da8b2c6eb7c3acb22611d977439a5c";
const AAPL_V3_FEE = 500;
const NVDA_V3_FEE = 500;

const UNISWAP_V4_DIRECT = ethers.id("UNISWAP_V4_DIRECT");
const UNISWAP_V3 = ethers.id("UNISWAP_V3");
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };
const AMOUNT = ethers.parseEther("0.001");
const SLIPPAGE_BPS = 50n;
const coder = ethers.AbiCoder.defaultAbiCoder();

const QUOTE_TYPES = { PermQuote: [
  { name: "account", type: "address" }, { name: "tokenIn", type: "address" },
  { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
  { name: "minAmountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" },
  { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" },
  { name: "quotedAt", type: "uint64" }, { name: "policyVersion", type: "uint32" },
  { name: "chainId", type: "uint256" }, { name: "referrer", type: "address" },
  { name: "routeHash", type: "bytes32" },
] };

function v4Step(adapter, tokenIn, tokenOut, key) {
  const data = coder.encode(
    ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
    [key, "0x"],
  );
  return { adapter, tokenIn, tokenOut, data };
}

function v3Step(adapter, tokenIn, tokenOut, fee) {
  return { adapter, tokenIn, tokenOut, data: coder.encode(["uint24", "uint160"], [fee, 0]) };
}

function encodeRoute(steps) {
  return coder.encode(["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"], [steps]);
}

async function sign(router, quoteSigner, account, fields) {
  const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
  const request = {
    gasEstimate: 900_000n,
    recipient: account,
    deadline: quotedAt + 90,
    quotedAt,
    policyVersion: 1,
    chainId: CHAIN_ID,
    referrer: ethers.ZeroAddress,
    ...fields,
    quoteId: ethers.ZeroHash,
  };
  const domain = { name: "Perm", version: "2", chainId: CHAIN_ID, verifyingContract: router.target };
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
  request.quoteId = ethers.TypedDataEncoder.hash(domain, QUOTE_TYPES, value);
  return { request, signature: await quoteSigner.signTypedData(domain, QUOTE_TYPES, value) };
}

function events(router, receipt) {
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === router.target.toLowerCase())
    .map((log) => { try { return router.interface.parseLog(log); } catch { return null; } })
    .filter(Boolean);
}

function expectFees(settled, amountIn) {
  const gross = amountIn * 20n / 10_000n;
  const rebate = gross * 2_500n / 10_000n;
  expect(settled.args.grossFee).to.equal(gross);
  expect(settled.args.rebate).to.equal(rebate);
  expect(settled.args.netFee).to.equal(gross - rebate);
}

const gasLog = [];

describe(RUN ? "Perm · mainnet 4663 recording rehearsal (fork)" : "Mainnet recording rehearsal (skipped)", function () {
  if (!RUN) {
    it.skip("set RUN_MAINNET_FORK_TESTS=1 to rehearse on a local chain-4663 fork", function () {});
    return;
  }
  this.timeout(600_000);

  let deployer; let quoteSigner; let user; let treasury; let referrer;
  let router; let v4Adapter; let v3Adapter;
  let nvda; let aapl; let v4Quoter; let v3Quoter;

  before(async function () {
    [deployer, quoteSigner, user, treasury, referrer] = await ethers.getSigners();
    expect((await ethers.provider.getNetwork()).chainId).to.equal(4663n);
    await ethers.provider.send("evm_mine", []);
    for (const [label, address] of Object.entries(M)) {
      expect(await ethers.provider.getCode(address), `${label} must have code on 4663`).to.not.equal("0x");
    }
    const swapRouter = await ethers.getContractAt(["function WETH9() view returns(address)"], M.v3SwapRouter02);
    expect(await swapRouter.WETH9()).to.equal(M.weth);

    nvda = await ethers.getContractAt([
      "function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function decimals() view returns(uint8)",
    ], M.NVDA);
    aapl = await ethers.getContractAt([
      "function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function decimals() view returns(uint8)",
    ], M.AAPL);
    v4Quoter = await ethers.getContractAt([
      "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
    ], M.v4Quoter);
    v3Quoter = await ethers.getContractAt([
      "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160,uint32,uint256 gasEstimate)",
    ], M.v3QuoterV2);
  });

  it("deploys Router v2 + V4 adapter + V3 adapter bound to official Uniswap V3 on 4663", async function () {
    const Router = await ethers.getContractFactory("PermRouter");
    router = await Router.deploy(deployer.address, treasury.address, quoteSigner.address, M.permit2);
    const V4 = await ethers.getContractFactory("PermV4Adapter");
    v4Adapter = await V4.deploy(deployer.address, router.target, M.poolManager);
    const V3 = await ethers.getContractFactory("PermV3Adapter");
    v3Adapter = await V3.deploy(deployer.address, router.target, M.v3SwapRouter02, M.weth);
    await router.configureAdapter(v4Adapter.target, UNISWAP_V4_DIRECT, true);
    await router.configureAdapter(v3Adapter.target, UNISWAP_V3, true);

    const policy = await router.feePolicies(1);
    expect(await router.activePolicyVersion()).to.equal(1n);
    expect(policy.platformFeeBps).to.equal(20n);
    expect(policy.rebateShareBps).to.equal(2_500n);
    expect(policy.enabled).to.equal(true);
    expect(await router.quoteSigner()).to.equal(quoteSigner.address);
    expect(await router.treasury()).to.equal(treasury.address);
    expect(await v3Adapter.swapRouter()).to.equal(M.v3SwapRouter02);
    expect(await v3Adapter.weth()).to.equal(M.weth);
  });

  it("Klip 02 · ETH→NVDA has at least two real candidates (Uniswap v4 and Uniswap v3)", async function () {
    const routed = AMOUNT - AMOUNT * 15n / 10_000n;
    const [v4] = await v4Quoter.quoteExactInputSingle.staticCall({ poolKey: NVDA_V4_KEY, zeroForOne: true, exactAmount: routed, hookData: "0x" });
    const [v3] = await v3Quoter.quoteExactInputSingle.staticCall({ tokenIn: M.weth, tokenOut: M.NVDA, amountIn: routed, fee: NVDA_V3_FEE, sqrtPriceLimitX96: 0 });
    expect(v4).to.be.greaterThan(0n);
    expect(v3).to.be.greaterThan(0n);
    console.log(`      candidates for 0.001 ETH → NVDA: v4 0.05% ${ethers.formatUnits(v4, 18)} · v3 0.05% ${ethers.formatUnits(v3, 18)}`);
  });

  it("Klip 05 · ETH→NVDA through Uniswap v4: fee 2e12 / rebate 5e11 / net 1.5e12 wei on-chain", async function () {
    const routed = AMOUNT - AMOUNT * 15n / 10_000n;
    const [quoted] = await v4Quoter.quoteExactInputSingle.staticCall({ poolKey: NVDA_V4_KEY, zeroForOne: true, exactAmount: routed, hookData: "0x" });
    const routeData = encodeRoute([v4Step(v4Adapter.target, ethers.ZeroAddress, M.NVDA, NVDA_V4_KEY)]);
    const { request, signature } = await sign(router, quoteSigner, user.address, {
      tokenIn: ethers.ZeroAddress, tokenOut: M.NVDA, amountIn: AMOUNT,
      minAmountOut: quoted * (10_000n - SLIPPAGE_BPS) / 10_000n, routeData,
    });
    const before = await nvda.balanceOf(user.address);
    const receipt = await (await router.connect(user).swapExactInput(request, signature, EMPTY_PERMIT, { value: AMOUNT })).wait();
    gasLog.push(["Klip 05 swap v4 ETH→NVDA", receipt.gasUsed]);
    const parsed = events(router, receipt);
    const settled = parsed.find((e) => e.name === "SwapSettled");
    const steps = parsed.filter((e) => e.name === "RouteStepSettled");
    expectFees(settled, AMOUNT);
    expect(settled.args.grossFee).to.equal(2_000_000_000_000n);
    expect(settled.args.rebate).to.equal(500_000_000_000n);
    expect(settled.args.netFee).to.equal(1_500_000_000_000n);
    expect(steps).to.have.length(1);
    expect(steps[0].args.providerId).to.equal(UNISWAP_V4_DIRECT);
    expect(steps[0].args.stepRouteId).to.equal(NVDA_V4_POOL_ID);
    expect(steps[0].args.hook).to.equal(ethers.ZeroAddress);
    expect((await nvda.balanceOf(user.address)) - before).to.equal(settled.args.amountOut);
    console.log(`      NVDA out ${ethers.formatUnits(settled.args.amountOut, 18)} · gas ${receipt.gasUsed}`);
  });

  it("Klip 06 · NVDA → ETH (v4) → AAPL (v3): two RouteStepSettled + one SwapSettled", async function () {
    const amountIn = await nvda.balanceOf(user.address);
    await nvda.connect(user).approve(router.target, amountIn);
    const routeData = encodeRoute([
      v4Step(v4Adapter.target, M.NVDA, ethers.ZeroAddress, NVDA_V4_KEY),
      v3Step(v3Adapter.target, ethers.ZeroAddress, M.AAPL, AAPL_V3_FEE),
    ]);
    const { request, signature } = await sign(router, quoteSigner, user.address, {
      tokenIn: M.NVDA, tokenOut: M.AAPL, amountIn, minAmountOut: 1n, routeData, gasEstimate: 1_200_000n,
    });
    const receipt = await (await router.connect(user).swapExactInput(request, signature, EMPTY_PERMIT)).wait();
    gasLog.push(["Klip 06 multi-hop NVDA→ETH→AAPL (approve excluded)", receipt.gasUsed]);
    const parsed = events(router, receipt);
    const steps = parsed.filter((e) => e.name === "RouteStepSettled");
    const settled = parsed.filter((e) => e.name === "SwapSettled");
    expect(steps).to.have.length(2);
    expect(settled).to.have.length(1);
    expect(steps[0].args.providerId).to.equal(UNISWAP_V4_DIRECT);
    expect(steps[1].args.providerId).to.equal(UNISWAP_V3);
    expectFees(settled[0], amountIn);
    expect(await aapl.balanceOf(user.address)).to.equal(settled[0].args.amountOut);
    console.log(`      AAPL out ${ethers.formatUnits(settled[0].args.amountOut, 18)} · gas ${receipt.gasUsed}`);
  });

  it("Klip 07 · AAPL→ETH via Uniswap v3 with a Permit2 signature (one-time Permit2 approve)", async function () {
    const amountIn = await aapl.balanceOf(user.address);
    const approveReceipt = await (await aapl.connect(user).approve(M.permit2, ethers.MaxUint256)).wait();
    gasLog.push(["Klip 07 one-time AAPL approve to Permit2", approveReceipt.gasUsed]);
    const routeData = encodeRoute([v3Step(v3Adapter.target, M.AAPL, ethers.ZeroAddress, AAPL_V3_FEE)]);
    const { request, signature } = await sign(router, quoteSigner, user.address, {
      tokenIn: M.AAPL, tokenOut: ethers.ZeroAddress, amountIn, minAmountOut: 1n, routeData,
    });
    const nonce = BigInt(ethers.hexlify(ethers.randomBytes(8)));
    const deadline = BigInt(request.deadline);
    const permitSignature = await user.signTypedData(
      { name: "Permit2", chainId: CHAIN_ID, verifyingContract: M.permit2 },
      {
        PermitTransferFrom: [
          { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
        ],
        TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
      },
      { permitted: { token: M.AAPL, amount: amountIn }, spender: router.target, nonce, deadline },
    );
    const ethBefore = await ethers.provider.getBalance(user.address);
    const receipt = await (await router.connect(user).swapExactInput(request, signature, { nonce, deadline, signature: permitSignature })).wait();
    gasLog.push(["Klip 07 Permit2 swap AAPL→ETH", receipt.gasUsed]);
    const settled = events(router, receipt).find((e) => e.name === "SwapSettled");
    expectFees(settled, amountIn);
    const ethAfter = await ethers.provider.getBalance(user.address);
    expect(ethAfter + receipt.gasUsed * receipt.gasPrice - ethBefore).to.equal(settled.args.amountOut);
    expect(await aapl.balanceOf(user.address)).to.equal(0n);
    console.log(`      ETH back ${ethers.formatEther(settled.args.amountOut)} · gas ${receipt.gasUsed}`);
  });

  it("Klip 08 · referral share comes out of the net fee and is claimed by the referrer", async function () {
    await router.connect(deployer).configureReferral(referrer.address, 5_000);
    const routed = AMOUNT - AMOUNT * 15n / 10_000n;
    const [quoted] = await v3Quoter.quoteExactInputSingle.staticCall({ tokenIn: M.weth, tokenOut: M.NVDA, amountIn: routed, fee: NVDA_V3_FEE, sqrtPriceLimitX96: 0 });
    const routeData = encodeRoute([v3Step(v3Adapter.target, ethers.ZeroAddress, M.NVDA, NVDA_V3_FEE)]);
    const { request, signature } = await sign(router, quoteSigner, user.address, {
      tokenIn: ethers.ZeroAddress, tokenOut: M.NVDA, amountIn: AMOUNT,
      minAmountOut: quoted * (10_000n - SLIPPAGE_BPS) / 10_000n, routeData, referrer: referrer.address,
    });
    const receipt = await (await router.connect(user).swapExactInput(request, signature, EMPTY_PERMIT, { value: AMOUNT })).wait();
    gasLog.push(["Klip 08 referral swap v3 ETH→NVDA", receipt.gasUsed]);
    const settled = events(router, receipt).find((e) => e.name === "SwapSettled");
    expectFees(settled, AMOUNT);
    expect(settled.args.referralFee).to.equal(settled.args.netFee / 2n);
    expect(settled.args.treasuryFee).to.equal(settled.args.netFee - settled.args.referralFee);
    const claimable = await router.claimableFees(ethers.ZeroAddress, referrer.address);
    expect(claimable).to.equal(settled.args.referralFee);
    const balanceBefore = await ethers.provider.getBalance(referrer.address);
    const claim = await (await router.connect(referrer).claimFees(ethers.ZeroAddress, referrer.address)).wait();
    gasLog.push(["Klip 08 referrer claimFees(ETH)", claim.gasUsed]);
    const balanceAfter = await ethers.provider.getBalance(referrer.address);
    expect(balanceAfter + claim.gasUsed * claim.gasPrice - balanceBefore).to.equal(claimable);
  });

  it("Klip 09 · treasury pulls accrued fees (ETH and stock-token fees)", async function () {
    const ethFees = await router.claimableFees(ethers.ZeroAddress, treasury.address);
    const nvdaFees = await router.claimableFees(M.NVDA, treasury.address);
    const aaplFees = await router.claimableFees(M.AAPL, treasury.address);
    expect(ethFees).to.be.greaterThan(0n);
    expect(nvdaFees).to.be.greaterThan(0n);
    expect(aaplFees).to.be.greaterThan(0n);
    const before = await ethers.provider.getBalance(treasury.address);
    const claim = await (await router.connect(treasury).claimFees(ethers.ZeroAddress, treasury.address)).wait();
    gasLog.push(["Klip 09 treasury claimFees(ETH)", claim.gasUsed]);
    const after = await ethers.provider.getBalance(treasury.address);
    expect(after + claim.gasUsed * claim.gasPrice - before).to.equal(ethFees);
    await (await router.connect(treasury).claimFees(M.NVDA, treasury.address)).wait();
    expect(await nvda.balanceOf(treasury.address)).to.equal(nvdaFees);
    console.log(`      treasury claimed ${ethers.formatEther(ethFees)} ETH + ${ethers.formatUnits(nvdaFees, 18)} NVDA (+ ${ethers.formatUnits(aaplFees, 18)} AAPL claimable)`);
  });

  // ── Extra mainnet venues: v4 Aggregator Hook, USDG hub (AMZN / NFLX / MSFT), Uniswap V2, admin handoff ──
  let wethAdapter; let v2Adapter;

  it("Aggregator Hook · ETH → WETH (1:1 wrap) → NVDA through the codehash-pinned SlipstreamAggregator hook", async function () {
    expect(ethers.keccak256(await ethers.provider.getCode(X.slipstreamHook))).to.equal(X.slipstreamHookCodehash);
    const Weth = await ethers.getContractFactory("PermWethAdapter");
    wethAdapter = await Weth.deploy(router.target, M.weth);
    await router.configureAdapter(wethAdapter.target, WETH_WRAP, true);
    await v4Adapter.setVerifiedHook(X.slipstreamHook, true);
    await router.configureHookProvider(v4Adapter.target, AGGREGATOR_HOOK);
    expect(await v4Adapter.verifiedHookCodehashes(X.slipstreamHook)).to.equal(X.slipstreamHookCodehash);

    const [, , , routed] = await router.previewFees(AMOUNT, 1);
    const [expectedOut] = await v4Quoter.quoteExactInputSingle.staticCall({ poolKey: HOOK_NVDA_KEY, zeroForOne: true, exactAmount: routed, hookData: "0x" });
    const routeData = encodeRoute([
      { adapter: wethAdapter.target, tokenIn: ethers.ZeroAddress, tokenOut: M.weth, data: "0x" },
      v4Step(v4Adapter.target, M.weth, M.NVDA, HOOK_NVDA_KEY),
    ]);
    const before = await nvda.balanceOf(user.address);
    const { request, signature } = await sign(router, quoteSigner, user.address, {
      tokenIn: ethers.ZeroAddress, tokenOut: M.NVDA, amountIn: AMOUNT, minAmountOut: expectedOut * (10_000n - SLIPPAGE_BPS) / 10_000n, routeData,
    });
    const receipt = await (await router.connect(user).swapExactInput(request, signature, EMPTY_PERMIT, { value: AMOUNT })).wait();
    gasLog.push(["Hook ETH→WETH→NVDA (SlipstreamAggregator)", receipt.gasUsed]);
    const parsed = events(router, receipt);
    const steps = parsed.filter((event) => event.name === "RouteStepSettled");
    const settled = parsed.find((event) => event.name === "SwapSettled");
    expect(steps.length).to.equal(2);
    expect(steps[0].args.providerId).to.equal(WETH_WRAP);
    expect(steps[0].args.amountOut).to.equal(routed);
    expect(steps[1].args.providerId).to.equal(AGGREGATOR_HOOK);
    expect(steps[1].args.hook).to.equal(X.slipstreamHook);
    expect(steps[1].args.hookCodehash).to.equal(X.slipstreamHookCodehash);
    expect(settled.args.amountOut).to.equal(expectedOut);
    expectFees(settled, AMOUNT);
    expect((await nvda.balanceOf(user.address)) - before).to.equal(expectedOut);
    console.log(`      hook route: 0.001 ETH → ${ethers.formatUnits(expectedOut, 18)} NVDA`);
  });

  it("Aggregator Hook · NVDA → WETH (hook) → ETH (1:1 unwrap)", async function () {
    const amountIn = (await nvda.balanceOf(user.address)) / 2n;
    const [, , , routed] = await router.previewFees(amountIn, 1);
    const [expectedOut] = await v4Quoter.quoteExactInputSingle.staticCall({ poolKey: HOOK_NVDA_KEY, zeroForOne: false, exactAmount: routed, hookData: "0x" });
    await nvda.connect(user).approve(router.target, amountIn);
    const routeData = encodeRoute([
      v4Step(v4Adapter.target, M.NVDA, M.weth, HOOK_NVDA_KEY),
      { adapter: wethAdapter.target, tokenIn: M.weth, tokenOut: ethers.ZeroAddress, data: "0x" },
    ]);
    const { request, signature } = await sign(router, quoteSigner, user.address, {
      tokenIn: M.NVDA, tokenOut: ethers.ZeroAddress, amountIn, minAmountOut: expectedOut * (10_000n - SLIPPAGE_BPS) / 10_000n, routeData,
    });
    const before = await ethers.provider.getBalance(user.address);
    const receipt = await (await router.connect(user).swapExactInput(request, signature, EMPTY_PERMIT)).wait();
    gasLog.push(["Hook NVDA→WETH→ETH (approve excluded)", receipt.gasUsed]);
    const settled = events(router, receipt).find((event) => event.name === "SwapSettled");
    expect(settled.args.amountOut).to.equal(expectedOut);
    expect((await ethers.provider.getBalance(user.address)) + receipt.gasUsed * receipt.gasPrice - before).to.equal(expectedOut);
  });

  for (const symbol of ["AMZN", "NFLX", "MSFT"]) {
    it(`USDG hub · ETH → USDG (Uniswap v3 0.01%) → ${symbol} (Uniswap v3 0.30%)`, async function () {
      const token = await ethers.getContractAt(erc20, X[symbol]);
      const [, , , routed] = await router.previewFees(AMOUNT, 1);
      const [usdgOut] = await v3Quoter.quoteExactInputSingle.staticCall({ tokenIn: M.weth, tokenOut: X.usdg, amountIn: routed, fee: 100, sqrtPriceLimitX96: 0 });
      const [tokenOut] = await v3Quoter.quoteExactInputSingle.staticCall({ tokenIn: X.usdg, tokenOut: X[symbol], amountIn: usdgOut, fee: 3000, sqrtPriceLimitX96: 0 });
      const routeData = encodeRoute([
        v3Step(v3Adapter.target, ethers.ZeroAddress, X.usdg, 100),
        v3Step(v3Adapter.target, X.usdg, X[symbol], 3000),
      ]);
      const { request, signature } = await sign(router, quoteSigner, user.address, {
        tokenIn: ethers.ZeroAddress, tokenOut: X[symbol], amountIn: AMOUNT, minAmountOut: tokenOut * (10_000n - SLIPPAGE_BPS) / 10_000n, routeData,
      });
      const receipt = await (await router.connect(user).swapExactInput(request, signature, EMPTY_PERMIT, { value: AMOUNT })).wait();
      gasLog.push([`USDG hub ETH→USDG→${symbol}`, receipt.gasUsed]);
      const parsed = events(router, receipt);
      const steps = parsed.filter((event) => event.name === "RouteStepSettled");
      const settled = parsed.find((event) => event.name === "SwapSettled");
      expect(steps.length).to.equal(2);
      expect(steps[0].args.tokenOut).to.equal(X.usdg);
      expect(steps[0].args.amountOut).to.equal(usdgOut);
      expect(settled.args.amountOut).to.equal(tokenOut);
      expectFees(settled, AMOUNT);
      expect(await token.balanceOf(user.address)).to.equal(tokenOut);
      console.log(`      0.001 ETH → ${ethers.formatUnits(usdgOut, 6)} USDG → ${ethers.formatUnits(tokenOut, 18)} ${symbol}`);
    });
  }

  it("Uniswap V2 · ETH → USDG → SPY through two official V2 pairs (codehash-pinned)", async function () {
    expect(ethers.keccak256(await ethers.provider.getCode(X.v2WethUsdg))).to.equal(X.v2PairCodehash);
    const V2 = await ethers.getContractFactory("PermV2Adapter");
    v2Adapter = await V2.deploy(deployer.address, router.target, X.v2Factory, M.weth, X.v2PairCodehash);
    await router.configureAdapter(v2Adapter.target, UNISWAP_V2, true);
    const v2Router = await ethers.getContractAt(["function getAmountsOut(uint256,address[]) view returns(uint256[])"], X.v2Router02);
    const [, , , routed] = await router.previewFees(AMOUNT, 1);
    const amounts = await v2Router.getAmountsOut(routed, [M.weth, X.usdg, X.SPY]);
    const spy = await ethers.getContractAt(erc20, X.SPY);
    const before = await spy.balanceOf(user.address);
    const routeData = encodeRoute([
      { adapter: v2Adapter.target, tokenIn: ethers.ZeroAddress, tokenOut: X.usdg, data: coder.encode(["address"], [X.v2WethUsdg]) },
      { adapter: v2Adapter.target, tokenIn: X.usdg, tokenOut: X.SPY, data: coder.encode(["address"], [X.v2UsdgSpy]) },
    ]);
    const { request, signature } = await sign(router, quoteSigner, user.address, {
      tokenIn: ethers.ZeroAddress, tokenOut: X.SPY, amountIn: AMOUNT, minAmountOut: amounts[2] * (10_000n - SLIPPAGE_BPS) / 10_000n, routeData,
    });
    const receipt = await (await router.connect(user).swapExactInput(request, signature, EMPTY_PERMIT, { value: AMOUNT })).wait();
    gasLog.push(["Uniswap V2 ETH→USDG→SPY", receipt.gasUsed]);
    const parsed = events(router, receipt);
    const steps = parsed.filter((event) => event.name === "RouteStepSettled");
    expect(steps.map((step) => step.args.providerId)).to.deep.equal([UNISWAP_V2, UNISWAP_V2]);
    expect(steps[0].args.amountOut).to.equal(amounts[1]);
    expect((await spy.balanceOf(user.address)) - before).to.equal(amounts[2]);
    console.log(`      V2: 0.001 ETH → ${ethers.formatUnits(amounts[1], 6)} USDG → ${ethers.formatUnits(amounts[2], 18)} SPY`);
  });

  it("Admin · set-treasury rotates new accruals only; referral share can be changed and removed", async function () {
    const [, , , , , newTreasury] = await ethers.getSigners();
    const oldClaimable = await router.claimableFees(ethers.ZeroAddress, treasury.address);
    await expect(router.connect(user).setTreasury(newTreasury.address)).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    await router.setTreasury(newTreasury.address);
    expect(await router.treasury()).to.equal(newTreasury.address);
    await router.configureReferral(referrer.address, 2_000);
    expect(await router.referralShares(referrer.address)).to.equal(2_000n);
    const [, , , routed] = await router.previewFees(AMOUNT, 1);
    const [expectedOut] = await v4Quoter.quoteExactInputSingle.staticCall({ poolKey: NVDA_V4_KEY, zeroForOne: true, exactAmount: routed, hookData: "0x" });
    const { request, signature } = await sign(router, quoteSigner, user.address, {
      tokenIn: ethers.ZeroAddress, tokenOut: M.NVDA, amountIn: AMOUNT, minAmountOut: expectedOut * (10_000n - SLIPPAGE_BPS) / 10_000n,
      referrer: referrer.address, routeData: encodeRoute([v4Step(v4Adapter.target, ethers.ZeroAddress, M.NVDA, NVDA_V4_KEY)]),
    });
    const receipt = await (await router.connect(user).swapExactInput(request, signature, EMPTY_PERMIT, { value: AMOUNT })).wait();
    const settled = events(router, receipt).find((event) => event.name === "SwapSettled");
    expect(settled.args.referralFee).to.equal(settled.args.netFee * 2_000n / 10_000n);
    expect(await router.claimableFees(ethers.ZeroAddress, newTreasury.address)).to.equal(settled.args.treasuryFee);
    expect(await router.claimableFees(ethers.ZeroAddress, treasury.address)).to.equal(oldClaimable);
    await router.configureReferral(referrer.address, 0);
    expect(await router.referralShares(referrer.address)).to.equal(0n);
  });

  it("Admin · transfer-ownership is two-step on Router and every owned adapter", async function () {
    const [, , , , , , newOwner] = await ethers.getSigners();
    for (const contract of [router, v4Adapter, v3Adapter, v2Adapter]) {
      await contract.transferOwnership(newOwner.address);
      expect(await contract.owner()).to.equal(deployer.address);
      expect(await contract.pendingOwner()).to.equal(newOwner.address);
      await expect(contract.connect(user).acceptOwnership()).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
      await contract.connect(newOwner).acceptOwnership();
      expect(await contract.owner()).to.equal(newOwner.address);
    }
    await expect(router.setTreasury(deployer.address)).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    await router.connect(newOwner).pause();
    await router.connect(newOwner).unpause();
  });

  after(function () {
    if (!gasLog.length) return;
    console.log("\n      Gas used on the 4663 fork:");
    for (const [label, gas] of gasLog) console.log(`        ${label.padEnd(52)} ${gas.toString().padStart(9)}`);
    const total = gasLog.reduce((sum, [, gas]) => sum + gas, 0n);
    console.log(`        ${"TOTAL".padEnd(52)} ${total.toString().padStart(9)}`);
  });
});
