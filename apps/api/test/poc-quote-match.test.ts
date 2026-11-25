/**
 * Regression tests for gap-analysis Bagian J — quote-match findings QM-1 … QM-7 and the Solana flag.
 * The PoC assertions were flipped after the fixes: every test asserts the SAFE outcome.
 *
 * Fully offline: evaluateQuoteMatch is a pure function.
 *   tsx --test test/poc-quote-match.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, maxUint256, parseAbi, type Hex } from "viem";
import {
  RHC_TESTNET_ASSETS,
  analyzeSolanaTransfer,
  approvalMatchesAllowList,
  base58Encode,
  decodeSolanaTransaction,
  evaluateQuoteMatch,
  findApprovals,
  getEip712DomainStatus,
  pinEip712DomainAgainstChain,
  SOLANA_PROGRAMS,
  type GuardPayload,
} from "@zguard/sdk";

const NET = "eip155:46630";
const CHAIN = 46630;
const USDG = RHC_TESTNET_ASSETS.USDG.address as `0x${string}`;
const PAYEE = "0x000000000000000000000000000000000000aaaa";
const ATTACKER = "0x000000000000000000000000000000000000bbbb";
const ROUTER = "0x000000000000000000000000000000000000cccc";
const HOLDER = "0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79";

const erc20 = parseAbi([
  "function transfer(address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function authorizeOperator(address operator)",
  "function approveAndCall(address spender, uint256 amount, bytes data)",
  "function increaseApproval(address spender, uint256 addedValue)",
  "function multicall(bytes[] data)",
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls)",
  "function execute(address dest, uint256 value, bytes func)",
]);

const transferData = (to: string, amt: bigint) =>
  encodeFunctionData({ abi: erc20, functionName: "transfer", args: [to as Hex, amt] });
const approveData = (spender: string, amt: bigint) =>
  encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender as Hex, amt] });

function intentPayload(
  intent: Record<string, unknown>,
  tx?: { to: string; data: string; value?: string; chainId?: number }
): GuardPayload {
  return {
    type: "intent",
    intent: { chainId: CHAIN, value: "0", from: HOLDER, ...intent } as never,
    ...(tx ? { tx: { from: HOLDER, value: "0", chainId: CHAIN, ...tx } as never } : {}),
  };
}

describe("[QM] quote-match regression (Bagian J)", () => {
  it("[QM-1][FIXED] intent function that cannot be re-encoded => abstain Q-DECODE, never allow", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload({ to: USDG, function: "swap" }, { to: USDG, data: transferData(ATTACKER, 10n ** 12n) }),
    });
    assert.notEqual(r.decision, "allow");
    assert.equal(r.decision, "abstain");
    assert.deepEqual(r.codes, ["Q-DECODE"]);
  });

  it("[QM-1b] matching full-signature intent + identical calldata => allow", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload(
        { to: USDG, function: "transfer(address,uint256)", args: [PAYEE, "1000"] },
        { to: USDG, data: transferData(PAYEE, 1000n) }
      ),
    });
    assert.equal(r.decision, "allow", JSON.stringify(r));
  });

  it("[QM-1c] calldata differing from re-encoded intent => deny", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload(
        { to: USDG, function: "transfer(address,uint256)", args: [PAYEE, "1000"] },
        { to: USDG, data: transferData(ATTACKER, 1000n) }
      ),
    });
    assert.equal(r.decision, "deny");
  });

  it("[QM-2][FIXED] intent without tx is never compared with itself => abstain Q-DECODE", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload({ to: USDG, function: "transfer(address,uint256)", args: [PAYEE, "0"] }),
    });
    assert.equal(r.decision, "abstain");
    assert.deepEqual(r.codes, ["Q-DECODE"]);
    assert.match(r.notes.join(" "), /without payload\.tx/);
  });

  it("[QM-2b] intent tx value differing from intent value => Q-002", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload(
        { to: USDG, function: "transfer(address,uint256)", args: [PAYEE, "1"] },
        { to: USDG, data: transferData(PAYEE, 1n), value: "5" }
      ),
    });
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("Q-002"));
  });

  it("[QM-3][FIXED] allowApprovals entry for another spender does not bless an unlimited approve", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload(
        {
          to: USDG,
          function: "approve(address,uint256)",
          args: [ATTACKER, maxUint256.toString()],
          allowApprovals: [{ token: USDG, spender: ROUTER, maxAmount: "1000" }],
        },
        { to: USDG, data: approveData(ATTACKER, maxUint256) }
      ),
    });
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("Q-006"));
  });

  it("[QM-3b] approve amount above maxAmount => Q-006; exact allow-listed approve => allow", () => {
    const over = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload(
        {
          to: USDG,
          function: "approve(address,uint256)",
          args: [ROUTER, "1001"],
          allowApprovals: [{ token: USDG, spender: ROUTER, maxAmount: "1000" }],
        },
        { to: USDG, data: approveData(ROUTER, 1001n) }
      ),
    });
    assert.ok(over.codes.includes("Q-006"));

    const ok = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload(
        {
          to: USDG,
          function: "approve(address,uint256)",
          args: [ROUTER, "1000"],
          allowApprovals: [{ token: USDG, spender: ROUTER, maxAmount: "1000" }],
        },
        { to: USDG, data: approveData(ROUTER, 1000n) }
      ),
    });
    assert.equal(ok.decision, "allow", JSON.stringify(ok));
  });

  it("[QM-3c] approvalMatchesAllowList never matches operator approvals or unknown amounts", () => {
    const op = findApprovals(USDG, encodeFunctionData({ abi: erc20, functionName: "authorizeOperator", args: [ROUTER] }));
    assert.equal(op.approvals.length, 1);
    assert.equal(
      approvalMatchesAllowList(op.approvals[0]!, [{ token: USDG, spender: ROUTER, maxAmount: maxUint256.toString() }]),
      false
    );
  });

  it("[QM-4][FIXED] EIP-3009 without signed domain chainId + verifyingContract => abstain Q-007", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      quote: { asset: USDG, payTo: PAYEE, amount: "1000000", chainId: CHAIN },
      payload: {
        type: "eip3009",
        authorization: {
          from: HOLDER,
          to: PAYEE,
          value: "1000000",
          validAfter: "0",
          validBefore: "4102444800",
          nonce: "0x" + "11".repeat(32),
        } as never,
      },
    });
    assert.equal(r.decision, "abstain");
    assert.deepEqual(r.codes, ["Q-007"]);
  });

  it("[QM-4b] EIP-3009 signed for another contract => Q-003 deny", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      quote: { asset: USDG, payTo: PAYEE, amount: "1000000", chainId: CHAIN },
      payload: {
        type: "eip3009",
        authorization: {
          from: HOLDER,
          to: PAYEE,
          value: "1000000",
          validAfter: "0",
          validBefore: "4102444800",
          nonce: "0x" + "22".repeat(32),
          domain: { chainId: CHAIN, verifyingContract: ROUTER },
        } as never,
      },
    });
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("Q-003"));
  });

  it("[QM-5][FIXED] ERC-777 authorizeOperator / approveAndCall / increaseApproval are approvals", () => {
    for (const data of [
      encodeFunctionData({ abi: erc20, functionName: "authorizeOperator", args: [ATTACKER] }),
      encodeFunctionData({ abi: erc20, functionName: "approveAndCall", args: [ATTACKER, 1n, "0x"] }),
      encodeFunctionData({ abi: erc20, functionName: "increaseApproval", args: [ATTACKER, 1n] }),
    ]) {
      const r = evaluateQuoteMatch({
        network: NET,
        quote: { asset: USDG, payTo: PAYEE, amount: "1", chainId: CHAIN },
        payload: { type: "evm_tx", tx: { to: USDG, data, value: "0", chainId: CHAIN } as never },
      });
      assert.equal(r.decision, "deny", data.slice(0, 10));
      assert.ok(r.codes.includes("Q-006"), data.slice(0, 10));
    }
  });

  it("[QM-5b] approve hidden in multicall / aggregate3 / execute (recursive) => Q-006", () => {
    const inner = approveData(ATTACKER, maxUint256);
    const multicall = encodeFunctionData({ abi: erc20, functionName: "multicall", args: [[inner]] });
    const agg = encodeFunctionData({
      abi: erc20,
      functionName: "aggregate3",
      args: [[{ target: USDG, allowFailure: false, callData: multicall }]],
    });
    const exec = encodeFunctionData({ abi: erc20, functionName: "execute", args: [ROUTER, 0n, agg] });

    const scan = findApprovals(ROUTER, exec);
    assert.equal(scan.approvals.length, 1);
    assert.deepEqual(scan.approvals[0]!.path, ["execute", "aggregate3", "multicall"]);
    assert.equal(scan.approvals[0]!.spender, ATTACKER.toLowerCase());

    // Intent declares the wrapper call itself, so calldata parity holds — the hidden approve must still deny.
    const r = evaluateQuoteMatch({
      network: NET,
      payload: intentPayload(
        { to: ROUTER, function: "execute(address,uint256,bytes)", args: [ROUTER, "0", agg] },
        { to: ROUTER, data: exec }
      ),
    });
    assert.equal(r.decision, "deny", JSON.stringify(r));
    assert.ok(r.codes.includes("Q-006"));

    const pay = evaluateQuoteMatch({
      network: NET,
      quote: { asset: USDG, payTo: PAYEE, amount: "1", chainId: CHAIN },
      payload: { type: "evm_tx", tx: { to: USDG, data: multicall, value: "0", chainId: CHAIN } as never },
    });
    assert.ok(pay.codes.includes("Q-006"));
  });

  it("[QM-6][FIXED] seeded EIP-712 domain that differs from the live contract is disabled (Q-007)", async () => {
    const before = getEip712DomainStatus(CHAIN, USDG);
    assert.ok(before, "testnet USDG must have a pinned domain");
    const lyingClient = {
      readContract: async () => ("0x" + "ab".repeat(32)) as Hex,
    } as never;
    const st = await pinEip712DomainAgainstChain(lyingClient, CHAIN, USDG);
    assert.equal(st, "mismatch");
    const r = evaluateQuoteMatch({
      network: NET,
      quote: { asset: USDG, payTo: PAYEE, amount: "1000000", chainId: CHAIN },
      payload: {
        type: "eip3009",
        authorization: {
          from: HOLDER,
          to: PAYEE,
          value: "1000000",
          validAfter: "0",
          validBefore: "4102444800",
          nonce: "0x" + "33".repeat(32),
          domain: { chainId: CHAIN, verifyingContract: USDG },
        } as never,
      },
    });
    assert.equal(r.decision, "abstain");
    assert.ok(r.codes.includes("Q-007"));
  });

  it("[QM-7][FIXED] ERC-20 transfer that also sends native ETH => deny Q-002", () => {
    const r = evaluateQuoteMatch({
      network: NET,
      quote: { asset: USDG, payTo: PAYEE, amount: "1000", chainId: CHAIN },
      payload: {
        type: "evm_tx",
        tx: { to: USDG, data: transferData(PAYEE, 1000n), value: "1000000000000000000", chainId: CHAIN } as never,
      },
    });
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("Q-002"));
  });
});

// ---------------------------------------------------------------------------------------------
// Solana: flag derived from decoded instructions
// ---------------------------------------------------------------------------------------------

function b58decode(s: string): Uint8Array {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(A.indexOf(ch));
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch === "1") out.unshift(0);
    else break;
  }
  while (out.length < 32) out.unshift(0);
  return Uint8Array.from(out);
}

function key(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7 + 1) & 0xff);
}

function u64(v: bigint): number[] {
  return Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
}

/** Builds a legacy wire tx: keys = [owner, src, mint, dst, delegate, TOKEN]. */
function buildSolTx(ixs: { prog: number; accs: number[]; data: number[] }[]): { b64: string; mint: string } {
  const keys = [key(1), key(2), key(3), key(4), key(5), b58decode(SOLANA_PROGRAMS.TOKEN)];
  const bytes: number[] = [1, ...new Array(64).fill(7), 1, 0, 1, keys.length];
  for (const k of keys) bytes.push(...k);
  bytes.push(...new Array(32).fill(9));
  bytes.push(ixs.length);
  for (const ix of ixs) bytes.push(ix.prog, ix.accs.length, ...ix.accs, ix.data.length, ...ix.data);
  return { b64: Buffer.from(bytes).toString("base64"), mint: base58Encode(keys[2]!) };
}

