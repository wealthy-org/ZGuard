import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  parseAbiItem,
  parseTransaction,
  type Abi,
  type Hex,
} from "viem";
import { RHC_TESTNET_CHAIN_ID } from "./constants.js";
import { scanContent } from "./content-scan.js";
import { analyzeSolanaTransfer, decodeSolanaTransaction, type SolanaTransferAnalysis } from "./solana-decode.js";
import { APPROVAL_SELECTORS, approvalMatchesAllowList, findApprovals } from "./approvals.js";
import { computeEip712DomainSeparator, getVerifiedEip712Domain } from "./eip712.js";
import type {
  EvmCallObject,
  GuardPayload,
  QuoteCheckResult,
  QuoteInput,
  ReasonCode,
  RouterIntent,
  SpendPolicy,
} from "./types.js";

const COMMON_EVM_PAYMENT_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function increaseAllowance(address spender, uint256 addedValue) returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
]);

// Approval selectors + recursive wrapper scanning live in ./approvals.ts (gaps QM-3, QM-5)

export function parseChainIdFromNetwork(network: string): number | null {
  const m = network.trim().match(/^eip155:(\d+)$/);
  if (!m) return null;
  return Number(m[1]);
}

export function isSolanaNetwork(network: string): boolean {
  return network.trim().toLowerCase().startsWith("solana:");
}

function normAddr(addr?: string | null): string {
  return (addr ?? "").trim().toLowerCase();
}

function parseBigIntSafe(val?: string | number | bigint | null): bigint | null {
  if (val === undefined || val === null || val === "") return null;
  try {
    return BigInt(val);
  } catch {
    return null;
  }
}

export interface QuoteMatchContext {
  network: string;
  quote?: QuoteInput;
  payload?: GuardPayload;
  spendPolicy?: SpendPolicy;
  /** Optional cumulative spend lookup for spendPolicy.maxLifetimeSpend; throwing/null triggers P-UNAVAIL */
  lifetimeSpendLookup?: (asset: string) => bigint | null;
  /** Set true if policy store failed to load -> fail-closed abstain P-UNAVAIL (§5.3 & §6.1.5) */
  policyStoreUnavailable?: boolean;
}

function evaluateSpendPolicy(
  policy: SpendPolicy | undefined,
  payTo: string,
  asset: string,
  amount: bigint,
  lifetimeSpendLookup?: (asset: string) => bigint | null,
  policyStoreUnavailable?: boolean
): { ok: true } | { ok: false; decision: "deny" | "abstain"; code: ReasonCode; note: string } {
  if (policyStoreUnavailable) {
    return {
      ok: false,
      decision: "abstain",
      code: "P-UNAVAIL",
      note: "Spend policy store is unavailable; refusing to assume allow",
    };
  }
  if (!policy) return { ok: true };

  if (policy.allowedAssets && policy.allowedAssets.length > 0) {
    const allowed = policy.allowedAssets.map(normAddr);
    if (!allowed.includes(normAddr(asset))) {
      return {
        ok: false,
        decision: "deny",
        code: "P-401",
        note: `Asset ${asset} is not in spendPolicy.allowedAssets`,
      };
    }
  }

  if (policy.allowedPayees && policy.allowedPayees.length > 0) {
    const allowed = policy.allowedPayees.map(normAddr);
    if (!allowed.includes(normAddr(payTo))) {
      return {
        ok: false,
        decision: "deny",
        code: "P-401",
        note: `Payee ${payTo} is not in spendPolicy.allowedPayees`,
      };
    }
  }

  if (policy.maxPerPayment) {
    for (const [k, capStr] of Object.entries(policy.maxPerPayment)) {
      if (normAddr(k) === normAddr(asset) || k === "*") {
        const cap = parseBigIntSafe(capStr);
        if (cap === null) {
          return {
            ok: false,
            decision: "abstain",
            code: "P-UNAVAIL",
            note: `Invalid spendPolicy.maxPerPayment cap for ${k}`,
          };
        }
        if (amount > cap) {
          return {
            ok: false,
            decision: "deny",
            code: "P-401",
            note: `Payment amount ${amount.toString()} exceeds maxPerPayment cap ${cap.toString()}`,
          };
        }
      }
    }
  }

  if (policy.maxLifetimeSpend) {
    for (const [k, capStr] of Object.entries(policy.maxLifetimeSpend)) {
      if (normAddr(k) === normAddr(asset) || k === "*") {
        const cap = parseBigIntSafe(capStr);
        if (cap === null || !lifetimeSpendLookup) {
          return {
            ok: false,
            decision: "abstain",
            code: "P-UNAVAIL",
            note: "Lifetime spend ledger unavailable to enforce spendPolicy.maxLifetimeSpend",
          };
        }
        const spentSoFar = lifetimeSpendLookup(normAddr(asset));
        if (spentSoFar === null) {
          return {
            ok: false,
            decision: "abstain",
            code: "P-UNAVAIL",
            note: "Failed to read cumulative spend from policy store",
          };
        }
        if (spentSoFar + amount > cap) {
          return {
            ok: false,
            decision: "deny",
            code: "P-401",
            note: `Cumulative spend ${(spentSoFar + amount).toString()} exceeds maxLifetimeSpend ${cap.toString()}`,
          };
        }
      }
    }
  }

  return { ok: true };
}

