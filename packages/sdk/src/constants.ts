export const RHC_MAINNET_CHAIN_ID = 4663 as const;
export const RHC_TESTNET_CHAIN_ID = 46630 as const;

/**
 * Default active chain in pre-production / senior review stage:
 * Robinhood Chain Testnet (46630). Switchable to 4663 via ZGUARD_ACTIVE_CHAIN_ID=4663.
 */
export const DEFAULT_ACTIVE_RHC_CHAIN_ID = RHC_TESTNET_CHAIN_ID;

export const NETWORK_RHC_MAINNET = "eip155:4663" as const;
export const NETWORK_RHC_TESTNET = "eip155:46630" as const;
export const NETWORK_BASE_MAINNET = "eip155:8453" as const;
export const NETWORK_BASE_SEPOLIA = "eip155:84532" as const;
export const NETWORK_SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;
export const NETWORK_SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;

export const RHC_PUBLIC_RPC_MAINNET = "https://rpc.mainnet.chain.robinhood.com" as const;
export const RHC_PUBLIC_RPC_TESTNET = "https://rpc.testnet.chain.robinhood.com" as const;
export const RHC_EXPLORER_MAINNET = "https://robinhoodchain.blockscout.com" as const;
export const RHC_EXPLORER_TESTNET = "https://explorer.testnet.chain.robinhood.com" as const;
export const RHC_FAUCET_TESTNET = "https://faucet.testnet.chain.robinhood.com" as const;

export const BASE_PUBLIC_RPC_MAINNET = "https://mainnet.base.org" as const;
export const BASE_PUBLIC_RPC_SEPOLIA = "https://sepolia.base.org" as const;
export const SOLANA_PUBLIC_RPC_MAINNET = "https://api.mainnet-beta.solana.com" as const;
export const SOLANA_PUBLIC_RPC_DEVNET = "https://api.devnet.solana.com" as const;

/**
 * Canonical assets on Robinhood Chain Mainnet 4663 (§7.2 Dev Brief).
 * Stock Tokens on mainnet are NEVER hardcoded as a static authority — they are loaded live from `api.robinhood.com/rhj/assets`.
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
    eip712Domain: {
      name: "Global Dollar",
      version: "1",
      chainId: 4663,
      verifyingContract: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
      domainSeparator:
        "0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036" as const,
    },
  },
  /** Paxos supply control contract on RHC Mainnet — NOT the USDG token itself (§7.2). */
  USDG_SUPPLY_CONTROL: "0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4",
} as const;

/**
 * Verified canonical & test assets on Robinhood Chain Testnet 46630.
 * Read & verified directly from installed contracts on `https://rpc.testnet.chain.robinhood.com`
 * and `https://explorer.testnet.chain.robinhood.com`.
 */
export const RHC_TESTNET_ASSETS = {
  WETH: {
    address: "0x33e4191705c386532ba27cBF171Db86919200B94",
    symbol: "WETH",
    name: "Wrapped ETH",
    decimals: 18,
  },
  USDG: {
    address: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
    eip712Domain: {
      name: "Global Dollar",
      version: "1",
      chainId: 46630,
      verifyingContract: "0x7E955252E15c84f5768B83c41a71F9eba181802F" as const,
      domainSeparator:
        "0xb1debe91e09d82163fd9cddaab89359061c0671664e1611258a3c3de7c2d950b" as const,
    },
  },
  /** Verified Robinhood Stock Token BeaconProxies deployed on Testnet 46630 (`uiMultiplier() == 1e18`). */
  STOCK_TOKENS: [
    {
      address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02" as const,
      symbol: "AMZN",
      name: "Amazon",
    },
    {
      address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" as const,
      symbol: "TSLA",
      name: "Tesla",
    },
    {
      address: "0x71178BAc73cBeb415514eB542a8995b82669778d" as const,
      symbol: "AMD",
      name: "AMD",
    },
    {
      address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0" as const,
      symbol: "PLTR",
      name: "Palantir Technologies",
    },
    {
      address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93" as const,
      symbol: "NFLX",
      name: "Netflix",
    },
  ],
  /** Live testnet fixtures for demos & acceptance tests on chain 46630 */
  DEMO_FIXTURES: {
    usdgHolder: "0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79" as const,
    ponsActiveCurveToken: "0x9118BD806cB3906Dc6d50a4409a9e9dF48172365" as const, // Koi Pond (KOIP, graduated=false)
    ponsGraduatedV4Token: "0x9c8CB5D0Bd313ebE5813aCfd8daa4E22DE76DFfd" as const, // Ponsi Doog (PONSIDOOG, graduated=true)
    fakeTickerLookalikeToken: "0x8F9231B0F448bA9AD045348437458721676c23BC" as const, // Mock USDG (open faucet/mint + USDG ticker lookalike)
  },
} as const;

