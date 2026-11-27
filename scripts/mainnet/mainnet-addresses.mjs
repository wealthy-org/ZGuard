// Single source of truth for Robinhood Chain mainnet (4663) external dependencies.
// Sources (checked 2026-11-23):
//  - Uniswap deployments feed: https://developers.uniswap.org/deployments.json (tier labs-supported)
//  - Robinhood assets registry: https://api.robinhood.com/rhj/assets (chainId 4663)
//  - WETH9 read from SwapRouter02.WETH9() on 4663
// Every address is re-verified for code by scripts/mainnet/check-liquidity.mjs and by the
// deploy script before broadcasting.

export const MAINNET = {
  chainId: 4663,
  network: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  explorerApiUrl: "https://robinhoodchain.blockscout.com/api",
  // First Uniswap v4 deployments on 4663 are after this block; scans start here.
  poolDiscoveryStartBlock: 0,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  uniswapV4: {
    poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
    stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
  },
  uniswapV3: {
    factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
    swapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
    quoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  },
  // Official Uniswap V2 on 4663 (github.com/Uniswap/contracts deployments/4663.md, deployed May 2026).
  uniswapV2: {
    factory: "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f",
    router02: "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba",
  },
  // Route-only hub tokens: never offered as a trade token, only used as an intermediate hop.
  // USDG is where most AMZN / NFLX / MSFT liquidity lives (Uniswap v3 0.30% pools).
  hubTokens: [
    { symbol: "USDG", name: "Global Dollar", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  ],
  // Aggregator Hook implementations accepted for discovery. The version string is what the hook
  // returns from aggregatorHookVersion(); the runtime codehash of every admitted hook is pinned on
  // PermV4Adapter (setVerifiedHook) and in deployments/mainnet/aggregator-hooks.json.
  aggregatorHookVersions: ["SlipstreamAggregator v1.0"],
  // Robinhood Stock Tokens (official registry). Tokens, not equity.
  stockTokens: [
    { symbol: "NVDA", name: "NVIDIA • Robinhood Token", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
    { symbol: "AAPL", name: "Apple • Robinhood Token", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
    { symbol: "TSLA", name: "Tesla • Robinhood Token", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
    { symbol: "AMZN", name: "Amazon • Robinhood Token", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
    { symbol: "SPCX", name: "SpaceX Class A • Robinhood Token", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" },
    { symbol: "PLTR", name: "Palantir • Robinhood Token", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A" },
    { symbol: "NFLX", name: "Netflix • Robinhood Token", address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8" },
    { symbol: "AMD", name: "AMD • Robinhood Token", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" },
    { symbol: "MSFT", name: "Microsoft • Robinhood Token", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
    { symbol: "GOOGL", name: "Alphabet Class A • Robinhood Token", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
    { symbol: "META", name: "Meta Platforms • Robinhood Token", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
    { symbol: "SPY", name: "SPDR S&P 500 ETF Trust • Robinhood Token", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
    { symbol: "QQQ", name: "Invesco QQQ • Robinhood Token", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68" },
    { symbol: "COIN", name: "Coinbase • Robinhood Token", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b" },
  ],
};
