const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO = ethers.ZeroAddress;

function routeData(currency0, currency1, hook = ZERO, hookData = "0x") {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
    [[currency0, currency1, 3000, 60, hook], hookData],
  );
}

describe("PermV4Adapter security boundaries", function () {
  async function fixture() {
    const [owner, routerCaller, attacker, recipient, manager] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const token0 = await Token.deploy("Token zero", "T0", 18);
    const token1 = await Token.deploy("Token one", "T1", 18);
    const Adapter = await ethers.getContractFactory("PermV4Adapter");
    const adapter = await Adapter.deploy(owner.address, routerCaller.address, manager.address);
    return { owner, routerCaller, attacker, recipient, manager, token0, token1, adapter };
  }

  it("accepts calls only from its immutable Perm router", async function () {
    const { attacker, recipient, token0, token1, adapter } = await fixture();
    const data = routeData(await token0.getAddress(), await token1.getAddress());
    await expect(adapter.connect(attacker).swapExactInput(await token0.getAddress(), await token1.getAddress(), 1, recipient.address, data))
      .to.be.revertedWithCustomError(adapter, "InvalidCaller");
  });

  it("rejects hook calldata for a no-hook pool", async function () {
    const { routerCaller, recipient, token0, token1, adapter } = await fixture();
    const data = routeData(await token0.getAddress(), await token1.getAddress(), ZERO, "0x1234");
    await expect(adapter.connect(routerCaller).swapExactInput(await token0.getAddress(), await token1.getAddress(), 1, recipient.address, data))
      .to.be.revertedWithCustomError(adapter, "HookDataUnsupported");
  });

  it("pins reviewed hooks to their runtime codehash", async function () {
    const { owner, routerCaller, attacker, recipient, token0, token1, adapter } = await fixture();
    const hook = await token0.getAddress();
    const data = routeData(await token0.getAddress(), await token1.getAddress(), hook);
    await expect(adapter.connect(routerCaller).swapExactInput(await token0.getAddress(), await token1.getAddress(), 1, recipient.address, data))
      .to.be.revertedWithCustomError(adapter, "HookNotVerified").withArgs(hook);
    await expect(adapter.connect(attacker).setVerifiedHook(hook, true))
      .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount").withArgs(attacker.address);
    await expect(adapter.connect(owner).setVerifiedHook(ZERO, true)).to.be.revertedWithCustomError(adapter, "InvalidPair");
    await expect(adapter.connect(owner).setVerifiedHook(attacker.address, true))
      .to.be.revertedWithCustomError(adapter, "HookNotVerified").withArgs(attacker.address);
    await adapter.connect(owner).setVerifiedHook(hook, true);
    const expected = ethers.keccak256(await ethers.provider.getCode(hook));
    expect(await adapter.verifiedHookCodehashes(hook)).to.equal(expected);
    expect(await adapter.verifiedHooks(hook)).to.equal(true);
    await adapter.connect(owner).setVerifiedHook(hook, false);
    expect(await adapter.verifiedHooks(hook)).to.equal(false);
  });

  it("rejects route keys that do not exactly match the requested token pair", async function () {
    const { routerCaller, recipient, token0, token1, adapter } = await fixture();
    const unrelated = recipient.address;
    const data = routeData(await token0.getAddress(), unrelated);
    await expect(adapter.connect(routerCaller).swapExactInput(await token0.getAddress(), await token1.getAddress(), 1, recipient.address, data))
      .to.be.revertedWithCustomError(adapter, "InvalidPair");
  });

  it("lets only governance recover accidentally stranded ERC-20 and native balances", async function () {
    const { owner, attacker, recipient, token0, adapter } = await fixture();
    const amount = ethers.parseEther("2");
    const adapterAddress = await adapter.getAddress();
    await token0.mint(adapterAddress, amount);
    await expect(adapter.connect(attacker).rescueExcess(await token0.getAddress(), recipient.address, amount))
      .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount").withArgs(attacker.address);
    await expect(adapter.connect(owner).rescueExcess(await token0.getAddress(), ZERO, amount))
      .to.be.revertedWithCustomError(adapter, "InvalidPair");
    await expect(adapter.connect(owner).rescueExcess(await token0.getAddress(), recipient.address, amount))
      .to.emit(adapter, "ExcessRescued").withArgs(await token0.getAddress(), recipient.address, amount);
    expect(await token0.balanceOf(recipient.address)).to.equal(amount);

    const nativeAmount = ethers.parseEther("1");
    await ethers.provider.send("hardhat_setBalance", [adapterAddress, ethers.toBeHex(nativeAmount)]);
    const RejectEther = await ethers.getContractFactory("RejectEther");
    const rejector = await RejectEther.deploy();
    await expect(adapter.connect(owner).rescueExcess(ZERO, await rejector.getAddress(), nativeAmount))
      .to.be.revertedWithCustomError(adapter, "TransferFailed");
    const before = await ethers.provider.getBalance(recipient.address);
    await expect(adapter.connect(owner).rescueExcess(ZERO, recipient.address, nativeAmount))
      .to.emit(adapter, "ExcessRescued").withArgs(ZERO, recipient.address, nativeAmount);
    expect((await ethers.provider.getBalance(recipient.address)) - before).to.equal(nativeAmount);
  });

  it("rejects native value mismatches before unlocking the PoolManager", async function () {
    const { routerCaller, recipient, token0, adapter } = await fixture();
    const data = routeData(ZERO, await token0.getAddress());
    await expect(adapter.connect(routerCaller).swapExactInput(ZERO, await token0.getAddress(), 2, recipient.address, data, { value: 1 }))
      .to.be.revertedWithCustomError(adapter, "InvalidNativeValue");
  });
});