/**
 * Verified USDC EIP-3009 contracts on Base Mainnet (8453) & Base Sepolia (84532)
 * read directly from on-chain `name()`, `version()`, and `DOMAIN_SEPARATOR()`.
 */
export const BASE_USDC_ASSETS = {
  MAINNET: {
    chainId: 8453,
    network: NETWORK_BASE_MAINNET,
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
    name: "USD Coin",
    version: "2",
    decimals: 6,
    domainSeparator:
      "0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f" as const,
  },
  SEPOLIA: {
    chainId: 84532,
    network: NETWORK_BASE_SEPOLIA,
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const,
    name: "USDC",
    version: "2",
    decimals: 6,
    domainSeparator:
      "0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818" as const,
  },
} as const;

export const SOLANA_USDC_MINTS = {
  MAINNET: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const,
  DEVNET: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as const,
} as const;

/**
 * pons V2 contracts on Robinhood Chain Mainnet 4663 (§7.3 Dev Brief).
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
 * pons V1 contracts on Robinhood Chain Mainnet 4663 (§7.3 Dev Brief & pons v1 docs).
 */
export const PONS_V1_CONTRACTS = {
  factory: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
  liquidityLocker: "0x736D76699C26D0d966744cAe304C000d471f7F35",
  legacyFactory: "0x0c37a24F5D23A486FA692d1500881d698B1F77a4",
  legacyLocker: "0x31ca5E101941A93A7DD6d0497928700625CF54B5",
  swapRouterV3: "0xCaf681a66D020601342297493863E78C959E5cb2",
} as const;

/**
 * pons & launchpad contracts deployed on Robinhood Chain Testnet 46630.
 */
export const PONS_TESTNET_CONTRACTS = {
  launchRouter: "0xB5B7A2f6c4EAFa2D73918fcA32d50e2126339eb9",
  factoryV2: "0xD8c7dC435Eced48E279FD8138DeC1E9b55DB0563",
  factoryV1: "0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59",
  curveDeployer: "0x2975AF1F342CE4f522a7ba452253931811Cd0c5d",
  feeVault: "0x65dB2fa02Aabc86F5808Cffd57Cd7D7e860CF9C0",
} as const;

/**
 * Uniswap v4 & Aggregator Hooks on Robinhood Chain (PoolManager shares the same singleton address on 4663 & 46630).
 */
export const UNISWAP_V4_RHC = {
  poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
  ponsV2MemeHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
  /** OpenHooks PonsCurveAggregator — explicitly noted unaudited in brief §7.4 */
  openHooksPonsCurveAggregator: "0xb091eC27074C7a0C1bA896C063cc677F89202888",
} as const;

