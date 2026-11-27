const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const exported = {
  PermRouter: require("../../lib/web3/artifacts/PermRouter.json"),
  PermV4Adapter: require("../../lib/web3/artifacts/PermV4Adapter.json"),
  PermV3Adapter: require("../../lib/web3/artifacts/PermV3Adapter.json"),
  PermV2Adapter: require("../../lib/web3/artifacts/PermV2Adapter.json"),
  PermTimelock: require("../../lib/web3/artifacts/PermTimelock.json"),
};

function normalize(code, references) {
  const chars = code.slice(2).toLowerCase().split("");
  for (const { start, length } of references || []) chars.fill("0", start * 2, (start + length) * 2);
  return chars.join("");
}

async function expectRuntime(contract, artifact) {
  const code = await ethers.provider.getCode(await contract.getAddress());
  expect(code.length).to.equal(artifact.deployedBytecode.length);
  expect(normalize(code, artifact.deployedBytecodeImmutableReferences)).to.equal(
    normalize(artifact.deployedBytecode, artifact.deployedBytecodeImmutableReferences),
  );
}

(hre.__SOLIDITY_COVERAGE_RUNNING ? describe.skip : describe)("Browser artifact integrity", function () {
  it("matches deployed runtime templates outside compiler-declared immutable slots", async function () {
    const [owner, signer] = await ethers.getSigners();
    const Permit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await Permit2.deploy();
    const Router = await ethers.getContractFactory("PermRouter");
    const router = await Router.deploy(owner.address, owner.address, signer.address, await permit2.getAddress());

    const V4 = await ethers.getContractFactory("PermV4Adapter");
    const v4 = await V4.deploy(owner.address, await router.getAddress(), await permit2.getAddress());
    const SwapRouter = await ethers.getContractFactory("MockSwapRouter02");
    const swapRouter = await SwapRouter.deploy();
    const Weth = await ethers.getContractFactory("MockWETH");
    const weth = await Weth.deploy();
    const V3 = await ethers.getContractFactory("PermV3Adapter");
    const v3 = await V3.deploy(owner.address, await router.getAddress(), await swapRouter.getAddress(), await weth.getAddress());
    const V2Factory = await ethers.getContractFactory("MockV2Factory");
    const v2Factory = await V2Factory.deploy();
    await v2Factory.createPair(await weth.getAddress(), await permit2.getAddress());
    const v2Pair = await v2Factory.getPair(await weth.getAddress(), await permit2.getAddress());
    const V2 = await ethers.getContractFactory("PermV2Adapter");
    const v2 = await V2.deploy(
      owner.address,
      await router.getAddress(),
      await v2Factory.getAddress(),
      await weth.getAddress(),
      ethers.keccak256(await ethers.provider.getCode(v2Pair)),
    );
    const Timelock = await ethers.getContractFactory("PermTimelock");
    const timelock = await Timelock.deploy(60, [owner.address], [ethers.ZeroAddress], ethers.ZeroAddress);

    await expectRuntime(router, exported.PermRouter);
    await expectRuntime(v4, exported.PermV4Adapter);
    await expectRuntime(v3, exported.PermV3Adapter);
    await expectRuntime(v2, exported.PermV2Adapter);
    await expectRuntime(timelock, exported.PermTimelock);
  });
});
