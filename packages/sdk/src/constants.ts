export const RHC_MAINNET_CHAIN_ID = 4663 as const;
export const RHC_TESTNET_CHAIN_ID = 46630 as const;

export const NETWORK_RHC_MAINNET = "eip155:4663" as const;
export const NETWORK_RHC_TESTNET = "eip155:46630" as const;
export const NETWORK_BASE_MAINNET = "eip155:8453" as const;
export const NETWORK_SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;

export const RHC_PUBLIC_RPC_MAINNET = "https://rpc.mainnet.chain.robinhood.com" as const;
export const RHC_PUBLIC_RPC_TESTNET = "https://rpc.testnet.chain.robinhood.com" as const;
export const RHC_EXPLORER_MAINNET = "https://robinhoodchain.blockscout.com" as const;

/**
 * Canonical assets on Robinhood Chain 4663 (§7.2 Dev Brief).
 * Stock Tokens are NEVER hardcoded as a static authority — they are loaded live from the official registry.
 */
export const RHC_CANONICAL_ASSETS = {
  WETH: {
    address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  },
  USDG: {
    address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
    /**
     * Verified directly from USDG contract on RHC 4663 via name() & DOMAIN_SEPARATOR():
     * keccak256(EIP712Domain("Global Dollar", "1", 4663, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168))
     */
    eip712Domain: {
      name: "Global Dollar",
      version: "1",
      chainId: 4663,
      verifyingContract: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
      domainSeparator:
        "0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036" as const,
    },
  },
  /** Paxos supply control contract on RHC — NOT the USDG token itself (§7.2). */
  USDG_SUPPLY_CONTROL: "0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4",
} as const;

/**
 * pons V2 contracts on Robinhood Chain 4663 (§7.3 Dev Brief).
 */
export const PONS_V2_CONTRACTS = {
  factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  memeHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
  feeEscrow: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e",
  buybackVault: "0x42df2a798f82289E177311362e8f5ccC45c1219c",
  launchLocker: "0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952",
  launchAndBuyRouter: "0xe33E9E479dF8802cb0866d5d05258bEc4cF62948",
  launchDeployer: "0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42",
  graduationExecutor: "0xC7819B64A1dAECD7eC19856d026cb14EfBd89046",
  graduationGuard: "0xf5695117b99B6f6401e67d4195BD653628176C6C",
} as const;

/**
 * pons V1 contracts on Robinhood Chain 4663 (§7.3 Dev Brief & pons v1 docs).
 */
export const PONS_V1_CONTRACTS = {
  factory: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
  liquidityLocker: "0x736D76699C26D0d966744cAe304C000d471f7F35",
  legacyFactory: "0x0c37a24F5D23A486FA692d1500881d698B1F77a4",
  legacyLocker: "0x31ca5E101941A93A7DD6d0497928700625CF54B5",
  swapRouterV3: "0xCaf681a66D020601342297493863E78C959E5cb2",
} as const;

/**
 * Uniswap v4 & Aggregator Hooks on Robinhood Chain 4663 (§7.4 Dev Brief).
 */
export const UNISWAP_V4_RHC = {
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  ponsV2MemeHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
  /** OpenHooks PonsCurveAggregator — explicitly noted unaudited in brief §7.4 */
  openHooksPonsCurveAggregator: "0xb091eC27074C7a0C1bA896C063cc677F89202888",
} as const;

/**
 * Chainlink confirmed crypto feeds on Robinhood Chain 4663 (§7.5 Dev Brief).
 * Full 62-feed directory is refreshed dynamically from ZGUARD_CHAINLINK_FEEDS_URL.
 */
export const CHAINLINK_CONFIRMED_FEEDS_RHC = {
  USDG_USD: {
    proxy: "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2",
    decimals: 8,
    heartbeatSeconds: 86400,
  },
  ETH_USD: {
    proxy: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
    decimals: 8,
    heartbeatSeconds: 86400,
  },
} as const;

export const DEAD_BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

/**
 * Map of known protocol contracts on RHC 4663 for call-tree naming in simulations (§6.2).
 */
export const KNOWN_RHC_CONTRACTS: Record<string, { label: string; category: string }> = {
  [RHC_CANONICAL_ASSETS.USDG.address.toLowerCase()]: {
    label: "USDG (Global Dollar)",
    category: "canonical_asset",
  },
  [RHC_CANONICAL_ASSETS.WETH.address.toLowerCase()]: {
    label: "WETH (Robinhood Chain)",
    category: "canonical_asset",
  },
  [UNISWAP_V4_RHC.poolManager.toLowerCase()]: {
    label: "Uniswap v4 PoolManager",
    category: "uniswap_v4",
  },
  [PONS_V2_CONTRACTS.memeHook.toLowerCase()]: {
    label: "pons V2 Meme Hook",
    category: "pons_v2_hook",
  },
  [PONS_V2_CONTRACTS.factory.toLowerCase()]: {
    label: "pons V2 Factory",
    category: "pons_v2",
  },
  [PONS_V2_CONTRACTS.feeEscrow.toLowerCase()]: {
    label: "pons V2 Fee Escrow",
    category: "pons_v2",
  },
  [PONS_V2_CONTRACTS.buybackVault.toLowerCase()]: {
    label: "pons V2 Buyback Vault",
    category: "pons_v2",
  },
  [PONS_V2_CONTRACTS.launchLocker.toLowerCase()]: {
    label: "pons V2 Launch Locker",
    category: "pons_v2",
  },
  [PONS_V2_CONTRACTS.launchAndBuyRouter.toLowerCase()]: {
    label: "pons V2 Launch & Buy Router",
    category: "pons_v2",
  },
  [PONS_V2_CONTRACTS.launchDeployer.toLowerCase()]: {
    label: "pons V2 Launch Deployer",
    category: "pons_v2",
  },
  [PONS_V2_CONTRACTS.graduationExecutor.toLowerCase()]: {
    label: "pons V2 Graduation Executor",
    category: "pons_v2",
  },
  [PONS_V2_CONTRACTS.graduationGuard.toLowerCase()]: {
    label: "pons V2 Graduation Guard",
    category: "pons_v2",
  },
  [PONS_V1_CONTRACTS.factory.toLowerCase()]: {
    label: "pons V1 Factory",
    category: "pons_v1",
  },
  [PONS_V1_CONTRACTS.liquidityLocker.toLowerCase()]: {
    label: "pons V1 Liquidity Locker",
    category: "pons_v1",
  },
  [PONS_V1_CONTRACTS.swapRouterV3.toLowerCase()]: {
    label: "pons V1 SwapRouter (V3)",
    category: "pons_v1",
  },
  [UNISWAP_V4_RHC.openHooksPonsCurveAggregator.toLowerCase()]: {
    label: "OpenHooks PonsCurveAggregator [unaudited]",
    category: "aggregator_hook",
  },
};
