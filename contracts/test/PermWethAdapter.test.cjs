const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO = ethers.ZeroAddress;

describe("PermWethAdapter", function () {
  async function fixture() {
    const [deployer, routerCaller, attacker, recipient] = await ethers.getSigners();
    const WETH = await ethers.getContractFactory("MockWETH");
    const weth = await WETH.deploy();
    const Token = await ethers.getContractFactory("MockERC20");
    const other = await Token.deploy("Other", "OTH", 18);
    const Adapter = await ethers.getContractFactory("PermWethAdapter");
    const adapter = await Adapter.deploy(routerCaller.address, await weth.getAddress());
    return { deployer, routerCaller, attacker, recipient, weth, other, adapter };
  }

  it("wraps ETH 1:1 and delivers WETH to the recipient", async function () {
    const { routerCaller, recipient, weth, adapter } = await fixture();
    const amount = ethers.parseEther("0.25");
    await expect(adapter.connect(routerCaller).swapExactInput(ZERO, await weth.getAddress(), amount, recipient.address, "0x", { value: amount }))
      .to.emit(adapter, "WethStepExecuted").withArgs(await adapter.WRAP_ROUTE_ID(), recipient.address, amount);
    expect(await weth.balanceOf(recipient.address)).to.equal(amount);
    expect(await weth.balanceOf(await adapter.getAddress())).to.equal(0n);
    expect(await ethers.provider.getBalance(await adapter.getAddress())).to.equal(0n);
  });

  it("unwraps WETH 1:1 and delivers ETH to the recipient", async function () {
    const { routerCaller, recipient, weth, adapter } = await fixture();
    const amount = ethers.parseEther("0.4");
    await weth.connect(routerCaller).deposit({ value: amount });
    await weth.connect(routerCaller).approve(await adapter.getAddress(), amount);
    const before = await ethers.provider.getBalance(recipient.address);
    await expect(adapter.connect(routerCaller).swapExactInput(await weth.getAddress(), ZERO, amount, recipient.address, "0x"))
      .to.emit(adapter, "WethStepExecuted").withArgs(await adapter.UNWRAP_ROUTE_ID(), recipient.address, amount);
    expect((await ethers.provider.getBalance(recipient.address)) - before).to.equal(amount);
    expect(await weth.balanceOf(await adapter.getAddress())).to.equal(0n);
  });

  it("returns amountOut == amountIn, no hook and a fixed route id (static call)", async function () {
    const { routerCaller, recipient, weth, adapter } = await fixture();
    const amount = 12345n;
    const [amountOut, hook, routeId] = await adapter.connect(routerCaller).swapExactInput.staticCall(
      ZERO, await weth.getAddress(), amount, recipient.address, "0x", { value: amount },
    );
    expect(amountOut).to.equal(amount);
    expect(hook).to.equal(ZERO);
    expect(routeId).to.equal(ethers.id("PERM_WETH_WRAP_V1"));
  });

  it("rejects every caller except the PermRouter", async function () {
    const { attacker, recipient, weth, adapter } = await fixture();
    await expect(adapter.connect(attacker).swapExactInput(ZERO, await weth.getAddress(), 1n, recipient.address, "0x", { value: 1n }))
      .to.be.revertedWithCustomError(adapter, "InvalidCaller");
  });

  it("rejects pairs other than ETH<->WETH, route data, zero amounts and wrong msg.value", async function () {
    const { routerCaller, recipient, weth, other, adapter } = await fixture();
    const wethAddress = await weth.getAddress();
    await expect(adapter.connect(routerCaller).swapExactInput(ZERO, await other.getAddress(), 1n, recipient.address, "0x", { value: 1n }))
      .to.be.revertedWithCustomError(adapter, "InvalidPair");
    await expect(adapter.connect(routerCaller).swapExactInput(wethAddress, wethAddress, 1n, recipient.address, "0x"))
      .to.be.revertedWithCustomError(adapter, "InvalidPair");
    await expect(adapter.connect(routerCaller).swapExactInput(ZERO, wethAddress, 1n, recipient.address, "0x01", { value: 1n }))
      .to.be.revertedWithCustomError(adapter, "InvalidRouteData");
    await expect(adapter.connect(routerCaller).swapExactInput(ZERO, wethAddress, 0n, recipient.address, "0x"))
      .to.be.revertedWithCustomError(adapter, "InvalidAmount");
    await expect(adapter.connect(routerCaller).swapExactInput(ZERO, wethAddress, 2n, recipient.address, "0x", { value: 1n }))
      .to.be.revertedWithCustomError(adapter, "InvalidNativeValue");
    await weth.connect(routerCaller).deposit({ value: 5n });
    await weth.connect(routerCaller).approve(await adapter.getAddress(), 5n);
    await expect(adapter.connect(routerCaller).swapExactInput(wethAddress, ZERO, 5n, recipient.address, "0x", { value: 1n }))
      .to.be.revertedWithCustomError(adapter, "InvalidNativeValue");
  });

  it("refuses plain ETH transfers from anything but WETH", async function () {
    const { attacker, adapter } = await fixture();
    await expect(attacker.sendTransaction({ to: await adapter.getAddress(), value: 1n }))
      .to.be.revertedWithCustomError(adapter, "InvalidCaller");
  });

  it("works as a PermRouter step: ETH -> WETH settles with exact fee accounting", async function () {
    const [owner, quoteSigner, user, treasury] = await ethers.getSigners();
    const WETH = await ethers.getContractFactory("MockWETH");
    const weth = await WETH.deploy();
    const Permit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await Permit2.deploy();
    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, await permit2.getAddress());
    const Adapter = await ethers.getContractFactory("PermWethAdapter");
    const adapter = await Adapter.deploy(await router.getAddress(), await weth.getAddress());
    await router.configureAdapter(await adapter.getAddress(), ethers.id("WETH_WRAP"), true);

    const coder = ethers.AbiCoder.defaultAbiCoder();
    const routeData = coder.encode(
      ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
      [[{ adapter: await adapter.getAddress(), tokenIn: ZERO, tokenOut: await weth.getAddress(), data: "0x" }]],
    );
    const amountIn = ethers.parseEther("1");
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const domain = { name: "Perm", version: "2", chainId, verifyingContract: await router.getAddress() };
    const types = { PermQuote: [
      { name: "account", type: "address" }, { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" },
      { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }, { name: "quotedAt", type: "uint64" },
      { name: "policyVersion", type: "uint32" }, { name: "chainId", type: "uint256" }, { name: "referrer", type: "address" },
      { name: "routeHash", type: "bytes32" },
    ] };
    const net = amountIn - amountIn * 15n / 10_000n;
    const value = {
      account: user.address, tokenIn: ZERO, tokenOut: await weth.getAddress(), amountIn, minAmountOut: net, gasEstimate: 100_000n,
      recipient: user.address, deadline: now + 90, quotedAt: now, policyVersion: 1, chainId, referrer: ZERO, routeHash: ethers.keccak256(routeData),
    };
    const request = { ...value, routeData, quoteId: ethers.TypedDataEncoder.hash(domain, types, value) };
    delete request.account;
    delete request.routeHash;
    const signature = await quoteSigner.signTypedData(domain, types, value);
    await router.connect(user).swapExactInput(request, signature, { nonce: 0, deadline: 0, signature: "0x" }, { value: amountIn });
    // 0.20% gross fee, 25% of it rebated => 0.15% net retained; the rest is wrapped 1:1.
    expect(await weth.balanceOf(user.address)).to.equal(net);
    expect(await router.claimableFees(ZERO, treasury.address)).to.equal(amountIn * 15n / 10_000n);
  });
});
