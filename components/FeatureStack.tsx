"use client";

import Link from "next/link";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import TokenLogo from "./TokenLogo";
import { IS_MAINNET } from "@/lib/web3/network";

const FEATURES: Array<{
  id: string;
  eyebrow: string;
  title: string;
  copy: string;
  tag: string;
  visual: ReactNode;
}> = [
  {
    id: "routing",
    eyebrow: "01 · ROUTE COMPARISON",
    title: "Every valid candidate, judged on the same basis",
    copy: IS_MAINNET
      ? "Perm compares whole-route candidates across Uniswap v4 and Uniswap v3 using the same amount, fee policy, and quote window. The highest valid net output is selected."
      : "Perm compares whole-route candidates using the same amount, fee policy, and quote window. A hook route wins only when its net result is competitive.",
    tag: "SAME-BASIS COMPARISON",
    visual: <RouteVisual />,
  },
  {
    id: "rebate",
    eyebrow: "02 · PERM FEE REBATE",
    title: "The discount is visible before you sign",
    copy: "The rebate reduces Perm's own platform fee at settlement. LP fees, third-party hook fees, protocol fees, and network gas stay separate.",
    tag: "INSTANT DISCOUNT",
    visual: <RebateVisual />,
  },
  {
    id: "hooks",
    eyebrow: IS_MAINNET ? "03 · VENUE COVERAGE" : "03 · VERIFIED HOOKS",
    title: IS_MAINNET ? "Only venues that actually exist on Robinhood Chain" : "Use verified hooks where they actually exist",
    copy: IS_MAINNET
      ? "Uniswap v4 direct pools (no hook) and Uniswap v3 pools enter comparison only after a liquidity check. Aggregator Hook routing stays disabled until a verified hook exists on this chain."
      : "Aggregator Hook candidates are included only after chain, deployment, quote, spender, and execution target checks. Plain V2 or V3 routes are never relabeled as hook routes.",
    tag: "VERIFIED COVERAGE",
    visual: <HookVisual />,
  },
  {
    id: "proof",
    eyebrow: "04 · SETTLEMENT PROOF",
    title: "A receipt for what actually happened",
    copy: "The receipt records the proven route, actual amounts, recipient, gross fee, rebate, net fee, policy version, transaction hash, and gas used.",
    tag: "MEASURABLE RESULT",
    visual: <ReceiptVisual />,
  },
  {
    id: "protection",
    eyebrow: "05 · USER BOUNDS",
    title: "Minimum received remains the hard line",
    copy: "Quotes bind chain, amount, recipient, deadline, policy version, and minimum output. Settlement cannot silently raise the fee after confirmation.",
    tag: "SLIPPAGE GUARD",
    visual: <ShieldVisual />,
  },
  {
    id: "accounting",
    eyebrow: "06 · ROUTER-LEVEL ACCOUNTING",
    title: "The rebate follows the Perm entry point—not a label",
    copy: "Eligible routes can receive the Perm fee discount without being forced through a custom pool. A direct trade outside Perm does not receive the router-level rebate.",
    tag: "ROUTE AGNOSTIC",
    visual: <AccountingVisual />,
  },
];

