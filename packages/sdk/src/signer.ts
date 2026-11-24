import { NETWORK_RHC_TESTNET } from "./constants.js";
import { computePayloadHash } from "./hash.js";
import type {
  EvmCallObject,
  GuardPayload,
  GuardRequest,
  GuardResponse,
  QuoteInput,
  ReasonCode,
  RouterIntent,
} from "./types.js";

export class GuardBlockedError extends Error {
  public readonly decision: "deny" | "abstain" | "missing";
  public readonly codes: ReasonCode[];
  public readonly payloadHash: string;

  constructor(
    message: string,
    decision: "deny" | "abstain" | "missing",
    codes: ReasonCode[],
    payloadHash: string
  ) {
    super(message);
    this.name = "GuardBlockedError";
    this.decision = decision;
    this.codes = codes;
    this.payloadHash = payloadHash;
  }
}

export class GuardDisabledError extends Error {
  constructor(surface: string) {
    super(
      `[ZGuard] Guard is disabled on ${surface}. Default-on policy blocks silent signing; re-enable ZGuard to proceed.`
    );
    this.name = "GuardDisabledError";
  }
}

export interface EvmSignerLike {
  signTypedData: (args: Record<string, unknown>) => Promise<`0x${string}`>;
  signTransaction?: (tx: EvmCallObject | Record<string, unknown>) => Promise<`0x${string}`>;
  sendTransaction?: (tx: EvmCallObject | Record<string, unknown>) => Promise<`0x${string}`>;
}

export interface GuardSignerConfig {
  network?: string;
  /** Evaluator function (local SDK `guardOffline` or `ZGuardClient.guard`) */
  evaluate?: (req: GuardRequest) => Promise<GuardResponse> | GuardResponse;
  /** Alias for `evaluate` */
  guardFn?: (req: GuardRequest) => Promise<GuardResponse> | GuardResponse;
  /** Default quote context bound to this signer instance */
  contextQuote?: QuoteInput;
  /** Default router intent bound to this signer instance */
  contextIntent?: RouterIntent;
  /**
   * Default false (§4.4): abstain is NEVER permission unless operator explicitly overrides
   * and records `abstainOverride: true` in receiptMeta.
   */
  allowAbstainOverride?: boolean;
  /** Default true (§9 #5): turning this false throws GuardDisabledError visibly, never signs silently */
  enabled?: boolean;
  surfaceName?: string;
  onReceipt?: (receipt: GuardResponse) => void;
}

export interface GuardSigningContext {
  quote?: QuoteInput;
  intent?: RouterIntent;
  token?: string;
  /** Pre-fetched receipt from POST /v1/guard; verified for hash match and TTL before signing */
  receipt?: GuardResponse;
}

/**
 * Validates that a GuardResponse authorizes signing the exact candidate request right now (§4.4).
 */
export function verifyReceiptForSigning(
  candidate: Pick<GuardRequest, "network" | "quote" | "payload" | "token">,
  receipt: GuardResponse | undefined,
  options?: { allowAbstainOverride?: boolean; nowMs?: number }
): { allowed: true; abstainOverrideUsed: boolean } {
  const expectedHash = computePayloadHash(candidate);

  if (!candidate.quote && !candidate.payload?.intent) {
    throw new GuardBlockedError(
      "Refusing to sign: missing quote (x402) or router intent",
      "deny",
      ["Q-005"],
      expectedHash
    );
  }

  if (!receipt) {
    throw new GuardBlockedError(
      "Refusing to sign: no ZGuard verdict receipt supplied",
      "missing",
      ["Q-005"],
      expectedHash
    );
  }

  if (receipt.payload_hash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new GuardBlockedError(
      `Refusing to sign: payload_hash mismatch (checked ${receipt.payload_hash}, signing ${expectedHash})`,
      "deny",
      ["Q-001"],
      expectedHash
    );
  }

  if (receipt.decision === "deny") {
    throw new GuardBlockedError(
      `Refusing to sign: ZGuard denied payload (${receipt.reason})`,
      "deny",
      receipt.codes,
      expectedHash
    );
  }

  if (receipt.decision === "abstain") {
    if (options?.allowAbstainOverride === true) {
      return { allowed: true, abstainOverrideUsed: true };
    }
    throw new GuardBlockedError(
      `Refusing to sign: ZGuard abstained (${receipt.reason}); abstain is not permission`,
      "abstain",
      receipt.codes,
      expectedHash
    );
  }

  if (!receipt.expires_at) {
    throw new GuardBlockedError(
      "Refusing to sign: allow verdict missing expires_at timestamp",
      "abstain",
      [],
      expectedHash
    );
  }

  const expiryMs = Date.parse(receipt.expires_at);
  const nowMs = options?.nowMs ?? Date.now();
  if (!Number.isFinite(expiryMs) || nowMs >= expiryMs) {
    throw new GuardBlockedError(
      `Refusing to sign: allow verdict expired at ${receipt.expires_at}`,
      "deny",
      [],
      expectedHash
    );
  }

  return { allowed: true, abstainOverrideUsed: false };
}