describe("[SOL] Solana approve/set-authority flag is derived, not trusted", () => {
  const recipient = "PayeeWa11et1111111111111111111111111111111";
  const transferChecked = { prog: 5, accs: [1, 2, 3, 0], data: [12, ...u64(1_000_000n), 6] };
  const approve = { prog: 5, accs: [1, 4, 0], data: [4, ...u64(2n ** 64n - 1n)] };

  it("decoder sees TransferChecked + Approve", () => {
    const { b64, mint } = buildSolTx([transferChecked, approve]);
    const a = analyzeSolanaTransfer(decodeSolanaTransaction(b64));
    assert.equal(a.hasApproveOrSetAuthority, true);
    assert.equal(a.transfers.length, 1);
    assert.equal(a.transfers[0]!.mint, mint);
    assert.equal(a.transfers[0]!.amount, 1_000_000n);
  });

  it("[SOL][FIXED] caller flag false but tx contains Approve => deny Q-006", () => {
    const { b64, mint } = buildSolTx([transferChecked, approve]);
    const r = evaluateQuoteMatch({
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      quote: { asset: mint, payTo: recipient, amount: "1000000" },
      payload: {
        type: "solana_spl",
        solanaTransfer: { recipient, mint, amount: "1000000", hasApproveOrSetAuthority: false, transaction: b64 },
      },
    });
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("Q-006"));
  });

  it("[SOL] clean single TransferChecked => allow; missing transaction => abstain Q-DECODE", () => {
    const { b64, mint } = buildSolTx([transferChecked]);
    const ok = evaluateQuoteMatch({
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      quote: { asset: mint, payTo: recipient, amount: "1000000" },
      payload: { type: "solana_spl", solanaTransfer: { recipient, mint, amount: "1000000", transaction: b64 } },
    });
    assert.equal(ok.decision, "allow", JSON.stringify(ok));

    const none = evaluateQuoteMatch({
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      quote: { asset: mint, payTo: recipient, amount: "1000000" },
      payload: { type: "solana_spl", solanaTransfer: { recipient, mint, amount: "1000000", hasApproveOrSetAuthority: false } },
    });
    assert.equal(none.decision, "abstain");
    assert.deepEqual(none.codes, ["Q-DECODE"]);
  });

  it("[SOL] decoded amount differing from declared amount => Q-002", () => {
    const { b64, mint } = buildSolTx([{ ...transferChecked, data: [12, ...u64(9_000_000n), 6] }]);
    const r = evaluateQuoteMatch({
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      quote: { asset: mint, payTo: recipient, amount: "1000000" },
      payload: { type: "solana_spl", solanaTransfer: { recipient, mint, amount: "1000000", transaction: b64 } },
    });
    assert.ok(r.codes.includes("Q-002"));
  });
});
