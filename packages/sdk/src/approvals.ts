import { decodeFunctionData, parseAbi, type Hex } from "viem";

/**
 * Approval / delegation detection for EVM calldata (gaps QM-3, QM-5).
 *
 * Finds every call that grants a spender/operator power over the signer's assets, including calls
 * wrapped inside multicall / Multicall3 aggregate / ERC-4337 execute / Safe execTransaction and
 * Uniswap Universal Router PERMIT2 commands, recursively.
 */

export type ApprovalKind =
  | "erc20-approve" // approve / increaseAllowance / increaseApproval / approveAndCall / safeIncreaseAllowance
  | "erc2612-permit" // permit(owner, spender, value, …)
  | "dai-permit" // permit(holder, spender, nonce, expiry, allowed, …) — unlimited when allowed
  | "permit2-approve" // Permit2.approve(token, spender, amount, expiration)
  | "permit2-permit" // Permit2.permit single/batch, permitTransferFrom
  | "operator" // setApprovalForAll / authorizeOperator — unbounded by design
  | "router-permit2" // Universal Router PERMIT2_PERMIT / PERMIT2_PERMIT_BATCH command
  | "opaque-approval"; // known approval selector that could not be decoded

export interface DetectedApproval {
  kind: ApprovalKind;
  selector: string;
  /** Contract the approval call is made on (token for ERC-20, Permit2 for Permit2 calls). */
  target: string;
  /** Token whose allowance is granted, when known. */
  token: string | null;
  spender: string | null;
  /** Granted amount; null = unbounded or unknown. */
  amount: bigint | null;
  /** Wrapper path, e.g. ["multicall", "execute"]. */
  path: string[];
}

export const APPROVAL_SELECTORS: ReadonlySet<string> = new Set([
  "0x095ea7b3", // approve(address,uint256)
  "0x39509351", // increaseAllowance(address,uint256)
  "0xd73dd623", // increaseApproval(address,uint256) (legacy OZ)
  "0xcae9ca51", // approveAndCall(address,uint256,bytes) (ERC-1363 style)
  "0xf9255c1f", // safeIncreaseAllowance(address,address,uint256) (exposed helper contracts)
  "0x959b8c3f", // authorizeOperator(address) (ERC-777)
  "0xa22cb465", // setApprovalForAll(address,bool)
  "0xd505accf", // permit(address,address,uint256,uint256,uint8,bytes32,bytes32) (ERC-2612)
  "0x8fcbaf0c", // DAI-style permit
  "0x87517c45", // Permit2 approve(address,address,uint160,uint48)
  "0x2b67b570", // Permit2 permit (single)
  "0x2a2d80d1", // Permit2 permit (batch)
  "0x30f28b7a", // Permit2 permitTransferFrom
]);

const APPROVAL_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function increaseApproval(address spender, uint256 addedValue)",
  "function approveAndCall(address spender, uint256 amount, bytes data)",
  "function safeIncreaseAllowance(address token, address spender, uint256 value)",
  "function authorizeOperator(address operator)",
  "function setApprovalForAll(address operator, bool approved)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)",
  "function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permitBatch, bytes signature)",
]);

const WRAPPER_ABI = parseAbi([
  "function multicall(bytes[] data)",
  "function multicall(uint256 deadline, bytes[] data)",
  "function aggregate((address target, bytes callData)[] calls)",
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls)",
  "function tryAggregate(bool requireSuccess, (address target, bytes callData)[] calls)",
  "function execute(address dest, uint256 value, bytes func)",
  "function executeBatch(address[] dest, uint256[] value, bytes[] func)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)",
  "function execute(bytes commands, bytes[] inputs)",
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
]);

const WRAPPER_SELECTORS = new Set([
  "0xac9650d8",
  "0x5ae401dc",
  "0x252dba42",
  "0x82ad56cb",
  "0xbce38bd7",
  "0xb61d27f6",
  "0x47e1da2a",
  "0x34fcd5be",
  "0x6a761202",
  "0x24856bc3",
  "0x3593564c",
]);