function sanitizeAbiArg(val: unknown): unknown {
  if (typeof val === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(val)) return val.toLowerCase();
    if (/^-?\d+$/.test(val)) return BigInt(val);
    return val;
  }
  if (typeof val === "number" && Number.isSafeInteger(val)) {
    return BigInt(val);
  }
  if (Array.isArray(val)) return val.map(sanitizeAbiArg);
  return val;
}

function encodeIntentCalldata(intent: RouterIntent): Hex | null {
  try {
    const cleanArgs = (intent.args ?? []).map(sanitizeAbiArg);
    if (intent.abi && Array.isArray(intent.abi)) {
      return encodeFunctionData({
        abi: intent.abi as Abi,
        functionName: intent.function,
        args: cleanArgs,
      });
    }
    if (intent.function.includes("(")) {
      const parseDynamic = parseAbiItem as unknown as (sig: string) => Abi[number];
      const abiItem = parseDynamic(`function ${intent.function}`);
      const fnName = intent.function.slice(0, intent.function.indexOf("(")).trim();
      return encodeFunctionData({
        abi: [abiItem],
        functionName: fnName,
        args: cleanArgs,
      });
    }
    return encodeFunctionData({
      abi: COMMON_EVM_PAYMENT_ABI,
      functionName: intent.function as never,
      args: cleanArgs as never,
    });
  } catch {
    return null;
  }
}

