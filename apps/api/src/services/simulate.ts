import {
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Abi,
  type Hex,
  type PublicClient,
} from "viem";
import {
  KNOWN_RHC_CONTRACTS,
  getRhcChainProfile,
  isSupportedRhcChainId,
  parseChainIdFromNetwork,
  type BalanceChange,
  type EvmCallObject,
  type GuardRequest,
  type NamedCall,
  type ReasonCode,
  type SimulationCheckResult,
  type SurfacedApproval,
} from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";
import { rawRhcRpc } from "./rhc-rpc.js";
import { checkSequencerHealth } from "./sequencer.js";

const ERC20_META_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const APPROVAL_FOR_ALL_TOPIC =
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";

// SIM-2: Permit2 allowance events (the Permit2 contract emits them, not the token).
const PERMIT2_APPROVAL_TOPIC = keccak256(toHex("Approval(address,address,address,uint160,uint48)"));
const PERMIT2_PERMIT_TOPIC = keccak256(toHex("Permit(address,address,address,uint160,uint48,uint48)"));
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

const MAX_UINT128 = (1n << 128n) - 1n;

interface EthSimulateLog {
  address: string;
  topics: string[];
  data: string;
}

interface EthSimulateCallResult {
  status: string;
  gasUsed: string;
  returnData?: string;
  logs?: EthSimulateLog[];
  error?: { code?: number; message?: string; data?: string };
}

interface EthSimulateBlockResult {
  gasUsed: string;
  calls: EthSimulateCallResult[];
}

function topicToAddress(topic?: string): string | null {
  if (!topic || topic.length < 42) return null;
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function sanitizeSimArg(val: unknown): unknown {
  if (typeof val === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(val)) return val.toLowerCase();
    if (/^-?\d+$/.test(val)) return BigInt(val);
    return val;
  }
  if (typeof val === "number" && Number.isSafeInteger(val)) {
    return BigInt(val);
  }
  if (Array.isArray(val)) return val.map(sanitizeSimArg);
  return val;
}

type BuiltCall =
  | {
      ok: true;
      call: { from: Hex; to: Hex; data: Hex; value: Hex };
      syntheticEip3009?: boolean;
    }
  | { ok: false; reason: string };

/**
 * SIM-1: the simulation must run as the account that will actually sign. A placeholder sender (the old
 * 0x…01 default) can hide sender-dependent behaviour (e.g. a contract that only drains `msg.sender == victim`),
 * so a missing or contradictory sender is an abstain, never a simulation.
 */
function resolveSender(candidates: Array<string | undefined | null>): { ok: true; from: Hex } | { ok: false; reason: string } {
  const given = candidates.filter((c): c is string => typeof c === "string" && c.length > 0);
  if (given.length === 0) {
    return { ok: false, reason: "No sender to simulate as: supply tx.from / intent.from or a signed raw tx (simulating from a placeholder address proves nothing)" };
  }
  for (const g of given) {
    if (!ADDR_RE.test(g) || g.toLowerCase() === ZERO_ADDR) return { ok: false, reason: `Invalid sender address ${g}` };
  }
  const first = given[0]!.toLowerCase();
  if (given.some((g) => g.toLowerCase() !== first)) {
    return { ok: false, reason: `Contradictory senders (${Array.from(new Set(given.map((g) => g.toLowerCase()))).join(" vs ")})` };
  }
  return { ok: true, from: first as Hex };
}

