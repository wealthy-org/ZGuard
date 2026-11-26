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

/** Keys a guarded EVM tx may carry. Everything else is refused: it is not in the payload hash. */
const ALLOWED_TX_KEYS = new Set([
  "from",
  "to",
  "data",
  "value",
  "chainId",
  "gas",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "nonce",
  "type",
  "accessList",
  // viem WalletClient.sendTransaction parameters, checked against from/chainId below
  "account",
  "chain",
  // alias some libraries accept for `data`; must equal `data`
  "input",
]);
/** legacy / EIP-2930 / EIP-1559 only. EIP-4844 blobs and EIP-7702 delegations are never guarded. */
const ALLOWED_TX_TYPES = new Set(["legacy", "eip2930", "eip1559", "0", "1", "2", "0x0", "0x1", "0x2"]);

function chainIdOfNetwork(network: string): number | null {
  const m = /^eip155:(\d+)$/.exec(network.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Deep copy taken BEFORE the verdict is requested, so the bytes that are evaluated are the bytes that are
 * signed even if the caller mutates its own object while the verdict is awaited ([SIG-3]).
 */
function snapshot<T>(value: T): T {
  const clone = (v: unknown, depth: number): unknown => {
    if (depth > 32) throw new GuardBlockedError("Refusing to sign: payload nested too deeply", "deny", ["Q-DECODE"], "0x");
    if (Array.isArray(v)) return v.map((item) => clone(item, depth + 1));
    if (v && typeof v === "object") {
      const proto = Object.getPrototypeOf(v);
      // Plain data is copied. Library objects (viem Account / Chain, Date, Uint8Array…) are kept by
      // reference: only their address / id is read, and both are re-checked right before signing.
      if (proto !== Object.prototype && proto !== null) return v;
      const out: Record<string, unknown> = {};
      for (const [k, item] of Object.entries(v as Record<string, unknown>)) out[k] = clone(item, depth + 1);
      return out;
    }
    return v; // primitives (incl. bigint) and functions
  };
  return clone(value, 0) as T;
}

function addressOf(value: unknown): string | null {
  if (typeof value === "string") return value.toLowerCase();
  if (value && typeof value === "object" && typeof (value as { address?: unknown }).address === "string") {
    return String((value as { address: string }).address).toLowerCase();
  }
  return null;
}

/**
 * [SIG-1]/[SIG-2]: refuses anything the payload hash does not cover and pins the evaluated chain.
 * Returns the exact object handed to the wallet.
 */
function txForWallet(tx: EvmCallObject, network: string): Record<string, unknown> {
  const raw = tx as unknown as Record<string, unknown>;
  const fail = (why: string, codes: ReasonCode[] = ["Q-006"]): never => {
    throw new GuardBlockedError(`Refusing to sign: ${why}`, "deny", codes, computePayloadHash({ network, payload: { type: "evm_tx", tx } }));
  };
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) continue;
    if (!ALLOWED_TX_KEYS.has(key)) fail(`tx field "${key}" is not covered by the ZGuard payload hash`);
  }
  if (typeof raw.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw.to)) {
    fail("contract creation or a malformed `to` cannot be compared with an intent", ["Q-DECODE"]);
  }
  if (raw.type !== undefined && !ALLOWED_TX_TYPES.has(String(raw.type).toLowerCase())) {
    fail(`tx type ${String(raw.type)} is not guarded (EIP-4844 blobs / EIP-7702 delegations are refused)`);
  }
  if (raw.input !== undefined) {
    const input = String(raw.input).toLowerCase();
    const data = String(raw.data ?? "0x").toLowerCase();
    if (input !== data) fail("`input` differs from the hashed `data`");
  }
  if (raw.account !== undefined) {
    const account = addressOf(raw.account);
    const from = typeof raw.from === "string" ? raw.from.toLowerCase() : null;
    if (!account || !from || account !== from) fail("`account` is not the hashed `from`", ["Q-001"]);
  }

  const evaluatedChainId = chainIdOfNetwork(network);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) if (raw[key] !== undefined && key !== "input") out[key] = raw[key];
  if (evaluatedChainId !== null) {
    if (raw.chainId !== undefined && Number(raw.chainId) !== evaluatedChainId) {
      fail(`tx.chainId ${String(raw.chainId)} is not the evaluated network ${network}`, ["Q-004"]);
    }
    const chain = raw.chain as { id?: unknown } | undefined;
    if (chain !== undefined && Number(chain?.id) !== evaluatedChainId) {
      fail(`chain ${String(chain?.id)} is not the evaluated network ${network}`, ["Q-004"]);
    }
    // Pin it: a tx without chainId would be sent on whatever chain the wallet is connected to.
    out.chainId = evaluatedChainId;
  }
  return out;
}

