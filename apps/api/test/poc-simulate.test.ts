/**
 * I5 crosscheck of apps/api/src/services/simulate.ts, offline (mocked eth_simulateV1 + fake client).
 *
 * [SIM-1] Without a usable sender the old code simulated from the placeholder 0x…01 (raw signed txs always,
 *         structured txs/intents when `from` was missing). Sender-dependent contracts then look harmless,
 *         so this could turn into an allow. Now: signed raw tx → recovered signer; contradictory/missing
 *         sender or a raw tx for another chain → abstain S-FAIL without simulating.
 * [SIM-2] Allowances created through Permit2 (Approval/Permit events on Permit2) and ERC-721 single-token
 *         approvals (4-topic Approval, empty data) were not surfaced, so S-APPROVE never fired for them.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { GuardRequest } from "@zguard/sdk";
import { loadConfig } from "../src/config.js";
import { simulateOnRhc } from "../src/services/simulate.js";

const USER = privateKeyToAccount(`0x${"42".repeat(32)}`);
const TARGET = "0x00000000000000000000000000000000000c0de1";
const TOKEN = "0x00000000000000000000000000000000000070c3";
const NFT = "0x0000000000000000000000000000000000000f71";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const SPENDER = "0x000000000000000000000000000000000000bEEF";
const word = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const P2_APPROVAL = keccak256(toHex("Approval(address,address,address,uint160,uint48)"));

const config = loadConfig({ ...process.env, DATABASE_URL: "", ZGUARD_ACTIVE_CHAIN_ID: "4663" });
const client = {
  getBlock: async () => ({ number: 1n, timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
  readContract: async () => { throw new Error("n/a"); },
  getBalance: async () => 0n,
} as unknown as PublicClient;

let rpcCalls: Array<{ method: string; params: unknown[] }> = [];
let simLogs: Array<{ address: string; topics: string[]; data: string }> = [];
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    rpcCalls.push(body);
    if (body.method !== "eth_simulateV1") return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "n/a" } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: [{ gasUsed: "0x5208", calls: [{ status: "0x1", gasUsed: "0x5208", logs: simLogs }] }] });
  }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { rpcCalls = []; simLogs = []; });

const simulatedFrom = () => {
  const sim = rpcCalls.find((c) => c.method === "eth_simulateV1");
  return (sim?.params[0] as { blockStateCalls: Array<{ calls: Array<{ from: string }> }> } | undefined)?.blockStateCalls[0]?.calls[0]?.from;
};
const req = (payload: GuardRequest["payload"]): GuardRequest => ({ network: "eip155:4663", payload } as GuardRequest);

describe("[SIM-1] simulation runs as the real sender", () => {
  it("structured tx without any sender → abstain, nothing simulated", async () => {
    const r = await simulateOnRhc(config, client, req({ type: "evm_tx", tx: { to: TARGET, data: "0x", value: "0" } } as never));
    assert.equal(r.decision, "abstain");
    assert.deepEqual(r.codes, ["S-FAIL"]);
    assert.equal(simulatedFrom(), undefined);
  });

  it("tx.from and intent.from that disagree → abstain", async () => {
    const r = await simulateOnRhc(config, client, req({
      type: "intent",
      tx: { from: USER.address, to: TARGET, data: "0x", value: "0" },
      intent: { chainId: 4663, to: TARGET, function: "transfer", args: [SPENDER, "1"], from: SPENDER },
    } as never));
    assert.equal(r.decision, "abstain");
    assert.match(r.notes.join(" "), /Contradictory senders/);
  });

  it("signed raw tx is simulated as its recovered signer", async () => {
    const raw = await USER.signTransaction({ chainId: 4663, type: "eip1559", to: TARGET, value: 0n, data: "0x", nonce: 0, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
    const r = await simulateOnRhc(config, client, req({ type: "evm_tx", tx: raw } as never));
    assert.equal(r.decision, "allow");
    assert.equal(simulatedFrom(), USER.address.toLowerCase());
  });

  it("raw tx signed for another chain → abstain", async () => {
    const raw = await USER.signTransaction({ chainId: 1, type: "eip1559", to: TARGET, value: 0n, data: "0x", nonce: 0, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
    const r = await simulateOnRhc(config, client, req({ type: "evm_tx", tx: raw } as never));
    assert.equal(r.decision, "abstain");
    assert.match(r.notes.join(" "), /chainId 1 does not match/);
  });

  it("unsigned raw tx without intent.from → abstain", async () => {
    const { serializeTransaction } = await import("viem");
    const raw = serializeTransaction({ chainId: 4663, type: "eip1559", to: TARGET, value: 0n, data: "0x", nonce: 0, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
    const r = await simulateOnRhc(config, client, req({ type: "evm_tx", tx: raw } as never));
    assert.equal(r.decision, "abstain");
  });
});

describe("[SIM-2] allowances via Permit2 and ERC-721", () => {
  const tx = { type: "evm_tx", tx: { from: USER.address, to: TARGET, data: "0x", value: "0" } } as never;

  it("Permit2 Approval event → S-APPROVE deny", async () => {
    simLogs = [{ address: PERMIT2, topics: [P2_APPROVAL, word(USER.address), word(TOKEN), word(SPENDER)], data: `${word("0xffffffffffffffffffffffffffffffffffffffff")}${"0".repeat(64)}` }];
    const r = await simulateOnRhc(config, client, req(tx));
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("S-APPROVE"));
    assert.equal(r.approvals[0]?.token, TOKEN);
    assert.equal(r.approvals[0]?.spender, SPENDER.toLowerCase());
    assert.equal(r.approvals[0]?.unlimited, true);
  });

  it("Permit2 approval declared in allowApprovals → allow", async () => {
    simLogs = [{ address: PERMIT2, topics: [P2_APPROVAL, word(USER.address), word(TOKEN), word(SPENDER)], data: `${word("0x64")}${"0".repeat(64)}` }];
    const r = await simulateOnRhc(config, client, req({
      type: "intent",
      tx: { from: USER.address, to: TARGET, data: "0x", value: "0" },
      intent: { chainId: 4663, to: TARGET, function: "x()", args: [], from: USER.address, allowApprovals: [{ token: TOKEN, spender: SPENDER, maxAmount: "100" }] },
    } as never));
    assert.equal(r.decision, "allow");
  });

  it("ERC-721 single-token approval → S-APPROVE deny", async () => {
    simLogs = [{ address: NFT, topics: [APPROVAL, word(USER.address), word(SPENDER), word("0x07")], data: "0x" }];
    const r = await simulateOnRhc(config, client, req(tx));
    assert.ok(r.codes.includes("S-APPROVE"));
    assert.equal(r.approvals[0]?.amount, "tokenId:7");
  });

  it("ERC-721 approval cleared to the zero address is not an allowance", async () => {
    simLogs = [{ address: NFT, topics: [APPROVAL, word(USER.address), word("0x0000000000000000000000000000000000000000"), word("0x07")], data: "0x" }];
    const r = await simulateOnRhc(config, client, req(tx));
    assert.equal(r.decision, "allow");
  });
});
