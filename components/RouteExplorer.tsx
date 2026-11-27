"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatEther, formatUnits, parseUnits } from "viem";
import Header from "./Header";
import AudioToggle from "./AudioToggle";
import Footer from "./Footer";
import LiveTokenMark from "./LiveTokenMark";
import { LIVE_TOKENS, LIVE_TOKEN_MAP, type LiveTokenSymbol } from "@/lib/web3/tokens";
import type { LiveQuote, LiveQuoteCandidate } from "@/lib/web3/quote";
import { AGGREGATOR_HOOKS_CLIENT_ENABLED, IS_MAINNET, PERM_CHAIN_ID, REVIEWED_V2, REVIEWED_V2_CLIENT_ENABLED, PERM_EXPLORER, V3_VENUE, ZERO_ADDRESS } from "@/lib/web3/config";

type Filter = "all" | "v4" | "v3" | "v2" | "multi" | "cross" | "hook";
const HOOK_FILTER_VISIBLE = IS_MAINNET ? AGGREGATOR_HOOKS_CLIENT_ENABLED : true;
const FILTERS: Filter[] = [
  "all", "v4", "v3",
  ...(REVIEWED_V2_CLIENT_ENABLED ? ["v2" as const] : []),
  "multi", "cross",
  ...(HOOK_FILTER_VISIBLE ? ["hook" as const] : []),
];

