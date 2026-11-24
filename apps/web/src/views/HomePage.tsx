import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  FlaskConical,
  Fingerprint,
  Router,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TerminalSquare,
} from 'lucide-react';
import { HeroScene3D } from '../components/HeroScene3D';
import { MagneticButton } from '../components/MagneticButton';
import { ZGuardLogo } from '../components/ZGuardLogo';
import { EASE, LineReveal, Reveal } from '../components/Reveal';
import { SpotlightCard } from '../components/SpotlightCard';
import { Counter } from '../components/Counter';
import { TerminalBlock } from '../components/Typed';
import { OrbitIllo, QuoteIllo, RiskIllo, SimIllo } from '../components/Illustrations';
import type { Navigate, RouteId } from '../types';

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function KineticWord({ text }: { text: string }) {
  return (
    <span className="inline-flex overflow-hidden">
      {text.split('').map((ch, i) => (
        <motion.span
          key={`${ch}-${i}`}
          initial={{ y: '120%', rotateX: -70, opacity: 0 }}
          animate={{ y: '0%', rotateX: 0, opacity: 1 }}
          transition={{ delay: 0.25 + i * 0.05, duration: 0.8, ease: EASE }}
          className="inline-block"
          style={{ transformOrigin: '50% 100%', perspective: 600 }}
        >
          {ch}
        </motion.span>
      ))}
    </span>
  );
}

function Hero({ navigate }: { navigate: Navigate }) {
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 700], [0, 140]);
  const heroOp = useTransform(scrollY, [0, 520], [1, 0.15]);

  return (
    <section className="relative flex min-h-[100svh] items-end overflow-hidden">
      <motion.div style={{ y: heroY, opacity: heroOp }} className="absolute inset-0">
        <HeroScene3D />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/20" />
        <div className="absolute inset-0 bg-zguard-grid opacity-40" />
      </motion.div>
      <motion.div
        aria-hidden
        style={{ y: heroY }}
        className="pointer-events-none absolute right-[-8%] top-[18%] hidden select-none font-display text-[28vw] leading-none text-white/[0.04] md:block"
      >
        4663
      </motion.div>

      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-16 pt-32 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-300 backdrop-blur-md"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          Robinhood Chain · 4663
        </motion.div>

        <h1 className="font-display text-[16vw] leading-[0.82] tracking-[-0.07em] text-white sm:text-[12vw] lg:text-[9.4vw]">
          <KineticWord text="ZGUARD" />
        </h1>

        <div className="mt-6 grid grid-cols-1 items-end gap-8 lg:grid-cols-12">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.8 }}
            className="font-display max-w-2xl text-lg font-medium leading-snug tracking-tight text-zinc-300 sm:text-2xl lg:col-span-7"
          >
            One check before your agent signs on Robinhood Chain.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.7 }}
            className="space-y-4 lg:col-span-5 lg:text-right"
          >
            <p className="max-w-sm text-sm text-zinc-400 lg:ml-auto">
              Quote-match, transaction simulation and token risk in a single call. The verdict is{' '}
              <span className="font-mono text-white">allow</span>, <span className="font-mono text-white">deny</span> or{' '}
              <span className="font-mono text-white">abstain</span> — never a “safe” label.
            </p>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <MagneticButton
                onClick={() => navigate('console')}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-6 py-3.5 font-mono text-xs font-bold text-black"
              >
                Open Guard Console
                <ArrowRight className="h-4 w-4" />
              </MagneticButton>
              <MagneticButton
                onClick={() => navigate('checks')}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3.5 font-mono text-xs text-white backdrop-blur"
              >
                Explore the checks
              </MagneticButton>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="mt-14 flex items-center gap-6 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500"
        >
          <span className="hidden h-10 w-px bg-white/20 sm:block" />
          <span className="animate-float-slow">Scroll</span>
          <span className="relative h-10 w-px overflow-hidden bg-white/15">
            <span className="absolute inset-x-0 h-4 bg-white animate-scanline" />
          </span>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Marquee                                                             */
/* ------------------------------------------------------------------ */

const MARQUEE = [
  'eip155:4663',
  'USDG · 0x5fc5…d168',
  'PoolManager · 0x8366…0951',
  'pons V2 factory · 0x7eD5…EC7e',
  'Groth16 · BN254',
  'Halo2-KZG (target)',
  'x402 · USDG billing',
  'allow · deny · abstain',
  'Perm · Terminal · MCP',
  'fail-closed signer',
];

