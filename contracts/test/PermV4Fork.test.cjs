const { expect } = require("chai");
const { ethers } = require("hardhat");

const RUN = process.env.RUN_FORK_TESTS === "1";
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const NVDA = "0x3ab049897b0697BdA766D8730fe1F955c9c103F0";
const ZERO = ethers.ZeroAddress;
const POOL = { currency0: ZERO, currency1: NVDA, fee: 3000, tickSpacing: 60, hooks: ZERO };
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };

function expectGasCalibration(receipt, quoted) {
  const delta = quoted > receipt.gasUsed ? quoted - receipt.gasUsed : receipt.gasUsed - quoted;
  expect(Number(delta * 10_000n / receipt.gasUsed)).to.be.at.most(3_000);
}

async function signedRequest(router, signer, account, values) {
  const request = { gasEstimate: 330_000n, ...values, quoteId: ethers.ZeroHash };
  const domain = { name: "Perm", version: "2", chainId: 46630, verifyingContract: await router.getAddress() };
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
    minAmountOut: request.minAmountOut, gasEstimate: request.gasEstimate, recipient: request.recipient, deadline: request.deadline,
    quotedAt: request.quotedAt, policyVersion: request.policyVersion, chainId: request.chainId,
    referrer: request.referrer, routeHash: ethers.keccak256(request.routeData),
  };
  return {
    request: { ...request, quoteId: ethers.TypedDataEncoder.hash(domain, types, value) },
    signature: await signer.signTypedData(domain, types, value),
  };
}

describe(RUN ? "PermV4Adapter · Robinhood testnet fork" : "PermV4Adapter fork (skipped)", function () {
  if (!RUN) {
    it.skip("set RUN_FORK_TESTS=1 to run against the current official Robinhood testnet state", function () {});
    return;
  }

  it("executes a real no-hook v4 pool in both directions with signed gas calibration and rebate", async function () {
    const [owner, quoteSigner, user, recipient, treasury] = await ethers.getSigners();
    expect((await ethers.provider.getNetwork()).chainId).to.equal(46630n);
    expect((await ethers.provider.getCode(POOL_MANAGER)).length).to.be.greaterThan(1000);
    expect((await ethers.provider.getCode(PERMIT2)).length).to.be.greaterThan(1000);

    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, PERMIT2);
    const Adapter = await ethers.getContractFactory("PermV4Adapter");
    const adapter = await Adapter.deploy(owner.address, await router.getAddress(), POOL_MANAGER);
    await router.configureAdapter(await adapter.getAddress(), ethers.id("UNISWAP_V4_DIRECT"), true);

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const v4Data = coder.encode(
      ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
      [POOL, "0x"],
    );
    const route = (tokenIn, tokenOut) => coder.encode(
      ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
      [[{ adapter: adapter.target, tokenIn, tokenOut, data: v4Data }]],
    );

    const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
    const amountIn = ethers.parseEther("0.001");
    const buy = await signedRequest(router, quoteSigner, user.address, {
      tokenIn: ZERO, tokenOut: NVDA, amountIn, minAmountOut: 1n, recipient: user.address,
      deadline: quotedAt + 90, quotedAt, policyVersion: 1, chainId: 46630,
      referrer: ZERO, routeData: route(ZERO, NVDA),
    });
    const buyTransaction = await router.connect(user).swapExactInput(buy.request, buy.signature, EMPTY_PERMIT, { value: amountIn });
    await expect(buyTransaction).to.emit(router, "SwapSettled");
    expectGasCalibration(await buyTransaction.wait(), buy.request.gasEstimate);
    const nvda = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"], NVDA);
    const bought = await nvda.balanceOf(user.address);
    expect(bought).to.be.greaterThan(0n);
    expect(await router.claimableFees(ZERO, treasury.address)).to.equal(ethers.parseEther("0.0000015"));

    await nvda.connect(user).approve(PERMIT2, bought);
    const quotedAt2 = (await ethers.provider.getBlock("latest")).timestamp;
    const nativeBefore = await ethers.provider.getBalance(recipient.address);
    const sell = await signedRequest(router, quoteSigner, user.address, {
      tokenIn: NVDA, tokenOut: ZERO, amountIn: bought, minAmountOut: 1n, recipient: recipient.address,
      deadline: quotedAt2 + 90, quotedAt: quotedAt2, policyVersion: 1, chainId: 46630,
      referrer: ZERO, routeData: route(NVDA, ZERO),
    });
    const permitNonce = 987654321n;
    const permitDeadline = BigInt(quotedAt2 + 90);
    const permitSignature = await user.signTypedData(
      { name: "Permit2", chainId: 46630, verifyingContract: PERMIT2 },
      {
        TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
        PermitTransferFrom: [
          { name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
        ],
      },
      { permitted: { token: NVDA, amount: bought }, spender: await router.getAddress(), nonce: permitNonce, deadline: permitDeadline },
    );
    const sellTransaction = await router.connect(user).swapExactInput(sell.request, sell.signature, {
      nonce: permitNonce, deadline: permitDeadline, signature: permitSignature,
    });
    await expect(sellTransaction).to.emit(router, "SwapSettled");
    expectGasCalibration(await sellTransaction.wait(), sell.request.gasEstimate);
    expect((await ethers.provider.getBalance(recipient.address)) - nativeBefore).to.be.greaterThan(0n);
    expect(await nvda.balanceOf(user.address)).to.equal(0n);
  });
});
