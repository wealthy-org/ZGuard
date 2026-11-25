"use client";

import { useState } from 'react';
import { CircleDollarSign, ExternalLink, Loader2 } from 'lucide-react';
import { RHC_CHAIN_PARAMS, getProvider, useWallet } from '../lib/wallet';
import { setSavedApiKey } from '../lib/zguard-api';
import { formatMicroUsdg, parseUsdgToMicro, topUpWithUsdgDeposit, type DepositStep } from '../lib/deposit';

const STEP_LABEL: Record<DepositStep, string> = {
  config: 'Reading payment rails from /v1/config…',
  transfer: 'Confirm the USDG transfer in your wallet…',
  sign: 'Sign the credit-claim message in your wallet (no gas)…',
  mined: 'Transfer mined, waiting for confirmations…',
  confirmations: 'Waiting for confirmations',
  claim: 'Claiming credit (POST /v1/register + X-PAYMENT)…',
  done: 'Credit added',
};

/**
 * Real USDG top-up in deposit mode (I9 #17). Only acts on an explicit click; the wallet sends the transfer
 * and signs the claim, the API verifies the onchain Transfer before crediting.
 */
export function BuyCreditCard({ chainId }: { chainId: 46630 | 4663 }) {
  const w = useWallet();
  const onChain = Boolean(w.address && w.walletChainId === chainId);
  const [amount, setAmount] = useState('0.10');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string; credit: string; hint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const explorer = RHC_CHAIN_PARAMS[chainId].explorer;

  const run = async () => {
    const provider = getProvider();
    if (!provider || !w.address) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const micro = parseUsdgToMicro(amount);
      const res = await topUpWithUsdgDeposit({
        provider,
        walletAddress: w.address,
        walletChainId: w.walletChainId,
        amountMicro: micro,
        onStep: (s, detail) => setStatus(s === 'confirmations' ? `${STEP_LABEL[s]} ${detail ?? ''}` : STEP_LABEL[s]),
      });
      setSavedApiKey(res.apiKey);
      setResult({
        txHash: res.txHash,
        credit: formatMicroUsdg(res.creditMicroUsdg),
        hint: `${res.apiKey.slice(0, 12)}…${res.apiKey.slice(-4)}`,
      });
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[#070708] p-5" data-testid="buy-credit-card">
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
        <span className="flex items-center gap-1.5">
          <CircleDollarSign className="h-3.5 w-3.5" /> Buy credit · USDG
        </span>
        <span className="text-zinc-500">x402 deposit</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
        Sends a real USDG transfer on RHC {chainId} to the deployment&apos;s payTo, then you sign a claim message.
        Credit is added only after the transfer is confirmed onchain.
      </p>
      {!onChain ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-amber-200">
          {w.address
            ? `Wallet is on chain ${w.walletChainId ?? '?'}: switch to RHC ${chainId} first.`
            : 'Connect your wallet first (Wallet card above or the navbar).'}
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              disabled={busy}
              aria-label="USDG amount"
              className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 pr-14 font-mono text-[11px] text-zinc-200 outline-none focus:border-white/40"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-zinc-500">
              USDG
            </span>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-200 transition hover:border-emerald-300 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Pay
          </button>
        </div>
      )}
      {status && (
        <div className="mt-2.5 rounded-xl border border-white/10 bg-black p-2.5 font-mono text-[10px] text-zinc-300">{status}</div>
      )}
      {error && (
        <div className="mt-2.5 break-words rounded-xl border border-rose-400/30 bg-rose-400/5 p-2.5 font-mono text-[10px] text-rose-200">
          {error}
        </div>
      )}
      {result && (
        <div className="mt-2.5 space-y-1 break-words rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-2.5 font-mono text-[10px] text-emerald-200">
          <div>PAID → credit {result.credit} USDG on key {result.hint} (now used by this Console)</div>
          <a
            href={`${explorer}/tx/${result.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-emerald-300 underline-offset-2 hover:underline"
          >
            {result.txHash.slice(0, 18)}… <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}
