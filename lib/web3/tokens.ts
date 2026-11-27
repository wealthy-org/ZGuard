import type { Address } from "viem";
import { ZERO_ADDRESS } from "./config";
import { IS_MAINNET } from "./network";

export type LiveTokenSymbol =
  | "ETH" | "NVDA" | "AAPL" | "SPCX" | "OPENAI" | "ANTHROPIC" | "TSLA" | "AMZN" | "PLTR" | "NFLX" | "AMD"
  | "GOOGL" | "META" | "SPY" | "QQQ" | "COIN" | "MSFT"
  // Route-only hub tokens (never offered in a token picker).
  | "WETH" | "USDG";

export type LiveToken = {
  symbol: LiveTokenSymbol;
  displaySymbol: string;
  name: string;
  address: Address;
  decimals: number;
  color: string;
  warning?: string;
  venue: "uniswap-v4" | "uniswap-v3" | "synthra-v3" | "both";
  /** Reached only through a two-hop route via the USDG hub (no usable ETH pool). */
  viaHub?: "USDG";
};

const TESTNET_TOKENS: readonly LiveToken[] = [
  { symbol: "ETH", displaySymbol: "ETH", name: "Testnet Ether", address: ZERO_ADDRESS, decimals: 18, color: "#6574c4", venue: "both" },
  { symbol: "NVDA", displaySymbol: "NVDA·T", name: "NVDA test asset", address: "0x3ab049897b0697BdA766D8730fe1F955c9c103F0", decimals: 18, color: "#76b900", venue: "uniswap-v4", warning: "Unvalued Robinhood testnet asset; not NVIDIA equity." },
  { symbol: "AAPL", displaySymbol: "AAPL·T", name: "AAPL test asset", address: "0x438820DcfE62A21e306614A4B54383Cd8a36AcF2", decimals: 18, color: "#6f7680", venue: "uniswap-v4", warning: "Unvalued Robinhood testnet asset; not Apple equity." },
  { symbol: "SPCX", displaySymbol: "SPCX·T", name: "SPCX test asset", address: "0xba163e9887d54A854323B41fcA9cf64a1c275Ac9", decimals: 18, color: "#253450", venue: "uniswap-v4", warning: "Unvalued Robinhood testnet asset; no SpaceX ownership." },
  { symbol: "OPENAI", displaySymbol: "OPENAI·T", name: "OpenAI test asset", address: "0x1b14321750b38f7eD66A363D07a921A668521A5F", decimals: 18, color: "#10a37f", venue: "uniswap-v4", warning: "Unvalued third-party test token; no OpenAI affiliation." },
  { symbol: "ANTHROPIC", displaySymbol: "ANTH·T", name: "Anthropic test asset", address: "0x92dCe70B18df47ac643Af6377621D74aBE3C868C", decimals: 18, color: "#d97757", venue: "uniswap-v4", warning: "Unvalued third-party test token; no Anthropic affiliation." },
  { symbol: "TSLA", displaySymbol: "TSLA·T", name: "TSLA Synthra test asset", address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", decimals: 18, color: "#cc2222", venue: "synthra-v3", warning: "Unvalued third-party test token; not Tesla equity." },
  { symbol: "AMZN", displaySymbol: "AMZN·T", name: "AMZN Synthra test asset", address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", decimals: 18, color: "#ff9900", venue: "synthra-v3", warning: "Unvalued third-party test token; not Amazon equity." },
  { symbol: "PLTR", displaySymbol: "PLTR·T", name: "PLTR Synthra test asset", address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0", decimals: 18, color: "#252525", venue: "synthra-v3", warning: "Unvalued third-party test token; not Palantir equity." },
  { symbol: "NFLX", displaySymbol: "NFLX·T", name: "NFLX Synthra test asset", address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", decimals: 18, color: "#e50914", venue: "synthra-v3", warning: "Unvalued third-party test token; not Netflix equity." },
  { symbol: "AMD", displaySymbol: "AMD·T", name: "AMD Synthra test asset", address: "0x71178BAc73cBeb415514eB542a8995b82669778d", decimals: 18, color: "#ed1c24", venue: "synthra-v3", warning: "Unvalued third-party test token; not AMD equity." },
];

/**
 * Robinhood Chain mainnet (4663) Stock Tokens from the official Robinhood assets registry.
 * Every listed token passed a liquidity check at 0.001 ETH:
 *   - direct ETH pools: deployments/mainnet/liquidity-report.md (v4 native pools + Uniswap v3 WETH pools)
 *   - USDG hub routes:  deployments/mainnet/hub-routes.md (ETH → USDG → token, ≤ 1% round trip)
 * AMZN, NFLX and MSFT have no usable ETH pool, so they are reached only through the USDG hub (`viaHub`).
 * `venue` mirrors deployments/mainnet/v4-pools.json (v4) and the liquidity-checked Uniswap v3 pools.
 * Stock Tokens are tokens, not shares: every entry carries that boundary as its warning.
 */
const stockTokenWarning = (issuer: string) => `Robinhood Stock Token. A token, not ${issuer} shares; no shareholder rights.`;
const MAINNET_TOKENS: readonly LiveToken[] = [
  { symbol: "ETH", displaySymbol: "ETH", name: "Ether", address: ZERO_ADDRESS, decimals: 18, color: "#6574c4", venue: "both" },
  { symbol: "NVDA", displaySymbol: "NVDA", name: "NVIDIA • Robinhood Token", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18, color: "#76b900", venue: "both", warning: stockTokenWarning("NVIDIA") },
  { symbol: "AAPL", displaySymbol: "AAPL", name: "Apple • Robinhood Token", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", decimals: 18, color: "#6f7680", venue: "uniswap-v3", warning: stockTokenWarning("Apple") },
  { symbol: "TSLA", displaySymbol: "TSLA", name: "Tesla • Robinhood Token", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18, color: "#cc2222", venue: "both", warning: stockTokenWarning("Tesla") },
  { symbol: "SPCX", displaySymbol: "SPCX", name: "SpaceX Class A • Robinhood Token", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", decimals: 18, color: "#253450", venue: "both", warning: stockTokenWarning("SpaceX") },
  { symbol: "META", displaySymbol: "META", name: "Meta Platforms • Robinhood Token", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", decimals: 18, color: "#0866ff", venue: "both", warning: stockTokenWarning("Meta Platforms") },
  { symbol: "GOOGL", displaySymbol: "GOOGL", name: "Alphabet Class A • Robinhood Token", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", decimals: 18, color: "#4285f4", venue: "uniswap-v4", warning: stockTokenWarning("Alphabet") },
  { symbol: "SPY", displaySymbol: "SPY", name: "SPDR S&P 500 ETF Trust • Robinhood Token", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", decimals: 18, color: "#8a1538", venue: "both", warning: "Robinhood Stock Token. A token, not ETF shares; no shareholder rights." },
  { symbol: "PLTR", displaySymbol: "PLTR", name: "Palantir • Robinhood Token", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", decimals: 18, color: "#252525", venue: "uniswap-v3", warning: stockTokenWarning("Palantir") },
  { symbol: "AMD", displaySymbol: "AMD", name: "AMD • Robinhood Token", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", decimals: 18, color: "#ed1c24", venue: "uniswap-v3", warning: stockTokenWarning("AMD") },
  { symbol: "QQQ", displaySymbol: "QQQ", name: "Invesco QQQ • Robinhood Token", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", decimals: 18, color: "#2b6cb0", venue: "uniswap-v3", warning: "Robinhood Stock Token. A token, not ETF shares; no shareholder rights." },
  { symbol: "COIN", displaySymbol: "COIN", name: "Coinbase • Robinhood Token", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", decimals: 18, color: "#0052ff", venue: "uniswap-v3", warning: stockTokenWarning("Coinbase") },
  { symbol: "AMZN", displaySymbol: "AMZN", name: "Amazon • Robinhood Token", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", decimals: 18, color: "#ff9900", venue: "uniswap-v3", viaHub: "USDG", warning: stockTokenWarning("Amazon") },
  { symbol: "NFLX", displaySymbol: "NFLX", name: "Netflix • Robinhood Token", address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", decimals: 18, color: "#e50914", venue: "uniswap-v3", viaHub: "USDG", warning: stockTokenWarning("Netflix") },
  { symbol: "MSFT", displaySymbol: "MSFT", name: "Microsoft • Robinhood Token", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", decimals: 18, color: "#5e5e5e", venue: "uniswap-v3", viaHub: "USDG", warning: stockTokenWarning("Microsoft") },
];

/**
 * Mainnet route-only hub tokens. They can appear as the middle hop of a signed route but are never
 * selectable: USDG carries the AMZN / NFLX / MSFT liquidity; WETH is the currency of the
 * Aggregator Hook pools and is reached through the 1:1 PermWethAdapter.
 */
const MAINNET_HUB_TOKENS: readonly LiveToken[] = [
  { symbol: "USDG", displaySymbol: "USDG", name: "Global Dollar (route hub)", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, color: "#1f7a5a", venue: "uniswap-v3" },
  { symbol: "WETH", displaySymbol: "WETH", name: "Wrapped Ether (route hub)", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18, color: "#6574c4", venue: "uniswap-v4" },
];

export const LIVE_TOKENS: readonly LiveToken[] = IS_MAINNET ? MAINNET_TOKENS : TESTNET_TOKENS;

/** Hub tokens usable as an intermediate hop on this chain (empty on testnet). */
export const ROUTE_HUB_TOKENS: readonly LiveToken[] = IS_MAINNET ? MAINNET_HUB_TOKENS : [];

export const LIVE_TOKEN_MAP = Object.fromEntries(LIVE_TOKENS.map((token) => [token.symbol, token])) as Record<LiveTokenSymbol, LiveToken>;
export const HUB_TOKEN_MAP = Object.fromEntries(ROUTE_HUB_TOKENS.map((token) => [token.symbol, token])) as Partial<Record<LiveTokenSymbol, LiveToken>>;
export const LIVE_TOKEN_BY_ADDRESS = Object.fromEntries([...LIVE_TOKENS, ...ROUTE_HUB_TOKENS].map((token) => [token.address.toLowerCase(), token])) as Record<string, LiveToken>;
/** Exported for scripts/tests that must validate both lists regardless of the build target. */
export const TOKEN_LISTS = { testnet: TESTNET_TOKENS, mainnet: MAINNET_TOKENS, mainnetHubs: MAINNET_HUB_TOKENS } as const;
