const { expect } = require("chai");
const { ethers } = require("hardhat");

const CHAIN_ID = 31337;
const POLICY_V1 = 1;
const ZERO = ethers.ZeroAddress;
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };
const ROUTE_TYPES = ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"];

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

function encodeRoute(steps) {
  return ethers.AbiCoder.defaultAbiCoder().encode(ROUTE_TYPES, [steps]);
}

function quoteValue(account, request) {
  return {
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
}

async function signRequest(router, signer, account, rawRequest) {
  const request = { ...rawRequest, quoteId: ethers.ZeroHash };
  const domain = {
    name: "Perm",
    version: "2",
    chainId: CHAIN_ID,
    verifyingContract: await router.getAddress(),
  };
  const types = {
    PermQuote: [
      { name: "account", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
      { name: "quotedAt", type: "uint64" },
      { name: "policyVersion", type: "uint32" },
      { name: "chainId", type: "uint256" },
      { name: "referrer", type: "address" },
      { name: "routeHash", type: "bytes32" },
    ],
  };
  const signature = await signer.signTypedData(domain, types, quoteValue(account, request));
  const quoteId = ethers.TypedDataEncoder.hash(domain, types, quoteValue(account, request));
  return { request: { ...request, quoteId }, signature };
}

function makeRequest(adapter, tokenIn, tokenOut, amountIn, recipient, quotedAt, overrides = {}) {
  const steps = overrides.steps || [{ adapter, tokenIn, tokenOut, data: "0x" }];
  return {
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut: 1,
    gasEstimate: 500_000,
    recipient,
    deadline: quotedAt + 90,
    quotedAt,
    policyVersion: POLICY_V1,
    chainId: CHAIN_ID,
    quoteId: ethers.ZeroHash,
    referrer: ZERO,
    routeData: encodeRoute(steps),
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "steps")),
  };
}

