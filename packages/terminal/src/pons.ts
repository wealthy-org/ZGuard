import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import type { EvmCallObject, RouterIntent } from "@zguard/sdk";

/**
 * pons bonding-curve ABI as deployed on Robinhood Chain testnet 46630 (unverified contracts; signatures
 * recovered from the bytecode dispatcher and from decoded onchain calls, e.g. curve
 * 0x7206856a27B19c17e7b185D33430E0359AfEF3A5):
 *   buy(uint256 minTokensOut, uint256 deadline) payable  -> returns tokensOut   (selector 0xd6febde8)
 *   sell(uint256 tokensIn, uint256 minEthOut, uint256 deadline) -> returns ethOut (selector 0xd3c9727c)
 */
export const PONS_CURVE_TRADE_ABI = parseAbi([
  "function buy(uint256 minTokensOut, uint256 deadline) payable returns (uint256)",
  "function sell(uint256 tokensIn, uint256 minEthOut, uint256 deadline) returns (uint256)",
]);

export const PONS_CURVE_READ_ABI = parseAbi([
  "function token() view returns (address)",
  "function factory() view returns (address)",
  "function graduated() view returns (bool)",
]);

export const PONS_TOKEN_ABI = parseAbi([
  "function curve() view returns (address)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const PONS_FACTORY_ABI = parseAbi(["function canLaunch(address caller) view returns (bool)"]);

/** The exact signatures sent as `intent.function`, so ZGuard re-encodes the calldata itself (QM-1). */
export const SIG_BUY = "buy(uint256,uint256)";
export const SIG_SELL = "sell(uint256,uint256,uint256)";
export const SIG_APPROVE = "approve(address,uint256)";

export interface GuardedCall {
  intent: RouterIntent;
  tx: EvmCallObject;
}

function addr(value: string): Address {
  return getAddress(value);
}

function positive(label: string, value: bigint): bigint {
  if (value <= 0n) throw new Error(`${label} must be greater than zero`);
  return value;
}

/**
 * Applies slippage to a simulated output. Integer basis points 1..2000 (max 20%); rounding is down so the
 * minimum never exceeds what the slippage allows.
 */
export function minOutWithSlippage(simulatedOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 2000) {
    throw new Error("slippage must be an integer between 1 and 2000 bps");
  }
  return (simulatedOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Curve buy: ETH in, at least `minTokensOut` back. The intent and the tx are built from the same values. */
export function buildCurveBuy(p: {
  chainId: number;
  curve: string;
  token: string;
  from: string;
  ethIn: bigint;
  minTokensOut: bigint;
  deadline: bigint;
}): GuardedCall {
  const curve = addr(p.curve);
  const from = addr(p.from);
  positive("ETH amount", p.ethIn);
  positive("minimum tokens out", p.minTokensOut);
  const args = [p.minTokensOut, p.deadline] as const;
  const data = encodeFunctionData({ abi: PONS_CURVE_TRADE_ABI, functionName: "buy", args });
  return {
    intent: {
      chainId: p.chainId,
      to: curve,
      function: SIG_BUY,
      args: args.map(String),
      value: p.ethIn.toString(),
      from,
      expectedOut: { token: addr(p.token), recipient: from, minAmountOut: p.minTokensOut.toString() },
    },
    tx: { chainId: p.chainId, from, to: curve, data, value: p.ethIn.toString() },
  };
}

/** Curve sell: tokens in, at least `minEthOut` back. */
export function buildCurveSell(p: {
  chainId: number;
  curve: string;
  from: string;
  tokensIn: bigint;
  minEthOut: bigint;
  deadline: bigint;
}): GuardedCall {
  const curve = addr(p.curve);
  const from = addr(p.from);
  positive("token amount", p.tokensIn);
  positive("minimum ETH out", p.minEthOut);
  const args = [p.tokensIn, p.minEthOut, p.deadline] as const;
  const data = encodeFunctionData({ abi: PONS_CURVE_TRADE_ABI, functionName: "sell", args });
  return {
    intent: {
      chainId: p.chainId,
      to: curve,
      function: SIG_SELL,
      args: args.map(String),
      value: "0",
      from,
      expectedOut: {
        token: "0x0000000000000000000000000000000000000000",
        recipient: from,
        minAmountOut: p.minEthOut.toString(),
      },
    },
    tx: { chainId: p.chainId, from, to: curve, data, value: "0" },
  };
}

/**
 * Exact approval: only the amount about to be sold, only to the curve that was resolved from the token.
 * The intent lists it in `allowApprovals`, so ZGuard denies any other spender or amount (Q-APPROVAL).
 */
export function buildExactApprove(p: {
  chainId: number;
  token: string;
  spender: string;
  from: string;
  amount: bigint;
}): GuardedCall {
  const token = addr(p.token);
  const spender = addr(p.spender);
  const from = addr(p.from);
  positive("approval amount", p.amount);
  const data = encodeFunctionData({ abi: PONS_TOKEN_ABI, functionName: "approve", args: [spender, p.amount] });
  return {
    intent: {
      chainId: p.chainId,
      to: token,
      function: SIG_APPROVE,
      args: [spender, p.amount.toString()],
      value: "0",
      from,
      allowApprovals: [{ token, spender, maxAmount: p.amount.toString() }],
    },
    tx: { chainId: p.chainId, from, to: token, data, value: "0" },
  };
}

export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}
