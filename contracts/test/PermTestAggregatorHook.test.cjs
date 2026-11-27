const { expect } = require("chai");
const { ethers } = require("hardhat");

const RUN_FORK_TESTS = process.env.RUN_FORK_TESTS === "1";

describe("Perm test Aggregator Hook deployment containment", function () {
  (RUN_FORK_TESTS ? it.skip : it)("rejects deployment on every non-46630 chain", async function () {
    const network = await ethers.provider.getNetwork();
    expect(network.chainId).to.not.equal(46630n);
    const Hook = await ethers.getContractFactory("PermTestAggregatorHook");
    await expect(Hook.deploy(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroHash))
      .to.be.revertedWithCustomError(Hook, "TestnetOnly")
      .withArgs(network.chainId);
  });
});
