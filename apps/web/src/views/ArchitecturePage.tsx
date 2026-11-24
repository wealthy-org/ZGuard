import { Fragment, useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, Check, Minus, Router, TerminalSquare } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE, Reveal } from '../components/Reveal';
import { SpotlightCard } from '../components/SpotlightCard';
import { FlowConnector } from '../components/Illustrations';

const FLOW = ['Callers', 'ZGuard core', 'Decision', 'Signer wrapper', 'RHC 4663'];

function FlowRow() {
  return (
    <div className="pb-4">
      {/* Vertical pipeline on phones/tablets, full-width horizontal row on desktop */}
      <div className="flex flex-col items-stretch lg:flex-row">
        {FLOW.map((f, i) => (
          <Fragment key={f}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.6, ease: EASE }}
              whileHover={{ y: -4 }}
              className="flex items-center gap-4 rounded-2xl border border-white/15 bg-black/70 px-5 py-4 lg:min-w-0 lg:flex-1 lg:flex-col lg:items-start lg:justify-center lg:gap-0 lg:p-5"
            >
              <span className="font-mono text-[10px] text-zinc-600">0{i + 1}</span>
              <span className="font-display text-lg text-white lg:mt-2">{f}</span>
            </motion.div>
            {i < FLOW.length - 1 && (
              <>
                <span className="lg:hidden"><FlowConnector delay={i * 0.35} vertical /></span>
                <span className="hidden lg:flex lg:items-center"><FlowConnector delay={i * 0.35} /></span>
              </>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const PLATES = [
  { k: 'L5', t: 'Signer wrapper', d: 'signs only allow, same hash' },
  { k: 'L4', t: 'Decision', d: 'allow · deny · abstain' },
  { k: 'L3', t: 'Token risk', d: 'kind · holders · tax · authority' },
  { k: 'L2', t: 'Simulation', d: 'RHC 4663 state · balance Δ' },
  { k: 'L1', t: 'Quote-match', d: 'payTo · asset · amount · chainId' },
];

function Stack3D() {
  const [exploded, setExploded] = useState(false);
  return (
    <div>
      <div className="perspective-2200 relative flex h-[340px] items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-black bg-zguard-dots sm:h-[440px]">
        <div className="perspective-2200 scale-[0.72] sm:scale-100">
        <motion.div
          animate={{ rotateX: 62, rotateZ: [-32, -22, -32] }}
          transition={{ rotateZ: { duration: 12, repeat: Infinity, ease: 'easeInOut' }, rotateX: { duration: 1 } }}
          className="relative h-56 w-72"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {PLATES.map((p, i) => (
            <motion.div
              key={p.k}
              animate={{ z: exploded ? (PLATES.length - 1 - i) * 72 : (PLATES.length - 1 - i) * 6 }}
              transition={{ duration: 0.9, ease: EASE, delay: exploded ? i * 0.05 : (PLATES.length - 1 - i) * 0.03 }}
              className="absolute inset-0 flex flex-col justify-between rounded-2xl border border-white/35 bg-[#0a0a0b]/92 p-5"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <span className="font-mono text-[9px] text-zinc-500">{p.k}</span>
              <div>
                <div className="font-display text-base text-white">{p.t}</div>
                <div className="mt-1 font-mono text-[10px] text-zinc-500">{p.d}</div>
              </div>
            </motion.div>
          ))}
        </motion.div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setExploded((v) => !v)}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-black"
      >
        {exploded ? 'Assemble stack' : 'Explode stack'}
      </button>
    </div>
  );
}

function FailClosedSim() {
  const [on, setOn] = useState({ api: true, quote: true, rpc: true, token: true });
  const toggle = (k: keyof typeof on) => setOn((s) => ({ ...s, [k]: !s[k] }));

  const quote = on.quote ? 'allow' : 'deny';
  const sim = on.rpc ? 'allow' : 'abstain';
  const token = on.token ? 'allow' : 'abstain';
  let effective: string;
  if (!on.api) effective = 'none (fail-closed)';
  else if (quote === 'deny') effective = 'deny';
  else if (sim === 'abstain' || token === 'abstain') effective = 'abstain';
  else effective = 'allow';
  const released = effective === 'allow';

  const toneOf = (d: string) => (d === 'allow' ? 'text-emerald-300' : d === 'deny' ? 'text-rose-300' : d.startsWith('none') ? 'text-zinc-300' : 'text-amber-300');

  const switches: { k: keyof typeof on; label: string }[] = [
    { k: 'api', label: 'Guard API reachable' },
    { k: 'quote', label: 'Quote matches intent' },
    { k: 'rpc', label: 'Simulation RPC healthy' },
    { k: 'token', label: 'Token kind resolvable' },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-5">
        {switches.map((s) => (
          <button
            key={s.k}
            type="button"
            onClick={() => toggle(s.k)}
            className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black px-5 py-4 text-left transition hover:border-white/25"
          >
            <span className="text-sm text-zinc-200">{s.label}</span>
            <span className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${on[s.k] ? 'bg-white' : 'bg-white/15'}`}>
              <motion.span
                animate={{ x: on[s.k] ? 22 : 2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={`absolute top-1 h-4 w-4 rounded-full ${on[s.k] ? 'bg-black' : 'bg-zinc-400'}`}
              />
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-3xl border border-white/10 bg-[#070708] p-6 lg:col-span-7">
        <div className="space-y-4 font-mono text-[12px]">
          {[
            ['checks.quote', quote, on.quote ? '' : 'Q-001'],
            ['checks.simulation', sim, on.rpc ? '' : 'S-FAIL'],
            ['checks.token_risk', token, on.token ? '' : 'T-UNKNOWN'],
          ].map(([k, d, code]) => (
            <div key={k} className="flex items-center justify-between border-b border-white/5 pb-3">
              <span className="text-zinc-500">{k}</span>
              <span className="flex items-center gap-3">
                {code && <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-zinc-400">{code}</span>}
                <motion.span key={d} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className={toneOf(d)}>
                  {d}
                </motion.span>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">effective decision</span>
          <motion.span key={effective} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`font-display text-2xl uppercase ${toneOf(effective)}`}>
            {effective}
          </motion.span>
        </div>

        <motion.div
          animate={{
            borderColor: released ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)',
            backgroundColor: released ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.6)',
          }}
          className="mt-6 flex items-center gap-4 rounded-2xl border p-4"
        >
          <motion.div
            key={released ? 'ok' : 'no'}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`flex h-10 w-10 items-center justify-center rounded-full ${released ? 'bg-white text-black' : 'border border-rose-300/40 text-rose-300'}`}
          >
            {released ? <Check className="h-5 w-5" strokeWidth={3} /> : <Minus className="h-5 w-5" strokeWidth={3} />}
          </motion.div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">signer wrapper</div>
            <div className="font-display text-lg text-white">{released ? 'Signature released' : 'Signature refused'}</div>
          </div>
        </motion.div>
        <p className="mt-4 font-mono text-[10px] leading-relaxed text-zinc-600">
          abstain is not permission. The wrapper refuses by default, and an override is possible only through explicit config, recorded in the receipt.
        </p>
      </div>
    </div>
  );
}

const DIST = [
  {
    title: 'Perm router',
    icon: Router,
    points: ['Every candidate route calls /v1/guard before signing', 'Intent is assembled by router code, not the model', 'No guard response, no signature'],
  },
  {
    title: 'RHC / pons terminal',
    icon: TerminalSquare,
    points: ['Guard fires before approve, swap and launch-buy', 'Verdict renders inline in the trade panel', 'Deny blocks the signature path, visibly'],
  },
  {
    title: 'MCP for agents',
    icon: Bot,
    points: ['One server, five tools: guard_payment, guard_transaction, check_token, check_before_use, guard_bundle', 'Works in Claude Code and Cursor', 'Local quote-match is free and needs no key'],
  },
];

export function ArchitecturePage() {
  return (
    <div className="relative">
      <PageHeader
        kicker="Architecture · signer & distribution"
        lines={['Nobody signs', { text: 'unverified bytes.', muted: true }]}
        desc="One decision engine behind every surface. The signer wrapper is the only path to the key, and it needs a hash-bound allow that has not expired."
      />

      <section className="relative pb-24">
        <div className="mx-auto max-w-7xl space-y-24 px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="mb-8 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">01 — Data path</div>
            <FlowRow />
          </Reveal>

          <div className="grid gap-12 lg:grid-cols-12">
            <Reveal className="lg:col-span-6">
              <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">02 — Stack</div>
              <Stack3D />
            </Reveal>
            <Reveal delay={0.15} className="lg:col-span-6 lg:self-center">
              <h3 className="font-display text-3xl leading-tight text-white sm:text-4xl">
                The wrapper signs what was checked,
                <span className="text-zinc-500"> and nothing else.</span>
              </h3>
              <ul className="mt-8 space-y-4 text-sm text-zinc-300">
                {[
                  'Refuses to sign if there is no quote or intent to compare (x402).',
                  'Refuses without an allow that is still valid for this exact payload hash.',
                  'Refuses after the allow has expired (120 seconds [ASSUMPTION]).',
                  'Refuses if the payload differs from the one that was checked.',
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-2 h-px w-4 shrink-0 bg-white" />
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal>
            <div className="mb-8 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">03 — Fail-closed simulator</div>
            <FailClosedSim />
          </Reveal>

          <div>
            <Reveal>
              <div className="mb-8 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">04 — Distribution</div>
            </Reveal>
            <div className="grid gap-5 lg:grid-cols-3">
              {DIST.map((d, i) => {
                const Icon = d.icon;
                return (
                  <Reveal key={d.title} delay={i * 0.1} className="h-full">
                    <SpotlightCard className="h-full p-7">
                      <div className="flex h-full flex-col">
                        <Icon className="h-6 w-6 text-white" strokeWidth={1.5} />
                        <h4 className="mt-8 font-display text-2xl text-white">{d.title}</h4>
                        <ul className="mt-6 space-y-3">
                          {d.points.map((p) => (
                            <li key={p} className="flex gap-2.5 text-[13px] leading-relaxed text-zinc-400">
                              <Check className="mt-1 h-3 w-3 shrink-0 text-white" strokeWidth={2.5} />
                              {p}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </SpotlightCard>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