/**
 * Wraps an EVM signer (`signTypedData`, `signTransaction`, `sendTransaction`) so NO byte is signed
 * without a hash-bound, non-expired `allow` verdict (§4.4 & §9 #2/#5/#8).
 */
export function guardEvmSigner<T extends EvmSignerLike>(signer: T, config: GuardSignerConfig = {}) {
  const defaultNetwork = config.network ?? NETWORK_RHC_TESTNET;
  const surface = config.surfaceName ?? "guardEvmSigner";
  const evalFn = config.evaluate ?? config.guardFn;

  async function ensureAllowed(
    payload: GuardPayload,
    ctx?: GuardSigningContext
  ): Promise<GuardResponse> {
    if (config.enabled === false) {
      throw new GuardDisabledError(surface);
    }

    const effectiveQuote = ctx?.quote ?? config.contextQuote;
    const effectiveIntent = ctx?.intent ?? config.contextIntent ?? payload.intent;
    const inferredChainId =
      effectiveIntent?.chainId ??
      effectiveQuote?.chainId ??
      payload.authorization?.domain?.chainId;
    const network =
      config.network ??
      effectiveQuote?.network ??
      (inferredChainId ? `eip155:${inferredChainId}` : defaultNetwork);

    if (!effectiveQuote && !effectiveIntent) {
      const h = computePayloadHash({ network, payload });
      throw new GuardBlockedError(
        "Refusing to sign: no quote or router intent provided",
        "deny",
        ["Q-005"],
        h
      );
    }

    const effectivePayload: GuardPayload =
      effectiveIntent && !payload.intent ? { ...payload, intent: effectiveIntent } : payload;

    const req: GuardRequest = {
      network,
      quote: effectiveQuote,
      payload: effectivePayload,
      token: ctx?.token,
    };

    let receipt = ctx?.receipt;
    if (!receipt) {
      if (!evalFn) {
        throw new GuardBlockedError(
          "Refusing to sign: neither pre-verified receipt nor evaluate() callback provided",
          "missing",
          ["Q-005"],
          computePayloadHash(req)
        );
      }
      receipt = await evalFn(req);
    }

    const check = verifyReceiptForSigning(req, receipt, {
      allowAbstainOverride: config.allowAbstainOverride,
    });

    if (check.abstainOverrideUsed) {
      receipt = {
        ...receipt,
        receiptMeta: {
          ...receipt.receiptMeta,
          abstainOverride: true,
        },
      };
    }

    config.onReceipt?.(receipt);
    return receipt;
  }

  return {
    /** Underlying signer is NOT exposed raw; all signing paths pass through ensureAllowed */
    async signEip3009Authorization(
      typedDataArgs: {
        domain: {
          name?: string;
          version?: string;
          chainId?: number;
          verifyingContract?: `0x${string}`;
        };
        primaryType: "TransferWithAuthorization" | "ReceiveWithAuthorization";
        types: Record<string, unknown>;
        message: {
          from: `0x${string}`;
          to: `0x${string}`;
          value: bigint | string;
          validAfter?: bigint | string | number;
          validBefore?: bigint | string | number;
          nonce: `0x${string}`;
        };
      },
      ctx: GuardSigningContext
    ): Promise<{ signature: `0x${string}`; receipt: GuardResponse }> {
      const payload: GuardPayload = {
        type: "eip3009",
        authorization: {
          kind: typedDataArgs.primaryType,
          from: typedDataArgs.message.from,
          to: typedDataArgs.message.to,
          value: String(typedDataArgs.message.value),
          validAfter: String(typedDataArgs.message.validAfter ?? 0),
          validBefore:
            typedDataArgs.message.validBefore !== undefined
              ? String(typedDataArgs.message.validBefore)
              : undefined,
          nonce: typedDataArgs.message.nonce,
          domain: typedDataArgs.domain,
        },
      };
      const receipt = await ensureAllowed(payload, ctx);
      const signature = await signer.signTypedData(typedDataArgs as unknown as Record<string, unknown>);
      return { signature, receipt };
    },

    async signTypedData(
      args: Record<string, unknown>,
      ctx?: GuardSigningContext
    ): Promise<`0x${string}`> {
      const msg = (args.message ?? {}) as Record<string, unknown>;
      const dom = (args.domain ?? {}) as Record<string, unknown>;
      const primaryType = String(args.primaryType ?? "");
      if (
        primaryType === "TransferWithAuthorization" ||
        primaryType === "ReceiveWithAuthorization"
      ) {
        const payload: GuardPayload = {
          type: "eip3009",
          authorization: {
            kind: primaryType,
            from: String(msg.from ?? ""),
            to: String(msg.to ?? ""),
            value: String(msg.value ?? ""),
            validAfter: msg.validAfter !== undefined ? String(msg.validAfter) : "0",
            validBefore: msg.validBefore !== undefined ? String(msg.validBefore) : undefined,
            nonce: msg.nonce !== undefined ? String(msg.nonce) : undefined,
            domain: {
              name: dom.name !== undefined ? String(dom.name) : undefined,
              version: dom.version !== undefined ? String(dom.version) : undefined,
              chainId: dom.chainId !== undefined ? Number(dom.chainId) : undefined,
              verifyingContract:
                dom.verifyingContract !== undefined ? String(dom.verifyingContract) : undefined,
            },
          },
        };
        await ensureAllowed(payload, ctx);
        return signer.signTypedData(args);
      }

      // Non-EIP-3009 typed data (e.g., Permit2 / unknown typed data) -> deny Q-006 unless explicit intent
      const intent = ctx?.intent ?? config.contextIntent;
      const payload: GuardPayload = intent
        ? { type: "intent", intent }
        : { type: "evm_tx", tx: "0xd505accf" }; // permit selector triggers Q-006 fail-closed
      await ensureAllowed(payload, ctx);
      return signer.signTypedData(args);
    },

    async signTransaction(
      tx: EvmCallObject,
      ctx?: GuardSigningContext
    ): Promise<`0x${string}`> {
      if (!signer.signTransaction) {
        throw new Error("Underlying signer does not implement signTransaction");
      }
      const intent = ctx?.intent ?? config.contextIntent;
      const payload: GuardPayload = intent
        ? { type: "intent", tx, intent }
        : { type: "evm_tx", tx };
      await ensureAllowed(payload, ctx);
      return signer.signTransaction(tx);
    },

    async sendTransaction(
      tx: EvmCallObject,
      ctx?: GuardSigningContext
    ): Promise<`0x${string}`> {
      if (!signer.sendTransaction) {
        throw new Error("Underlying signer does not implement sendTransaction");
      }
      const intent = ctx?.intent ?? config.contextIntent;
      const payload: GuardPayload = intent
        ? { type: "intent", tx, intent }
        : { type: "evm_tx", tx };
      await ensureAllowed(payload, ctx);
      return signer.sendTransaction(tx);
    },
  };
}