describe("PermRouter v2", function () {
  async function fixture() {
    const [owner, quoteSigner, user, recipient, treasury, referrer, attacker] = await ethers.getSigners();
    const Permit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await Permit2.deploy();
    const Token = await ethers.getContractFactory("MockERC20");
    const tokenIn = await Token.deploy("Input", "IN", 18);
    const tokenMid = await Token.deploy("Middle", "MID", 18);
    const tokenOut = await Token.deploy("Output", "OUT", 18);
    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, await permit2.getAddress());
    const Adapter = await ethers.getContractFactory("MockAdapter");
    const adapter = await Adapter.deploy(await router.getAddress(), 2, 1);
    const secondAdapter = await Adapter.deploy(await router.getAddress(), 2, 1);
    await router.configureAdapter(await adapter.getAddress(), ethers.id("MOCK_A"), true);
    await router.configureAdapter(await secondAdapter.getAddress(), ethers.id("MOCK_B"), true);
    await tokenIn.mint(user.address, ethers.parseEther("10000"));
    await tokenMid.mint(await adapter.getAddress(), ethers.parseEther("30000"));
    await tokenOut.mint(await adapter.getAddress(), ethers.parseEther("30000"));
    await tokenOut.mint(await secondAdapter.getAddress(), ethers.parseEther("60000"));
    await user.sendTransaction({ to: await adapter.getAddress(), value: ethers.parseEther("100") });
    return {
      owner, quoteSigner, user, recipient, treasury, referrer, attacker,
      permit2, tokenIn, tokenMid, tokenOut, router, adapter, secondAdapter,
    };
  }

  it("settles a server-signed quote with exact fee rebate and pull-based treasury accounting", async function () {
    const { quoteSigner, user, recipient, treasury, tokenIn, tokenOut, router, adapter } = await fixture();
    const amountIn = ethers.parseEther("100");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t,
      { minAmountOut: ethers.parseEther("199") },
    ));
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);

    const tx = await router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT);
    await expect(tx).to.emit(router, "RouteStepSettled").and.to.emit(router, "SwapSettled");

    expect(await tokenOut.balanceOf(recipient.address)).to.equal(ethers.parseEther("199.7"));
    expect(await tokenIn.balanceOf(treasury.address)).to.equal(0);
    expect(await router.claimableFees(await tokenIn.getAddress(), treasury.address)).to.equal(ethers.parseEther("0.15"));
    expect(await tokenIn.allowance(await router.getAddress(), await adapter.getAddress())).to.equal(0);
    expect(await router.consumedQuotes(signed.request.quoteId)).to.equal(true);

    await expect(router.connect(treasury).claimFees(await tokenIn.getAddress(), treasury.address))
      .to.emit(router, "FeeClaimed")
      .withArgs(await tokenIn.getAddress(), treasury.address, treasury.address, ethers.parseEther("0.15"));
    expect(await tokenIn.balanceOf(treasury.address)).to.equal(ethers.parseEther("0.15"));
  });

  it("pins adapter runtime codehashes and rejects code changed after allowlisting", async function () {
    const { owner, quoteSigner, user, recipient, tokenIn, tokenOut, router } = await fixture();
    const MutableAdapter = await ethers.getContractFactory("MockMutableAdapter");
    const mutable = await MutableAdapter.deploy(await router.getAddress());
    const mutableAddress = await mutable.getAddress();
    await expect(router.connect(owner).configureAdapter(mutableAddress, ethers.id("MUTABLE"), true))
      .to.emit(router, "AdapterConfigured");
    const pinnedCodehash = await router.adapterCodehashes(mutableAddress);
    expect(pinnedCodehash).to.equal(ethers.keccak256(await ethers.provider.getCode(mutableAddress)));

    // Hardhat's test-only RPC mutation emulates a metamorphic implementation after governance review.
    await ethers.provider.send("hardhat_setCode", [mutableAddress, "0x60006000fd"]);
    const changedCodehash = ethers.keccak256(await ethers.provider.getCode(mutableAddress));
    expect(changedCodehash).to.not.equal(pinnedCodehash);

    const amountIn = ethers.parseEther("1");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      mutableAddress, await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t,
    ));
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await expect(router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "AdapterCodehashMismatch")
      .withArgs(mutableAddress, pinnedCodehash, changedCodehash);
  });

  it("rejects forged, mutated, replayed, stale, future, expired and wrong-chain quotes", async function () {
    const { quoteSigner, user, recipient, attacker, tokenIn, tokenOut, router, adapter } = await fixture();
    const amountIn = ethers.parseEther("1");
    await tokenIn.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
    const t = await now();
    const raw = makeRequest(await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t);
    const signed = await signRequest(router, quoteSigner, user.address, raw);
    const forged = await signRequest(router, attacker, user.address, raw);

    await expect(router.connect(user).swapExactInput(forged.request, forged.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "InvalidQuoteSigner");
    await expect(router.connect(user).swapExactInput({ ...signed.request, minAmountOut: 2 }, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "QuoteBindingMismatch");
    await expect(router.connect(user).swapExactInput({ ...signed.request, gasEstimate: 500_001 }, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "QuoteBindingMismatch");

    const wrongChain = await signRequest(router, quoteSigner, user.address, { ...raw, chainId: 46630 });
    await expect(router.connect(user).swapExactInput(wrongChain.request, wrongChain.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "ChainMismatch");
    const expired = await signRequest(router, quoteSigner, user.address, { ...raw, deadline: t - 1 });
    await expect(router.connect(user).swapExactInput(expired.request, expired.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "DeadlineExpired");
    const stale = await signRequest(router, quoteSigner, user.address, { ...raw, quotedAt: t - 121, deadline: t + 300 });
    await expect(router.connect(user).swapExactInput(stale.request, stale.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "QuoteStale");
    const future = await signRequest(router, quoteSigner, user.address, { ...raw, quotedAt: t + 100, deadline: t + 200 });
    await expect(router.connect(user).swapExactInput(future.request, future.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "QuoteFromFuture");
    const oversized = await signRequest(router, quoteSigner, user.address, { ...raw, amountIn: 1n << 127n });
    await expect(router.connect(user).swapExactInput(oversized.request, oversized.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "AmountTooLarge");
    const zeroGas = await signRequest(router, quoteSigner, user.address, { ...raw, gasEstimate: 0 });
    await expect(router.connect(user).swapExactInput(zeroGas.request, zeroGas.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "InvalidAmount");
    const excessiveGas = await signRequest(router, quoteSigner, user.address, { ...raw, gasEstimate: 30_000_001 });
    await expect(router.connect(user).swapExactInput(excessiveGas.request, excessiveGas.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "AmountTooLarge");

    await router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT);
    await expect(router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "AlreadyConsumed");
  });

  it("rejects self-referral even when the quote signer included it", async function () {
    const { owner, quoteSigner, user, recipient, tokenIn, tokenOut, router, adapter } = await fixture();
    await router.connect(owner).configureReferral(user.address, 5_000);
    const t = await now();
    const raw = makeRequest(await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), ethers.parseEther("1"), recipient.address, t, { referrer: user.address });
    const signed = await signRequest(router, quoteSigner, user.address, raw);
    await tokenIn.connect(user).approve(await router.getAddress(), raw.amountIn);
    await expect(router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "SelfReferral");
  });

  it("executes a signed two-step route and proves each venue step", async function () {
    const { quoteSigner, user, recipient, tokenIn, tokenMid, tokenOut, router, adapter, secondAdapter } = await fixture();
    const amountIn = ethers.parseEther("10");
    const t = await now();
    const steps = [
      { adapter: await adapter.getAddress(), tokenIn: await tokenIn.getAddress(), tokenOut: await tokenMid.getAddress(), data: "0x" },
      { adapter: await secondAdapter.getAddress(), tokenIn: await tokenMid.getAddress(), tokenOut: await tokenOut.getAddress(), data: "0x" },
    ];
    const raw = makeRequest(await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t, {
      steps,
      minAmountOut: ethers.parseEther("39"),
    });
    const signed = await signRequest(router, quoteSigner, user.address, raw);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    const receipt = await (await router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT)).wait();
    const stepEvents = receipt.logs.map((log) => {
      try { return router.interface.parseLog(log); } catch { return null; }
    }).filter((log) => log?.name === "RouteStepSettled");
    expect(stepEvents).to.have.length(2);
    expect(stepEvents[0].args.providerId).to.equal(ethers.id("MOCK_A"));
    expect(stepEvents[1].args.providerId).to.equal(ethers.id("MOCK_B"));
    expect(stepEvents[0].args.hookCodehash).to.equal(ethers.ZeroHash);
    expect(stepEvents[1].args.hookCodehash).to.equal(ethers.ZeroHash);
    expect(await tokenOut.balanceOf(recipient.address)).to.equal(ethers.parseEther("39.94"));
  });

  it("fails closed on hook steps until a distinct hook provider identity is configured", async function () {
    const { owner, quoteSigner, user, recipient, attacker, tokenIn, tokenOut, router, adapter } = await fixture();
    const amountIn = ethers.parseEther("1");
    const t = await now();
    const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [attacker.address]);
    const raw = makeRequest(await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t, {
      steps: [{ adapter: await adapter.getAddress(), tokenIn: await tokenIn.getAddress(), tokenOut: await tokenOut.getAddress(), data: hookData }],
    });
    const signed = await signRequest(router, quoteSigner, user.address, raw);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await expect(router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "InvalidRoute");
    expect(await router.consumedQuotes(signed.request.quoteId)).to.equal(false);

    const hookProviderId = ethers.id("UNISWAP_V4_AGGREGATOR_HOOK");
    await expect(router.connect(owner).configureHookProvider(await adapter.getAddress(), hookProviderId))
      .to.emit(router, "HookProviderConfigured").withArgs(await adapter.getAddress(), hookProviderId);
    const receipt = await (await router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT)).wait();
    const step = receipt.logs.map((log) => {
      try { return router.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry?.name === "RouteStepSettled");
    expect(step.args.providerId).to.equal(hookProviderId);
    expect(step.args.hook).to.equal(attacker.address);
    expect(step.args.hookCodehash).to.equal(ethers.keccak256("0x"));

    await router.connect(owner).configureHookProvider(await adapter.getAddress(), ethers.ZeroHash);
    const disabledRaw = { ...raw, quoteId: ethers.ZeroHash, quotedAt: await now(), deadline: (await now()) + 90 };
    const disabled = await signRequest(router, quoteSigner, user.address, disabledRaw);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await expect(router.connect(user).swapExactInput(disabled.request, disabled.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "InvalidRoute");
  });

  it("uses Permit2 signature transfer when supplied", async function () {
    const { quoteSigner, user, recipient, permit2, tokenIn, tokenOut, router, adapter } = await fixture();
    const amountIn = ethers.parseEther("2");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t,
    ));
    await tokenIn.connect(user).approve(await permit2.getAddress(), amountIn);
    const permit = { nonce: 77, deadline: t + 90, signature: "0x1234" };
    await router.connect(user).swapExactInput(signed.request, signed.signature, permit);
    expect(await permit2.used(user.address, 77)).to.equal(true);
    expect(await tokenIn.allowance(user.address, await permit2.getAddress())).to.equal(0);
  });

  it("delivers native output and rolls back when the signed recipient rejects ETH", async function () {
    const { quoteSigner, user, recipient, tokenIn, router, adapter } = await fixture();
    const amountIn = ethers.parseEther("1");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), await tokenIn.getAddress(), ZERO, amountIn, recipient.address, t,
      { minAmountOut: ethers.parseEther("1.99") },
    ));
    await tokenIn.connect(user).approve(await router.getAddress(), ethers.parseEther("2"));
    const before = await ethers.provider.getBalance(recipient.address);
    await router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT);
    expect(await ethers.provider.getBalance(recipient.address) - before).to.equal(ethers.parseEther("1.997"));

    const Reject = await ethers.getContractFactory("RejectEther");
    const reject = await Reject.deploy();
    const rejected = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), await tokenIn.getAddress(), ZERO, amountIn, await reject.getAddress(), t,
      { minAmountOut: ethers.parseEther("1.99") },
    ));
    const userBefore = await tokenIn.balanceOf(user.address);
    await expect(router.connect(user).swapExactInput(rejected.request, rejected.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "TransferFailed");
    expect(await tokenIn.balanceOf(user.address)).to.equal(userBefore);
    expect(await router.consumedQuotes(rejected.request.quoteId)).to.equal(false);
  });

  it("does not let a reverting treasury block a native-input swap", async function () {
    const { owner, quoteSigner, user, recipient, tokenOut, router, adapter } = await fixture();
    const Reject = await ethers.getContractFactory("RejectEther");
    const reject = await Reject.deploy();
    await router.connect(owner).setTreasury(await reject.getAddress());
    const amountIn = ethers.parseEther("1");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), ZERO, await tokenOut.getAddress(), amountIn, recipient.address, t,
    ));
    await expect(router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT, { value: amountIn }))
      .to.emit(router, "SwapSettled");
    expect(await router.claimableFees(ZERO, await reject.getAddress())).to.equal(ethers.parseEther("0.0015"));
  });

  it("rejects fee-on-transfer input before routing and rolls quote state back", async function () {
    const { quoteSigner, user, recipient, tokenOut, router, adapter } = await fixture();
    const TaxToken = await ethers.getContractFactory("MockFeeOnTransferERC20");
    const taxed = await TaxToken.deploy("Taxed", "TAX", 100);
    const amountIn = ethers.parseEther("10");
    await taxed.mint(user.address, amountIn);
    await taxed.connect(user).approve(await router.getAddress(), amountIn);
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), await taxed.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t,
    ));
    await expect(router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "FeeOnTransferInputUnsupported");
    expect(await router.consumedQuotes(signed.request.quoteId)).to.equal(false);
    expect(await taxed.balanceOf(user.address)).to.equal(amountIn);
    expect(await taxed.balanceOf(await router.getAddress())).to.equal(0);
  });

  it("protects claim reserves while allowing the owner to rescue only excess funds", async function () {
    const { owner, quoteSigner, user, recipient, treasury, tokenIn, tokenOut, router, adapter } = await fixture();
    const amountIn = ethers.parseEther("10");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t,
    ));
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT);
    const reserved = ethers.parseEther("0.015");
    await tokenIn.mint(await router.getAddress(), ethers.parseEther("5"));
    await expect(router.connect(owner).rescueExcess(await tokenIn.getAddress(), owner.address, ethers.parseEther("5.000000000000000001")))
      .to.be.revertedWithCustomError(router, "InsufficientExcess");
    await router.connect(owner).rescueExcess(await tokenIn.getAddress(), owner.address, ethers.parseEther("5"));
    expect(await tokenIn.balanceOf(await router.getAddress())).to.equal(reserved);
    await router.connect(treasury).claimFees(await tokenIn.getAddress(), treasury.address);
    expect(await tokenIn.balanceOf(await router.getAddress())).to.equal(0);
  });

  it("protects native fee reserves while rescuing accidental ETH and supports pull claims", async function () {
    const { owner, quoteSigner, user, recipient, treasury, tokenOut, router, adapter } = await fixture();
    const amountIn = ethers.parseEther("1");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), ZERO, await tokenOut.getAddress(), amountIn, recipient.address, t,
    ));
    await router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT, { value: amountIn });
    const reserved = ethers.parseEther("0.0015");
    await owner.sendTransaction({ to: await router.getAddress(), value: ethers.parseEther("0.25") });
    await expect(router.connect(owner).rescueExcess(ZERO, owner.address, ethers.parseEther("0.250000000000000001")))
      .to.be.revertedWithCustomError(router, "InsufficientExcess");
    await router.connect(owner).rescueExcess(ZERO, owner.address, ethers.parseEther("0.25"));
    expect(await ethers.provider.getBalance(await router.getAddress())).to.equal(reserved);
    const before = await ethers.provider.getBalance(recipient.address);
    await router.connect(treasury).claimFees(ZERO, recipient.address);
    expect((await ethers.provider.getBalance(recipient.address)) - before).to.equal(reserved);
    expect(await ethers.provider.getBalance(await router.getAddress())).to.equal(0);
  });

  it("publishes immutable fee versions for zero fee, full rebate and dust", async function () {
    const { owner, router } = await fixture();
    await router.connect(owner).publishFeePolicy(2, 0, 0, true);
    await router.connect(owner).publishFeePolicy(3, 20, 10_000, true);
    expect(await router.previewFees(99, 2)).to.deep.equal([0n, 0n, 0n, 99n]);
    expect(await router.previewFees(100_000, 3)).to.deep.equal([200n, 200n, 0n, 100_000n]);
    expect(await router.previewFees(499, 1)).to.deep.equal([0n, 0n, 0n, 499n]);
    expect(await router.previewFees(500, 1)).to.deep.equal([1n, 0n, 1n, 499n]);
    await expect(router.connect(owner).publishFeePolicy(3, 20, 2_500, true)).to.be.revertedWithCustomError(router, "InvalidFeePolicy");
    await router.connect(owner).setActiveFeePolicy(3);
    await expect(router.connect(owner).setFeePolicyEnabled(3, false)).to.be.revertedWithCustomError(router, "InvalidFeePolicy");
  });

  it("rolls back consumed quote, fees and allowance when minimum output fails", async function () {
    const { quoteSigner, user, recipient, treasury, tokenIn, tokenOut, router, adapter } = await fixture();
    const amountIn = ethers.parseEther("1");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t,
      { minAmountOut: ethers.parseEther("100") },
    ));
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await expect(router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "OutputBelowMinimum");
    expect(await router.consumedQuotes(signed.request.quoteId)).to.equal(false);
    expect(await router.claimableFees(await tokenIn.getAddress(), treasury.address)).to.equal(0);
    expect(await tokenIn.allowance(await router.getAddress(), await adapter.getAddress())).to.equal(0);
  });

  it("blocks adapter reentrancy and rolls all state back", async function () {
    const { owner, quoteSigner, user, recipient, tokenIn, tokenOut, router } = await fixture();
    const Reentrant = await ethers.getContractFactory("ReentrantAdapter");
    const reentrant = await Reentrant.deploy(await router.getAddress());
    await router.connect(owner).configureAdapter(await reentrant.getAddress(), ethers.id("REENTRY"), true);
    const amountIn = ethers.parseEther("1");
    const t = await now();
    const signed = await signRequest(router, quoteSigner, user.address, makeRequest(
      await reentrant.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t,
    ));
    await reentrant.setReentryCall(router.interface.encodeFunctionData("swapExactInput", [signed.request, signed.signature, EMPTY_PERMIT]));
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await expect(router.connect(user).swapExactInput(signed.request, signed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "ReentrancyGuardReentrantCall");
    expect(await router.consumedQuotes(signed.request.quoteId)).to.equal(false);
  });

  it("rejects disabled adapters and malformed route continuity before moving funds", async function () {
    const { owner, quoteSigner, user, recipient, tokenIn, tokenMid, tokenOut, router, adapter, secondAdapter } = await fixture();
    const t = await now();
    const amountIn = ethers.parseEther("1");
    const malformed = makeRequest(await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t, {
      steps: [
        { adapter: await adapter.getAddress(), tokenIn: await tokenIn.getAddress(), tokenOut: await tokenMid.getAddress(), data: "0x" },
        { adapter: await secondAdapter.getAddress(), tokenIn: await tokenIn.getAddress(), tokenOut: await tokenOut.getAddress(), data: "0x" },
      ],
    });
    const signedMalformed = await signRequest(router, quoteSigner, user.address, malformed);
    await tokenIn.connect(user).approve(await router.getAddress(), amountIn);
    await expect(router.connect(user).swapExactInput(signedMalformed.request, signedMalformed.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "InvalidRoute");

    await router.connect(owner).configureAdapter(await adapter.getAddress(), ethers.id("MOCK_A"), false);
    const disabled = await signRequest(router, quoteSigner, user.address, makeRequest(
      await adapter.getAddress(), await tokenIn.getAddress(), await tokenOut.getAddress(), amountIn, recipient.address, t,
    ));
    await expect(router.connect(user).swapExactInput(disabled.request, disabled.signature, EMPTY_PERMIT))
      .to.be.revertedWithCustomError(router, "InvalidRoute");
  });

  it("supports an emergency guardian, signer rotation and two-step ownership", async function () {
    const { owner, user, attacker, router } = await fixture();
    await expect(router.connect(attacker).pause()).to.be.revertedWithCustomError(router, "UnauthorizedPauseGuardian");
    await router.connect(owner).setPauseGuardian(attacker.address);
    await router.connect(attacker).pause();
    expect(await router.paused()).to.equal(true);
    await expect(router.connect(attacker).unpause()).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    await router.connect(owner).unpause();
    await expect(router.connect(user).setPauseGuardian(user.address)).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    await router.connect(owner).setQuoteSigner(attacker.address);
    expect(await router.quoteSigner()).to.equal(attacker.address);
    await router.connect(owner).transferOwnership(attacker.address);
    expect(await router.pendingOwner()).to.equal(attacker.address);
    await router.connect(attacker).acceptOwnership();
    expect(await router.owner()).to.equal(attacker.address);
  });
});
