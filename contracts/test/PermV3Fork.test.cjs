const { expect } = require("chai");
const { ethers } = require("hardhat");

const RUN = process.env.RUN_FORK_TESTS === "1";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const SWAP_ROUTER = "0x3Ce954107b1A675826B33bF23060Dd655e3758fE";
const WETH = "0x33e4191705c386532ba27cBF171Db86919200B94";
const TSLA = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";
const ZERO = ethers.ZeroAddress;
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };

function expectGasCalibration(receipt, quoted) {
  const delta = quoted > receipt.gasUsed ? quoted - receipt.gasUsed : receipt.gasUsed - quoted;
  expect(Number(delta * 10_000n / receipt.gasUsed)).to.be.at.most(3_000);
}

async function signedRequest(router, signer, account, values) {
  const request = { gasEstimate: 350_000n, ...values, quoteId: ethers.ZeroHash };
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

describe(RUN ? "PermV3Adapter · Synthra testnet fork" : "PermV3Adapter fork (skipped)", function () {
  if (!RUN) {
    it.skip("set RUN_FORK_TESTS=1 to run against current Synthra state", function () {});
    return;
  }

  it("executes native-to-TSLA and Permit2-backed TSLA-to-native with signed gas calibration", async function () {
    const [owner, quoteSigner, user, recipient, treasury] = await ethers.getSigners();
    expect((await ethers.provider.getNetwork()).chainId).to.equal(46630n);
    for (const target of [PERMIT2, SWAP_ROUTER, WETH, TSLA]) expect((await ethers.provider.getCode(target)).length).to.be.greaterThan(100);

    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, PERMIT2);
    const Adapter = await ethers.getContractFactory("PermV3Adapter");
    const adapter = await Adapter.deploy(owner.address, await router.getAddress(), SWAP_ROUTER, WETH);
    await router.configureAdapter(await adapter.getAddress(), ethers.id("SYNTHRA_V3"), true);

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const adapterData = coder.encode(["uint24", "uint160"], [3000, 0]);
    const route = (tokenIn, tokenOut) => coder.encode(
      ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
      [[{ adapter: adapter.target, tokenIn, tokenOut, data: adapterData }]],
    );
    const amountIn = ethers.parseEther("0.001");
    const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
    const buy = await signedRequest(router, quoteSigner, user.address, {
      tokenIn: ZERO, tokenOut: TSLA, amountIn, minAmountOut: 1n, recipient: user.address,
      deadline: quotedAt + 90, quotedAt, policyVersion: 1, chainId: 46630,
      referrer: ZERO, routeData: route(ZERO, TSLA),
    });
    const buyTransaction = await router.connect(user).swapExactInput(buy.request, buy.signature, EMPTY_PERMIT, { value: amountIn });
    await expect(buyTransaction).to.emit(router, "SwapSettled");
    expectGasCalibration(await buyTransaction.wait(), buy.request.gasEstimate);

    const tsla = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"], TSLA);
    const bought = await tsla.balanceOf(user.address);
    expect(bought).to.be.greaterThan(0n);
    await tsla.connect(user).approve(PERMIT2, bought);

    const quotedAt2 = (await ethers.provider.getBlock("latest")).timestamp;
    const sell = await signedRequest(router, quoteSigner, user.address, {
      tokenIn: TSLA, tokenOut: ZERO, amountIn: bought, minAmountOut: 1n, recipient: recipient.address,
      deadline: quotedAt2 + 90, quotedAt: quotedAt2, policyVersion: 1, chainId: 46630,
      referrer: ZERO, routeData: route(TSLA, ZERO),
    });
    const permitNonce = 123456789n;
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
      { permitted: { token: TSLA, amount: bought }, spender: await router.getAddress(), nonce: permitNonce, deadline: permitDeadline },
    );
    const before = await ethers.provider.getBalance(recipient.address);
    const sellTransaction = await router.connect(user).swapExactInput(sell.request, sell.signature, {
      nonce: permitNonce, deadline: permitDeadline, signature: permitSignature,
    });
    await expect(sellTransaction).to.emit(router, "SwapSettled");
    expectGasCalibration(await sellTransaction.wait(), sell.request.gasEstimate);
    expect((await ethers.provider.getBalance(recipient.address)) - before).to.be.greaterThan(0n);
    expect(await tsla.balanceOf(user.address)).to.equal(0n);
    expect(await tsla.allowance(user.address, PERMIT2)).to.equal(0n);
  });
});
