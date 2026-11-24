import { Check, Fingerprint } from 'lucide-react';
import { motion } from 'framer-motion';

/** Quote-match: two documents, a scanning band, and a verified mark. */
export function QuoteIllo() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute left-[14%] top-[18%] h-[60%] w-[36%] rounded-xl border border-white/25 bg-black/70 p-3">
        {[90, 72, 84, 60].map((w, i) => (
          <div key={i} className="mb-2 h-1.5 rounded bg-white/25" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="absolute left-[38%] top-[30%] h-[60%] w-[40%] rounded-xl border border-white/60 bg-zinc-900/90 p-3 shadow-[0_0_30px_rgba(255,255,255,0.12)]">
        {[88, 70, 80, 56].map((w, i) => (
          <div key={i} className={`mb-2 h-1.5 rounded ${i === 2 ? 'bg-white' : 'bg-white/40'}`} style={{ width: `${w}%` }} />
        ))}
        <div className="absolute bottom-3 right-3 flex h-6 w-6 items-center justify-center rounded-full border border-white">
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[30%] bg-gradient-to-r from-transparent via-white/25 to-transparent animate-scan-x" />
    </div>
  );
}

/** Simulation: a looping execution trace with pulsing state nodes. */
export function SimIllo() {
  const nodes: [number, number][] = [
    [116, 30],
    [152, 56],
    [236, 74],
  ];
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 300 150" className="absolute inset-0 h-full w-full" fill="none" preserveAspectRatio="none">
        <path d="M0 118 H300" stroke="rgba(255,255,255,0.15)" strokeDasharray="3 6" />
        <path
          pathLength={100}
          d="M10 90 H80 L100 90 L116 30 L134 128 L152 56 L166 90 H220 L236 74 L250 90 H290"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
          className="animate-draw-loop"
        />
        {nodes.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="3.5"
            fill="white"
            className="animate-blink-soft"
            style={{ animationDelay: `${i * 0.4}s` }}
          />
        ))}
      </svg>
      <div className="absolute left-4 top-3 font-mono text-[9px] tracking-[0.2em] text-zinc-500">BALANCE Δ · RHC 4663</div>
    </div>
  );
}

/** Token risk: rotating radar rings with a conic sweep and scanning blips. */
export function RiskIllo() {
  const blips: [number, number][] = [
    [30, 20],
    [70, 38],
    [60, 78],
  ];
  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="absolute aspect-square w-[72%] animate-spin-slow rounded-full border border-dashed border-white/25" />
      <div className="absolute aspect-square w-[52%] animate-spin-rev rounded-full border border-white/35" />
      <div
        className="absolute aspect-square w-[72%] animate-spin-slow rounded-full opacity-70"
        style={{ background: 'conic-gradient(from 0deg, rgba(255,255,255,0.3), transparent 22%)' }}
      />
      <div className="absolute aspect-square w-[30%] rounded-full border border-white/80" />
      <div className="absolute h-2 w-2 rotate-45 bg-white" />
      {blips.map(([x, y], i) => (
        <span
          key={i}
          className="absolute h-1.5 w-1.5 rounded-full bg-white animate-blink-soft"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.5}s` }}
        />
      ))}
    </div>
  );
}

/** ZK layer: three orbital rings around a proof core. */
export function OrbitIllo({ size = 340 }: { size?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size, perspective: 800 }}>
      <div className="absolute inset-0 rounded-full border border-white/40 animate-orbit-a" style={{ transformStyle: 'preserve-3d' }} />
      <div className="absolute inset-0 rounded-full border border-white/25 animate-orbit-b" style={{ transformStyle: 'preserve-3d' }} />
      <div className="absolute inset-0 rounded-full border border-dashed border-white/25 animate-orbit-c" style={{ transformStyle: 'preserve-3d' }} />
      <div className="absolute inset-[18%] flex items-center justify-center rounded-full border border-white/20 bg-black/85 shadow-[0_0_60px_rgba(255,255,255,0.15)]">
        <Fingerprint className="h-14 w-14 text-white" strokeWidth={1.2} />
      </div>
      <div className="absolute inset-0 animate-spin-slow">
        <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_16px_white]" />
      </div>
    </div>
  );
}

/** Animated connector used in flow diagrams: a dot travels along a hairline. */
export function FlowConnector({ delay = 0, vertical = false }: { delay?: number; vertical?: boolean }) {
  if (vertical) {
    return (
      <div className="relative mx-auto h-10 w-px shrink-0 bg-white/15">
        <motion.span
          className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
          initial={{ top: '0%' }}
          animate={{ top: ['0%', '100%'] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'linear', delay }}
        />
      </div>
    );
  }
  return (
    <div className="relative h-px w-10 shrink-0 self-center bg-white/15 sm:w-16">
      <motion.span
        className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
        initial={{ left: '0%' }}
        animate={{ left: ['0%', '100%'] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'linear', delay }}
      />
    </div>
  );
}
