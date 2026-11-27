import type { Address, Hex } from "viem";

export type QuoteRouteStep = {
  providerId: "UNISWAP_V4_DIRECT" | "UNISWAP_V4_AGGREGATOR_HOOK" | "SYNTHRA_V3" | "UNISWAP_V3" | "REVIEWED_V2_THIRD_PARTY" | "UNISWAP_V2" | "WETH_WRAP";
  providerLabel: string;
  adapter: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  gasEstimate: string;
  poolId: Hex;
  poolFee: number;
  hook: Address;
  verifiedHook: boolean;
  hookCodehash?: Hex;
  data: Hex;
};

export type LiveQuoteCandidate = {
  providerId: string;
  providerLabel: string;
  routeKind: "direct" | "multi-hop" | "cross-venue" | "aggregator-hook";
  routeId: Hex;
  routeData: Hex;
  steps: QuoteRouteStep[];
  amountOut: string;
  minAmountOut: string;
  gasEstimate: string;
  estimatedNetworkFeeWei: string;
  estimatedGasInOutput?: string;
  gasAdjustedOutput?: string;
  gasNormalized: boolean;
  priceImpactBps?: number;
  hook: Address;
  verifiedHook: boolean;
};

export type LiveQuote = {
  contractVersion: number;
  chainId: number;
  quoteId: Hex;
  quoteSignature: Hex;
  quotedAt: number;
  deadline: number;
  policyVersion: number;
  platformFeeBps: number;
  rebateShareBps: number;
  account: Address;
  recipient: Address;
  referrer: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  grossFee: string;
  rebate: string;
  netFee: string;
  routedInput: string;
  slippageBps: number;
  routingMode: "best" | "v4" | "v3" | "v2" | "mixed" | "hooks";
  blockNumber: string;
  requestFingerprint: Hex;
  executable: boolean;
  executionMode: "release" | "allowlisted-staging" | "read-only";
  nonRelease: boolean;
  deploymentReason?: string;
  selected: LiveQuoteCandidate;
  candidates: LiveQuoteCandidate[];
};
