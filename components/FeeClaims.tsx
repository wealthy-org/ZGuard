"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import LiveTokenMark from "./LiveTokenMark";
import { useWeb3 } from "./Web3Provider";
import { permRouterAbi } from "@/lib/web3/abis";
import { NETWORK_COPY, getRobinhoodPublicClient, PERM_EXPLORER } from "@/lib/web3/config";
import { usePermDeployment } from "@/lib/web3/local-deployment";
import { LIVE_TOKENS, type LiveToken } from "@/lib/web3/tokens";

const publicClient = getRobinhoodPublicClient();

type Claimable = { token: LiveToken; amount: bigint };
type ClaimStatus = { stage: "idle" | "loading" | "submitting" | "success" | "error"; message?: string; hash?: Hex };

function formatted(value: bigint, token: LiveToken) {
  const [whole, fraction = ""] = formatUnits(value, token.decimals).split(".");
  const visible = fraction.replace(/0+$/, "").slice(0, 12);
  return visible ? `${BigInt(whole).toLocaleString("en-US")}.${visible}` : BigInt(whole).toLocaleString("en-US");
}

export default function FeeClaims() {
  const deployment = usePermDeployment();
  const { account, isCorrectChain, connect, switchNetwork, walletClient } = useWeb3();
  const [claimables, setClaimables] = useState<Claimable[]>([]);
  const [treasury, setTreasury] = useState<Address>();
  const [referralShareBps, setReferralShareBps] = useState(0);
  const [status, setStatus] = useState<ClaimStatus>({ stage: "idle" });
  const [refreshTick, setRefreshTick] = useState(0);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!account || !deployment.router || deployment.version < 2) {
      setClaimables([]);
      setTreasury(undefined);
      setReferralShareBps(0);
      return;
    }
    setStatus((current) => current.stage === "submitting" ? current : { stage: "loading", message: "Reading claimable balances from Router v2…" });
    try {
      const [routerTreasury, share, amounts] = await Promise.all([
        publicClient.readContract({ address: deployment.router, abi: permRouterAbi, functionName: "treasury" }),
        publicClient.readContract({ address: deployment.router, abi: permRouterAbi, functionName: "referralShares", args: [account] }),
        Promise.all(LIVE_TOKENS.map((token) => publicClient.readContract({
          address: deployment.router!,
          abi: permRouterAbi,
          functionName: "claimableFees",
          args: [token.address, account],
        }))),
      ]);
      setTreasury(routerTreasury);
      setReferralShareBps(Number(share));
      setClaimables(LIVE_TOKENS.map((token, index) => ({ token, amount: amounts[index] })));
      setStatus((current) => current.stage === "success" ? current : { stage: "idle" });
    } catch (cause) {
      setStatus({ stage: "error", message: (cause as { shortMessage?: string }).shortMessage || "Claimable fee read failed; refresh to retry." });
    }
  }, [account, deployment.router, deployment.version]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  const activeClaims = useMemo(() => claimables.filter(({ amount }) => amount > 0n), [claimables]);
  const isTreasury = Boolean(account && treasury && account.toLowerCase() === treasury.toLowerCase());
  const isReferrer = referralShareBps > 0;

  const copyReferralLink = async () => {
    if (!account || !isReferrer) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/trade?referrer=${account}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setStatus({ stage: "error", message: "The referral link could not be copied." });
    }
  };

  const claim = async (token: LiveToken) => {
    if (!account) return void connect().catch((cause) => setStatus({ stage: "error", message: cause instanceof Error ? cause.message : "Wallet connection failed" }));
    if (!deployment.router) return void setStatus({ stage: "error", message: "Router v2 is not configured." });
    if (!isCorrectChain) return void switchNetwork().catch((cause) => setStatus({ stage: "error", message: cause instanceof Error ? cause.message : "Network switch failed" }));
    try {
      setStatus({ stage: "submitting", message: `Simulating ${token.displaySymbol} fee claim…` });
      const simulation = await publicClient.simulateContract({
        account,
        address: deployment.router,
        abi: permRouterAbi,
        functionName: "claimFees",
        args: [token.address, account],
      });
      const hash = await walletClient().writeContract(simulation.request);
      setStatus({ stage: "submitting", hash, message: `Waiting for ${token.displaySymbol} claim confirmation…` });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error("Fee claim reverted");
      await refresh();
      setStatus({ stage: "success", hash, message: `${token.displaySymbol} fees claimed to the connected wallet.` });
    } catch (cause) {
      const detail = cause as { shortMessage?: string; message?: string };
      setStatus({ stage: "error", message: detail.shortMessage || detail.message || "Fee claim failed" });
    }
  };

  return (
    <section className="claims-panel data-panel" id="claims" aria-label="Claimable Router fees">
      <header className="claims-head">
        <div><span className="section-kicker">PULL-PAYMENT FEES</span><h2>Claim referral or treasury fees.</h2><p>Only the connected beneficiary can pull its own reserved balance. A claim never blocks a swap.</p></div>
        <button type="button" onClick={() => setRefreshTick((value) => value + 1)} disabled={status.stage === "loading" || status.stage === "submitting"}>Refresh</button>
      </header>

      {deployment.version < 2 ? <div className="claims-empty"><b>Router v2 required</b><span>Fee claims remain unavailable while this build points to a legacy Router.</span></div> : !account ? <div className="claims-empty"><b>Connect a beneficiary wallet</b><span>Perm will read claimable balances directly from Router v2.</span><button type="button" onClick={() => void connect().catch(() => undefined)}>Connect wallet</button></div> : <>
        <div className="claim-role-grid">
          <article className={isReferrer ? "active" : ""}><span>REFERRER</span><b>{isReferrer ? `${(referralShareBps / 100).toFixed(2).replace(/\.00$/, "")}% of net fee` : "Not configured"}</b><small>{isReferrer ? "Share applies only when this address is signed into the quote." : "No active referral share on this Router."}</small>{isReferrer && <button type="button" onClick={() => void copyReferralLink()}>{copied ? "Copied" : "Copy referral link"}</button>}</article>
          <article className={isTreasury ? "active" : ""}><span>TREASURY</span><b>{isTreasury ? "Connected role" : "Different wallet"}</b><small>{treasury ? `${treasury.slice(0, 8)}…${treasury.slice(-6)}` : "Reading Router treasury…"}</small></article>
        </div>

        <div className="claim-list">
          {activeClaims.map(({ token, amount }) => <article key={token.symbol}>
            <LiveTokenMark token={token} size={34} />
            <div><span>{token.displaySymbol} claimable</span><b>{formatted(amount, token)} {token.displaySymbol}</b></div>
            <button type="button" onClick={() => void claim(token)} disabled={status.stage === "submitting"}>{isCorrectChain ? "Claim" : "Switch network"}</button>
          </article>)}
          {status.stage !== "loading" && activeClaims.length === 0 && <div className="claims-zero"><b>No claimable balance</b><span>Execute a configured referral swap or connect the Router treasury wallet, then refresh.</span></div>}
        </div>
      </>}

      {status.message && <div className={`transaction-status ${status.stage === "error" ? "error" : status.stage === "success" ? "success" : "confirming"}`}><i /><span>{status.message}</span>{status.hash && <a href={`${PERM_EXPLORER}/tx/${status.hash}`} target="_blank" rel="noopener noreferrer">Explorer ↗</a>}</div>}
      <p className="claims-boundary">{NETWORK_COPY.testnet ? "Robinhood Chain testnet only · test assets have no monetary value · claiming does not change the fee policy." : "Robinhood Chain · claims settle onchain and are visible on Blockscout · claiming does not change the fee policy."}</p>
    </section>
  );
}