async function buildCallFromRequest(req: GuardRequest, chainId: number): Promise<BuiltCall> {
  const payload = req.payload;
  if (!payload) {
    return { ok: false, reason: "No payload supplied to simulate" };
  }

  // 1. EIP-3009 authorization: simulate the underlying token transfer on RHC (46630 / 4663)
  if (payload.type === "eip3009") {
    const auth = payload.authorization;
    const tokenAddr = auth?.domain?.verifyingContract ?? req.quote?.asset;
    if (
      !auth ||
      !tokenAddr ||
      !/^0x[0-9a-fA-F]{40}$/.test(tokenAddr) ||
      !/^0x[0-9a-fA-F]{40}$/.test(auth.from ?? "") ||
      !/^0x[0-9a-fA-F]{40}$/.test(auth.to ?? "")
    ) {
      return { ok: false, reason: "Malformed EIP-3009 authorization for simulation" };
    }
    try {
      const data = encodeFunctionData({
        abi: ERC20_META_ABI,
        functionName: "transfer",
        args: [auth.to.toLowerCase() as Hex, BigInt(auth.value)],
      });
      return {
        ok: true,
        syntheticEip3009: true,
        call: {
          from: auth.from.toLowerCase() as Hex,
          to: tokenAddr.toLowerCase() as Hex,
          data,
          value: "0x0",
        },
      };
    } catch {
      return { ok: false, reason: "Invalid EIP-3009 value for simulation" };
    }
  }

  // 2. Raw or structured EVM tx
  if (payload.tx) {
    if (typeof payload.tx === "string") {
      let parsed: ReturnType<typeof parseTransaction>;
      try {
        parsed = parseTransaction(payload.tx as Hex);
      } catch {
        return { ok: false, reason: "Failed to parse raw EVM transaction bytes" };
      }
      if (!parsed.to) return { ok: false, reason: "Contract creation tx not supported" };
      if (parsed.chainId !== undefined && parsed.chainId !== chainId) {
        return { ok: false, reason: `Raw tx chainId ${parsed.chainId} does not match ${req.network}` };
      }
      let signer: string | undefined;
      if (parsed.r && parsed.s) {
        try {
          signer = await recoverTransactionAddress({ serializedTransaction: payload.tx as never });
        } catch {
          return { ok: false, reason: "Raw tx signature could not be recovered" };
        }
      }
      const sender = resolveSender([signer, payload.intent?.from]);
      if (!sender.ok) return sender;
      return {
        ok: true,
        call: {
          from: sender.from,
          to: parsed.to.toLowerCase() as Hex,
          data: (parsed.data ?? "0x") as Hex,
          value: `0x${(parsed.value ?? 0n).toString(16)}` as Hex,
        },
      };
    }

    const txObj = payload.tx as EvmCallObject;
    if (!/^0x[0-9a-fA-F]{40}$/.test(txObj.to ?? "")) {
      return { ok: false, reason: "Invalid tx.to address" };
    }
    const valBig = BigInt(txObj.value ?? "0");
    const sender = resolveSender([txObj.from, payload.intent?.from]);
    if (!sender.ok) return sender;
    return {
      ok: true,
      call: {
        from: sender.from,
        to: txObj.to.toLowerCase() as Hex,
        data: ((txObj.data && txObj.data.startsWith("0x") ? txObj.data : "0x") as Hex),
        value: `0x${valBig.toString(16)}` as Hex,
      },
    };
  }

  // 3. Router intent without pre-encoded tx
  if (payload.intent) {
    const intent = payload.intent;
    try {
      const parseDynamic = parseAbiItem as unknown as (sig: string) => Abi[number];
      const abi = intent.abi
        ? (intent.abi as Abi)
        : intent.function.includes("(")
          ? [parseDynamic(`function ${intent.function}`)]
          : ERC20_META_ABI;
      const fnName = intent.function.includes("(")
        ? intent.function.slice(0, intent.function.indexOf("(")).trim()
        : intent.function;
      const data = encodeFunctionData({
        abi,
        functionName: fnName,
        args: (intent.args ?? []).map(sanitizeSimArg),
      });
      const valBig = BigInt(intent.value ?? "0");
      const sender = resolveSender([intent.from]);
      if (!sender.ok) return sender;
      return {
        ok: true,
        call: {
          from: sender.from,
          to: intent.to.toLowerCase() as Hex,
          data,
          value: `0x${valBig.toString(16)}` as Hex,
        },
      };
    } catch (err) {
      return {
        ok: false,
        reason: `Could not encode intent function "${intent.function}" for simulation: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  return { ok: false, reason: "No simulatable transaction or intent found" };
}

/**
 * Simulates a candidate payment or swap against live Robinhood Chain (Testnet 46630 or Mainnet 4663) state (§6.2).
 * Primary method: `eth_simulateV1` with `traceTransfers: true`, extracting exact ETH & ERC-20 balance deltas,
 * surfaced approvals, L2 sequencer health, and named calls (PoolManager v4, pons hooks, curves).
 */
export async function simulateOnRhc(
  config: ZGuardAppConfig,
  client: PublicClient,
  req: GuardRequest,
  /** State to simulate against. Default "latest"; a past block (hex) is used to replay a mined tx (§9.3 check). */
  blockTag: string = "latest"
): Promise<SimulationCheckResult> {
  const chainId = parseChainIdFromNetwork(req.network);
  if (!isSupportedRhcChainId(chainId)) {
    return {
      decision: "abstain",
      codes: ["S-FAIL"],
      status: "unknown",
      gasUsed: null,
      balanceChanges: [],
      approvals: [],
      calls: [],
      notes: [
        `Simulation supports Robinhood Chain eip155:46630 (Testnet) and eip155:4663 (Mainnet) (received ${req.network})`,
      ],
    };
  }

  const built = await buildCallFromRequest(req, chainId);
  if (!built.ok) {
    return {
      decision: "abstain",
      codes: ["S-FAIL"],
      status: "unknown",
      gasUsed: null,
      balanceChanges: [],
      approvals: [],
      calls: [],
      notes: [built.reason],
    };
  }

  const { call, syntheticEip3009 } = built;
  const profile = getRhcChainProfile(chainId);
  const notes: string[] = [];
  const codes: ReasonCode[] = [];

  try {
    const seqHealthPromise = checkSequencerHealth(config, client, chainId);

    if (syntheticEip3009 && req.payload?.authorization) {
      const payer = call.from.toLowerCase();
      if (call.to.toLowerCase() === profile.usdgAddress.toLowerCase()) {
        const realBal = await client
          .readContract({
            address: call.to,
            abi: ERC20_META_ABI,
            functionName: "balanceOf",
            args: [call.from],
          })
          .catch(() => 0n);

        if (realBal === 0n && payer.startsWith("0x000000000000000000000000000000000000")) {
          notes.push("Dry-run fixture sender detected (0x000…); verifying contract transfer path");
        }
      }
    }

    const [simBlocks, seqHealth] = await Promise.all([
      rawRhcRpc<EthSimulateBlockResult[]>(
        config,
        "eth_simulateV1",
        [
          {
            blockStateCalls: [{ calls: [call] }],
            traceTransfers: true,
            validation: false,
          },
          blockTag,
        ],
        chainId
      ),
      seqHealthPromise,
    ]);

    if (!seqHealth.up || !seqHealth.gracePeriodPassed) {
      return {
        decision: "abstain",
        codes: ["S-SEQUENCER"],
        method: "eth_simulateV1",
        status: "unknown",
        gasUsed: null,
        balanceChanges: [],
        approvals: [],
        calls: [],
        notes: [
          `RHC (${chainId}) L2 sequencer health check failed (up=${seqHealth.up}, gracePassed=${seqHealth.gracePeriodPassed}, blockAge=${seqHealth.latestBlockAgeSeconds}s)`,
        ],
      };
    }

    const firstBlock = simBlocks?.[0];
    const callRes = firstBlock?.calls?.[0];
    if (!callRes) {
      return {
        decision: "abstain",
        codes: ["S-FAIL"],
        method: "eth_simulateV1",
        status: "unknown",
        gasUsed: null,
        balanceChanges: [],
        approvals: [],
        calls: [],
        notes: ["eth_simulateV1 returned an empty call result"],
      };
    }

    const succeeded = callRes.status === "0x1";
    const logs = callRes.logs ?? [];

    const touchedAddresses = new Set<string>([call.to.toLowerCase()]);
    for (const lg of logs) {
      if (lg.address) touchedAddresses.add(lg.address.toLowerCase());
    }

    const namedCalls: NamedCall[] = Array.from(touchedAddresses).map((addr) => {
      const known = KNOWN_RHC_CONTRACTS[addr];
      return {
        to: addr,
        label: known?.label,
        category: known?.category,
        selector:
          addr === call.to.toLowerCase() && call.data.length >= 10
            ? call.data.slice(0, 10)
            : undefined,
        value: addr === call.to.toLowerCase() ? call.value : undefined,
      };
    });

    const netDeltas = new Map<string, bigint>();
    const approvals: SurfacedApproval[] = [];
    const ZERO_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    for (const lg of logs) {
      const topic0 = (lg.topics?.[0] ?? "").toLowerCase();
      const tokenAddr = lg.address.toLowerCase();

      if (topic0 === TRANSFER_TOPIC && lg.topics.length >= 3) {
        const fromAddr = topicToAddress(lg.topics[1]);
        const toAddr = topicToAddress(lg.topics[2]);
        const rawAmt = lg.data && lg.data !== "0x" ? BigInt(lg.data) : 0n;
        const assetId = tokenAddr === ZERO_ETH ? "ETH" : tokenAddr;

        if (fromAddr && fromAddr !== "0x0000000000000000000000000000000000000000") {
          const k = `${fromAddr}|${assetId}`;
          netDeltas.set(k, (netDeltas.get(k) ?? 0n) - rawAmt);
        }
        if (toAddr && toAddr !== "0x0000000000000000000000000000000000000000") {
          const k = `${toAddr}|${assetId}`;
          netDeltas.set(k, (netDeltas.get(k) ?? 0n) + rawAmt);
        }
      } else if (topic0 === APPROVAL_TOPIC && lg.topics.length === 4) {
        // SIM-2: ERC-721 approve(spender, tokenId): all three params indexed, empty data. Approving the zero
        // address clears the approval.
        const owner = topicToAddress(lg.topics[1]) ?? call.from.toLowerCase();
        const spender = topicToAddress(lg.topics[2]) ?? "";
        if (spender && spender !== ZERO_ADDR) {
          approvals.push({
            owner,
            spender,
            token: tokenAddr,
            amount: `tokenId:${BigInt(lg.topics[3]!).toString()}`,
            unlimited: false,
          });
        }
      } else if ((topic0 === PERMIT2_APPROVAL_TOPIC || topic0 === PERMIT2_PERMIT_TOPIC) && lg.topics.length >= 4) {
        // SIM-2: Permit2 allowance (owner, token, spender indexed; amount = first data word, uint160).
        const owner = topicToAddress(lg.topics[1]) ?? call.from.toLowerCase();
        const token = topicToAddress(lg.topics[2]) ?? "";
        const spender = topicToAddress(lg.topics[3]) ?? "";
        const amount = lg.data && lg.data.length >= 66 ? BigInt(lg.data.slice(0, 66)) : 0n;
        if (amount > 0n) {
          approvals.push({
            owner,
            spender,
            token,
            amount: amount.toString(),
            unlimited: amount >= MAX_UINT128,
            via: `permit2:${tokenAddr}`,
          });
        }
      } else if (topic0 === APPROVAL_TOPIC && lg.topics.length >= 3) {
        const owner = topicToAddress(lg.topics[1]) ?? call.from.toLowerCase();
        const spender = topicToAddress(lg.topics[2]) ?? "";
        const amount = lg.data && lg.data !== "0x" ? BigInt(lg.data) : 0n;
        if (amount > 0n) {
          approvals.push({
            owner,
            spender,
            token: tokenAddr,
            amount: amount.toString(),
            unlimited: amount >= MAX_UINT128,
          });
        }
      } else if (topic0 === APPROVAL_FOR_ALL_TOPIC && lg.topics.length >= 3) {
        const owner = topicToAddress(lg.topics[1]) ?? call.from.toLowerCase();
        const spender = topicToAddress(lg.topics[2]) ?? "";
        const approved = lg.data && lg.data !== "0x" ? BigInt(lg.data) === 1n : false;
        if (approved) {
          approvals.push({
            owner,
            spender,
            token: tokenAddr,
            amount: "ALL",
            unlimited: true,
          });
        }
      }
    }

    if (call.data.length >= 138 && call.data.slice(0, 10).toLowerCase() === "0x095ea7b3") {
      const spender = `0x${call.data.slice(34, 74).toLowerCase()}`;
      const amt = BigInt(`0x${call.data.slice(74, 138)}`);
      if (
        amt > 0n &&
        !approvals.some((a) => a.spender === spender && a.token === call.to.toLowerCase())
      ) {
        approvals.push({
          owner: call.from.toLowerCase(),
          spender,
          token: call.to.toLowerCase(),
          amount: amt.toString(),
          unlimited: amt >= MAX_UINT128,
        });
      }
    }

    const balanceChanges: BalanceChange[] = [];
    for (const [key, delta] of netDeltas.entries()) {
      if (delta === 0n) continue;
      const [addr, token] = key.split("|");
      let before = 0n;
      let symbol: string | undefined;
      try {
        if (token === "ETH") {
          before = await client.getBalance({ address: addr as Hex });
          symbol = "ETH";
        } else {
          const [bal, sym] = await Promise.all([
            client.readContract({
              address: token as Hex,
              abi: ERC20_META_ABI,
              functionName: "balanceOf",
              args: [addr as Hex],
            }),
            client
              .readContract({
                address: token as Hex,
                abi: ERC20_META_ABI,
                functionName: "symbol",
              })
              .catch(() => undefined),
          ]);
          before = bal;
          symbol = sym;
        }
      } catch {
        before = 0n;
      }
      const after = before + delta;
      balanceChanges.push({
        address: addr,
        token,
        symbol,
        before: before.toString(),
        after: after.toString(),
        delta: delta > 0n ? `+${delta.toString()}` : delta.toString(),
      });
    }

    const allowedApprovals = req.payload?.intent?.allowApprovals ?? [];
    for (const app of approvals) {
      const permitted = allowedApprovals.some(
        (allow) =>
          allow.token.toLowerCase() === app.token.toLowerCase() &&
          allow.spender.toLowerCase() === app.spender.toLowerCase() &&
          /^\d+$/.test(app.amount) &&
          BigInt(app.amount) <= BigInt(allow.maxAmount)
      );
      if (!permitted) {
        codes.push("S-APPROVE");
        notes.push(
          `Unexpected allowance surfaced: ${app.token} -> spender ${app.spender} (${
            app.unlimited ? "unlimited" : app.amount
          })`
        );
      }
    }

    if (!succeeded) {
      const errMsg = callRes.error?.message || "execution reverted";
      notes.push(`Simulation reverted on RHC (${chainId}): ${errMsg}`);
      codes.push("S-REVERT");
      return {
        decision: "deny",
        codes: Array.from(new Set(codes)),
        method: "eth_simulateV1",
        status: "revert",
        gasUsed: callRes.gasUsed ?? firstBlock.gasUsed ?? null,
        balanceChanges,
        approvals,
        calls: namedCalls,
        notes,
      };
    }

    if (req.quote) {
      const expectedPayee = req.quote.payTo.toLowerCase();
      const expectedAsset =
        req.quote.asset.toUpperCase() === "ETH" ||
        req.quote.asset === "0x0000000000000000000000000000000000000000"
          ? "ETH"
          : req.quote.asset.toLowerCase();
      const expectedAmt = BigInt(req.quote.amount);
      const payeeDelta = netDeltas.get(`${expectedPayee}|${expectedAsset}`) ?? 0n;
      if (payeeDelta !== expectedAmt) {
        codes.push("S-DIFF");
        notes.push(
          `Simulated recipient delta (${payeeDelta.toString()}) != quoted amount (${expectedAmt.toString()})`
        );
      }
    } else if (req.payload?.intent?.expectedOut) {
      const exp = req.payload.intent.expectedOut;
      const outToken =
        exp.token.toUpperCase() === "ETH" ||
        exp.token === "0x0000000000000000000000000000000000000000"
          ? "ETH"
          : exp.token.toLowerCase();
      const actualOut = netDeltas.get(`${exp.recipient.toLowerCase()}|${outToken}`) ?? 0n;
      const minOut = BigInt(exp.minAmountOut);
      if (actualOut < minOut) {
        codes.push("S-DIFF");
        notes.push(
          `Simulated output ${actualOut.toString()} is below router intent minAmountOut ${minOut.toString()}`
        );
      }
    }

    if (codes.length > 0) {
      return {
        decision: "deny",
        codes: Array.from(new Set(codes)),
        method: "eth_simulateV1",
        status: "success",
        gasUsed: callRes.gasUsed ?? firstBlock.gasUsed ?? null,
        balanceChanges,
        approvals,
        calls: namedCalls,
        notes,
      };
    }

    return {
      decision: "allow",
      codes: [],
      method: "eth_simulateV1",
      status: "success",
      gasUsed: callRes.gasUsed ?? firstBlock.gasUsed ?? null,
      balanceChanges,
      approvals,
      calls: namedCalls,
      notes,
    };
  } catch (err) {
    return {
      decision: "abstain",
      codes: ["S-FAIL"],
      method: "eth_simulateV1",
      status: "unknown",
      gasUsed: null,
      balanceChanges: [],
      approvals: [],
      calls: [],
      notes: [
        `Simulation RPC failed on RHC (${chainId}): ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}
