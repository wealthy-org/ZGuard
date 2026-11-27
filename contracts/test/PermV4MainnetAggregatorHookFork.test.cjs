const { expect } = require("chai");
const { ethers } = require("hardhat");

const RUN = process.env.RUN_MAINNET_HOOK_FORK_TESTS === "1";
const CHAIN_ID = 4663;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const POOL_MANAGER_CODEHASH = "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const HOOK = "0xA1AD09c98710d2C709e3bea03708823255312888";
const HOOK_CODEHASH = "0x537d4b59539aa00520d3f9885e00707e9a7bfe6670455ae54a3099e9b53129c7";
const EXTERNAL_POOL = "0x23D641FeCcD207E8794c593e8240444A0674C4Ba";
const EXTERNAL_POOL_CODEHASH = "0xda57657ec68ddfb0987ba1352a44cefe40433e55585f3e4555b8ced4bbeb540d";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const UP = "0x57C0E45cB534413D1C20A4240955d6bB250BB4F1";
const DYNAMIC_FEE = 0x800000;
const TICK_SPACING = 200;
const POOL_ID = "0x9ef343fe68e0702b7013a38444b2123e61e8cab2ede3f575a0d5b77cb1f8c95b";
const COMPATIBILITY_PROVIDER = ethers.id("UNAPPROVED_MAINNET_HOOK_COMPATIBILITY");
const EMPTY_PERMIT = { nonce: 0, deadline: 0, signature: "0x" };
const HOOK_SWAP_TOPIC = ethers.id("HookSwap(bytes32,address,int256,int256,uint24)");
const EXTERNAL_SWAP_TOPIC = ethers.id("Swap(address,address,int256,int256,uint160,uint128,int24)");

