export type TokenSymbol = "ETH" | "WETH" | "USDC" | "USDT" | "WBTC" | "DAI" | "LINK" | "UNI";

export type TokenInfo = {
  symbol: TokenSymbol;
  name: string;
  logo: string;
  usdFixture: number;
  decimals: number;
  category: "Native" | "Wrapped" | "Stablecoin" | "Asset" | "Governance";
};

/**
 * Display fixtures for the interface preview. Logos are sourced from the
 * Trust Wallet assets repository; values are deliberately labelled as demo
 * fixtures and are not live prices or a chain-support statement.
 */
export const TOKENS: readonly TokenInfo[] = [
  { symbol: "ETH", name: "Ether", logo: "/tokens/eth.png", usdFixture: 3092.72, decimals: 6, category: "Native" },
  { symbol: "WETH", name: "Wrapped Ether", logo: "/tokens/weth.png", usdFixture: 3092.72, decimals: 6, category: "Wrapped" },
  { symbol: "USDC", name: "USD Coin", logo: "/tokens/usdc.png", usdFixture: 1, decimals: 2, category: "Stablecoin" },
  { symbol: "USDT", name: "Tether USD", logo: "/tokens/usdt.png", usdFixture: 0.9998, decimals: 2, category: "Stablecoin" },
  { symbol: "WBTC", name: "Wrapped Bitcoin", logo: "/tokens/wbtc.png", usdFixture: 90320, decimals: 7, category: "Wrapped" },
  { symbol: "DAI", name: "Dai", logo: "/tokens/dai.png", usdFixture: 0.9996, decimals: 2, category: "Stablecoin" },
  { symbol: "LINK", name: "Chainlink", logo: "/tokens/link.png", usdFixture: 14.82, decimals: 5, category: "Asset" },
  { symbol: "UNI", name: "Uniswap", logo: "/tokens/uni.png", usdFixture: 8.41, decimals: 5, category: "Governance" },
] as const;

export const TOKEN_MAP = Object.fromEntries(TOKENS.map((token) => [token.symbol, token])) as Record<TokenSymbol, TokenInfo>;

export const tokenPairKey = (sell: TokenSymbol, buy: TokenSymbol) => `${sell}/${buy}`;