function extractTxObject(rawTx: string | EvmCallObject): EvmCallObject | null {
  if (typeof rawTx === "object" && rawTx !== null) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawTx.to ?? "")) return null;
    if (rawTx.data && !/^0x([0-9a-fA-F]{2})*$/.test(rawTx.data)) return null;
    return rawTx;
  }
  if (typeof rawTx === "string") {
    const trimmed = rawTx.trim();
    if (!/^0x([0-9a-fA-F]{2})+$/.test(trimmed)) return null;
    try {
      const parsed = parseTransaction(trimmed as Hex);
      if (!parsed.to) return null;
      return {
        to: parsed.to,
        data: parsed.data ?? "0x",
        value: (parsed.value ?? 0n).toString(),
        chainId: parsed.chainId ? Number(parsed.chainId) : undefined,
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Pure offline quote-match & router-intent parity engine (§4.1 & §6.1 Dev Brief).
 * Runs in < 1 ms without RPC or telemetry.
 */
export function evaluateQuoteMatch(ctx: QuoteMatchContext): QuoteCheckResult {
  const codes: ReasonCode[] = [];
  const notes: string[] = [];

  const solanaMode = isSolanaNetwork(ctx.network);
  const networkChainId = parseChainIdFromNetwork(ctx.network);

  if (networkChainId === null && !solanaMode) {
    return {
      decision: "abstain",
      codes: ["Q-004"],
      expected: null,
      actual: null,
      notes: [`Unsupported network identifier: ${ctx.network}`],
    };
  }

  const payload = ctx.payload;
  const quote = ctx.quote;
  const intent = payload?.intent;

  // Rule §6.1.1: Missing both quote and router intent -> deny Q-005
  if (!quote && !intent) {
    return {
      decision: "deny",
      codes: ["Q-005"],
      expected: null,
      actual: null,
      notes: ["No quote (x402 channel) or router intent supplied to compare against"],
    };
  }

  if (!payload) {
    return {
      decision: "abstain",
      codes: ["Q-DECODE"],
      expected: quote
        ? {
            payTo: quote.payTo,
            asset: quote.asset,
            amount: quote.amount,
            chainId: quote.chainId ?? networkChainId ?? 0,
          }
        : null,
      actual: null,
      notes: ["Missing transaction or authorization payload"],
    };
  }

  // Rule §6.1.6: Scan any merchant description / memo text inside quote
  if (quote?.description || quote?.memo) {
    const textRes = scanContent({
      text: [quote.description, quote.memo].filter(Boolean).join(" "),
    });
    if (textRes.verdict === "findings") {
      codes.push("C-FINDING");
      notes.push("Quote memo/description matched content payload shape rules");
    }
  }

  // Optional Solana SPL USDC payment rail (§2.1: SPL transfer only for (recipient, mint); deny SetAuthority/Approve)
  if (solanaMode || payload.type === "solana_spl") {
    if (!solanaMode) {
      return {
        decision: "deny",
        codes: ["Q-004"],
        expected: null,
        actual: null,
        notes: [`Solana SPL payload submitted on non-Solana network ${ctx.network}`],
      };
    }
    if (!quote) {
      return {
        decision: "deny",
        codes: ["Q-005"],
        expected: null,
        actual: null,
        notes: ["Solana SPL transfer verification requires an x402 quote"],
      };
    }
    const spl = payload.solanaTransfer;
    const expected = {
      payTo: quote.payTo,
      asset: quote.asset,
      amount: quote.amount,
      chainId: 0,
    };
    if (!spl || !spl.recipient || !spl.mint || parseBigIntSafe(spl.amount) === null) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual: null,
        notes: ["Malformed Solana SPL transfer payload"],
      };
    }
    const actualAmount = parseBigIntSafe(spl.amount)!;
    const expectedAmount = parseBigIntSafe(quote.amount);
    const actual = {
      payTo: spl.recipient,
      asset: spl.mint,
      amount: spl.amount,
      chainId: 0,
    };
    if (expectedAmount === null) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual,
        notes: ["Invalid numeric amount in quote"],
      };
    }

    // The approve/set-authority flag is derived from the decoded instructions, never from the
    // caller-supplied boolean (which could simply be set to false).
    if (!spl.transaction) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual,
        notes: ["Solana SPL payload must include the serialized transaction (base64) so instructions can be decoded"],
      };
    }
    let analysis: SolanaTransferAnalysis;
    try {
      analysis = analyzeSolanaTransfer(decodeSolanaTransaction(spl.transaction));
    } catch (err) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual,
        notes: [`Solana transaction could not be decoded: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
    if (analysis.hasApproveOrSetAuthority) {
      codes.push("Q-006");
      notes.push("Solana SPL Approve / ApproveChecked / SetAuthority instruction decoded and denied (§2.1)");
    }
    if (analysis.disallowed.length > 0) {
      if (!codes.includes("Q-006")) codes.push("Q-006");
      notes.push(`Instructions outside a one-shot SPL transfer: ${analysis.disallowed.join(", ")}`);
    }
    if (analysis.transfers.length !== 1) {
      if (!codes.includes("Q-002")) codes.push("Q-002");
      notes.push(`Expected exactly one SPL transfer instruction, decoded ${analysis.transfers.length}`);
    } else {
      const t = analysis.transfers[0]!;
      if (t.amount !== actualAmount) {
        if (!codes.includes("Q-002")) codes.push("Q-002");
        notes.push(`Decoded transfer amount ${t.amount.toString()} != declared ${actualAmount.toString()}`);
      }
      if (t.kind !== "transferChecked" || t.mint !== spl.mint.trim()) {
        if (!codes.includes("Q-003")) codes.push("Q-003");
        notes.push(
          t.kind !== "transferChecked"
            ? "Use TransferChecked so the mint is bound inside the signed instruction"
            : `Decoded mint ${t.mint} != declared ${spl.mint}`
        );
      }
    }
    const instructions = spl.instructions ?? [];
    for (const ix of instructions) {
      const lowerIx = ix.toLowerCase();
      if (lowerIx.includes("approve") || lowerIx.includes("setauthority")) {
        if (!codes.includes("Q-006")) codes.push("Q-006");
        notes.push(`Solana instruction "${ix}" grants delegate/authority outside one-shot transfer`);
      }
    }

    // Solana base58 addresses are case-sensitive!
    if (spl.recipient.trim() !== quote.payTo.trim()) {
      codes.push("Q-001");
      notes.push(`Solana recipient mismatch: expected ${quote.payTo}, got ${spl.recipient}`);
    }
    if (actualAmount !== expectedAmount) {
      codes.push("Q-002");
      notes.push(`Solana SPL amount mismatch: expected ${expectedAmount.toString()}, got ${actualAmount.toString()}`);
    }
    if (spl.mint.trim() !== quote.asset.trim()) {
      codes.push("Q-003");
      notes.push(`Solana SPL mint mismatch: expected ${quote.asset}, got ${spl.mint}`);
    }

    const policyRes = evaluateSpendPolicy(
      ctx.spendPolicy,
      spl.recipient,
      spl.mint,
      actualAmount,
      ctx.lifetimeSpendLookup,
      ctx.policyStoreUnavailable
    );
    if (!policyRes.ok) {
      codes.push(policyRes.code);
      notes.push(policyRes.note);
      if (policyRes.decision === "abstain" && codes.length === 1) {
        return { decision: "abstain", codes, expected, actual, notes };
      }
    }

    return {
      decision: codes.length > 0 ? "deny" : "allow",
      codes,
      expected,
      actual,
      notes:
        codes.length === 0
          ? [...notes, `Verified Solana SPL one-shot transfer for (${spl.recipient}, ${spl.mint})`]
          : notes,
    };
  }

  // Case 1: EIP-3009 Authorization (x402 payment rail, e.g., USDG on 46630/4663 or USDC on 8453/84532)
  if (payload.type === "eip3009") {
    if (!quote) {
      return {
        decision: "deny",
        codes: ["Q-005"],
        expected: null,
        actual: null,
        notes: ["EIP-3009 authorization requires an x402 quote"],
      };
    }

    const auth = payload.authorization;
    if (
      !auth ||
      !/^0x[0-9a-fA-F]{40}$/.test(auth.to ?? "") ||
      !/^0x[0-9a-fA-F]{40}$/.test(auth.from ?? "") ||
      parseBigIntSafe(auth.value) === null
    ) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected: {
          payTo: quote.payTo,
          asset: quote.asset,
          amount: quote.amount,
          chainId: quote.chainId ?? networkChainId!,
        },
        actual: null,
        notes: ["Malformed EIP-3009 authorization fields"],
      };
    }

    // QM-4: the signed EIP-712 domain is what binds the authorization to a contract and chain.
    // Without it, asset/chain would silently be copied from the quote and Q-003/Q-004 could never fire.
    if (
      !auth.domain ||
      auth.domain.chainId === undefined ||
      auth.domain.chainId === null ||
      !Number.isFinite(Number(auth.domain.chainId)) ||
      !/^0x[0-9a-fA-F]{40}$/.test(String(auth.domain.verifyingContract ?? ""))
    ) {
      return {
        decision: "abstain",
        codes: ["Q-007"],
        expected: {
          payTo: quote.payTo,
          asset: quote.asset,
          amount: quote.amount,
          chainId: quote.chainId ?? networkChainId!,
        },
        actual: null,
        notes: [
          "EIP-3009 authorization must carry the signed EIP-712 domain (chainId + verifyingContract); refusing to assume it from the quote",
        ],
      };
    }

    const expectedChainId = quote.chainId ?? networkChainId!;
    const actualChainId = Number(auth.domain.chainId);
    const actualAsset = String(auth.domain.verifyingContract);
    const expectedAmount = parseBigIntSafe(quote.amount);
    const actualAmount = parseBigIntSafe(auth.value)!;

    const expected = {
      payTo: quote.payTo,
      asset: quote.asset,
      amount: quote.amount,
      chainId: expectedChainId,
    };
    const actual = {
      payTo: auth.to,
      asset: actualAsset,
      amount: auth.value,
      chainId: actualChainId,
    };

    if (expectedAmount === null) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual,
        notes: ["Invalid numeric amount in quote"],
      };
    }

    if (normAddr(auth.to) !== normAddr(quote.payTo)) {
      codes.push("Q-001");
      notes.push(`payTo mismatch: expected ${quote.payTo}, got ${auth.to}`);
    }
    if (actualAmount !== expectedAmount) {
      codes.push("Q-002");
      notes.push(`amount mismatch: expected ${expectedAmount.toString()}, got ${actualAmount.toString()}`);
    }
    if (normAddr(actualAsset) !== normAddr(quote.asset)) {
      codes.push("Q-003");
      notes.push(`asset mismatch: expected ${quote.asset}, got ${actualAsset}`);
    }
    if (actualChainId !== expectedChainId || expectedChainId !== networkChainId) {
      codes.push("Q-004");
      notes.push(`chainId mismatch: expected ${expectedChainId}, got ${actualChainId}`);
    }

    // Rule §6.1.4: Verify EIP-712 domain against on-chain verified contract registry
    const verifiedDomain = getVerifiedEip712Domain(actualChainId, actualAsset);
    if (!verifiedDomain || !verifiedDomain.supportsEip3009) {
      if (codes.some((c) => c === "Q-001" || c === "Q-002" || c === "Q-003" || c === "Q-004")) {
        return { decision: "deny", codes, expected, actual, notes };
      }
      return {
        decision: "abstain",
        codes: [...codes, "Q-007"],
        expected,
        actual,
        notes: [
          ...notes,
          `EIP-712 domain for (${actualChainId}, ${actualAsset}) is not in the onchain-verified allowlist`,
        ],
      };
    }

    if (auth.domain && (auth.domain.name !== undefined || auth.domain.version !== undefined)) {
      const suppliedSep = computeEip712DomainSeparator({
        name: auth.domain.name ?? verifiedDomain.name,
        version: auth.domain.version ?? verifiedDomain.version,
        chainId: auth.domain.chainId ?? actualChainId,
        verifyingContract: (auth.domain.verifyingContract ?? actualAsset) as `0x${string}`,
      });
      if (suppliedSep.toLowerCase() !== verifiedDomain.domainSeparator.toLowerCase()) {
        return {
          decision: "abstain",
          codes: [...codes, "Q-007"],
          expected,
          actual,
          notes: [
            ...notes,
            `Supplied EIP-712 domain parameters do not match onchain DOMAIN_SEPARATOR (${verifiedDomain.domainSeparator})`,
          ],
        };
      }
    }

    // SpendPolicy evaluation (§6.1.5)
    const policyRes = evaluateSpendPolicy(
      ctx.spendPolicy,
      auth.to,
      actualAsset,
      actualAmount,
      ctx.lifetimeSpendLookup,
      ctx.policyStoreUnavailable
    );
    if (!policyRes.ok) {
      codes.push(policyRes.code);
      notes.push(policyRes.note);
      if (policyRes.decision === "abstain" && !codes.some((c) => c.startsWith("Q-00") || c === "P-401")) {
        return { decision: "abstain", codes, expected, actual, notes };
      }
    }

    const denyCodes = codes.filter((c) => c !== "Q-007" && c !== "P-UNAVAIL");
    if (denyCodes.length > 0) {
      return { decision: "deny", codes, expected, actual, notes };
    }

    return {
      decision: "allow",
      codes: [],
      expected,
      actual,
      notes: [
        ...notes,
        `Verified against onchain EIP-712 domain "${verifiedDomain.name}" v${verifiedDomain.version ?? "none"} on chain ${verifiedDomain.chainId}`,
      ],
    };
  }

  // Case 2: Router Intent (Perm or RHC/pons Terminal swap/route)
  if (payload.type === "intent" || intent) {
    if (!intent) {
      return {
        decision: "deny",
        codes: ["Q-005"],
        expected: null,
        actual: null,
        notes: ["payload.type=intent missing intent definition"],
      };
    }

    const expected = {
      payTo: intent.to,
      asset: quote?.asset ?? intent.to,
      amount: quote?.amount ?? intent.value ?? "0",
      chainId: intent.chainId,
    };

    // QM-2: an intent alone is compared with nothing. Only the bytes that will actually be signed
    // (payload.tx) can be checked for parity, so intent-only requests never produce `allow`.
    if (!payload.tx) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual: null,
        notes: [
          "Router intent supplied without payload.tx: nothing to compare (attach the exact transaction that will be signed)",
        ],
      };
    }

    if (intent.chainId !== networkChainId) {
      codes.push("Q-004");
      notes.push(`Intent chainId ${intent.chainId} != network chainId ${networkChainId}`);
    }

    const allowList = intent.allowApprovals ?? [];
    const fnLower = intent.function.toLowerCase();
    const intentIsApproval =
      fnLower.startsWith("approve") ||
      fnLower.startsWith("permit") ||
      fnLower.startsWith("setapprovalforall") ||
      fnLower.startsWith("increaseallowance") ||
      fnLower.startsWith("increaseapproval") ||
      fnLower.startsWith("authorizeoperator") ||
      fnLower.startsWith("setauthority");
    if (intentIsApproval && allowList.length === 0) {
      codes.push("Q-006");
      notes.push(`Approval/delegation function "${intent.function}" is not permitted without an explicit allowApprovals entry`);
    }

    const txObj = extractTxObject(payload.tx);
    if (!txObj) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual: null,
        notes: ["Failed to decode transaction bytes supplied alongside intent"],
      };
    }

    // QM-3 / QM-5: every approval in the calldata (including inside multicall/execute wrappers) must
    // match an allowApprovals entry on token, spender and amount; otherwise Q-006.
    const scan = findApprovals(txObj.to, txObj.data);
    if (scan.undecodableWrapper) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual: null,
        notes: ["Wrapped calldata (multicall/execute) could not be fully decoded; refusing to assume no approval inside"],
      };
    }
    for (const ap of scan.approvals) {
      if (!approvalMatchesAllowList(ap, allowList)) {
        if (!codes.includes("Q-006")) codes.push("Q-006");
        notes.push(
          `Approval ${ap.kind} (selector ${ap.selector}${ap.path.length ? ` via ${ap.path.join(" > ")}` : ""}) to spender ${ap.spender ?? "unknown"} on ${ap.token ?? ap.target} for ${ap.amount === null ? "unbounded/unknown" : ap.amount.toString()} is not covered by intent.allowApprovals`
        );
      }
    }

    if (normAddr(txObj.to) !== normAddr(intent.to)) {
      codes.push("Q-001");
      notes.push(`Transaction target ${txObj.to} != intent target ${intent.to}`);
    }

    const expectedVal = parseBigIntSafe(intent.value ?? "0") ?? 0n;
    const actualVal = parseBigIntSafe(txObj.value ?? "0");
    if (actualVal === null || actualVal !== expectedVal) {
      codes.push("Q-002");
      notes.push(`Transaction value ${String(txObj.value ?? "0")} != intent value ${expectedVal.toString()}`);
    }

    if (txObj.chainId !== undefined && txObj.chainId !== intent.chainId) {
      codes.push("Q-004");
      notes.push(`Transaction chainId ${txObj.chainId} != intent chainId ${intent.chainId}`);
    }

    // QM-1: calldata parity is mandatory. If the intent cannot be re-encoded (bare function name
    // without abi/signature, bad args) we cannot prove the bytes match, so we abstain.
    const reencoded = encodeIntentCalldata(intent);
    const txData = (txObj.data ?? "0x").toLowerCase();
    const actualOut = {
      payTo: txObj.to,
      asset: expected.asset,
      amount: txObj.value ?? "0",
      chainId: txObj.chainId ?? intent.chainId,
    };
    if (!reencoded) {
      return {
        decision: codes.length > 0 ? "deny" : "abstain",
        codes: codes.length > 0 ? codes : ["Q-DECODE"],
        expected,
        actual: actualOut,
        notes: [
          ...notes,
          `Router intent function "${intent.function}" could not be ABI-encoded (provide intent.abi or a full signature like "swap(address,uint256)"); calldata parity unproven`,
        ],
      };
    }
    if (reencoded.toLowerCase() !== txData) {
      return {
        decision: "deny",
        codes: codes.length > 0 ? codes : ["Q-001"],
        expected,
        actual: actualOut,
        notes: [...notes, "Calldata bytes do not match re-encoded router intent"],
      };
    }

    const policyAmount = parseBigIntSafe(expected.amount) ?? 0n;
    const policyRes = evaluateSpendPolicy(
      ctx.spendPolicy,
      intent.to,
      expected.asset,
      policyAmount,
      ctx.lifetimeSpendLookup,
      ctx.policyStoreUnavailable
    );
    if (!policyRes.ok) {
      codes.push(policyRes.code);
      notes.push(policyRes.note);
      if (policyRes.decision === "abstain" && codes.length === 1) {
        return { decision: "abstain", codes, expected, actual: actualOut, notes };
      }
    }

    if (codes.length > 0) {
      return { decision: "deny", codes, expected, actual: actualOut, notes };
    }

    return {
      decision: "allow",
      codes: [],
      expected,
      actual: actualOut,
      notes: [...notes, `Router intent re-encoded byte-for-byte against the signed calldata on chain ${intent.chainId || RHC_TESTNET_CHAIN_ID}`],
    };
  }

  // Case 3: Raw EVM Transaction (`evm_tx`) compared against `quote`
  if (payload.type === "evm_tx") {
    if (!quote) {
      return {
        decision: "deny",
        codes: ["Q-005"],
        expected: null,
        actual: null,
        notes: ["evm_tx payment verification requires a quote"],
      };
    }

    const expectedChainId = quote.chainId ?? networkChainId!;
    const expected = {
      payTo: quote.payTo,
      asset: quote.asset,
      amount: quote.amount,
      chainId: expectedChainId,
    };

    if (!payload.tx) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual: null,
        notes: ["Missing tx field for payload.type=evm_tx"],
      };
    }

    const txObj = extractTxObject(payload.tx);
    if (!txObj) {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual: null,
        notes: ["Failed to decode raw EVM transaction bytes (fail-closed abstain)"],
      };
    }

    const data = (txObj.data ?? "0x") as Hex;
    const txVal = parseBigIntSafe(txObj.value ?? "0") ?? 0n;
    const txChain = txObj.chainId ?? networkChainId!;

    // Native ETH payment if data === "0x"
    if (data === "0x") {
      const isNativeAsset =
        normAddr(quote.asset) === "0x0000000000000000000000000000000000000000" ||
        quote.asset.toUpperCase() === "ETH";
      const actual = {
        payTo: txObj.to,
        asset: isNativeAsset ? quote.asset : "0x0000000000000000000000000000000000000000",
        amount: txVal.toString(),
        chainId: txChain,
      };

      if (!isNativeAsset) codes.push("Q-003");
      if (normAddr(txObj.to) !== normAddr(quote.payTo)) codes.push("Q-001");
      if (txVal !== (parseBigIntSafe(quote.amount) ?? -1n)) codes.push("Q-002");
      if (txChain !== expectedChainId) codes.push("Q-004");

      const policyRes = evaluateSpendPolicy(
        ctx.spendPolicy,
        txObj.to,
        actual.asset,
        txVal,
        ctx.lifetimeSpendLookup,
        ctx.policyStoreUnavailable
      );
      if (!policyRes.ok) {
        codes.push(policyRes.code);
        notes.push(policyRes.note);
        if (policyRes.decision === "abstain" && codes.length === 1) {
          return { decision: "abstain", codes, expected, actual, notes };
        }
      }

      return {
        decision: codes.length > 0 ? "deny" : "allow",
        codes,
        expected,
        actual,
        notes,
      };
    }

    // Decode ERC-20 / EIP-3009 calldata
    let decoded: ReturnType<typeof decodeFunctionData<typeof COMMON_EVM_PAYMENT_ABI>>;
    try {
      decoded = decodeFunctionData({
        abi: COMMON_EVM_PAYMENT_ABI,
        data,
      });
    } catch {
      const selector = data.slice(0, 10).toLowerCase();
      const wrapped = findApprovals(txObj.to, data);
      if (APPROVAL_SELECTORS.has(selector) || wrapped.approvals.length > 0) {
        return {
          decision: "deny",
          codes: ["Q-006"],
          expected,
          actual: null,
          notes: [
            wrapped.approvals.length > 0 && !APPROVAL_SELECTORS.has(selector)
              ? `Approval hidden inside wrapper call (${wrapped.approvals.map((a) => a.path.join(" > ") || a.selector).join(", ")}) on a payment path`
              : `Selector ${selector} is an approval/permit call outside a one-shot payment`,
          ],
        };
      }
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual: null,
        notes: [`Unrecognized or undecodable calldata at selector ${selector}`],
      };
    }

    const fn = decoded.functionName;
    if (
      fn === "approve" ||
      fn === "increaseAllowance" ||
      fn === "setApprovalForAll" ||
      fn === "permit"
    ) {
      return {
        decision: "deny",
        codes: ["Q-006"],
        expected,
        actual: {
          payTo: String(decoded.args?.[0] ?? ""),
          asset: txObj.to,
          amount: String(decoded.args?.[1] ?? "0"),
          chainId: txChain,
        },
        notes: [`${fn}() detected on payment path; approvals/delegates are denied (Q-006)`],
      };
    }

    let actualPayTo = "";
    let actualAmount = 0n;
    if (fn === "transfer") {
      actualPayTo = String(decoded.args[0]);
      actualAmount = BigInt(decoded.args[1]);
    } else if (
      fn === "transferFrom" ||
      fn === "transferWithAuthorization" ||
      fn === "receiveWithAuthorization"
    ) {
      actualPayTo = String(decoded.args[1]);
      actualAmount = BigInt(decoded.args[2]);
    } else {
      return {
        decision: "abstain",
        codes: ["Q-DECODE"],
        expected,
        actual: null,
        notes: [`Decoded function ${fn} is not a direct one-shot x402 payment transfer`],
      };
    }

    const actual = {
      payTo: actualPayTo,
      asset: txObj.to,
      amount: actualAmount.toString(),
      chainId: txChain,
    };

    if (normAddr(actualPayTo) !== normAddr(quote.payTo)) codes.push("Q-001");
    if (actualAmount !== (parseBigIntSafe(quote.amount) ?? -1n)) codes.push("Q-002");
    if (normAddr(txObj.to) !== normAddr(quote.asset)) codes.push("Q-003");
    if (txChain !== expectedChainId) codes.push("Q-004");
    // QM-7: an ERC-20 payment must not also send native ETH to the token contract.
    if (txVal !== 0n) {
      if (!codes.includes("Q-002")) codes.push("Q-002");
      notes.push(`ERC-20 payment call also sends ${txVal.toString()} wei of native value (must be 0)`);
    }

    const policyRes = evaluateSpendPolicy(
      ctx.spendPolicy,
      actualPayTo,
      txObj.to,
      actualAmount,
      ctx.lifetimeSpendLookup,
      ctx.policyStoreUnavailable
    );
    if (!policyRes.ok) {
      codes.push(policyRes.code);
      notes.push(policyRes.note);
      if (policyRes.decision === "abstain" && codes.length === 1) {
        return { decision: "abstain", codes, expected, actual, notes };
      }
    }

    return {
      decision: codes.length > 0 ? "deny" : "allow",
      codes,
      expected,
      actual,
      notes,
    };
  }

  return {
    decision: "abstain",
    codes: ["Q-DECODE"],
    expected: null,
    actual: null,
    notes: ["Unsupported payload.type"],
  };
}