export default function RouteExplorer() {
  const [filter, setFilter] = useState<Filter>("all");
  const [sellSymbol, setSellSymbol] = useState<LiveTokenSymbol>("NVDA");
  const [buySymbol, setBuySymbol] = useState<LiveTokenSymbol>("AAPL");
  const [amount, setAmount] = useState("0.001");
  const [quote, setQuote] = useState<LiveQuote>();
  const [selectedRoute, setSelectedRoute] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const inputToken = LIVE_TOKEN_MAP[sellSymbol];
  const outputToken = LIVE_TOKEN_MAP[buySymbol];

  const refresh = useCallback(async () => {
    let raw: bigint;
    try {
      raw = parseUnits(amount || "0", inputToken.decimals);
      if (raw <= 0n) throw new Error("Amount must be positive");
    } catch {
      setError(`Enter a valid ${inputToken.displaySymbol} amount`);
      return;
    }
    setLoading(true);
    setError(undefined);
    setQuote(undefined);
    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tokenIn: sellSymbol,
          tokenOut: buySymbol,
          amountIn: raw.toString(),
          slippageBps: 50,
          routingMode: filter === "hook" ? "hooks" : filter === "v4" ? "v4" : filter === "v3" ? "v3" : filter === "v2" ? "v2" : filter === "cross" ? "mixed" : "best",
        }),
        cache: "no-store",
      });
      const data = await response.json() as LiveQuote & { error?: string };
      if (!response.ok) throw new Error(data.error || "Quote unavailable");
      setQuote(data);
      setSelectedRoute(data.selected.routeId);
      setUpdatedAt(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quote unavailable");
    } finally {
      setLoading(false);
    }
  }, [amount, inputToken.decimals, inputToken.displaySymbol, sellSymbol, buySymbol, filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 300);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const candidates = useMemo(() => (quote?.candidates || []).filter((candidate) => {
    if (filter === "v3") return candidate.steps.some((step) => step.providerId === "SYNTHRA_V3" || step.providerId === "UNISWAP_V3");
    if (filter === "v2") return candidate.steps.some((step) => step.providerId === "REVIEWED_V2_THIRD_PARTY" || step.providerId === "UNISWAP_V2");
    if (filter === "multi") return candidate.steps.length > 1;
    if (filter === "cross") return candidate.routeKind === "cross-venue";
    if (filter === "hook") return candidate.verifiedHook;
    if (filter === "v4") return candidate.steps.every((step) => step.providerId.startsWith("UNISWAP_V4"));
    return true;
  }), [quote, filter]);
  const active = candidates.find((candidate) => candidate.routeId === selectedRoute) || candidates[0];
  const fmt = (raw?: string) => raw ? Number(formatUnits(BigInt(raw), outputToken.decimals)).toLocaleString("en-US", { maximumFractionDigits: 7 }) : "—";
  const inputFmt = (raw?: string) => raw ? Number(formatUnits(BigInt(raw), inputToken.decimals)).toLocaleString("en-US", { maximumFractionDigits: 7 }) : "—";

  const chooseSell = (symbol: LiveTokenSymbol) => {
    setSellSymbol(symbol);
    if (symbol === buySymbol) setBuySymbol(symbol === "ETH" ? "NVDA" : "ETH");
  };
  const chooseBuy = (symbol: LiveTokenSymbol) => {
    setBuySymbol(symbol);
    if (symbol === sellSymbol) setSellSymbol(symbol === "ETH" ? "NVDA" : "ETH");
  };

  return (
    <main className="app-page light-app routes-page">
      <Header extra={<AudioToggle />} />
      <div className="app-aurora" aria-hidden="true"><i /><i /><i /><b /><b /></div>
      <section className="data-shell app-enter">
        <header className="data-hero">
          <span className="section-kicker">MULTI-VENUE ROUTE EXPLORER · CHAIN {PERM_CHAIN_ID}</span>
          <h1>Compare the route, not the label.</h1>
          <p>The same exact input is quoted across reviewed Uniswap v4 and {V3_VENUE.shortLabel} pools. Token-to-token paths may use two venue steps through ETH, and gas is normalized only when a valid conversion exists.{IS_MAINNET
            ? `${REVIEWED_V2_CLIENT_ENABLED ? ` ${REVIEWED_V2.shortLabel} pools are also compared.` : ""}${AGGREGATOR_HOOKS_CLIENT_ENABLED ? " Codehash-pinned v4 Aggregator Hook pools are reached through a 1:1 ETH→WETH wrap step." : ""}`
            : REVIEWED_V2_CLIENT_ENABLED ? " A separately gated third-party V2 path is also enabled." : " Third-party V2 remains withheld by the venue-admission gate."}</p>
          <div className="data-disclaimer"><i /> {IS_MAINNET ? "Only hookless Uniswap v4 pools and Uniswap v3 pools that passed a liquidity check are quoted on Robinhood Chain" : "Hook candidates remain unavailable unless deployment, runtime codehash, pool and quote all verify onchain"}</div>
        </header>

        <div className="metric-row">
          <article><span>VALID ROUTES</span><b>{quote?.candidates.length || 0}</b><small>same amount + policy</small></article>
          <article><span>VENUES OBSERVED</span><b>{quote ? new Set(quote.candidates.flatMap((candidate) => candidate.steps.map((step) => step.providerId))).size : 0}</b><small>not a marketing count</small></article>
          <article><span>FRESHNESS</span><b>{loading ? "…" : updatedAt ? "Live" : "—"}</b><small>{updatedAt ? new Date(updatedAt).toLocaleTimeString() : "awaiting RPC"}</small></article>
        </div>

        <section className="data-panel route-catalog">
          <header className="catalog-head">
            <div><span className="section-kicker">ONCHAIN CANDIDATE CATALOG</span><h2>Route quotes</h2></div>
            <div className="route-live-controls">
              <label><span>Input</span><input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /></label>
              <label><span>From</span><select value={sellSymbol} onChange={(event) => chooseSell(event.target.value as LiveTokenSymbol)}>{LIVE_TOKENS.map((token) => <option key={token.symbol} value={token.symbol}>{token.displaySymbol}</option>)}</select></label>
              <label><span>To</span><select value={buySymbol} onChange={(event) => chooseBuy(event.target.value as LiveTokenSymbol)}>{LIVE_TOKENS.map((token) => <option key={token.symbol} value={token.symbol}>{token.displaySymbol}</option>)}</select></label>
              <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Reading…" : "Refresh"}</button>
            </div>
            <div className="catalog-tabs" role="group" aria-label="Route type filter">
              {FILTERS.map((item) => <button key={item} type="button" className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "all" ? "All valid" : item === "multi" ? "Multi-hop" : item === "hook" ? "Verified hooks" : item.toUpperCase()}</button>)}
            </div>
          </header>

          <div className="catalog-layout">
          <div className="route-table" role="grid" aria-label="Live route candidates" tabIndex={0}>
            <div className="route-table-head" role="row"><span role="columnheader">PAIR</span><span role="columnheader">ROUTE</span><span role="columnheader">LIVE OUTPUT</span><span role="columnheader">GAS EST.</span><span role="columnheader">TYPE</span></div>
            {candidates.map((candidate, index) => <RouteRow key={candidate.routeId} candidate={candidate} index={index} active={candidate.routeId === active?.routeId} onSelect={() => setSelectedRoute(candidate.routeId)} input={inputToken} output={outputToken} fmt={fmt} />)}
            {!candidates.length && <div className="route-filter-empty">{loading ? "Reading verified quoters…" : error || "No candidate passes this filter. Unavailable coverage is not fabricated."}</div>}
          </div>

            {active ? <aside className="route-inspector" key={active.routeId}>
              <span className="section-kicker">SELECTED ROUTE</span>
              <div className="inspector-pair"><LiveTokenMark token={inputToken} size={42} /><i>→</i><LiveTokenMark token={outputToken} size={42} /></div>
              <h3>{inputToken.displaySymbol} to {outputToken.displaySymbol}</h3><p>{active.providerLabel}</p>
              <div className="inspector-path"><span>INPUT</span><i /><em>{active.routeKind.toUpperCase()}</em><i /><span>OUTPUT</span></div>
              <dl>
                <div><dt>Live result</dt><dd>{fmt(active.amountOut)} {outputToken.displaySymbol}</dd></div>
                <div><dt>Minimum received</dt><dd>{fmt(active.minAmountOut)} {outputToken.displaySymbol}</dd></div>
                <div><dt>Net Perm fee</dt><dd>{inputFmt(quote?.netFee)} {inputToken.displaySymbol}</dd></div>
                <div><dt>Gas-adjusted result</dt><dd>{active.gasAdjustedOutput ? `${fmt(active.gasAdjustedOutput)} ${outputToken.displaySymbol}` : "gas separate"}</dd></div>
                <div><dt>Price impact</dt><dd>{active.priceImpactBps === undefined ? "unavailable" : `${(active.priceImpactBps / 100).toFixed(2)}%`}</dd></div>
                <div><dt>Hook claim</dt><dd>{active.verifiedHook ? active.hook : "None"}</dd></div>
              </dl>
              <section className="inspector-steps">{active.steps.map((step, index) => <div key={`${active.routeId}-${index}`}><b>{index + 1}. {step.providerLabel}</b><span>{step.tokenIn === ZERO_ADDRESS ? "ETH" : `${step.tokenIn.slice(0, 6)}…`} → {step.tokenOut === ZERO_ADDRESS ? "ETH" : `${step.tokenOut.slice(0, 6)}…`}</span><small>pool {step.poolId.slice(0, 12)}… · {step.poolFee / 10_000}%</small></div>)}</section>
              <a href={`${PERM_EXPLORER}/address/${active.steps[0].adapter}`} target="_blank" rel="noopener noreferrer">Inspect adapter ↗</a>
              <small>The trade page requests an account-bound EIP-712 signature and simulates this exact route immediately before submission.</small>
            </aside> : <aside className="route-inspector"><span className="section-kicker">NO VALID QUOTE</span><h3>{error || "Reading verified quoters…"}</h3></aside>}
          </div>
        </section>

        <section className="logic-band app-reveal"><div><span className="section-kicker">SELECTION LOGIC</span><h2>Net result wins when units match.</h2></div><ol><li><b>01</b><span>Apply one input and the active onchain fee policy to every candidate.</span></li><li><b>02</b><span>Reject stale, reverting, unapproved-adapter, and codehash-mismatched hook routes.</span></li><li><b>03</b><span>Rank after estimated gas when ETH can be converted through the observed route.</span></li></ol></section>
      </section>
      <div className="footer-shell app-footer"><Footer /></div>
    </main>
  );
}