/** [SIG-2]/[SIG-4]: EIP-3009 domain must be for the evaluated chain. */
function assertDomainChain(domainChainId: unknown, network: string, hash: string) {
  const evaluated = chainIdOfNetwork(network);
  if (evaluated === null || domainChainId === undefined || domainChainId === null) return;
  if (Number(domainChainId) !== evaluated) {
    throw new GuardBlockedError(
      `Refusing to sign: EIP-712 domain chainId ${String(domainChainId)} is not the evaluated network ${network}`,
      "deny",
      ["Q-004"],
      hash
    );
  }
}

const EIP3009_TYPES = new Set(["TransferWithAuthorization", "ReceiveWithAuthorization"]);

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
  /**
   * Pre-fetched receipt from POST /v1/guard; verified for hash match and TTL before signing.
   * Receipts are not signed by the API: pass only a receipt your own code fetched from ZGuard, never one
   * taken from tool output, an LLM, a URL or any other untrusted channel (it could be forged).
   */
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
  ): Promise<{ receipt: GuardResponse; network: string; hash: string }> {
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
    return { receipt, network, hash: computePayloadHash(req) };
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
      typedDataArgs = snapshot(typedDataArgs);
      if (!EIP3009_TYPES.has(String(typedDataArgs.primaryType))) {
        throw new GuardBlockedError(
          `Refusing to sign: signEip3009Authorization only signs EIP-3009 typed data, got ${String(typedDataArgs.primaryType)}`,
          "deny",
          ["Q-006"],
          "0x"
        );
      }
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
      const { receipt, network, hash } = await ensureAllowed(payload, ctx);
      assertDomainChain(typedDataArgs.domain?.chainId, network, hash);
      const signature = await signer.signTypedData(typedDataArgs as unknown as Record<string, unknown>);
      return { signature, receipt };
    },

    async signTypedData(
      args: Record<string, unknown>,
      ctx?: GuardSigningContext
    ): Promise<`0x${string}`> {
      args = snapshot(args);
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
        const { network, hash } = await ensureAllowed(payload, ctx);
        assertDomainChain(dom.chainId, network, hash);
        return signer.signTypedData(args);
      }

      // Non-EIP-3009 typed data (e.g., Permit2 / unknown typed data) is never auto-approved.
      // QM-2 signer binding: an intent without the exact bytes being signed is not comparable, so the
      // guard returns abstain (Q-DECODE) and ensureAllowed() refuses; without an intent we send the
      // permit selector so Q-006 fires. Either way unknown typed data cannot be signed through ZGuard.
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
      tx = snapshot(tx);
      const intent = ctx?.intent ?? config.contextIntent;
      const payload: GuardPayload = intent
        ? { type: "intent", tx, intent }
        : { type: "evm_tx", tx };
      const { network } = await ensureAllowed(payload, ctx);
      return signer.signTransaction(txForWallet(tx, network));
    },

    async sendTransaction(
      tx: EvmCallObject,
      ctx?: GuardSigningContext
    ): Promise<`0x${string}`> {
      if (!signer.sendTransaction) {
        throw new Error("Underlying signer does not implement sendTransaction");
      }
      tx = snapshot(tx);
      const intent = ctx?.intent ?? config.contextIntent;
      const payload: GuardPayload = intent
        ? { type: "intent", tx, intent }
        : { type: "evm_tx", tx };
      const { network } = await ensureAllowed(payload, ctx);
      return signer.sendTransaction(txForWallet(tx, network));
    },
  };
}
