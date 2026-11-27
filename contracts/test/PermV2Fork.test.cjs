const { expect } = require("chai");
const { ethers } = require("hardhat");

const RUN = process.env.RUN_FORK_TESTS === "1";
const FACTORY = "0x6C4cA684D84761E193cB23d62b22fA83bB35E54E";
const PAIR = "0x3Ca1d41f238949F3c033d5C35c5F01A43036a288";
const WETH = "0x33e4191705c386532ba27cBF171Db86919200B94";
const TSLA = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ZERO = ethers.ZeroAddress;
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };

async function signedRequest(router, signer, account, values) {
  const request = { gasEstimate: 340_000n, ...values, quoteId: ethers.ZeroHash };
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
    minAmountOut: request.minAmountOut, gasEstimate: request.gasEstimate, recipient: request.recipient,
    deadline: request.deadline, quotedAt: request.quotedAt, policyVersion: request.policyVersion, chainId: request.chainId,
    referrer: request.referrer, routeHash: ethers.keccak256(request.routeData),
  };
  return {
    request: { ...request, quoteId: ethers.TypedDataEncoder.hash(domain, types, value) },
    signature: await signer.signTypedData(domain, types, value),
  };
}

describe(RUN ? "PermV2Adapter · reviewed testnet V2 fork" : "PermV2Adapter fork (skipped)", function () {
  if (!RUN) {
    it.skip("set RUN_FORK_TESTS=1 to run against the reviewed third-party V2 pair", function () {});
    return;
  }

  it("executes a native-to-TSLA swap through the pinned source-exact V2 pair", async function () {
    const [owner, quoteSigner, user, treasury] = await ethers.getSigners();
    expect((await ethers.provider.getNetwork()).chainId).to.equal(46630n);
    for (const target of [FACTORY, PAIR, WETH, TSLA, PERMIT2]) expect((await ethers.provider.getCode(target)).length).to.be.greaterThan(100);
    const pairCodehash = ethers.keccak256(await ethers.provider.getCode(PAIR));
    expect(pairCodehash).to.equal("0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5");

    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, PERMIT2);
    const Adapter = await ethers.getContractFactory("PermV2Adapter");
    const adapter = await Adapter.deploy(owner.address, await router.getAddress(), FACTORY, WETH, pairCodehash);
    await router.configureAdapter(await adapter.getAddress(), ethers.id("REVIEWED_V2_THIRD_PARTY"), true);

    const amountIn = 10_000_000_000n;
    const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
    const routeData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
      [[{ adapter: await adapter.getAddress(), tokenIn: ZERO, tokenOut: TSLA, data: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [PAIR]) }]],
    );
    const quote = await signedRequest(router, quoteSigner, user.address, {
      tokenIn: ZERO, tokenOut: TSLA, amountIn, minAmountOut: 1n, recipient: user.address,
      deadline: quotedAt + 90, quotedAt, policyVersion: 1, chainId: 46630,
      referrer: ZERO, routeData,
    });
    const token = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], TSLA);
    const before = await token.balanceOf(user.address);
    const transaction = await router.connect(user).swapExactInput(quote.request, quote.signature, EMPTY_PERMIT, { value: amountIn });
    await expect(transaction).to.emit(router, "RouteStepSettled");
    expect(await token.balanceOf(user.address)).to.be.greaterThan(before);
  });
});
