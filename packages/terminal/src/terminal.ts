import { decodeFunctionResult, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import {
  createTerminalSwapGuard,
  GuardDisabledError,
  ZGuardClient,
  type EvmSignerLike,
  type GuardRequest,
  type GuardResponse,
} from "@zguard/sdk";
import {
  buildCurveBuy,
  buildCurveSell,
  buildExactApprove,
  minOutWithSlippage,
  PONS_CURVE_READ_ABI,
  PONS_CURVE_TRADE_ABI,
  PONS_FACTORY_ABI,
  PONS_TOKEN_ABI,
  type GuardedCall,
} from "./pons.js";

export const TERMINAL_SURFACE = "RHC/pons Trading Terminal";

/** Minimal read side of a viem PublicClient (lets tests inject a fake chain). */
export interface ChainReader {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  call(args: { account: Address; to: Address; data: Hex; value?: bigint }): Promise<{ data?: Hex }>;
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ status: "success" | "reverted" }>;
}

export type TerminalMode = "enforce" | "off";

export interface TerminalOptions {
  chainId: number;
  account: string;
  reader: ChainReader;
  /** Wallet that actually signs. Only ever reached through the ZGuard-guarded signer. */
  signer: EvmSignerLike;
  /** `off` exists only so that switching the guard off fails loudly: the terminal then refuses to sign. */
  mode?: TerminalMode;
  /** ZGuard API (an API key is mandatory). Ignored when `evaluate` is supplied (tests). */
  zguard?: { baseUrl?: string; apiKey?: string; fetchImpl?: typeof fetch };
  evaluate?: (req: GuardRequest) => Promise<GuardResponse>;
  slippageBps?: number;
  deadlineSeconds?: number;
  nowSeconds?: () => number;
  onVerdict?: (receipt: GuardResponse) => void;
  onStep?: (message: string) => void;
}

export class TerminalGuardUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalGuardUnavailableError";
  }
}

export interface TradeResult {
  hash: Hex;
  receipt: GuardResponse;
  call: GuardedCall;
  approval?: { hash: Hex; receipt: GuardResponse; call: GuardedCall };
}

/**
 * Local RHC/pons trading terminal. Every approve, buy and sell goes through `createTerminalSwapGuard`:
 * the exact bytes are checked by ZGuard (quote parity, simulation, token risk) and only an unexpired
 * `allow` bound to those bytes reaches the wallet. Deny, abstain, an unreachable API, a missing API key
 * and mode `off` all end before a signature. There is no flag that signs without ZGuard.
 */