/**
 * Chainlink confirmed crypto feeds on Robinhood Chain 4663 (§7.5 Dev Brief).
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

export function isSupportedRhcChainId(chainId: number | null | undefined): chainId is 4663 | 46630 {
  return chainId === RHC_MAINNET_CHAIN_ID || chainId === RHC_TESTNET_CHAIN_ID;
}

export interface RhcChainProfile {
  chainId: 4663 | 46630;
  network: typeof NETWORK_RHC_MAINNET | typeof NETWORK_RHC_TESTNET;
  isTestnet: boolean;
  name: string;
  defaultRpcUrl: string;
  explorerUrl: string;
  explorerApiUrl: string;
  faucetUrl: string | null;
  usdgAddress: `0x${string}`;
  wethAddress: `0x${string}`;
  usdgDomain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
    domainSeparator: `0x${string}`;
  };
}

export function getRhcChainProfile(chainId: number): RhcChainProfile {
  if (chainId === RHC_MAINNET_CHAIN_ID) {
    return {
      chainId: RHC_MAINNET_CHAIN_ID,
      network: NETWORK_RHC_MAINNET,
      isTestnet: false,
      name: "Robinhood Chain Mainnet",
      defaultRpcUrl: RHC_PUBLIC_RPC_MAINNET,
      explorerUrl: RHC_EXPLORER_MAINNET,
      explorerApiUrl: `${RHC_EXPLORER_MAINNET}/api/v2`,
      faucetUrl: null,
      usdgAddress: RHC_CANONICAL_ASSETS.USDG.address,
      wethAddress: RHC_CANONICAL_ASSETS.WETH.address,
      usdgDomain: RHC_CANONICAL_ASSETS.USDG.eip712Domain,
    };
  }
  return {
    chainId: RHC_TESTNET_CHAIN_ID,
    network: NETWORK_RHC_TESTNET,
    isTestnet: true,
    name: "Robinhood Chain Testnet",
    defaultRpcUrl: RHC_PUBLIC_RPC_TESTNET,
    explorerUrl: RHC_EXPLORER_TESTNET,
    explorerApiUrl: `${RHC_EXPLORER_TESTNET}/api/v2`,
    faucetUrl: RHC_FAUCET_TESTNET,
    usdgAddress: RHC_TESTNET_ASSETS.USDG.address,
    wethAddress: RHC_TESTNET_ASSETS.WETH.address,
    usdgDomain: RHC_TESTNET_ASSETS.USDG.eip712Domain,
  };
}

/**
 * Map of known protocol contracts across RHC 4663 & 46630 for call-tree naming in simulations (§6.2).
 */
export const KNOWN_RHC_CONTRACTS: Record<string, { label: string; category: string }> = {
  [RHC_CANONICAL_ASSETS.USDG.address.toLowerCase()]: {
    label: "USDG (Global Dollar Mainnet)",
    category: "canonical_asset",
  },
  [RHC_CANONICAL_ASSETS.WETH.address.toLowerCase()]: {
    label: "WETH (Robinhood Chain Mainnet)",
    category: "canonical_asset",
  },
  [RHC_TESTNET_ASSETS.USDG.address.toLowerCase()]: {
    label: "USDG (Global Dollar Testnet 46630)",
    category: "canonical_asset",
  },
  [RHC_TESTNET_ASSETS.WETH.address.toLowerCase()]: {
    label: "WETH (Robinhood Chain Testnet 46630)",
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
  [PONS_TESTNET_CONTRACTS.launchRouter.toLowerCase()]: {
    label: "pons Launch & Buy Router (Testnet 46630)",
    category: "pons_v2",
  },
  [PONS_TESTNET_CONTRACTS.factoryV2.toLowerCase()]: {
    label: "pons V2 Factory (Testnet 46630)",
    category: "pons_v2",
  },
  [PONS_TESTNET_CONTRACTS.factoryV1.toLowerCase()]: {
    label: "pons V1 Factory (Testnet 46630)",
    category: "pons_v1",
  },
  [PONS_TESTNET_CONTRACTS.curveDeployer.toLowerCase()]: {
    label: "Launchpad CurveDeployer (Testnet 46630)",
    category: "pons_v2",
  },
  [UNISWAP_V4_RHC.openHooksPonsCurveAggregator.toLowerCase()]: {
    label: "OpenHooks PonsCurveAggregator [unaudited]",
    category: "aggregator_hook",
  },
};
