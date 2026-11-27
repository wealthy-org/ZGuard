"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SceneController, SceneStop } from "@/lib/perm-scene";
import Header from "./Header";
import AudioToggle from "./AudioToggle";
import FeatureStack from "./FeatureStack";
import Footer from "./Footer";
import { IS_MAINNET } from "@/lib/web3/network";

type JourneyCard = {
  from: number;
  to: number;
  align?: "left" | "right";
  content: ReactNode;
};

const FALLBACK_STOPS: SceneStop[] = [
  { n: "I", label: "Route", p: 0.30, a: 0.24 },
  { n: "II", label: "Rebate", p: 0.43, a: 0.37 },
  { n: "III", label: "Proof", p: 0.56, a: 0.50 },
  { n: "IV", label: IS_MAINNET ? "Venues" : "Hooks", p: 0.69, a: 0.63 },
  { n: "V", label: "Settle", p: 0.97, a: 0.88 },
];
// On mainnet the fourth stop describes venue coverage: no Aggregator Hook is enabled on 4663.
const relabelStops = (stops: SceneStop[]) => IS_MAINNET
  ? stops.map((stop) => (stop.label === "Hooks" ? { ...stop, label: "Venues" } : stop))
  : stops;

const JOURNEY_CARDS: JourneyCard[] = [
  {
    from: 0.18,
    to: 0.275,
    content: (
      <>
        <CardKicker left="THE PERM FLOW" right="ROUTER · SETTLEMENT" />
        <h2>A swap you can read before you sign</h2>
        <p>Every gate is a decision: compare valid candidates, expose each known fee, protect the minimum, then prove the final result.</p>
      </>
    ),
  },
  {
    from: 0.285,
    to: 0.355,
    content: (
      <>
        <CardKicker left="I · ROUTE" right="SAME BASIS" />
        <h2>Compare the whole route</h2>
        <p>Candidate routes use the same amount, fee policy, and quote window. Perm selects a valid net result—not the loudest venue label.</p>
        <div className="journey-rows">
          <span>Candidate A</span><b>{IS_MAINNET ? "Uniswap v4 direct pool" : "V4 + verified hook"}</b>
          <span>Candidate B</span><b>Uniswap V3</b>
          <span>Selection</span><b className="status-live">Highest valid net output</b>
        </div>
        <Link className="card-link" href="/trade">{IS_MAINNET ? "Open routing" : "Preview routing"}</Link>
      </>
    ),
  },
  {
    from: 0.37,
    to: 0.485,
    content: (
      <>
        <CardKicker left="II · REBATE" right="PERM FEE ONLY" />
        <h2>Reduce the platform fee at settlement</h2>
        <p>The rebate comes from Perm&apos;s own fee. It does not rebrand LP fees, third-party fees, protocol fees, or gas as a discount.</p>
        <div className="journey-rows compact">
          <span>Gross Perm fee</span><b>0.20%</b>
          <span>{IS_MAINNET ? "Fee rebate share" : "Illustrative rebate share"}</span><b className="mint-text">25%</b>
          <span>Net Perm fee</span><b>0.15%</b>
        </div>
        <small className="fixture-note">{IS_MAINNET ? "Fee policy v1, published onchain by PermRouter." : "Illustrative fixture—not final commercial policy."}</small>
      </>
    ),
  },
  {
    from: 0.50,
    to: 0.615,
    content: (
      <>
        <CardKicker left="III · PROOF" right="ACTUAL RESULT" />
        <h2>The receipt follows settlement</h2>
        <p>Route identifiers, actual input and output, fee, rebate, recipient, policy version, transaction hash, and gas belong in one verifiable record.</p>
        <div className="proof-chip"><i>✓</i><span>Policy-bound receipt</span><code>perm-fee-v1</code></div>
      </>
    ),
  },
  {
    from: 0.63,
    to: 0.745,
    content: IS_MAINNET ? (
      <>
        <CardKicker left="IV · VENUES" right="ONCHAIN ONLY" />
        <h2>Only venues that exist on this chain</h2>
        <p>On Robinhood Chain, Perm quotes Uniswap v4 direct pools without hooks and Uniswap v3 pools that passed a liquidity check. Nothing else is labelled as a route.</p>
        <div className="tag-row"><span>chain</span><span>adapter</span><span>pool</span><span>freshness</span></div>
        <Link className="card-link" href="/docs/hooks">Understand the boundary</Link>
      </>
    ) : (
      <>
        <CardKicker left="IV · HOOKS" right="VERIFIED ONLY" />
        <h2>Verified hooks, never hook-by-label</h2>
        <p>A hook callback exists only when its pool is actually used. Perm verifies deployment and execution details before a hook candidate can enter comparison.</p>
        <div className="tag-row"><span>chain</span><span>spender</span><span>target</span><span>freshness</span></div>
        <Link className="card-link" href="/docs/hooks">Understand the boundary</Link>
      </>
    ),
  },
  {
    from: 0.77,
    to: 0.865,
    content: (
      <>
        <CardKicker left="THE ROUTER" right="NET RESULT" />
        <h2>No forced detour for a badge</h2>
        <p>{IS_MAINNET ? "Uniswap v4 and Uniswap v3 routes, including two-step routes through ETH, compete on the same basis." : "V2, V3, verified v4 hook routes, and other supported venues can compete."} If gas cannot be converted into the same unit reliably, Perm shows the trade-off instead of inventing certainty.</p>
      </>
    ),
  },
  {
    from: 0.89,
    to: 1.01,
    content: (
      <>
        <CardKicker left="V · SETTLE" right="PERM" />
        <h2>See the route. Keep the difference.</h2>
        <p>Enter a transparent router experience designed around comparable quotes, a visible fee discount, and proof after execution.</p>
        <div className="button-row card-buttons">
          <Link className="button primary" href="/trade">{IS_MAINNET ? "Open router" : "Launch preview"}</Link>
          <Link className="button secondary" href="/docs">Read the docs</Link>
        </div>
      </>
    ),
  },
];

