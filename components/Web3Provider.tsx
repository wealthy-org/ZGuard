"use client";

import { createWalletClient, custom, numberToHex, type Address, type EIP1193Provider, type WalletClient } from "viem";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type UniversalProvider from "@walletconnect/universal-provider";
import { NETWORK_COPY, PERM_CHAIN_ID, PERM_EXPLORER, permChain } from "@/lib/web3/config";
import {
  parseEip155ChainId,
  WALLETCONNECT_EIP155_METHODS,
  walletConnectSessionHasRequiredMethods,
} from "@/lib/web3/eip1193";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & ProviderEvents;
  }
}

type ProviderEvents = {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
};
type WalletMode = "injected" | "walletconnect";

type Web3ContextValue = {
  account?: Address;
  chainId?: number;
  connecting: boolean;
  error?: string;
  isCorrectChain: boolean;
  walletMode?: WalletMode;
  walletConnectAvailable: boolean;
  connect: (mode?: WalletMode) => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  walletClient: () => WalletClient;
};

const Web3Context = createContext<Web3ContextValue | null>(null);
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

function getInjectedProvider() {
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No injected EVM wallet detected. Choose WalletConnect or install Robinhood Wallet, MetaMask, or Rabby.");
  return window.ethereum;
}

export default function Web3Provider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const [provider, setProvider] = useState<(EIP1193Provider & ProviderEvents)>();
  const [walletMode, setWalletMode] = useState<WalletMode>();
  const [walletConnectUri, setWalletConnectUri] = useState<string>();
  const [walletConnectQr, setWalletConnectQr] = useState<string>();
  const walletConnectAttempt = useRef<UniversalProvider | undefined>(undefined);
  const walletConnectAttemptId = useRef(0);
  const walletDialogRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async (source?: EIP1193Provider) => {
    const active = source || provider;
    if (!active) return;
    const [accounts, chain] = await Promise.all([
      active.request({ method: "eth_accounts" }) as Promise<Address[]>,
      active.request({ method: "eth_chainId" }),
    ]);
    const nextChainId = parseEip155ChainId(chain);
    if (nextChainId === undefined) throw new Error("Wallet returned an invalid chain ID");
    setAccount(accounts[0]);
    setChainId(nextChainId);
  }, [provider]);

  useEffect(() => {
    if (!window.ethereum || provider) return;
    setProvider(window.ethereum);
    setWalletMode("injected");
    void refresh(window.ethereum).catch(() => undefined);
  }, [provider, refresh]);

  const closeWalletConnect = useCallback(() => {
    walletConnectAttemptId.current += 1;
    try { walletConnectAttempt.current?.abortPairingAttempt(); } catch { /* already settled */ }
    walletConnectAttempt.current = undefined;
    setWalletConnectUri(undefined);
    setWalletConnectQr(undefined);
    setConnecting(false);
    setError(undefined);
  }, []);

  useEffect(() => {
    if (!walletConnectUri) return;
    walletDialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeWalletConnect();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(walletDialogRef.current?.querySelectorAll<HTMLElement>("a[href],button:not([disabled])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === walletDialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [walletConnectUri, closeWalletConnect]);

  useEffect(() => {
    if (!provider?.on) return;
    const accountsChanged = (value: unknown) => setAccount((value as Address[])[0]);
    const chainChanged = (value: unknown) => {
      const nextChainId = parseEip155ChainId(value);
      if (nextChainId === undefined) {
        setChainId(undefined);
        setError("Wallet returned an invalid chain ID");
        return;
      }
      setChainId(nextChainId);
    };
    const disconnected = () => { setAccount(undefined); setChainId(undefined); };
    provider.on("accountsChanged", accountsChanged);
    provider.on("chainChanged", chainChanged);
    provider.on("disconnect", disconnected);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, [provider]);

  const switchWith = useCallback(async (active: EIP1193Provider) => {
    try {
      await active.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(PERM_CHAIN_ID) }] });
    } catch (cause) {
      const code = (cause as { code?: number }).code;
      if (code !== 4902) throw cause;
      await active.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: numberToHex(PERM_CHAIN_ID),
          chainName: permChain.name,
          nativeCurrency: permChain.nativeCurrency,
          rpcUrls: permChain.rpcUrls.default.http,
          blockExplorerUrls: [PERM_EXPLORER],
        }],
      });
    }
    await refresh(active);
  }, [refresh]);

  const switchNetwork = useCallback(async () => {
    const active = provider || getInjectedProvider();
    await switchWith(active);
  }, [provider, switchWith]);

  const connect = useCallback(async (mode: WalletMode = "injected") => {
    const attemptId = walletConnectAttemptId.current + 1;
    walletConnectAttemptId.current = attemptId;
    setConnecting(true);
    setError(undefined);
    try {
      let active: EIP1193Provider & ProviderEvents;
      if (mode === "walletconnect") {
        if (!walletConnectProjectId) throw new Error("WalletConnect is not configured. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.");
        const [{ default: UniversalProvider }, { default: qrcode }] = await Promise.all([
          import("@walletconnect/universal-provider"),
          import("qrcode-generator"),
        ]);
        const wc = await UniversalProvider.init({
          projectId: walletConnectProjectId,
          metadata: {
            name: "Perm",
            description: NETWORK_COPY.testnet ? "Signed multi-venue testnet routing" : "Signed multi-venue routing on Robinhood Chain",
            url: window.location.origin,
            icons: [`${window.location.origin}/icon.png`],
          },
        });
        walletConnectAttempt.current = wc;
        wc.on("display_uri", (uri: unknown) => {
          if (attemptId !== walletConnectAttemptId.current) {
            try { wc.abortPairingAttempt(); } catch { /* stale pairing is already closed */ }
            return;
          }
          if (typeof uri !== "string" || uri.length > 4_096 || !uri.startsWith("wc:")) {
            try { wc.abortPairingAttempt(); } catch { /* invalid pairing is already closed */ }
            setError("WalletConnect returned an invalid pairing URI");
            return;
          }
          const qr = qrcode(0, "M");
          qr.addData(uri);
          qr.make();
          setWalletConnectUri(uri);
          setWalletConnectQr(qr.createDataURL(5, 12));
        });
        await wc.connect({
          namespaces: {
            eip155: {
              chains: [`eip155:${PERM_CHAIN_ID}`],
              methods: [...WALLETCONNECT_EIP155_METHODS],
              events: ["accountsChanged", "chainChanged"],
              rpcMap: { [PERM_CHAIN_ID]: permChain.rpcUrls.default.http[0] },
            },
          },
        });
        if (!walletConnectSessionHasRequiredMethods(wc.session?.namespaces)) {
          try { await wc.disconnect(); } catch { /* invalid session may already be closed */ }
          throw new Error("Wallet did not approve the methods required to submit Perm transactions");
        }
        if (attemptId !== walletConnectAttemptId.current) {
          try { await wc.disconnect(); } catch { /* a cancelled pairing may have no active session */ }
          return;
        }
        setWalletConnectUri(undefined);
        setWalletConnectQr(undefined);
        active = wc as unknown as EIP1193Provider & ProviderEvents;
      } else {
        active = getInjectedProvider();
        await active.request({ method: "eth_requestAccounts" });
      }
      const chain = parseEip155ChainId(await active.request({ method: "eth_chainId" }));
      if (chain === undefined) throw new Error("Wallet returned an invalid chain ID");
      if (chain !== PERM_CHAIN_ID) await switchWith(active);
      else await refresh(active);
      setProvider(active);
      setWalletMode(mode);
      if (mode === "walletconnect") walletConnectAttempt.current = undefined;
    } catch (cause) {
      const cancelled = attemptId !== walletConnectAttemptId.current;
      if (mode === "walletconnect" && !cancelled) {
        try { await walletConnectAttempt.current?.disconnect(); }
        catch {
          try { walletConnectAttempt.current?.abortPairingAttempt(); } catch { /* pairing already settled */ }
        }
        walletConnectAttempt.current = undefined;
        setWalletConnectUri(undefined);
        setWalletConnectQr(undefined);
      }
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : "Wallet connection failed");
      throw cause;
    } finally {
      if (attemptId === walletConnectAttemptId.current) setConnecting(false);
    }
  }, [refresh, switchWith]);

  const disconnect = useCallback(() => {
    closeWalletConnect();
    if (walletMode === "walletconnect") void provider?.disconnect?.().catch(() => undefined);
    setAccount(undefined);
    setChainId(undefined);
    setError(undefined);
    setWalletMode(undefined);
    setProvider(window.ethereum);
  }, [provider, walletMode, closeWalletConnect]);

  const getWalletClient = useCallback(() => {
    const active = provider || getInjectedProvider();
    return createWalletClient({ account, chain: permChain, transport: custom(active) });
  }, [account, provider]);

  const value = useMemo<Web3ContextValue>(() => ({
    account,
    chainId,
    connecting,
    error,
    isCorrectChain: chainId === PERM_CHAIN_ID,
    walletMode,
    walletConnectAvailable: Boolean(walletConnectProjectId),
    connect,
    disconnect,
    switchNetwork,
    walletClient: getWalletClient,
  }), [account, chainId, connecting, error, walletMode, connect, disconnect, switchNetwork, getWalletClient]);

  return <Web3Context.Provider value={value}>
    {children}
    {walletConnectUri && <div className="walletconnect-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeWalletConnect();
    }}>
      <div ref={walletDialogRef} className="walletconnect-dialog" role="dialog" aria-modal="true" aria-labelledby="walletconnect-title" aria-describedby="walletconnect-help" tabIndex={-1}>
        <button className="walletconnect-close" type="button" onClick={closeWalletConnect} aria-label="Close WalletConnect dialog">×</button>
        <span className="walletconnect-kicker">SECURE PAIRING</span>
        <h2 id="walletconnect-title">Scan with your wallet</h2>
        <p id="walletconnect-help">Open a WalletConnect-compatible wallet, scan this code, and approve only the {NETWORK_COPY.name} session.</p>
        {walletConnectQr && <img src={walletConnectQr} alt="WalletConnect pairing QR code" width={260} height={260} />}
        <div className="walletconnect-actions">
          <a href={walletConnectUri}>Open wallet app</a>
          <button type="button" onClick={() => void navigator.clipboard.writeText(walletConnectUri).catch(() => setError("Could not copy the WalletConnect URI"))}>Copy pairing link</button>
        </div>
        <small>Pairing links expire. Perm never asks for a seed phrase or private key.</small>
      </div>
    </div>}
  </Web3Context.Provider>;
}

export function useWeb3() {
  const value = useContext(Web3Context);
  if (!value) throw new Error("useWeb3 must be used inside Web3Provider");
  return value;
}

export function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect";
}