async function signedRequest(router, signer, account, values) {
  const request = { gasEstimate: 800_000n, ...values, quoteId: ethers.ZeroHash };
  const domain = { name: "Perm", version: "2", chainId: CHAIN_ID, verifyingContract: router.target };
  const types = { PermQuote: [
    { name: "account", type: "address" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" },
    { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" },
    { name: "quotedAt", type: "uint64" }, { name: "policyVersion", type: "uint32" },
    { name: "chainId", type: "uint256" }, { name: "referrer", type: "address" },
    { name: "routeHash", type: "bytes32" },
  ] };
  const value = {
    account,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    minAmountOut: request.minAmountOut,
    gasEstimate: request.gasEstimate,
    recipient: request.recipient,
    deadline: request.deadline,
    quotedAt: request.quotedAt,
    policyVersion: request.policyVersion,
    chainId: request.chainId,
    referrer: request.referrer,
    routeHash: ethers.keccak256(request.routeData),
  };
  return {
    request: { ...request, quoteId: ethers.TypedDataEncoder.hash(domain, types, value) },
    signature: await signer.signTypedData(domain, types, value),
  };
}

function routerEvents(router, receipt) {
  return receipt.logs
    .filter((log) => log.address.toLowerCase() === router.target.toLowerCase())
    .map((log) => { try { return router.interface.parseLog(log); } catch { return null; } })
    .filter(Boolean);
}

describe(
  RUN ? "PermV4Adapter · unapproved mainnet Aggregator Hook compatibility" : "Mainnet hook compatibility fork (skipped)",
  function () {
    if (!RUN) {
      it.skip("set RUN_MAINNET_HOOK_FORK_TESTS=1 for the read-only chain-4663 compatibility fork", function () {});
      return;
    }

    it("settles through the existing hook while preserving hook identity and runtime codehash evidence", async function () {
      this.timeout(180_000);
      const [owner, quoteSigner, user, treasury] = await ethers.getSigners();
      expect((await ethers.provider.getNetwork()).chainId).to.equal(4663n);
      await ethers.provider.send("evm_mine", []);

      expect(ethers.keccak256(await ethers.provider.getCode(POOL_MANAGER))).to.equal(POOL_MANAGER_CODEHASH);
      expect(ethers.keccak256(await ethers.provider.getCode(HOOK))).to.equal(HOOK_CODEHASH);
      expect(ethers.keccak256(await ethers.provider.getCode(EXTERNAL_POOL))).to.equal(EXTERNAL_POOL_CODEHASH);

      const hook = await ethers.getContractAt([
        "function poolManager() view returns(address)",
        "function poolIdToExternalPool(bytes32) view returns(address)",
        "event HookSwap(bytes32 indexed poolId,address indexed sender,int256 amount0,int256 amount1,uint24 swapFee)",
      ], HOOK);
      expect(await hook.poolManager()).to.equal(ethers.getAddress(POOL_MANAGER));
      expect(await hook.poolIdToExternalPool(POOL_ID)).to.equal(EXTERNAL_POOL);

      const externalPool = await ethers.getContractAt([
        "function token0() view returns(address)",
        "function token1() view returns(address)",
        "function fee() view returns(uint24)",
        "function tickSpacing() view returns(int24)",
      ], EXTERNAL_POOL);
      expect(await externalPool.token0()).to.equal(WETH);
      expect(await externalPool.token1()).to.equal(UP);
      expect(await externalPool.fee()).to.equal(10_000n);
      expect(await externalPool.tickSpacing()).to.equal(BigInt(TICK_SPACING));

      const key = {
        currency0: WETH,
        currency1: UP,
        fee: DYNAMIC_FEE,
        tickSpacing: TICK_SPACING,
        hooks: HOOK,
      };
      const coder = ethers.AbiCoder.defaultAbiCoder();
      expect(ethers.keccak256(coder.encode(
        ["address", "address", "uint24", "int24", "address"],
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
      ))).to.equal(POOL_ID);

      const Router = await ethers.getContractFactory("PermRouter");
      const router = await Router.deploy(owner.address, treasury.address, quoteSigner.address, PERMIT2);
      const Adapter = await ethers.getContractFactory("PermV4Adapter");
      const adapter = await Adapter.deploy(owner.address, router.target, POOL_MANAGER);
      await router.configureAdapter(adapter.target, ethers.id("UNISWAP_V4_DIRECT"), true);
      await router.configureHookProvider(adapter.target, COMPATIBILITY_PROVIDER);
      await adapter.setVerifiedHook(HOOK, true);
      expect(await adapter.verifiedHookCodehashes(HOOK)).to.equal(HOOK_CODEHASH);

      const v4Data = coder.encode(
        ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)", "bytes"],
        [key, "0x"],
      );
      const routeData = coder.encode(
        ["tuple(address adapter,address tokenIn,address tokenOut,bytes data)[]"],
        [[{ adapter: adapter.target, tokenIn: WETH, tokenOut: UP, data: v4Data }]],
      );

      const weth = await ethers.getContractAt([
        "function deposit() payable",
        "function approve(address,uint256) returns(bool)",
      ], WETH);
      const up = await ethers.getContractAt(["function balanceOf(address) view returns(uint256)"], UP);
      const amountIn = ethers.parseEther("0.0001");
      await weth.connect(user).deposit({ value: amountIn });
      await weth.connect(user).approve(router.target, amountIn);

      const quotedAt = (await ethers.provider.getBlock("latest")).timestamp;
      const signed = await signedRequest(router, quoteSigner, user.address, {
        tokenIn: WETH,
        tokenOut: UP,
        amountIn,
        minAmountOut: 1n,
        recipient: user.address,
        deadline: quotedAt + 90,
        quotedAt,
        policyVersion: 1,
        chainId: CHAIN_ID,
        referrer: ethers.ZeroAddress,
        routeData,
      });
      const receipt = await (await router.connect(user).swapExactInput(
        signed.request,
        signed.signature,
        EMPTY_PERMIT,
        { gasLimit: 3_000_000 },
      )).wait();

      const events = routerEvents(router, receipt);
      const step = events.find((event) => event.name === "RouteStepSettled");
      const settlement = events.find((event) => event.name === "SwapSettled");
      expect(step.args.providerId).to.equal(COMPATIBILITY_PROVIDER);
      expect(step.args.stepRouteId).to.equal(POOL_ID);
      expect(step.args.hook).to.equal(HOOK);
      expect(step.args.hookCodehash).to.equal(HOOK_CODEHASH);
      expect(settlement.args.receiptId).to.equal(step.args.receiptId);
      expect(settlement.args.amountOut).to.equal(step.args.amountOut);

      const hookLog = receipt.logs.find((log) =>
        log.address.toLowerCase() === HOOK.toLowerCase() && log.topics[0] === HOOK_SWAP_TOPIC
      );
      const hookSwap = hook.interface.parseLog(hookLog);
      expect(hookSwap.args.poolId).to.equal(POOL_ID);
      expect(hookSwap.args.sender).to.equal(adapter.target);
      expect(hookSwap.args.amount0).to.be.greaterThan(0n);
      expect(hookSwap.args.amount1).to.be.lessThan(0n);
      expect(receipt.logs.some((log) =>
        log.address.toLowerCase() === EXTERNAL_POOL.toLowerCase() && log.topics[0] === EXTERNAL_SWAP_TOPIC
      )).to.equal(true);
      expect(await up.balanceOf(user.address)).to.equal(settlement.args.amountOut);
    });
  },
);
