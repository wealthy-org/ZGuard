const { expect } = require("chai");
const { ethers } = require("hardhat");

const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };
const ROUTE_TYPES = ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"];
const TYPES = {
  PermQuote: [
    { name: "account", type: "address" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" }, { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" }, { name: "quotedAt", type: "uint64" },
    { name: "policyVersion", type: "uint32" }, { name: "chainId", type: "uint256" },
    { name: "referrer", type: "address" }, { name: "routeHash", type: "bytes32" },
  ],
};

function nextRandom(state) {
  let x = state & ((1n << 128n) - 1n);
  x ^= x << 13n;
  x ^= x >> 7n;
  x ^= x << 17n;
  return x & ((1n << 128n) - 1n);
}

async function deployFixture() {
  const [owner, quoteSigner, user, recipient, treasury, referrer] = await ethers.getSigners();
  const Permit2 = await ethers.getContractFactory("MockPermit2");
  const permit2 = await Permit2.deploy();
  const Token = await ethers.getContractFactory("MockERC20");
  const tokenIn = await Token.deploy("Input", "IN", 18);
  const tokenOut = await Token.deploy("Output", "OUT", 18);
  const Router = await ethers.getContractFactory("PermRouter");
  const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, await permit2.getAddress());
  const Adapter = await ethers.getContractFactory("MockAdapter");
  const adapter = await Adapter.deploy(await router.getAddress(), 2, 1);
  await router.configureAdapter(await adapter.getAddress(), ethers.id("FUZZ_ADAPTER"), true);
  await router.configureReferral(referrer.address, 3_333);
  await tokenIn.mint(user.address, ethers.parseEther("100000"));
  await tokenOut.mint(await adapter.getAddress(), ethers.parseEther("200000"));
  await tokenIn.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
  return { quoteSigner, user, recipient, treasury, referrer, tokenIn, tokenOut, router, adapter };
}

async function signedSwap(f, amountIn) {
  const block = await ethers.provider.getBlock("latest");
  const routeData = ethers.AbiCoder.defaultAbiCoder().encode(ROUTE_TYPES, [[{
    adapter: await f.adapter.getAddress(), tokenIn: await f.tokenIn.getAddress(), tokenOut: await f.tokenOut.getAddress(), data: "0x",
  }]]);
  const request = {
    tokenIn: await f.tokenIn.getAddress(), tokenOut: await f.tokenOut.getAddress(), amountIn,
    minAmountOut: 1n, gasEstimate: 500_000n, recipient: f.recipient.address, deadline: block.timestamp + 90,
    quotedAt: block.timestamp, policyVersion: 1, chainId: 31337,
    quoteId: ethers.ZeroHash, referrer: f.referrer.address, routeData,
  };
  const domain = { name: "Perm", version: "2", chainId: 31337, verifyingContract: await f.router.getAddress() };
  const message = {
    account: f.user.address, tokenIn: request.tokenIn, tokenOut: request.tokenOut,
    amountIn, minAmountOut: 1n, gasEstimate: request.gasEstimate, recipient: request.recipient, deadline: request.deadline,
    quotedAt: request.quotedAt, policyVersion: 1, chainId: 31337,
    referrer: request.referrer, routeHash: ethers.keccak256(routeData),
  };
  const quoteId = ethers.TypedDataEncoder.hash(domain, TYPES, message);
  const signature = await f.quoteSigner.signTypedData(domain, TYPES, message);
  return f.router.connect(f.user).swapExactInput({ ...request, quoteId }, signature, EMPTY_PERMIT);
}

describe("PermRouter v2 fuzz and invariants", function () {
  it("fuzzes integer fee settlement over 1,024 deterministic uint127 inputs", async function () {
    const { router } = await deployFixture();
    const cap = (1n << 127n) - 1n;
    let state = 0x6a09e667f3bcc909n;
    for (let i = 0; i < 1_024; i += 1) {
      state = nextRandom(state + BigInt(i + 1));
      const amount = state % cap;
      const [gross, rebate, net, routed] = await router.previewFees(amount, 1);
      expect(gross).to.equal(amount * 20n / 10_000n);
      expect(rebate).to.equal(gross * 2_500n / 10_000n);
      expect(net).to.equal(gross - rebate);
      expect(routed + net).to.equal(amount);
      expect(rebate).to.be.at.most(gross);
      expect(routed).to.be.at.most(amount);
    }
  });

  it("preserves fee conservation, referral split, reserves and quote consumption across randomized swaps", async function () {
    const f = await deployFixture();
    let state = 0xbb67ae8584caa73bn;
    let expectedReferral = 0n;
    let expectedTreasury = 0n;
    for (let i = 0; i < 24; i += 1) {
      state = nextRandom(state + BigInt(i + 17));
      const amount = state % ethers.parseEther("100") + BigInt(i + 1);
      const receipt = await (await signedSwap(f, amount)).wait();
      const event = receipt.logs.map((log) => {
        try { return f.router.interface.parseLog(log); } catch { return null; }
      }).find((entry) => entry?.name === "SwapSettled");
      expect(event, "SwapSettled event").not.to.equal(undefined);
      const args = event.args;
      expect(args.routedInput + args.netFee).to.equal(args.amountIn);
      expect(args.rebate + args.netFee).to.equal(args.grossFee);
      expect(args.referralFee + args.treasuryFee).to.equal(args.netFee);
      expect(args.amountIn).to.equal(amount);
      expect(await f.router.consumedQuotes(args.quoteId)).to.equal(true);
      expectedReferral += args.referralFee;
      expectedTreasury += args.treasuryFee;
    }
    const token = await f.tokenIn.getAddress();
    expect(await f.router.claimableFees(token, f.referrer.address)).to.equal(expectedReferral);
    expect(await f.router.claimableFees(token, f.treasury.address)).to.equal(expectedTreasury);
    expect(await f.router.totalClaimableFees(token)).to.equal(expectedReferral + expectedTreasury);
    expect(await f.tokenIn.balanceOf(await f.router.getAddress())).to.equal(expectedReferral + expectedTreasury);
  });
});
