const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO = ethers.ZeroAddress;
const data = (fee = 3000, limit = 0) => ethers.AbiCoder.defaultAbiCoder().encode(["uint24", "uint160"], [fee, limit]);

describe("PermV3Adapter", function () {
  async function fixture() {
    const [owner, routerCaller, attacker, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const token0 = await Token.deploy("Token zero", "T0", 18);
    const token1 = await Token.deploy("Token one", "T1", 18);
    const WETH = await ethers.getContractFactory("MockWETH");
    const weth = await WETH.deploy();
    await weth.connect(owner).deposit({ value: ethers.parseEther("20") });
    const SwapRouter = await ethers.getContractFactory("MockSwapRouter02");
    const swapRouter = await SwapRouter.deploy();
    const Adapter = await ethers.getContractFactory("PermV3Adapter");
    const adapter = await Adapter.deploy(owner.address, routerCaller.address, await swapRouter.getAddress(), await weth.getAddress());
    return { owner, routerCaller, attacker, recipient, token0, token1, weth, swapRouter, adapter };
  }

  it("executes exact ERC20 input and clears the external-router allowance", async function () {
    const { routerCaller, recipient, token0, token1, swapRouter, adapter } = await fixture();
    const amount = ethers.parseEther("2");
    await token0.mint(routerCaller.address, amount);
    await token0.connect(routerCaller).approve(await adapter.getAddress(), amount);
    const tx = await adapter.connect(routerCaller).swapExactInput(await token0.getAddress(), await token1.getAddress(), amount, recipient.address, data());
    await expect(tx).to.emit(adapter, "V3StepExecuted");
    expect(await token1.balanceOf(recipient.address)).to.equal(ethers.parseEther("4"));
    expect(await token0.allowance(await adapter.getAddress(), await swapRouter.getAddress())).to.equal(0);
  });

  it("wraps native input and unwraps native output", async function () {
    const { routerCaller, recipient, token0, adapter } = await fixture();
    const amount = ethers.parseEther("1");
    await adapter.connect(routerCaller).swapExactInput(ZERO, await token0.getAddress(), amount, recipient.address, data(), { value: amount });
    expect(await token0.balanceOf(recipient.address)).to.equal(ethers.parseEther("2"));

    await token0.mint(routerCaller.address, amount);
    await token0.connect(routerCaller).approve(await adapter.getAddress(), amount);
    const before = await ethers.provider.getBalance(recipient.address);
    await adapter.connect(routerCaller).swapExactInput(await token0.getAddress(), ZERO, amount, recipient.address, data());
    expect((await ethers.provider.getBalance(recipient.address)) - before).to.equal(ethers.parseEther("2"));
  });

  it("lets only governance recover accidentally stranded ERC-20 and native balances", async function () {
    const { owner, attacker, recipient, token0, adapter } = await fixture();
    const amount = ethers.parseEther("2");
    const adapterAddress = await adapter.getAddress();
    await token0.mint(adapterAddress, amount);
    await expect(adapter.connect(attacker).rescueExcess(await token0.getAddress(), recipient.address, amount))
      .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount").withArgs(attacker.address);
    await expect(adapter.connect(owner).rescueExcess(await token0.getAddress(), recipient.address, amount))
      .to.emit(adapter, "ExcessRescued").withArgs(await token0.getAddress(), recipient.address, amount);
    expect(await token0.balanceOf(recipient.address)).to.equal(amount);

    const nativeAmount = ethers.parseEther("1");
    await ethers.provider.send("hardhat_setBalance", [adapterAddress, ethers.toBeHex(nativeAmount)]);
    const before = await ethers.provider.getBalance(recipient.address);
    await expect(adapter.connect(owner).rescueExcess(ZERO, recipient.address, nativeAmount))
      .to.emit(adapter, "ExcessRescued").withArgs(ZERO, recipient.address, nativeAmount);
    expect((await ethers.provider.getBalance(recipient.address)) - before).to.equal(nativeAmount);
  });

  it("rejects untrusted callers, unsupported fees and custom price limits", async function () {
    const { routerCaller, attacker, recipient, token0, token1, adapter } = await fixture();
    await expect(adapter.connect(attacker).swapExactInput(await token0.getAddress(), await token1.getAddress(), 1, recipient.address, data()))
      .to.be.revertedWithCustomError(adapter, "InvalidCaller");
    await expect(adapter.connect(routerCaller).swapExactInput(await token0.getAddress(), await token1.getAddress(), 1, recipient.address, data(250)))
      .to.be.revertedWithCustomError(adapter, "InvalidFee");
    await expect(adapter.connect(routerCaller).swapExactInput(await token0.getAddress(), await token1.getAddress(), 1, recipient.address, data(3000, 1)))
      .to.be.revertedWithCustomError(adapter, "InvalidRouteData");
  });
});
