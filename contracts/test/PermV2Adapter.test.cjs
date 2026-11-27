const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO = ethers.ZeroAddress;
const route = (pair) => ethers.AbiCoder.defaultAbiCoder().encode(["address"], [pair]);

function amountOut(amountIn, reserveIn, reserveOut) {
  const withFee = amountIn * 997n;
  return withFee * reserveOut / (reserveIn * 1000n + withFee);
}

describe("PermV2Adapter", function () {
  async function fixture() {
    const [owner, routerCaller, attacker, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("Token A", "TA", 18);
    const tokenB = await Token.deploy("Token B", "TB", 18);
    const WETH = await ethers.getContractFactory("MockWETH");
    const weth = await WETH.deploy();
    const Factory = await ethers.getContractFactory("MockV2Factory");
    const factory = await Factory.deploy();
    await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
    await factory.createPair(await weth.getAddress(), await tokenA.getAddress());
    const pairAddress = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    const wethPairAddress = await factory.getPair(await weth.getAddress(), await tokenA.getAddress());
    const pair = await ethers.getContractAt("MockV2Pair", pairAddress);
    const wethPair = await ethers.getContractAt("MockV2Pair", wethPairAddress);

    const seedPair = async (venuePair, first, second, amountFirst, amountSecond, secondIsWeth = false) => {
      const token0 = await venuePair.token0();
      const firstAddress = await first.getAddress();
      const [amount0, amount1] = token0.toLowerCase() === firstAddress.toLowerCase()
        ? [amountFirst, amountSecond]
        : [amountSecond, amountFirst];
      await first.mint(owner.address, amountFirst);
      if (secondIsWeth) await second.connect(owner).deposit({ value: amountSecond });
      else await second.mint(owner.address, amountSecond);
      await first.connect(owner).approve(await venuePair.getAddress(), amountFirst);
      await second.connect(owner).approve(await venuePair.getAddress(), amountSecond);
      await venuePair.connect(owner).seed(amount0, amount1);
    };
    await seedPair(pair, tokenA, tokenB, ethers.parseEther("100"), ethers.parseEther("200"));
    await seedPair(wethPair, tokenA, weth, ethers.parseEther("100"), ethers.parseEther("20"), true);

    const pairCodehash = ethers.keccak256(await ethers.provider.getCode(pairAddress));
    const Adapter = await ethers.getContractFactory("PermV2Adapter");
    const adapter = await Adapter.deploy(owner.address, routerCaller.address, await factory.getAddress(), await weth.getAddress(), pairCodehash);
    return { owner, routerCaller, attacker, recipient, tokenA, tokenB, weth, factory, pair, wethPair, adapter, pairCodehash };
  }

  it("executes an exact ERC-20 input against the factory-selected, codehash-pinned pair", async function () {
    const { routerCaller, tokenA, tokenB, pair, adapter } = await fixture();
    const amount = ethers.parseEther("1");
    const [reserve0, reserve1] = await pair.getReserves();
    const token0 = await pair.token0();
    const expected = token0.toLowerCase() === (await tokenA.getAddress()).toLowerCase()
      ? amountOut(amount, reserve0, reserve1)
      : amountOut(amount, reserve1, reserve0);
    await tokenA.mint(routerCaller.address, amount);
    await tokenA.connect(routerCaller).approve(await adapter.getAddress(), amount);
    await expect(adapter.connect(routerCaller).swapExactInput(
      await tokenA.getAddress(), await tokenB.getAddress(), amount, routerCaller.address, route(await pair.getAddress()),
    )).to.emit(adapter, "V2StepExecuted");
    expect(await tokenB.balanceOf(routerCaller.address)).to.equal(expected);
  });

  it("wraps native input and unwraps native output", async function () {
    const { routerCaller, tokenA, wethPair, adapter } = await fixture();
    const amount = ethers.parseEther("0.1");
    await adapter.connect(routerCaller).swapExactInput(ZERO, await tokenA.getAddress(), amount, routerCaller.address, route(await wethPair.getAddress()), { value: amount });
    const bought = await tokenA.balanceOf(routerCaller.address);
    expect(bought).to.be.greaterThan(0n);

    await tokenA.mint(routerCaller.address, ethers.parseEther("1"));
    await tokenA.connect(routerCaller).approve(await adapter.getAddress(), ethers.parseEther("1"));
    const before = await ethers.provider.getBalance(routerCaller.address);
    await adapter.connect(routerCaller).swapExactInput(await tokenA.getAddress(), ZERO, ethers.parseEther("1"), routerCaller.address, route(await wethPair.getAddress()));
    expect((await ethers.provider.getBalance(routerCaller.address)) - before).to.be.greaterThan(0n);
  });

  it("rejects a wrong pair, changed pair code and reserve donations", async function () {
    const { routerCaller, tokenA, tokenB, pair, wethPair, adapter } = await fixture();
    const amount = ethers.parseEther("1");
    await tokenA.mint(routerCaller.address, amount * 3n);
    await tokenA.connect(routerCaller).approve(await adapter.getAddress(), amount * 3n);
    await expect(adapter.connect(routerCaller).swapExactInput(
      await tokenA.getAddress(), await tokenB.getAddress(), amount, routerCaller.address, route(await wethPair.getAddress()),
    )).to.be.revertedWithCustomError(adapter, "InvalidPair");

    const originalCode = await ethers.provider.getCode(await pair.getAddress());
    await ethers.provider.send("hardhat_setCode", [await pair.getAddress(), "0x60006000fd"]);
    await expect(adapter.connect(routerCaller).swapExactInput(
      await tokenA.getAddress(), await tokenB.getAddress(), amount, routerCaller.address, route(await pair.getAddress()),
    )).to.be.revertedWithCustomError(adapter, "ExternalCodeChanged");
    await ethers.provider.send("hardhat_setCode", [await pair.getAddress(), originalCode]);

    await tokenA.mint(await pair.getAddress(), 1n);
    await expect(adapter.connect(routerCaller).swapExactInput(
      await tokenA.getAddress(), await tokenB.getAddress(), amount, routerCaller.address, route(await pair.getAddress()),
    )).to.be.revertedWithCustomError(adapter, "UnexpectedBalance");
  });

  it("rejects untrusted callers and malformed route data", async function () {
    const { routerCaller, attacker, recipient, tokenA, tokenB, pair, adapter } = await fixture();
    await expect(adapter.connect(attacker).swapExactInput(
      await tokenA.getAddress(), await tokenB.getAddress(), 1n, routerCaller.address, route(await pair.getAddress()),
    )).to.be.revertedWithCustomError(adapter, "InvalidCaller");
    await expect(adapter.connect(routerCaller).swapExactInput(
      await tokenA.getAddress(), await tokenB.getAddress(), 1n, recipient.address, route(await pair.getAddress()),
    )).to.be.revertedWithCustomError(adapter, "InvalidRouteData");
    await expect(adapter.connect(routerCaller).swapExactInput(
      await tokenA.getAddress(), await tokenB.getAddress(), 1n, routerCaller.address, "0x1234",
    )).to.be.revertedWithCustomError(adapter, "InvalidRouteData");
  });

  it("lets only governance rescue accidentally stranded balances", async function () {
    const { owner, attacker, recipient, tokenA, adapter } = await fixture();
    const amount = ethers.parseEther("1");
    await tokenA.mint(await adapter.getAddress(), amount);
    await expect(adapter.connect(attacker).rescueExcess(await tokenA.getAddress(), recipient.address, amount))
      .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount").withArgs(attacker.address);
    await expect(adapter.connect(owner).rescueExcess(await tokenA.getAddress(), recipient.address, amount))
      .to.emit(adapter, "ExcessRescued").withArgs(await tokenA.getAddress(), recipient.address, amount);
  });
});
