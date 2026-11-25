/**
 * Gap D3 — shared wallet store.
 * Proves: connect uses ONLY eth_requestAccounts + wallet_switchEthereumChain (never a signature/tx),
 * the Testnet/Mainnet toggle follows the wallet and vice versa, and missing wallets are reported.
 * Run: cd apps/web && ../../node_modules/.bin/tsx --test test/wallet.test.ts
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  __resetWalletStoreForTests,
  connectWallet,
  getWalletState,
  selectChain,
} from "../src/lib/wallet";

type Handler = (...a: unknown[]) => void;
const SIGNING = ["eth_sign", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction", "wallet_addEthereumChain"];

function mockProvider(opts: { knownChains?: string[]; rejectAccounts?: boolean } = {}) {
  const calls: string[] = [];
  const handlers: Record<string, Handler[]> = {};
  let chain = "0x1";
  const known = opts.knownChains ?? ["0x1", "0xb626", "0x1237"];
  const provider = {
    calls,
    emit: (ev: string, ...a: unknown[]) => (handlers[ev] ?? []).forEach((h) => h(...a)),
    on: (ev: string, h: Handler) => {
      (handlers[ev] ??= []).push(h);
    },
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      calls.push(method);
      if (method === "eth_requestAccounts") {
        if (opts.rejectAccounts) throw Object.assign(new Error("User rejected"), { code: 4001 });
        return ["0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79"];
      }
      if (method === "wallet_switchEthereumChain") {
        const target = (params?.[0] as { chainId: string }).chainId;
        if (!known.includes(target)) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
        chain = target;
        return null;
      }
      throw new Error(`unexpected method ${method}`);
    },
    get chain() {
      return chain;
    },
  };
  (globalThis as unknown as { window: unknown }).window = { ethereum: provider };
  return provider;
}

beforeEach(() => __resetWalletStoreForTests());

test("connect: only eth_requestAccounts + wallet_switchEthereumChain(0xb626), no signing", async () => {
  const p = mockProvider();
  await connectWallet(46630);
  const s = getWalletState();
  assert.deepEqual(p.calls, ["eth_requestAccounts", "wallet_switchEthereumChain"]);
  assert.equal(p.chain, "0xb626");
  assert.equal(s.address, "0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79");
  assert.equal(s.walletChainId, 46630);
  assert.equal(s.error, null);
  assert.ok(!p.calls.some((m) => SIGNING.includes(m)));
});

test("toggle Mainnet while connected asks wallet to switch to 0x1237", async () => {
  const p = mockProvider();
  await connectWallet(46630);
  await selectChain(4663);
  assert.equal(p.chain, "0x1237");
  assert.equal(getWalletState().selectedChainId, 4663);
  assert.equal(getWalletState().walletChainId, 4663);
  assert.ok(!p.calls.some((m) => SIGNING.includes(m)));
});

test("toggle without a wallet connected does not touch the provider", async () => {
  const p = mockProvider();
  await selectChain(4663);
  assert.deepEqual(p.calls, []);
  assert.equal(getWalletState().selectedChainId, 4663);
});

test("wallet-side chainChanged / accountsChanged sync back into the store", async () => {
  const p = mockProvider();
  await connectWallet(46630);
  p.emit("chainChanged", "0x1237");
  assert.equal(getWalletState().selectedChainId, 4663);
  p.emit("chainChanged", "0x1");
  assert.equal(getWalletState().walletChainId, 1);
  assert.equal(getWalletState().selectedChainId, 4663, "unknown chain keeps toggle, UI shows wrong-chain");
  p.emit("accountsChanged", []);
  assert.equal(getWalletState().address, null);
});

test("unknown chain (4902) gives manual-add instructions, never wallet_addEthereumChain", async () => {
  const p = mockProvider({ knownChains: ["0x1"] });
  await connectWallet(46630);
  const s = getWalletState();
  assert.match(String(s.error), /chainId 46630 \(0xb626\)/);
  assert.ok(!p.calls.includes("wallet_addEthereumChain"));
});

test("user rejection is reported, no address stored", async () => {
  mockProvider({ rejectAccounts: true });
  await connectWallet(46630);
  assert.equal(getWalletState().address, null);
  assert.match(String(getWalletState().error), /rejected/i);
});

test("no EIP-1193 wallet → clear message", async () => {
  (globalThis as unknown as { window: unknown }).window = {};
  await connectWallet(46630);
  assert.match(String(getWalletState().error), /No EIP-1193 browser wallet/);
});
