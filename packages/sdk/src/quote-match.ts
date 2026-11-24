import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  parseAbiItem,
  parseTransaction,
  type Abi,
  type Hex,
} from "viem";
import { RHC_MAINNET_CHAIN_ID } from "./constants.js";
import { scanContent } from "./content-scan.js";
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

const APPROVAL_SELECTORS = new Set([
  "0x095ea7b3", // approve(address,uint256)
  "0x39509351", // increaseAllowance(address,uint256)
  "0xa22cb465", // setApprovalForAll(address,bool)
  "0xd505accf", // permit(address,address,uint256,uint256,uint8,bytes32,bytes32)
  "0x8fcbaf0c", // DAI-style permit
  "0x2b67b570", // Permit2 approve
  "0x30f28b7a", // Permit2 permitTransferFrom
]);

export function parseChainIdFromNetwork(network: string): number | null {
  const m = network.trim().match(/^eip155:(\d+)$/);
  if (!m) return null;
  return Number(m[1]);
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

  const networkChainId = parseChainIdFromNetwork(ctx.network);
  if (networkChainId === null) {
    return {
      decision: "abstain",
      codes: ["Q-004"],
      expected: null,
      actual: null,
      notes: [`Unsupported or non-EVM network identifier: ${ctx.network}`],
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
            chainId: quote.chainId ?? networkChainId,
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

  // Case 1: EIP-3009 Authorization (x402 payment rail, e.g., USDG on 4663)
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
          chainId: quote.chainId ?? networkChainId,
        },
        actual: null,
        notes: ["Malformed EIP-3009 authorization fields"],
      };
    }

    const expectedChainId = quote.chainId ?? networkChainId;
    const actualChainId = auth.domain?.chainId ?? networkChainId;
    const actualAsset = auth.domain?.verifyingContract ?? quote.asset;
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

  // Case 2: Router Intent (Perm or RHC/pons Terminal swap/route) — with or without raw tx calldata
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

    if (intent.chainId !== networkChainId) {
      codes.push("Q-004");
      notes.push(`Intent chainId ${intent.chainId} != network chainId ${networkChainId}`);
    }

    const fnLower = intent.function.toLowerCase();
    const isExplicitApprovalIntent = intent.allowApprovals && intent.allowApprovals.length > 0;
    if (
      !isExplicitApprovalIntent &&
      (fnLower.startsWith("approve") ||
        fnLower.startsWith("permit") ||
        fnLower.startsWith("setapprovalforall") ||
        fnLower.startsWith("increaseallowance") ||
        fnLower.startsWith("setauthority"))
    ) {
      codes.push("Q-006");
      notes.push(`Approval/delegation function "${intent.function}" is not permitted outside explicit allowApprovals`);
    }

    // If raw tx / call object is also attached, re-encode intent and enforce byte-level parity (§6.1.2)
    if (payload.tx) {
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

      if (txObj.data && txObj.data.length >= 10) {
        const selector = txObj.data.slice(0, 10).toLowerCase();
        if (!isExplicitApprovalIntent && APPROVAL_SELECTORS.has(selector)) {
          codes.push("Q-006");
          notes.push(`Transaction calldata selector ${selector} grants approval/permit outside signed intent`);
        }
      }

      if (normAddr(txObj.to) !== normAddr(intent.to)) {
        codes.push("Q-001");
        notes.push(`Transaction target ${txObj.to} != intent target ${intent.to}`);
      }

      const expectedVal = parseBigIntSafe(intent.value ?? "0") ?? 0n;
      const actualVal = parseBigIntSafe(txObj.value ?? "0") ?? 0n;
      if (actualVal !== expectedVal) {
        codes.push("Q-002");
        notes.push(`Transaction value ${actualVal.toString()} != intent value ${expectedVal.toString()}`);
      }

      if (txObj.chainId !== undefined && txObj.chainId !== intent.chainId) {
        codes.push("Q-004");
        notes.push(`Transaction chainId ${txObj.chainId} != intent chainId ${intent.chainId}`);
      }

      const reencoded = encodeIntentCalldata(intent);
      if (reencoded && txObj.data && txObj.data !== "0x") {
        if (reencoded.toLowerCase() !== txObj.data.toLowerCase()) {
          return {
            decision: "deny",
            codes: codes.length > 0 ? codes : ["Q-001"],
            expected,
            actual: {
              payTo: txObj.to,
              asset: expected.asset,
              amount: txObj.value ?? "0",
              chainId: txObj.chainId ?? intent.chainId,
            },
            notes: [...notes, "Calldata bytes do not match re-encoded router intent"],
          };
        }
      } else if (!reencoded && txObj.data && txObj.data !== "0x") {
        // Cannot re-encode unknown custom function without ABI -> check selector or abstain if undecodable
        if (!/^0x([0-9a-fA-F]{2}){4,}$/.test(txObj.data)) {
          return {
            decision: "abstain",
            codes: ["Q-DECODE"],
            expected,
            actual: null,
            notes: ["Malformed calldata on intent transaction"],
          };
        }
      }
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
      if (policyRes.decision === "abstain") {
        return { decision: "abstain", codes, expected, actual: expected, notes };
      }
    }

    if (codes.length > 0) {
      return { decision: "deny", codes, expected, actual: expected, notes };
    }

    return {
      decision: "allow",
      codes: [],
      expected,
      actual: expected,
      notes: [...notes, `Router intent verified for chain ${intent.chainId || RHC_MAINNET_CHAIN_ID}`],
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

    const expectedChainId = quote.chainId ?? networkChainId;
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
    const txChain = txObj.chainId ?? networkChainId;

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
      if (APPROVAL_SELECTORS.has(selector)) {
        return {
          decision: "deny",
          codes: ["Q-006"],
          expected,
          actual: null,
          notes: [`Selector ${selector} is an approval/permit call outside a one-shot payment`],
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