export function createPonsTerminal(opts: TerminalOptions) {
  const chainId = opts.chainId;
  const account = getAddress(opts.account);
  const reader = opts.reader;
  const mode: TerminalMode = opts.mode ?? "enforce";
  const slippageBps = opts.slippageBps ?? 300;
  const deadlineSeconds = opts.deadlineSeconds ?? 600;
  const now = opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const step = opts.onStep ?? (() => undefined);

  let evaluate = opts.evaluate;
  if (!evaluate && mode !== "off") {
    const apiKey = opts.zguard?.apiKey?.trim();
    if (!apiKey) {
      throw new TerminalGuardUnavailableError("ZGUARD_API_KEY is not set. The terminal never signs without ZGuard.");
    }
    const client = new ZGuardClient({
      baseUrl: opts.zguard?.baseUrl,
      apiKey,
      fetchImpl: opts.zguard?.fetchImpl,
      timeoutMs: 20_000,
    });
    evaluate = (req: GuardRequest) => client.guard(req);
  }

  const guard = createTerminalSwapGuard({
    chainId,
    enabled: mode !== "off",
    evaluate: async (req) => {
      if (!evaluate) throw new TerminalGuardUnavailableError("No ZGuard evaluator configured. Refusing to sign.");
      try {
        return await evaluate(req);
      } catch (cause) {
        if (cause instanceof TerminalGuardUnavailableError) throw cause;
        const why = cause instanceof Error ? cause.message : String(cause);
        throw new TerminalGuardUnavailableError(`ZGuard could not be reached (${why}). Nothing was signed.`);
      }
    },
    onVerdict: opts.onVerdict,
  });

  function assertEnabled(): void {
    if (mode === "off") throw new GuardDisabledError(TERMINAL_SURFACE);
  }

  function deadline(): bigint {
    return BigInt(now() + deadlineSeconds);
  }

  async function resolveCurve(tokenInput: string): Promise<{ token: Address; curve: Address }> {
    const token = getAddress(tokenInput);
    const curve = getAddress(
      (await reader.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: "curve" })) as string
    );
    const back = getAddress(
      (await reader.readContract({ address: curve, abi: PONS_CURVE_READ_ABI, functionName: "token" })) as string
    );
    if (back !== token) throw new Error(`Curve ${curve} does not belong to token ${token} (curve.token() = ${back})`);
    const graduated = (await reader.readContract({
      address: curve,
      abi: PONS_CURVE_READ_ABI,
      functionName: "graduated",
    })) as boolean;
    if (graduated) throw new Error(`Token ${token} has graduated from its curve; trade it on the DEX (Perm), not the curve`);
    return { token, curve };
  }

  async function simulate(to: Address, data: Hex, value: bigint, fn: "buy" | "sell"): Promise<bigint> {
    const res = await reader.call({ account, to, data, value });
    if (!res.data || res.data === "0x") throw new Error(`Simulation of ${fn} returned no data (would revert)`);
    return decodeFunctionResult({ abi: PONS_CURVE_TRADE_ABI, functionName: fn, data: res.data }) as bigint;
  }

  async function guardAndSend(call: GuardedCall, token: Address): Promise<{ hash: Hex; receipt: GuardResponse }> {
    assertEnabled();
    const { receipt, txHashOrSig } = await guard.guardAndExecuteSwap({
      intent: call.intent,
      tx: call.tx,
      tokenAddress: token,
      signer: opts.signer,
    });
    const mined = await reader.waitForTransactionReceipt({ hash: txHashOrSig });
    if (mined.status !== "success") throw new Error(`Transaction ${txHashOrSig} reverted onchain`);
    return { hash: txHashOrSig, receipt };
  }

  return {
    surface: TERMINAL_SURFACE,
    chainId,
    account,
    mode,
    resolveCurve,

    async quoteBuy(tokenInput: string, ethIn: bigint) {
      const { token, curve } = await resolveCurve(tokenInput);
      const data = encodeFunctionData({ abi: PONS_CURVE_TRADE_ABI, functionName: "buy", args: [0n, deadline()] });
      const tokensOut = await simulate(curve, data, ethIn, "buy");
      return { token, curve, tokensOut, minTokensOut: minOutWithSlippage(tokensOut, slippageBps) };
    },

    async quoteSell(tokenInput: string, tokensIn: bigint) {
      const { token, curve } = await resolveCurve(tokenInput);
      const data = encodeFunctionData({
        abi: PONS_CURVE_TRADE_ABI,
        functionName: "sell",
        args: [tokensIn, 0n, deadline()],
      });
      const ethOut = await simulate(curve, data, 0n, "sell");
      return { token, curve, ethOut, minEthOut: minOutWithSlippage(ethOut, slippageBps) };
    },

    async buy(tokenInput: string, ethIn: bigint): Promise<TradeResult> {
      assertEnabled();
      const q = await this.quoteBuy(tokenInput, ethIn);
      const call = buildCurveBuy({
        chainId,
        curve: q.curve,
        token: q.token,
        from: account,
        ethIn,
        minTokensOut: q.minTokensOut,
        deadline: deadline(),
      });
      step(`ZGuard check: buy on curve ${q.curve}, min ${q.minTokensOut} tokens`);
      const sent = await guardAndSend(call, q.token);
      return { ...sent, call };
    },

    async sell(tokenInput: string, tokensIn: bigint): Promise<TradeResult> {
      assertEnabled();
      const { token, curve } = await resolveCurve(tokenInput);
      const balance = (await reader.readContract({
        address: token,
        abi: PONS_TOKEN_ABI,
        functionName: "balanceOf",
        args: [account],
      })) as bigint;
      if (balance < tokensIn) throw new Error(`Balance ${balance} is below the ${tokensIn} tokens to sell`);

      let approval: TradeResult["approval"];
      const allowance = (await reader.readContract({
        address: token,
        abi: PONS_TOKEN_ABI,
        functionName: "allowance",
        args: [account, curve],
      })) as bigint;
      if (allowance < tokensIn) {
        const call = buildExactApprove({ chainId, token, spender: curve, from: account, amount: tokensIn });
        step(`ZGuard check: approve exactly ${tokensIn} to curve ${curve}`);
        approval = { ...(await guardAndSend(call, token)), call };
      }

      const q = await this.quoteSell(token, tokensIn);
      const call = buildCurveSell({
        chainId,
        curve,
        from: account,
        tokensIn,
        minEthOut: q.minEthOut,
        deadline: deadline(),
      });
      step(`ZGuard check: sell ${tokensIn} on curve ${curve}, min ${q.minEthOut} wei`);
      const sent = await guardAndSend(call, token);
      return { ...sent, call, approval };
    },

    /**
     * pons V2 factory `canLaunch(account)` pre-check before offering a launch (§6.3.6, §7.3). Read-only.
     * `null` = the factory does not implement `canLaunch` (e.g. the testnet BondingCurve factories), so
     * the terminal must not offer a launch-and-buy there.
     */
    async canLaunch(factory: string): Promise<boolean | null> {
      try {
        return (await reader.readContract({
          address: getAddress(factory),
          abi: PONS_FACTORY_ABI,
          functionName: "canLaunch",
          args: [account],
        })) as boolean;
      } catch {
        return null;
      }
    },
  };
}

export type PonsTerminal = ReturnType<typeof createPonsTerminal>;
