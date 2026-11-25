"use client";

/**
 * Shared browser-wallet + network store (gap D3).
 *
 * - One source of truth for the Navbar button, the Console header and the Signer panel.
 * - Connecting calls ONLY `eth_requestAccounts` and `wallet_switchEthereumChain`. It never asks for a
 *   signature or a transaction. If the wallet does not know the chain (error 4902) we show the
 *   network parameters instead of calling `wallet_addEthereumChain`.
 * - The Testnet/Mainnet toggle (`selectedChainId`) is shared; changing it while connected asks the
 *   wallet to switch, and wallet-side chain changes are reflected back.
 */
import { useSyncExternalStore } from "react";
import { describeWalletError } from "./wallet-error";

export type RhcChainId = 46630 | 4663;

export interface WalletState {
  address: string | null;
  /** Chain the wallet reports (may differ from selectedChainId until the user approves the switch). */
  walletChainId: number | null;
  selectedChainId: RhcChainId;
  connecting: boolean;
  error: string | null;
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
}

export const RHC_CHAIN_PARAMS: Record<RhcChainId, { hex: string; name: string; rpc: string; explorer: string }> = {
  46630: {
    hex: "0xb626",
    name: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
  4663: {
    hex: "0x1237",
    name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
  },
};

let state: WalletState = {
  address: null,
  walletChainId: null,
  selectedChainId: 46630,
  connecting: false,
  error: null,
};
const listeners = new Set<() => void>();
let wired = false;

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

function parseChainId(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = v.startsWith("0x") ? parseInt(v, 16) : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function wireProviderEvents(eth: Eip1193Provider) {
  if (wired || !eth.on) return;
  wired = true;
  eth.on("accountsChanged", (accs: unknown) => {
    const list = Array.isArray(accs) ? (accs as string[]) : [];
    set({ address: list[0] ?? null });
  });
  eth.on("chainChanged", (cid: unknown) => {
    const id = parseChainId(cid);
    set({ walletChainId: id });
    if (id === 46630 || id === 4663) set({ selectedChainId: id });
  });
}

async function switchWalletChain(eth: Eip1193Provider, target: RhcChainId): Promise<void> {
  const p = RHC_CHAIN_PARAMS[target];
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: p.hex }] });
    set({ walletChainId: target, error: null });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 4902 || describeWalletError(err).includes("4902") || /unrecognized/i.test(describeWalletError(err))) {
      throw new Error(
        `Your wallet does not know ${p.name}. Add it manually: chainId ${target} (${p.hex}), RPC ${p.rpc}, explorer ${p.explorer}.`
      );
    }
    if (code === 4001) throw new Error("Network switch rejected in wallet.");
    throw err instanceof Error ? err : new Error(describeWalletError(err));
  }
}

/** Connect: eth_requestAccounts + wallet_switchEthereumChain only. No signature, no transaction. */
export async function connectWallet(target?: RhcChainId): Promise<void> {
  const eth = getProvider();
  const chain = target ?? state.selectedChainId;
  if (!eth) {
    set({ error: "No EIP-1193 browser wallet detected (install MetaMask, Rabby or Robinhood Wallet)." });
    return;
  }
  wireProviderEvents(eth);
  set({ connecting: true, error: null, selectedChainId: chain });
  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts || accounts.length === 0) throw new Error("Wallet returned no accounts.");
    set({ address: accounts[0] });
    await switchWalletChain(eth, chain);
  } catch (err) {
    const code = (err as { code?: number })?.code;
    set({ error: code === 4001 ? "Connection rejected in wallet." : describeWalletError(err) });
  } finally {
    set({ connecting: false });
  }
}

/** Testnet/Mainnet toggle. When connected, asks the wallet to follow. */
export async function selectChain(chain: RhcChainId): Promise<void> {
  set({ selectedChainId: chain });
  const eth = getProvider();
  if (state.address && eth && state.walletChainId !== chain) {
    try {
      await switchWalletChain(eth, chain);
    } catch (err) {
      set({ error: describeWalletError(err) });
    }
  }
}

/** Forget the address locally (wallets have no standard programmatic disconnect). */
export function disconnectWallet(): void {
  set({ address: null, walletChainId: null, error: null });
}

export function shortAddress(a: string | null): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function getWalletState(): WalletState {
  return state;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const serverSnapshot: WalletState = { ...state };

export function useWallet(): WalletState {
  return useSyncExternalStore(subscribe, getWalletState, () => serverSnapshot);
}

/** Test hook: reset module state. */
export function __resetWalletStoreForTests(): void {
  wired = false;
  state = { address: null, walletChainId: null, selectedChainId: 46630, connecting: false, error: null };
  listeners.forEach((l) => l());
}