function Marquee() {
  return (
    <div className="overflow-hidden border-y border-white/10 bg-white/[0.02] py-3">
      <div className="animate-marquee gap-12">
        {[0, 1].map((k) => (
          <div key={k} className="flex shrink-0 items-center gap-12 pr-12 font-mono text-[11px] text-zinc-500">
            {MARQUEE.map((m, i) => (
              <span key={i} className={i % 4 === 0 ? 'text-white' : ''}>
                {m}
                <span className="ml-12 text-zinc-700">✳</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pinned horizontal: three checks                                     */
/* ------------------------------------------------------------------ */

interface CheckDef {
  n: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  bullets: string[];
  illo: ReactNode;
  to: RouteId;
}

const CHECKS: CheckDef[] = [
  {
    n: '01',
    icon: ScanLine,
    title: 'Quote-match',
    desc: 'Confirms the payment you sign is the payment you were quoted: payee, amount, asset and chain, compared byte for byte.',
    bullets: ['payTo · asset · amount · chainId', 'Approvals outside intent → deny', 'Undecodable bytes → abstain'],
    illo: <QuoteIllo />,
    to: 'checks',
  },
  {
    n: '02',
    icon: FlaskConical,
    title: 'Tx simulation',
    desc: 'Runs the transaction against current Robinhood Chain state: balance changes, approvals, hook calls and reverts before anything is signed.',
    bullets: ['ETH + ERC-20 balance deltas', 'Uniswap v4 & pons hook calls', 'Revert → S-REVERT'],
    illo: <SimIllo />,
    to: 'checks',
  },
  {
    n: '03',
    icon: Fingerprint,
    title: 'Token risk',
    desc: 'Reports what a token is onchain: kind, holders, liquidity, tax, mint authority and pons curve state. Identity by address, never ticker.',
    bullets: ['kind resolved by address & registry', 'Holders · LP · tax · authorities', 'pons curve / v4 graduation state'],
    illo: <RiskIllo />,
    to: 'checks',
  },
];

/** Scroll-progress window in which the track actually travels; the rest is a hold. */
const TRAVEL_START = 0.06;
const TRAVEL_END = 0.9;

function CheckCard({
  c,
  navigate,
  x,
  focusX,
  desktop,
}: {
  c: CheckDef;
  navigate: Navigate;
  x: MotionValue<number>;
  focusX: number;
  desktop: boolean;
}) {
  const Icon = c.icon;
  // Distance (px) between this card's centre and the viewport centre.
  const offset = useTransform(x, (v) => (desktop ? v - focusX : 0));
  const scale = useTransform(offset, [-1000, 0, 1000], [0.94, 1, 0.94]);
  const opacity = useTransform(offset, [-1000, 0, 1000], [0.55, 1, 0.55]);
  const illoX = useTransform(offset, (v) => v * -0.06);

  return (
    <motion.div
      data-card
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.7, ease: EASE }}
      className="lg:w-[32vw] lg:shrink-0"
    >
      {/* Entrance lives on the outer layer, scroll focus on the inner one, so the two opacities never fight. */}
      <motion.div style={{ scale, opacity }} className="h-full">
        <SpotlightCard className="h-full p-6 sm:p-7">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
              <span>{c.n} / 03</span>
              <Icon className="h-4 w-4 text-white" strokeWidth={1.6} />
            </div>
            <div className="relative mt-5 h-52 overflow-hidden rounded-2xl border border-white/10 bg-black/60 bg-zguard-dots">
              <motion.div style={{ x: illoX }} className="absolute inset-y-0 -inset-x-6">
                {c.illo}
              </motion.div>
            </div>
            <h3 className="mt-6 font-display text-2xl text-white">{c.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{c.desc}</p>
            <ul className="mt-5 space-y-2">
              {c.bullets.map((b) => (
                <li key={b} className="flex items-center gap-2 font-mono text-[11px] text-zinc-300">
                  <span className="h-1 w-1 rounded-full bg-white" />
                  {b}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => navigate(c.to)}
              className="mt-auto inline-flex items-center gap-2 pt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-white transition-all hover:gap-3"
            >
              Explore the checks <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </SpotlightCard>
      </motion.div>
    </motion.div>
  );
}

function PinnedChecks({ navigate }: { navigate: Navigate }) {
  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [desktop, setDesktop] = useState(false);
  const [dist, setDist] = useState(0);
  const [focus, setFocus] = useState<number[]>([]);
  const [index, setIndex] = useState(0);

  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const measure = () => {
      const isDesktop = mq.matches;
      setDesktop(isDesktop);
      const t = track.current;
      if (!t || !isDesktop) {
        setDist(0);
        setFocus([]);
        return;
      }
      const rect = t.getBoundingClientRect();
      setDist(Math.max(0, Math.ceil(rect.width - window.innerWidth)));
      const cards = Array.from(t.querySelectorAll<HTMLElement>('[data-card]'));
      setFocus(
        cards.map((el) => {
          const r = el.getBoundingClientRect();
          const centreInTrack = r.left - rect.left + r.width / 2;
          return window.innerWidth / 2 - centreInTrack;
        })
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (track.current) ro.observe(track.current);
    window.addEventListener('resize', measure);
    mq.addEventListener('change', measure);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      mq.removeEventListener('change', measure);
    };
  }, []);

  const { scrollYProgress } = useScroll({ target: wrap, offset: ['start start', 'end end'] });
  const xRaw = useTransform(scrollYProgress, [TRAVEL_START, TRAVEL_END], [0, -dist]);
  const x = useSpring(xRaw, { stiffness: 150, damping: 32, mass: 0.35 });
  const bar = useTransform(scrollYProgress, [TRAVEL_START, TRAVEL_END], [0, 1]);

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const p = Math.min(Math.max((v - TRAVEL_START) / (TRAVEL_END - TRAVEL_START), 0), 1);
    setIndex(Math.round(p * (CHECKS.length - 1)));
  });

  // The track only moves during TRAVEL_START..TRAVEL_END, so scale the extra
  // scroll length up to keep the horizontal speed natural and leave a hold at
  // both ends where the first and last card sit still, fully in view.
  const extra = Math.round(dist / (TRAVEL_END - TRAVEL_START));

  return (
    <section
      ref={wrap}
      id="three-checks"
      style={{ height: desktop ? `calc(100vh + ${extra}px)` : 'auto' }}
      className="relative border-t border-white/10"
    >
      <div className="relative py-24 lg:sticky lg:top-0 lg:flex lg:h-screen lg:items-center lg:overflow-hidden lg:py-0">
        <motion.div
          ref={track}
          style={{ x: desktop ? x : 0 }}
          className="flex flex-col gap-5 px-4 sm:px-6 lg:w-max lg:flex-row lg:items-stretch lg:gap-6 lg:px-[5vw]"
        >
          <div className="lg:flex lg:w-[30vw] lg:shrink-0 lg:flex-col lg:justify-center lg:pr-10">
            <div className="mb-6 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">
              <span className="h-px w-8 bg-white/60" />
              01 — Core checks
            </div>
            <LineReveal
              lines={['Three checks.', { text: 'One verdict.', muted: true }]}
              className="font-display text-5xl leading-[0.92] text-white sm:text-6xl"
            />
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-zinc-400">
              One API call evaluates the intent, the simulated execution and the asset. Only an{' '}
              <span className="font-mono text-white">allow</span> can reach the signer.
            </p>
            <div className="mt-8 hidden items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600 lg:flex">
              <span className="animate-float-slow">Keep scrolling</span>
              <span className="relative h-px w-12 overflow-hidden bg-white/15">
                <span className="absolute inset-y-0 w-4 bg-white animate-scan-x" />
              </span>
            </div>
          </div>

          {CHECKS.map((c, i) => (
            <CheckCard key={c.n} c={c} navigate={navigate} x={x} focusX={focus[i] ?? 0} desktop={desktop} />
          ))}

          {/* End cap: a natural stop after the third card */}
          <motion.button
            type="button"
            onClick={() => navigate('console')}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, ease: EASE }}
            className="group flex flex-col justify-between rounded-3xl border border-dashed border-white/20 p-7 text-left transition-colors duration-500 hover:border-white/60 hover:bg-white/[0.04] lg:w-[22vw] lg:shrink-0"
          >
            <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
              <span>next</span>
              <ArrowUpRight className="h-4 w-4 text-white transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1" />
            </div>
            <div className="mt-16 lg:mt-0">
              <div className="font-display text-3xl leading-tight text-white">Run all three.</div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">Replay the acceptance fixtures and watch the signer refuse.</p>
              <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-mono text-[11px] font-bold text-black transition-all group-hover:gap-3">
                Open Guard Console <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </motion.button>
        </motion.div>

        {/* Progress rail (desktop only) */}
        <div className="pointer-events-none absolute inset-x-[5vw] bottom-8 hidden items-center gap-5 lg:flex">
          <span className="w-16 font-mono text-[10px] tracking-[0.3em] text-zinc-500">
            0{index + 1} / 0{CHECKS.length}
          </span>
          <div className="relative h-px flex-1 bg-white/10">
            <motion.div style={{ scaleX: bar, transformOrigin: '0% 50%' }} className="absolute inset-0 bg-white" />
          </div>
          <span key={index} className="w-32 text-right font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-400">
            {CHECKS[index].title}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Scroll-driven flow                                                  */
/* ------------------------------------------------------------------ */

const FLOW = [
  {
    k: 'Router',
    t: 'Intent is built by code',
    d: 'Perm or the terminal assembles the swap or payment intent. The model never writes it.',
  },
  {
    k: 'Call',
    t: 'POST /v1/guard',
    d: 'One request carries the quote, the payload, the token and the checks to run on chain 4663.',
  },
  {
    k: 'Checks',
    t: 'Three checks run',
    d: 'Quote-match against the signed quote, simulation on RHC state, and token risk resolved by address.',
  },
  {
    k: 'Aggregate',
    t: 'Fail-closed by default',
    d: 'Any required deny wins. Abstain blocks. Only all-allow passes, bound to the payload hash for 120 seconds.',
  },
  {
    k: 'Signer',
    t: 'The wrapper decides',
    d: 'It signs only the exact payload that was checked. Anything else is refused, and the refusal is visible.',
  },
];

function FlowSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 70%', 'end 60%'] });
  const lineScale = useSpring(scrollYProgress, { stiffness: 120, damping: 25 });

  return (
    <section className="relative border-t border-white/10 py-28">
      <div className="mx-auto grid max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        <div className="lg:col-span-5 lg:sticky lg:top-32 lg:self-start">
          <Reveal>
            <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">02 — Flow</div>
          </Reveal>
          <LineReveal lines={['From intent', { text: 'to signature.', muted: true }]} className="font-display text-4xl leading-[0.95] text-white sm:text-6xl" />
          <Reveal delay={0.2}>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-zinc-400">
              A single guard call sits between the router and the key. Scroll to follow one payload through the pipeline.
            </p>
          </Reveal>
        </div>

        <div ref={ref} className="relative lg:col-span-7">
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-white/10">
            <motion.div style={{ scaleY: lineScale, transformOrigin: 'top' }} className="h-full w-px bg-white" />
          </div>
          <ol className="space-y-16">
            {FLOW.map((s, i) => (
              <motion.li
                key={s.t}
                initial={{ opacity: 0.25, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ margin: '-45% 0px -45% 0px' }}
                transition={{ duration: 0.6, ease: EASE }}
                className="relative pl-14"
              >
                <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-black font-mono text-[11px] text-white">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">{s.k}</div>
                <h3 className="mt-2 font-display text-2xl text-white">{s.t}</h3>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-zinc-400">{s.d}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ZK teaser                                                           */
/* ------------------------------------------------------------------ */

function ZkTeaser({ navigate }: { navigate: Navigate }) {
  return (
    <section className="relative overflow-hidden border-t border-white/10 py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.045] via-white/[0.015] to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-zguard-grid [mask-image:radial-gradient(ellipse_50%_70%_at_25%_50%,black,transparent)]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div className="relative flex h-[420px] items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.1, ease: EASE }}
          >
            <OrbitIllo size={380} />
          </motion.div>
          <span className="absolute bottom-4 left-4 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
            proof · commitment only
          </span>
        </div>

        <div>
          <Reveal>
            <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">03 — Zero-knowledge layer</div>
          </Reveal>
          <LineReveal lines={['Prove the match.', { text: 'Keep the intent private.', muted: true }]} className="font-display text-4xl leading-[0.95] text-white sm:text-6xl" />
          <Reveal delay={0.2}>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-zinc-400">
              Groth16 is the required proof system for MVP, with Halo2-KZG as the target. The proof covers quote-match only,
              never simulation or token risk, and carries commitments instead of your intent.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['scope: "quote"', 'Groth16 · BN254', 'Halo2-KZG · target', 'commitment hashes'].map((t) => (
                <span key={t} className="rounded-full border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300">
                  {t}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => navigate('zk')}
              className="mt-8 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white transition-all hover:gap-3"
            >
              Explore ZK Layer <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Verdict flip cards                                                  */
/* ------------------------------------------------------------------ */

function FlipCard({
  icon: Icon,
  name,
  caption,
  back,
  tone,
}: {
  icon: LucideIcon;
  name: string;
  caption: string;
  back: string;
  tone: string;
}) {
  const [flip, setFlip] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => setFlip(true)}
      onMouseLeave={() => setFlip(false)}
      onFocus={() => setFlip(true)}
      onBlur={() => setFlip(false)}
      onClick={() => setFlip((f) => !f)}
      className="perspective-1400 group relative h-80 cursor-pointer outline-none"
    >
      <motion.div animate={{ rotateY: flip ? 180 : 0 }} transition={{ duration: 0.8, ease: EASE }} className="preserve-3d relative h-full w-full">
        <div className="backface-hidden absolute inset-0 flex flex-col justify-between rounded-3xl border border-white/10 bg-[#070708] p-7 transition-colors group-hover:border-white/30">
          <div className="flex items-center justify-between">
            <Icon className={`h-6 w-6 ${tone}`} strokeWidth={1.5} />
            <span className="font-mono text-[10px] text-zinc-600">hover ↺</span>
          </div>
          <div>
            <div className="font-display text-5xl uppercase tracking-tight text-white">{name}</div>
            <p className="mt-3 font-mono text-[11px] text-zinc-500">{caption}</p>
          </div>
        </div>
        <div
          className="backface-hidden absolute inset-0 flex flex-col justify-between rounded-3xl bg-white p-7 text-black"
          style={{ transform: 'rotateY(180deg)' }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.2em]">{name} · verdict</div>
          <p className="font-display text-xl leading-snug">{back}</p>
        </div>
      </motion.div>
    </div>
  );
}

function Verdicts() {
  return (
    <section className="relative border-t border-white/10 py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Reveal>
              <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">04 — Verdicts</div>
            </Reveal>
            <LineReveal lines={['Allow, deny, abstain.', { text: 'Never “safe”.', muted: true }]} className="font-display text-4xl leading-[0.95] text-white sm:text-6xl" />
          </div>
          <Reveal delay={0.2} className="lg:col-span-5 lg:self-end">
            <p className="max-w-sm text-sm leading-relaxed text-zinc-400">
              Hover a card to reveal what the verdict means. Abstain is never permission: the signer refuses by default.
            </p>
          </Reveal>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <FlipCard icon={ShieldCheck} name="allow" caption="every required check passes" tone="text-emerald-300" back="Every required check passes. The signer may sign this exact payload hash, for 120 seconds only." />
          <FlipCard icon={ShieldX} name="deny" caption="a required check fails" tone="text-rose-300" back="Quote mismatch, unexpected revert, or an open mint authority. The payload is rejected outright." />
          <FlipCard icon={ShieldAlert} name="abstain" caption="cannot decide safely" tone="text-amber-300" back="Bytes cannot be decoded, RPC is down, or a domain is unverified. Abstain is not permission." />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Distribution                                                        */
/* ------------------------------------------------------------------ */

const SURFACES: { title: string; icon: LucideIcon; desc: string; lines: { text: string; kind?: 'cmd' | 'out' | 'ok' }[] }[] = [
  {
    title: 'Perm router',
    icon: Router,
    desc: 'Default-on. Every candidate route calls the guard with an intent built by router code.',
    lines: [
      { text: 'perm.route(intent)', kind: 'cmd' },
      { text: '→ POST /v1/guard', kind: 'out' },
      { text: 'decision: allow', kind: 'ok' },
      { text: '→ sign(payload_hash)', kind: 'out' },
    ],
  },
  {
    title: 'RHC / pons terminal',
    icon: TerminalSquare,
    desc: 'Runs before every approve, swap or launch-buy. A deny blocks the signature path.',
    lines: [
      { text: 'terminal.swap(quote)', kind: 'cmd' },
      { text: 'guard → token_risk: other', kind: 'out' },
      { text: 'decision: deny · T-MINT', kind: 'ok' },
      { text: 'signature refused', kind: 'out' },
    ],
  },
  {
    title: 'MCP for agents',
    icon: Bot,
    desc: 'One server, five tools. Works in Claude Code and Cursor. Local quote-match needs no key.',
    lines: [
      { text: 'claude mcp add zguard', kind: 'cmd' },
      { text: 'check_token(0x…)', kind: 'cmd' },
      { text: 'guard_bundle → allow', kind: 'ok' },
      { text: 'expires_at +120s', kind: 'out' },
    ],
  },
];

function Distribution() {
  return (
    <section className="relative overflow-hidden border-t border-white/10 py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[900px] -translate-x-1/2 -translate-y-1/2"
        style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.07), transparent)' }}
      />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14">
          <Reveal>
            <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">05 — Distribution</div>
          </Reveal>
          <LineReveal lines={['Default-on,', { text: 'not optional.', muted: true }]} className="font-display text-4xl leading-[0.95] text-white sm:text-6xl" />
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {SURFACES.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.title} delay={i * 0.1} className="h-full">
                <SpotlightCard className="h-full p-6">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">surface 0{i + 1}</span>
                      <Icon className="h-5 w-5 text-white" strokeWidth={1.5} />
                    </div>
                    <h3 className="mt-6 font-display text-2xl text-white">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.desc}</p>
                    <div className="mt-6 flex-1 rounded-2xl border border-white/10 bg-black/70 p-4">
                      <TerminalBlock lines={s.lines} />
                    </div>
                  </div>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stats + CTA                                                         */
/* ------------------------------------------------------------------ */

function Stats() {
  const items: { to: number; suffix?: string; label: string }[] = [
    { to: 4663, label: 'Chain ID · mainnet' },
    { to: 3, label: 'Checks per guard call' },
    { to: 120, suffix: 's', label: 'Allow verdict TTL [ASSUMPTION]' },
    { to: 0, label: '"safe" claims made' },
  ];
  return (
    <section className="relative border-t border-white/10 py-24">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 px-0 md:grid-cols-4">
        {items.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1, duration: 0.7, ease: EASE }}
            className="bg-black p-7 sm:p-9"
          >
            <div className="font-display text-4xl text-white sm:text-5xl">
              <Counter to={s.to} suffix={s.suffix} />
            </div>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{s.label}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function FinalCta({ navigate }: { navigate: Navigate }) {
  return (
    <section className="relative overflow-hidden py-32">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-25">
        <div className="relative h-[520px] w-[520px]">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="absolute inset-0 rounded-full border border-white/30 animate-radar-wave" style={{ animationDelay: `${i * 0.55}s` }} />
          ))}
          <div className="absolute inset-0 flex items-center justify-center">
            <ZGuardLogo size={160} animated />
          </div>
        </div>
      </div>
      <div className="relative mx-auto max-w-4xl px-4 text-center">
        <Reveal>
          <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-500">Guard Console</div>
        </Reveal>
        <LineReveal lines={['Agents will sign.', { text: 'Make them check first.', muted: true }]} className="font-display text-4xl leading-[0.95] text-white sm:text-6xl" />
        <Reveal delay={0.2}>
          <div className="mt-10 flex justify-center">
            <MagneticButton
              onClick={() => navigate('console')}
              className="inline-flex cursor-pointer items-center gap-3 rounded-full bg-white px-8 py-4 font-mono text-sm font-bold text-black shadow-[0_0_60px_rgba(255,255,255,0.25)]"
            >
              Open Guard Console
              <ArrowRight className="h-4 w-4" />
            </MagneticButton>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function HomePage({ navigate }: { navigate: Navigate }) {
  return (
    <div className="relative">
      <Hero navigate={navigate} />
      <Marquee />
      <PinnedChecks navigate={navigate} />
      <FlowSection />
      <ZkTeaser navigate={navigate} />
      <Verdicts />
      <Distribution />
      <Stats />
      <FinalCta navigate={navigate} />
    </div>
  );
}