/** Universal Router command ids (low 6 bits) that grant Permit2 allowances. */
const UR_PERMIT2_PERMIT = 0x0a;
const UR_PERMIT2_PERMIT_BATCH = 0x03;

const MAX_DEPTH = 4;

function lower(a: unknown): string | null {
  return typeof a === "string" ? a.toLowerCase() : null;
}

function toBig(v: unknown): bigint | null {
  try {
    return v === undefined || v === null ? null : BigInt(v as string | number | bigint);
  } catch {
    return null;
  }
}

function isHexData(data: unknown): data is Hex {
  return typeof data === "string" && /^0x([0-9a-fA-F]{2})*$/.test(data);
}

/**
 * Returns every approval/delegation found in `data` called on `target`, recursing into wrappers.
 * `undecodableWrapper` is set when a wrapper selector was seen but its body could not be decoded
 * (callers should treat that as fail-closed).
 */
export function findApprovals(
  target: string,
  data: string | undefined | null,
  path: string[] = [],
  depth = 0
): { approvals: DetectedApproval[]; undecodableWrapper: boolean } {
  const out: DetectedApproval[] = [];
  let undecodableWrapper = false;
  if (!isHexData(data) || data.length < 10) return { approvals: out, undecodableWrapper };
  const selector = data.slice(0, 10).toLowerCase();
  const tgt = target.toLowerCase();

  if (APPROVAL_SELECTORS.has(selector)) {
    out.push(decodeApproval(tgt, data, selector, path));
    return { approvals: out, undecodableWrapper };
  }

  if (!WRAPPER_SELECTORS.has(selector)) return { approvals: out, undecodableWrapper };
  if (depth >= MAX_DEPTH) return { approvals: out, undecodableWrapper: true };

  const recurse = (innerTarget: string, innerData: unknown, label: string) => {
    if (!isHexData(innerData)) return;
    const r = findApprovals(innerTarget, innerData, [...path, label], depth + 1);
    out.push(...r.approvals);
    if (r.undecodableWrapper) undecodableWrapper = true;
  };

  try {
    const decoded = decodeFunctionData({ abi: WRAPPER_ABI, data });
    const args = (decoded.args ?? []) as readonly unknown[];
    switch (decoded.functionName) {
      case "multicall": {
        const calls = (args.length === 1 ? args[0] : args[1]) as readonly Hex[];
        for (const c of calls) recurse(tgt, c, "multicall");
        break;
      }
      case "aggregate":
      case "aggregate3": {
        const calls = args[0] as readonly { target: string; callData: Hex }[];
        for (const c of calls) recurse(c.target, c.callData, decoded.functionName);
        break;
      }
      case "tryAggregate": {
        const calls = args[1] as readonly { target: string; callData: Hex }[];
        for (const c of calls) recurse(c.target, c.callData, "tryAggregate");
        break;
      }
      case "execute": {
        if (typeof args[0] === "string" && /^0x[0-9a-fA-F]{40}$/.test(args[0])) {
          recurse(args[0] as string, args[2], "execute");
        } else {
          // Universal Router: execute(bytes commands, bytes[] inputs[, deadline])
          const commands = args[0] as Hex;
          const bytes = commands.slice(2).match(/.{2}/g) ?? [];
          bytes.forEach((b, i) => {
            const cmd = parseInt(b, 16) & 0x3f;
            if (cmd === UR_PERMIT2_PERMIT || cmd === UR_PERMIT2_PERMIT_BATCH) {
              out.push({
                kind: "router-permit2",
                selector,
                target: tgt,
                token: null,
                spender: null,
                amount: null,
                path: [...path, `execute#${i}`],
              });
            }
          });
        }
        break;
      }
      case "executeBatch": {
        if (args.length === 3) {
          const dests = args[0] as readonly string[];
          const funcs = args[2] as readonly Hex[];
          funcs.forEach((f, i) => recurse(dests[i] ?? tgt, f, "executeBatch"));
        } else {
          const calls = args[0] as readonly { target: string; data: Hex }[];
          for (const c of calls) recurse(c.target, c.data, "executeBatch");
        }
        break;
      }
      case "execTransaction": {
        recurse(args[0] as string, args[2], "execTransaction");
        break;
      }
    }
  } catch {
    undecodableWrapper = true;
  }
  return { approvals: out, undecodableWrapper };
}