export default function FeatureStack() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const elements = root.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!elements) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.target.classList.toggle("revealed", entry.isIntersecting)),
      { threshold: 0.2 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <section className="feature-section" ref={root} aria-labelledby="feature-title">
      <div className="feature-inner">
        <header className="feature-heading" data-reveal>
          <span className="section-kicker">WHAT PERM CHANGES</span>
          <h2 id="feature-title">Clearer routes. Lower platform cost. Proof at the end.</h2>
          <p>Scroll through the product logic. Every claim below maps to an implementation requirement in the Perm brief.</p>
        </header>

        <div className="feature-stack">
          {FEATURES.map((feature, index) => (
            <article
              id={feature.id}
              key={feature.id}
              className="feature-card"
              style={{ "--card-index": index } as CSSProperties}
              data-reveal
            >
              <div className="feature-visual" aria-hidden="true">{feature.visual}</div>
              <div className="feature-copy">
                <div className="feature-meta"><span>{feature.eyebrow}</span><b>{feature.tag}</b></div>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
                <Link href="/docs" className="text-link">Read the docs <span>↗</span></Link>
              </div>
            </article>
          ))}
        </div>

        <div className="proof-strip" data-reveal>
          <div>
            <span className="section-kicker">THE STANDARD</span>
            <h3>No “always cheapest” claim. Just comparable inputs and measurable outcomes.</h3>
          </div>
          <div className="proof-metrics">
            <span><b>01</b> Net output</span>
            <span><b>02</b> Fee policy</span>
            <span><b>03</b> Gas used</span>
            <span><b>04</b> Route proof</span>
          </div>
        </div>

        <div className="final-cta" data-reveal>
          <img src="/perm-mark.png" alt="" />
          <span className="section-kicker">THE ROUTER, MADE LEGIBLE</span>
          <h2>Compare routes. See every fee. Keep more of your swap.</h2>
          <p>{IS_MAINNET ? "Router v2 is live on Robinhood Chain. Every settlement links to Blockscout." : "Explore the interface preview while execution contracts and verified integrations are finalized."}</p>
          <div className="button-row">
            <Link className="button primary" href="/trade">{IS_MAINNET ? "Open router" : "Open router preview"}</Link>
            <Link className="button secondary" href="/docs">Read the docs</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function RouteVisual() {
  // Schematic only. On mainnet no amounts are shown here; real numbers live on /trade and /proofs.
  const routes = IS_MAINNET
    ? [
        ["Uniswap v4 direct", "candidate", 92, true],
        ["Uniswap v3", "candidate", 88, false],
        ["v4 → ETH → v3", "candidate", 74, false],
      ] as const
    : [
        ["V4 + verified hook", "1,846.72", 96, true],
        ["Uniswap V3", "1,843.09", 81, false],
        ["Uniswap V2", "1,837.44", 67, false],
      ] as const;
  return (
    <div className="route-visual">
      {IS_MAINNET
        ? <div className="visual-token-pair"><TokenLogo symbol="ETH" size={30} /><i>→</i><span>ETH → Stock Token</span></div>
        : <div className="visual-token-pair"><TokenLogo symbol="ETH" size={30} /><i>→</i><TokenLogo symbol="USDC" size={30} /><span>ETH / USDC</span></div>}
      {routes.map(([name, amount, width, selected], index) => (
        <div className={`route-line${selected ? " selected" : ""}`} key={name} style={{ "--delay": `${index * 160}ms` } as CSSProperties}>
          <div><span>{selected ? "✓ " : ""}{name}</span><b>{amount}</b></div>
          <i><em style={{ width: `${width}%` }} /></i>
        </div>
      ))}
      <small>{IS_MAINNET ? "schematic · live quotes on /trade" : "same amount · same snapshot · net result"}</small>
    </div>
  );
}

function RebateVisual() {
  return (
    <div className="rebate-visual">
      <div className="fee-ring"><span>25%</span><small>rebate share</small></div>
      <div className="fee-lines">
        <span>Gross Perm fee <b>0.20</b></span>
        <span className="discount">Fee rebate <b>−0.05</b></span>
        <span className="total">Net Perm fee <b>0.15</b></span>
      </div>
      <small className="demo-label">{IS_MAINNET ? "POLICY v1 · PUBLISHED ONCHAIN" : "DEMO POLICY · VALUES ARE ILLUSTRATIVE"}</small>
    </div>
  );
}

function HookVisual() {
  return (
    <svg className="hook-visual" viewBox="0 0 420 220">
      <defs>
        <linearGradient id="hook-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#70e4b0" /><stop offset="1" stopColor="#70e8df" />
        </linearGradient>
      </defs>
      <path className="hook-path" d="M55 55 C130 25 248 30 307 87 C350 128 329 185 267 187 C219 189 194 160 214 131" />
      <circle className="hook-pool" cx="214" cy="131" r="36" />
      <circle className="hook-core" cx="214" cy="131" r="12" />
      {[[55,55],[129,35],[214,42],[288,72],[330,125],[304,174]].map(([x,y], index) => (
        <circle key={index} className="hook-node" cx={x} cy={y} r="5" style={{ "--delay": `${index * 180}ms` } as CSSProperties} />
      ))}
      <text x="42" y="90">verified candidate</text>
      <text x="252" y="128">pool-bound</text>
    </svg>
  );
}

function ReceiptVisual() {
  return (
    <div className="receipt-visual">
      <div className="receipt-top"><span>SETTLED</span><i>✓</i></div>
      <div><small>ROUTE</small><b>{IS_MAINNET ? "route steps" : "V4 hook → USDC"}</b></div>
      <div><small>ACTUAL OUT</small><b>{IS_MAINNET ? "from SwapSettled" : "1,846.72 USDC"}</b></div>
      <div><small>FEE / REBATE</small><b>0.20 / −0.05</b></div>
      <div><small>POLICY</small><b>perm-fee-v1</b></div>
      <code>{IS_MAINNET ? "tx hash → Blockscout" : "0x8c3f…a91e"}</code>
      <span className="scanline" />
    </div>
  );
}

function ShieldVisual() {
  return (
    <div className="shield-visual">
      <svg viewBox="0 0 160 180">
        <path className="shield-body" d="M80 8 145 32v55c0 43-28 69-65 86-37-17-65-43-65-86V32Z" />
        <path className="shield-check" pathLength="1" d="m46 91 24 23 47-52" />
      </svg>
      <div><span>Minimum received</span><b>{IS_MAINNET ? "signed minimum" : "1,837.48 USDC"}</b><small>bound at confirmation</small></div>
    </div>
  );
}

function AccountingVisual() {
  return (
    <div className="accounting-visual">
      <div className="account-node input">USER</div>
      <div className="account-flow"><i /><i /><i /></div>
      <div className="account-node router">PERM<br />ROUTER</div>
      <div className="account-branches">
        {IS_MAINNET
          ? <><span>V4</span><span>V3</span><span>V4→V3</span></>
          : <><span>V2</span><span>V3</span><span className="hook">V4 HOOK</span></>}
      </div>
      <div className="account-label">one fee policy · multiple valid route types</div>
    </div>
  );
}
