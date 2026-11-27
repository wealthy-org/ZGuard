"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatUnits, parseUnits } from "viem";
import Header from "./Header";
import AudioToggle from "./AudioToggle";
import Footer from "./Footer";
import LiveTokenMark from "./LiveTokenMark";
import FeeClaims from "./FeeClaims";
import { permRouterAbi } from "@/lib/web3/abis";
import { getRobinhoodPublicClient } from "@/lib/web3/config";
import { usePermDeployment } from "@/lib/web3/local-deployment";
import { LIVE_TOKEN_MAP, type LiveTokenSymbol } from "@/lib/web3/tokens";

const REBATE_TOKENS: LiveTokenSymbol[] = ["ETH", "NVDA", "AAPL", "TSLA"];
const BPS = 10_000n;

type Policy = { version: number; feeBps: number; rebateBps: number; enabled: boolean; source: "onchain" | "legacy" };

export default function RebateCalculator() {
  const deployment = usePermDeployment();
  const [tokenSymbol, setTokenSymbol] = useState<LiveTokenSymbol>("ETH");
  const [amount, setAmount] = useState("1");
  const [throughPerm, setThroughPerm] = useState(true);
  const [policy, setPolicy] = useState<Policy>();
  const [policyError, setPolicyError] = useState<string>();
  const token = LIVE_TOKEN_MAP[tokenSymbol];
  const feeBps = policy?.feeBps ?? 20;
  const rebateBps = policy?.rebateBps ?? 2_500;
  const version = policy?.version ?? 1;

  useEffect(() => {
    if (!deployment.router) return;
    setPolicy(undefined);
    setPolicyError(undefined);
    const client = getRobinhoodPublicClient();
    let cancelled = false;
    const run = async (attempt = 0): Promise<void> => {
      try {
        const activeVersion = deployment.version >= 2
          ? Number(await client.readContract({ address: deployment.router!, abi: permRouterAbi, functionName: "activePolicyVersion" }))
          : 1;
        const [platformFeeBps, rebateShareBps, enabled] = await client.readContract({ address: deployment.router!, abi: permRouterAbi, functionName: "feePolicies", args: [activeVersion] });
        if (cancelled) return;
        setPolicyError(undefined);
        setPolicy({ version: activeVersion, feeBps: platformFeeBps, rebateBps: rebateShareBps, enabled, source: deployment.version >= 2 ? "onchain" : "legacy" });
      } catch (cause) {
        if (cancelled) return;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
          if (!cancelled) return run(attempt + 1);
          return;
        }
        console.warn("Policy read failed", cause);
        setPolicyError("the chain RPC could not be reached. The values shown are the published v1 policy; refresh to retry.");
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [deployment.router, deployment.version]);

  const values = useMemo(() => {
    let raw = 0n;
    try { raw = parseUnits(amount || "0", token.decimals); } catch { raw = 0n; }
    const gross = raw * BigInt(feeBps) / BPS;
    const rebate = throughPerm ? gross * BigInt(rebateBps) / BPS : 0n;
    return { raw, gross, rebate, net: gross - rebate, routed: raw - (gross - rebate) };
  }, [amount, token.decimals, feeBps, rebateBps, throughPerm]);

  const fmt = (value: bigint) => {
    const [whole, fraction] = formatUnits(value, token.decimals).split(".");
    const groupedWhole = BigInt(whole).toLocaleString("en-US");
    return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
  };
  const savedPercent = throughPerm ? rebateBps / 100 : 0;
  const netFeeBps = feeBps * (10_000 - rebateBps) / 10_000;

  return (
    <main className="app-page light-app rebate-page">
      <Header extra={<AudioToggle />} />
      <div className="app-aurora" aria-hidden="true"><i /><i /><i /><b /><b /></div>
      <section className="data-shell app-enter">
        <header className="data-hero rebate-hero">
          <span className="section-kicker">PERM FEE REBATE · ACTIVE POLICY V{version}</span>
          <h1>The exact discount, before signing.</h1>
          <p>Values are read from the active deployed policy and calculated in token base units with the same rounding used by settlement.</p>
          <div className={`data-disclaimer${policy?.source === "onchain" ? " verified-policy" : ""}`}><i /> {policy ? policy.source === "onchain" ? `Policy v${version} read from Router v2` : "Legacy policy v1 read from the current router; execution waits for v2" : deployment.router ? "Reading the active fee policy from chain" : "Router deployment is not configured"}</div>
          <a className="claims-jump" href="#claims">View referral and treasury claims ↓</a>
        </header>

        <section className="rebate-workbench data-panel">
          <div className="rebate-controls">
            <div className="control-head"><span className="section-kicker">EXACT INPUT BASIS</span><b>perm-v{version}</b></div>
            <label className="amount-control"><span>Swap input</span><div><input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} /><div>{REBATE_TOKENS.map((symbol) => <button type="button" key={symbol} className={tokenSymbol === symbol ? "active" : ""} onClick={() => setTokenSymbol(symbol)}><LiveTokenMark token={LIVE_TOKEN_MAP[symbol]} size={24} />{LIVE_TOKEN_MAP[symbol].displaySymbol}</button>)}</div></div></label>
            <fieldset className="route-control"><legend>Onchain versioned policy fields</legend><div><div className="policy-field"><b>{feeBps} bps</b><span>gross Perm fee</span></div><div className="policy-field"><b>{rebateBps / 100}%</b><span>rebate share</span></div><div className="policy-field"><b>{netFeeBps} bps</b><span>effective net fee</span></div></div></fieldset>
            <div className="policy-formula"><code>gross = floor(input × {feeBps} / 10,000)</code><code>rebate = floor(gross × {rebateBps} / 10,000)</code><code>routed = input − (gross − rebate)</code></div>
            <div className="eligibility-toggle"><div><b>Entered through eligible Perm routing</b><span>Turn off to compare the same gross fee without the Perm entry-point rebate</span></div><button type="button" className={throughPerm ? "on" : ""} onClick={() => setThroughPerm((value) => !value)} aria-pressed={throughPerm} aria-label="Entered through eligible Perm routing"><i /></button></div>
            {policyError && <small className="policy-error">Onchain policy verification failed: {policyError}</small>}
            {policy && !policy.enabled && <small className="policy-error">The active policy is disabled; executable quotes must fail closed.</small>}
          </div>

          <div className="rebate-result" key={`${tokenSymbol}-${amount}-${throughPerm}-${feeBps}-${rebateBps}`}>
            <div className="rebate-orbit" style={{ "--rebate-angle": `${savedPercent * 3.6}deg` } as CSSProperties}><div><strong>{savedPercent}%</strong><span>of Perm fee</span></div><i /><i /><i /></div>
            <span className="section-kicker">DETERMINISTIC BREAKDOWN</span><h2>{throughPerm ? `Policy v${version} eligible` : "No entry-point rebate"}</h2>
            <dl><div><dt>Exact input</dt><dd>{fmt(values.raw)} {token.displaySymbol}</dd></div><div><dt>Gross Perm fee <small>{feeBps} bps</small></dt><dd>{fmt(values.gross)} {token.displaySymbol}</dd></div><div className="saved"><dt>Fee rebate <small>{throughPerm ? `${rebateBps / 100}% share` : "not eligible"}</small></dt><dd>−{fmt(values.rebate)} {token.displaySymbol}</dd></div><div className="net"><dt>Net Perm fee</dt><dd>{fmt(values.net)} {token.displaySymbol}</dd></div><div><dt>Input sent to venues</dt><dd>{fmt(values.routed)} {token.displaySymbol}</dd></div></dl>
            <p>Rebate never exceeds gross Perm fee. Pool, hook-provider, protocol and network fees remain separate.</p>
          </div>
        </section>
        <FeeClaims />
      </section>
      <div className="footer-shell app-footer"><Footer /></div>
    </main>
  );
}
