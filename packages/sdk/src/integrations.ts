import { parseAbi, type PublicClient } from "viem";
import { ZGuardClient } from "./client.js";
import { DEFAULT_ACTIVE_RHC_CHAIN_ID } from "./constants.js";
import {
  GuardDisabledError,
  guardEvmSigner,
  type EvmSignerLike,
} from "./signer.js";
import type {
  EvmCallObject,
  GuardRequest,
  GuardResponse,
  RouterIntent,
  SpendPolicy,
} from "./types.js";

/**
 * Default-On Distribution Adapters (§1.1, §7.4, §8.1, §9 #5 Dev Brief):
 *   1. `createPermRouterGuard`: Drop-in guard gate for Perm (hook-aware DEX router).
 *   2. `createTerminalSwapGuard`: Drop-in guard gate for Bos's RHC/pons Trading Terminal,
 *      including optional `canLaunch(address)` pre-check (§6.3.6 & §7.3).
 *
 * Turning `enabled: false` in dev config NEVER creates a silent bypass — it throws `GuardDisabledError`
 * visibly so UI / router halts before reaching any wallet signature (§9 #5).
 */
export interface DistributionGuardOptions {
  client?: ZGuardClient;
  evaluate?: (req: GuardRequest) => Promise<GuardResponse>;
  chainId?: number;
  enabled?: boolean;
  spendPolicy?: SpendPolicy;
  onVerdict?: (verdict: GuardResponse) => void;
}

export interface PermRouteExecutionInput<TSigner extends EvmSignerLike> {
  /** Router intent assembled deterministically by Perm router code (NEVER by LLM) */
  intent: RouterIntent;
  /** Candidate encoded swap transaction about to be signed */
  tx: EvmCallObject;
  /** Target output or input token to run RHC token-risk on */
  tokenAddress: string;
  signer: TSigner;
}

export function createPermRouterGuard(opts: DistributionGuardOptions = {}) {
  const activeChainId = opts.chainId ?? DEFAULT_ACTIVE_RHC_CHAIN_ID;
  const network = `eip155:${activeChainId}`;
  const zguard = opts.client ?? new ZGuardClient();
  const evalFn = opts.evaluate ?? ((req: GuardRequest) => zguard.guard(req));

  return {
    surface: "Perm DEX Router",
    network,
    async guardAndSignRoute<TSigner extends EvmSignerLike>(
      input: PermRouteExecutionInput<TSigner>
    ): Promise<{ receipt: GuardResponse; txHashOrSig: `0x${string}` }> {
      if (opts.enabled === false) {
        throw new GuardDisabledError("Perm DEX Router");
      }

      const guardReq: GuardRequest = {
        network: `eip155:${input.intent.chainId || activeChainId}`,
        // Must be byte-identical to what guardEvmSigner hashes ({type:"intent", tx, intent}), otherwise
        // the receipt's payload_hash never matches and the signer refuses (found by the C8 test).
        payload: {
          type: "intent",
          tx: input.tx,
          intent: input.intent,
        },
        token: input.tokenAddress,
        checks: ["quote", "simulation", "token_risk"],
        options: {
          spendPolicy: opts.spendPolicy,
        },
      };

      const receipt = await evalFn(guardReq);
      opts.onVerdict?.(receipt);

      const guarded = guardEvmSigner(input.signer, {
        network: guardReq.network,
        enabled: opts.enabled ?? true,
        surfaceName: "Perm DEX Router",
      });

      if (guarded.sendTransaction) {
        const hash = await guarded.sendTransaction(input.tx, {
          intent: input.intent,
          token: input.tokenAddress,
          receipt,
        });
        return { receipt, txHashOrSig: hash };
      }

      if (guarded.signTransaction) {
        const sig = await guarded.signTransaction(input.tx, {
          intent: input.intent,
          token: input.tokenAddress,
          receipt,
        });
        return { receipt, txHashOrSig: sig };
      }

      throw new Error("Supplied signer does not expose sendTransaction or signTransaction");
    },
  };
}

const PONS_CAN_LAUNCH_ABI = parseAbi([
  "function canLaunch(address caller) view returns (bool)",
]);

export function createTerminalSwapGuard(opts: DistributionGuardOptions = {}) {
  const activeChainId = opts.chainId ?? DEFAULT_ACTIVE_RHC_CHAIN_ID;
  const network = `eip155:${activeChainId}`;
  const zguard = opts.client ?? new ZGuardClient();
  const evalFn = opts.evaluate ?? ((req: GuardRequest) => zguard.guard(req));

  return {
    surface: "RHC/pons Trading Terminal",
    network,

    /**
     * Checks `canLaunch(caller)` on pons V2 factory before offering a create/launch-and-buy flow (§6.3.6 & §7.3).
     */
    async checkCanLaunchOnPons(
      publicClient: PublicClient,
      factoryAddress: `0x${string}`,
      callerAddress: `0x${string}`
    ): Promise<boolean> {
      try {
        return await publicClient.readContract({
          address: factoryAddress,
          abi: PONS_CAN_LAUNCH_ABI,
          functionName: "canLaunch",
          args: [callerAddress],
        });
      } catch {
        return false;
      }
    },

    /**
     * Default-on guard before any user or agent swap / curve buy / launch-buy signature in the terminal.
     */
    async guardAndExecuteSwap<TSigner extends EvmSignerLike>(params: {
      intent: RouterIntent;
      tx: EvmCallObject;
      tokenAddress: string;
      recipientForSnipeTax?: string;
      signer: TSigner;
    }): Promise<{ receipt: GuardResponse; txHashOrSig: `0x${string}` }> {
      if (opts.enabled === false) {
        throw new GuardDisabledError("RHC/pons Trading Terminal");
      }

      const reqNetwork = `eip155:${params.intent.chainId || activeChainId}`;
      const guardReq: GuardRequest = {
        network: reqNetwork,
        payload: {
          type: "intent",
          tx: params.tx,
          intent: params.intent,
        },
        token: params.tokenAddress,
        checks: ["quote", "simulation", "token_risk"],
        options: {
          spendPolicy: opts.spendPolicy,
          recipientForSnipeTax: params.recipientForSnipeTax,
        },
      };

      const receipt = await evalFn(guardReq);
      opts.onVerdict?.(receipt);

      const guarded = guardEvmSigner(params.signer, {
        network: reqNetwork,
        enabled: opts.enabled ?? true,
        surfaceName: "RHC/pons Trading Terminal",
      });

      if (guarded.sendTransaction) {
        const hash = await guarded.sendTransaction(params.tx, {
          intent: params.intent,
          token: params.tokenAddress,
          receipt,
        });
        return { receipt, txHashOrSig: hash };
      }

      if (guarded.signTransaction) {
        const sig = await guarded.signTransaction(params.tx, {
          intent: params.intent,
          token: params.tokenAddress,
          receipt,
        });
        return { receipt, txHashOrSig: sig };
      }

      throw new Error("Terminal wallet signer must implement sendTransaction or signTransaction");
    },
  };
}
