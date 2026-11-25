"use client";

import { Loader2, Wallet, AlertTriangle } from 'lucide-react';
import { connectWallet, disconnectWallet, shortAddress, useWallet } from '../lib/wallet';

/** Navbar variant: a pill showing "Connect" or the short address + chain (gap D3). */
export function WalletPill() {
  const w = useWallet();
  const wrongChain = Boolean(w.address && w.walletChainId !== w.selectedChainId);
  return (
    <button
      type="button"
      onClick={() => (w.address ? disconnectWallet() : connectWallet())}
      disabled={w.connecting}
      title={
        w.error ??
        (w.address
          ? `Connected ${w.address} · chain ${w.walletChainId ?? '?'} (click to forget locally)`
          : `Connect wallet on RHC ${w.selectedChainId} (eth_requestAccounts only, no signature)`)
      }
      data-testid="wallet-pill"
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] transition ${
        w.address
          ? wrongChain
            ? 'border-amber-400/60 text-amber-200'
            : 'border-emerald-400/50 text-emerald-200 hover:border-emerald-300'
          : 'border-white/20 text-zinc-200 hover:border-white/60 hover:text-white'
      }`}
    >
      {w.connecting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : wrongChain ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : (
        <Wallet className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">{w.address ? shortAddress(w.address) : 'Connect'}</span>
    </button>
  );
}

/** Console header variant: status line + connect button, synced with the Testnet/Mainnet toggle. */
export function WalletStatusCard() {
  const w = useWallet();
  const wrongChain = Boolean(w.address && w.walletChainId !== w.selectedChainId);
  return (
    <div className="rounded-3xl border border-white/10 bg-[#070708] p-4" data-testid="wallet-status-card">
      <div className="mb-2.5 flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <Wallet className="h-3.5 w-3.5" /> Wallet
        </span>
        <span className={w.address ? (wrongChain ? 'text-amber-300' : 'text-emerald-300') : 'text-zinc-500'}>
          {w.address ? (wrongChain ? `wallet on ${w.walletChainId ?? '?'}` : `RHC ${w.walletChainId}`) : 'not connected'}
        </span>
      </div>
      {w.address ? (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black px-3 py-2.5 font-mono text-[11px]">
          <span className="truncate text-zinc-200">{shortAddress(w.address)}</span>
          {wrongChain ? (
            <button
              type="button"
              onClick={() => connectWallet(w.selectedChainId)}
              className="shrink-0 rounded-lg border border-amber-400/50 px-2 py-1 text-[10px] text-amber-200 hover:border-amber-300"
            >
              Switch to {w.selectedChainId}
            </button>
          ) : (
            <button
              type="button"
              onClick={disconnectWallet}
              className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-[10px] text-zinc-400 hover:text-white"
            >
              Forget
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={w.connecting}
          onClick={() => connectWallet(w.selectedChainId)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-zinc-200"
        >
          {w.connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
          Connect Wallet · RHC {w.selectedChainId}
        </button>
      )}
      <p className="mt-2 px-1 text-[10px] leading-relaxed text-zinc-500">
        Connecting only reads your address and asks the wallet to switch network. No signature or transaction is requested.
      </p>
      {w.error && (
        <div className="mt-2 break-words rounded-xl border border-rose-400/30 bg-rose-400/5 p-2.5 font-mono text-[10px] text-rose-200">
          {w.error}
        </div>
      )}
    </div>
  );
}