function decodeApproval(target: string, data: Hex, selector: string, path: string[]): DetectedApproval {
  const base = { selector, target, path };
  try {
    const d = decodeFunctionData({ abi: APPROVAL_ABI, data });
    const a = (d.args ?? []) as readonly unknown[];
    switch (d.functionName) {
      case "approve":
        if (a.length === 4) {
          return { ...base, kind: "permit2-approve", token: lower(a[0]), spender: lower(a[1]), amount: toBig(a[2]) };
        }
        return { ...base, kind: "erc20-approve", token: target, spender: lower(a[0]), amount: toBig(a[1]) };
      case "increaseAllowance":
      case "increaseApproval":
      case "approveAndCall":
        return { ...base, kind: "erc20-approve", token: target, spender: lower(a[0]), amount: toBig(a[1]) };
      case "safeIncreaseAllowance":
        return { ...base, kind: "erc20-approve", token: lower(a[0]), spender: lower(a[1]), amount: toBig(a[2]) };
      case "authorizeOperator":
        return { ...base, kind: "operator", token: target, spender: lower(a[0]), amount: null };
      case "setApprovalForAll":
        return { ...base, kind: "operator", token: target, spender: lower(a[0]), amount: a[1] === false ? 0n : null };
      case "permit": {
        if (a.length === 7) {
          return { ...base, kind: "erc2612-permit", token: target, spender: lower(a[1]), amount: toBig(a[2]) };
        }
        if (a.length === 8) {
          return { ...base, kind: "dai-permit", token: target, spender: lower(a[1]), amount: a[4] === false ? 0n : null };
        }
        const p = a[1] as {
          details: { token: string; amount: bigint } | readonly { token: string; amount: bigint }[];
          spender: string;
        };
        const det = Array.isArray(p.details) ? p.details : [p.details];
        const first = det[0] as { token: string; amount: bigint } | undefined;
        return {
          ...base,
          kind: "permit2-permit",
          token: det.length === 1 && first ? first.token.toLowerCase() : null,
          spender: lower(p.spender),
          amount: det.length === 1 && first ? BigInt(first.amount) : null,
        };
      }
    }
  } catch {
    // fall through
  }
  return { ...base, kind: "opaque-approval", token: null, spender: null, amount: null };
}

export interface AllowedApproval {
  token: string;
  spender: string;
  maxAmount: string;
}

/**
 * QM-3: an approval is only acceptable when it matches an explicit `allowApprovals` entry on token,
 * spender AND amount <= maxAmount. Operator approvals, unbounded/unknown amounts, router Permit2
 * commands and undecodable approvals never match.
 */
export function approvalMatchesAllowList(
  approval: DetectedApproval,
  allowList: readonly AllowedApproval[] | undefined
): boolean {
  if (!allowList || allowList.length === 0) return false;
  if (approval.kind === "operator" && approval.amount === 0n) return true; // revoking is harmless
  if (approval.kind === "dai-permit" && approval.amount === 0n) return true;
  if (
    approval.kind === "operator" ||
    approval.kind === "router-permit2" ||
    approval.kind === "opaque-approval" ||
    approval.amount === null ||
    !approval.token ||
    !approval.spender
  ) {
    return false;
  }
  return allowList.some((entry) => {
    let max: bigint;
    try {
      max = BigInt(entry.maxAmount);
    } catch {
      return false;
    }
    return (
      entry.token.toLowerCase() === approval.token &&
      entry.spender.toLowerCase() === approval.spender &&
      approval.amount !== null &&
      approval.amount <= max
    );
  });
}
