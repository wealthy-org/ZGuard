const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PermTimelock ownership migration", function () {
  it("schedules and atomically accepts Router and adapter ownership after the delay", async function () {
    const [deployer, proposer, outsider] = await ethers.getSigners();
    const Permit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await Permit2.deploy();
    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(deployer.address, deployer.address, deployer.address, await permit2.getAddress());
    const V4 = await ethers.getContractFactory("PermV4Adapter");
    const v4 = await V4.deploy(deployer.address, await router.getAddress(), await permit2.getAddress());
    const SwapRouter = await ethers.getContractFactory("MockSwapRouter02");
    const swapRouter = await SwapRouter.deploy();
    const Weth = await ethers.getContractFactory("MockWETH");
    const weth = await Weth.deploy();
    const V3 = await ethers.getContractFactory("PermV3Adapter");
    const v3 = await V3.deploy(deployer.address, await router.getAddress(), await swapRouter.getAddress(), await weth.getAddress());

    const delay = 60;
    const Timelock = await ethers.getContractFactory("PermTimelock");
    const timelock = await Timelock.deploy(delay, [proposer.address], [ethers.ZeroAddress], ethers.ZeroAddress);
    const timelockAddress = await timelock.getAddress();
    await router.transferOwnership(timelockAddress);
    await v4.transferOwnership(timelockAddress);
    await v3.transferOwnership(timelockAddress);

    const targets = [await router.getAddress(), await v4.getAddress(), await v3.getAddress()];
    const values = [0, 0, 0];
    const ownable = new ethers.Interface(["function acceptOwnership()"]);
    const payloads = targets.map(() => ownable.encodeFunctionData("acceptOwnership"));
    const predecessor = ethers.ZeroHash;
    const salt = ethers.id("PERM_ROUTER_V2_OWNERSHIP_TEST");
    const operationId = await timelock.hashOperationBatch(targets, values, payloads, predecessor, salt);

    await expect(timelock.connect(outsider).scheduleBatch(targets, values, payloads, predecessor, salt, delay)).to.be.reverted;
    await timelock.connect(proposer).scheduleBatch(targets, values, payloads, predecessor, salt, delay);
    expect(await timelock.isOperationPending(operationId)).to.equal(true);
    await expect(timelock.connect(outsider).executeBatch(targets, values, payloads, predecessor, salt)).to.be.reverted;

    await ethers.provider.send("evm_increaseTime", [delay]);
    await ethers.provider.send("evm_mine", []);
    await timelock.connect(outsider).executeBatch(targets, values, payloads, predecessor, salt);

    expect(await timelock.isOperationDone(operationId)).to.equal(true);
    for (const contract of [router, v4, v3]) {
      expect(await contract.owner()).to.equal(timelockAddress);
      expect(await contract.pendingOwner()).to.equal(ethers.ZeroAddress);
    }
  });
});