function CardKicker({ left, right }: { left: string; right: string }) {
  return <div className="card-kicker"><span>{left}</span><b>{right}</b></div>;
}

export default function Landing() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hero = useRef<HTMLElement>(null);
  const transitionVeil = useRef<HTMLDivElement>(null);
  const scrollHint = useRef<HTMLDivElement>(null);
  const cardElements = useRef<Array<HTMLElement | null>>([]);
  const controller = useRef<SceneController | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pastJourney, setPastJourney] = useState(false);
  const [stops, setStops] = useState<SceneStop[]>(FALLBACK_STOPS);

  useEffect(() => {
    let active = true;
    let cleanupScroll: (() => void) | undefined;
    let currentReader: (() => void) | undefined;
    let scrollTimer = 0;
    let lastObservedScroll = -1;
    let minimumPassed = false;
    let sceneLoaded = false;
    const revealWhenReady = () => {
      if (active && minimumPassed && sceneLoaded) setReady(true);
    };

    const minimumIntro = window.setTimeout(() => {
      minimumPassed = true;
      revealWhenReady();
    }, 1320);

    const applyPresentation = (next: number, isPast: boolean) => {
      const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
      const ease = (value: number) => value * value * (3 - 2 * value);
      const heroExit = ease(clampUnit((next - 0.012) / 0.078));
      const heroVisibility = 1 - heroExit;
      if (hero.current) {
        hero.current.style.opacity = String(heroVisibility);
        hero.current.style.transform = `translateY(${-10 * heroExit}px) scale(${1 - heroExit * 0.008})`;
        hero.current.style.filter = `blur(${heroExit * 1.8}px)`;
      }
      if (transitionVeil.current) {
        const veilIn = ease(clampUnit((next - 0.012) / 0.068));
        const veilOut = ease(clampUnit((next - 0.105) / 0.09));
        transitionVeil.current.style.opacity = String((0.08 + veilIn * 0.66) * (1 - veilOut));
      }
      if (scrollHint.current) scrollHint.current.style.opacity = String(Math.max(0, 1 - next / 0.03));
      cardElements.current.forEach((element, index) => {
        const card = JOURNEY_CARDS[index];
        element?.classList.toggle("visible", !isPast && next >= card.from && next <= card.to);
      });
    };

    const monitorScroll = () => {
      if (currentReader && Math.abs(scrollY - lastObservedScroll) > 0.5) currentReader();
    };
    scrollTimer = window.setInterval(monitorScroll, 48);

    const start = async () => {
      try {
        const { createPermScene } = await import("@/lib/perm-scene");
        if (!active || !canvas.current) return;
        const scene = createPermScene(canvas.current, {
          onReady: () => {
            sceneLoaded = true;
            revealWhenReady();
          },
        });
        controller.current = scene;
        setStops(relabelStops(scene.stops));

        const read = () => {
          lastObservedScroll = scrollY;
          const max = journeyEnd();
          const next = max > 0 ? Math.min(1, scrollY / max) : 0;
          scene.setTarget(next);
          const isPast = scrollY > max + innerHeight * 0.12;
          applyPresentation(next, isPast);
          setProgress(next);
          setPastJourney(isPast);
          document.body.classList.toggle("after-journey", isPast);
        };
        currentReader = read;
        addEventListener("scroll", read, { passive: true });
        addEventListener("resize", read, { passive: true });
        read();
        cleanupScroll = () => {
          removeEventListener("scroll", read);
          removeEventListener("resize", read);
        };
      } catch (error) {
        console.error("Perm WebGL scene unavailable", error);
        if (!active) return;
        setFailed(true);
        sceneLoaded = true;
        revealWhenReady();
        const readFallback = () => {
          lastObservedScroll = scrollY;
          const max = journeyEnd();
          const value = max > 0 ? Math.min(1, scrollY / max) : 0;
          const isPast = scrollY > max + innerHeight * 0.12;
          applyPresentation(value, isPast);
          setProgress(value);
          setPastJourney(isPast);
        };
        currentReader = readFallback;
        addEventListener("scroll", readFallback, { passive: true });
        readFallback();
        cleanupScroll = () => removeEventListener("scroll", readFallback);
      }
    };

    const safety = window.setTimeout(() => setReady(true), 4200);
    start();
    return () => {
      active = false;
      currentReader = undefined;
      window.clearInterval(scrollTimer);
      window.clearTimeout(minimumIntro);
      window.clearTimeout(safety);
      cleanupScroll?.();
      controller.current?.dispose();
      controller.current = null;
      document.body.classList.remove("after-journey");
    };
  }, []);

  const goTo = (target: number) => {
    scrollTo({ top: target * journeyEnd(), behavior: "smooth" });
  };

  let activeStop = -1;
  stops.forEach((stop, index) => {
    if (progress >= stop.a - 0.025) activeStop = index;
  });

  return (
    <main className={`landing${ready ? " entered" : ""}`}>
      <canvas id="perm-scene" ref={canvas} className={failed ? "failed" : undefined} aria-hidden="true" />
      <div className={`scene-fallback${failed ? " visible" : ""}`} aria-hidden="true"><i /><i /><i /></div>
      <div className="scene-atmosphere" aria-hidden="true"><i /><i /><i /></div>
      <div ref={transitionVeil} className="scene-transition-veil" aria-hidden="true" />

      <div className={`site-loader${ready ? " hidden" : ""}`} aria-hidden={ready}>
        <div className="loader-emblem"><i /><i /><span /><img src="/perm-mark.png" alt="" /></div>
        <b>PERM</b>
        <span>ENTERING THE FLOW</span>
        <small>LOADING THE PERM WORLD</small>
        <div className="loader-bar"><i /></div>
      </div>

      <Header extra={<AudioToggle />} />

      <section ref={hero} className="landing-hero">
        <div className="hero-orbit" aria-hidden="true"><i /><i /></div>
        <span className="hero-kicker"><i /> {IS_MAINNET ? "MULTI-VENUE ROUTING · TRANSPARENT REBATE" : "VERIFIED-HOOK ROUTING · TRANSPARENT REBATE"}</span>
        <h1>PERM</h1>
        <p>COMPARE ROUTES. SEE EVERY FEE.<br />KEEP MORE OF YOUR SWAP.</p>
        <span className="hero-sub">A routing interface designed for measurable net results—not labels.</span>
        <div className="hero-badges">
          <span>Signed route</span><span>Perm fee rebate</span><span>Proof receipt</span>
        </div>
        <div className="button-row hero-buttons">
          <Link className="button primary" href="/trade">Open router</Link>
          <a className="button secondary" href="#capabilities">Explore the flow <span>↓</span></a>
        </div>
      </section>

      <div ref={scrollHint} className="scroll-hint">
        <span>SCROLL TO FOLLOW THE ROUTE</span><i />
      </div>

      {JOURNEY_CARDS.map((card, index) => (
        <article
          key={index}
          ref={(element) => { cardElements.current[index] = element; }}
          className={`journey-card ${card.align === "right" ? "right-card" : ""}`}
        >
          {card.content}
        </article>
      ))}

      <nav className={`journey-rail${pastJourney ? " hidden" : ""}`} aria-label="Perm journey">
        {stops.map((stop, index) => (
          <button key={stop.label} type="button" className={index === activeStop ? "active" : ""} aria-label={`${stop.n} · ${stop.label.toUpperCase()}`} onClick={() => goTo(stop.p)}>
            <span>{stop.n} · {stop.label.toUpperCase()}</span><i />
          </button>
        ))}
      </nav>

      <div id="journey-track" />
      <div id="capabilities"><FeatureStack /></div>
      <div className="footer-shell"><Footer /></div>
    </main>
  );
}

function journeyEnd() {
  const track = document.getElementById("journey-track");
  return track ? track.offsetTop + track.offsetHeight - innerHeight : Math.max(1, document.documentElement.scrollHeight - innerHeight);
}