function RouteRow({ candidate, index, active, onSelect, input, output, fmt }: {
  candidate: LiveQuoteCandidate;
  index: number;
  active: boolean;
  onSelect: () => void;
  input: typeof LIVE_TOKENS[number];
  output: typeof LIVE_TOKENS[number];
  fmt: (raw?: string) => string;
}) {
  return <button className={`route-table-row${active ? " selected" : ""}`} type="button" onClick={onSelect} style={{ "--row-delay": `${index * 45}ms` } as CSSProperties}>
    <span className="pair-cell" role="cell"><span className="live-pair"><LiveTokenMark token={input} size={27} /><LiveTokenMark token={output} size={27} /></span><b>{input.displaySymbol}/{output.displaySymbol}</b></span>
    <span role="cell"><b>{candidate.providerLabel}</b><small>{candidate.steps.length} step{candidate.steps.length > 1 ? "s" : ""} · {candidate.gasNormalized ? "gas normalized" : "gas separate"}</small></span>
    <span className="mono-cell" role="cell">{fmt(candidate.amountOut)} {output.displaySymbol}</span>
    <span className="mono-cell" role="cell">{Number(formatEther(BigInt(candidate.estimatedNetworkFeeWei))).toPrecision(3)} ETH</span>
    <span role="cell"><em className={`route-type ${candidate.verifiedHook ? "hook" : "direct"}`}>{candidate.routeKind.toUpperCase()}</em></span>
  </button>;
}
