import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Coins, FlaskConical, ScanLine, ShieldCheck, ShieldX, ShieldAlert } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE } from '../components/Reveal';
import { SpotlightCard } from '../components/SpotlightCard';
import type { Navigate } from '../types';

interface Tab {
  id: string;
  num: string;
  name: string;
  tagline: string;
  icon: typeof ScanLine;
  headline: string;
  rules: string[];
  readout: { title: string; rows: [string, string][] };
  codes: [string, string][];
}

const TABS: Tab[] = [
  {
    id: 'quote',
    num: '01',
    name: 'Quote-match',
    tagline: 'Is this the payment you were quoted?',
    icon: ScanLine,
    headline: 'Pure parity. Byte level. No model in the loop.',
    rules: [
      'The quote arrives over the HTTP 402 channel, never through the model.',
      'Compared field by field: payTo, asset, amount and chainId.',
      'Every signing path is wrapped: signTypedData, signTransaction, sendTransaction and EIP-3009 authorization.',
      'EIP-712 domains are read from installed contracts only. Unknown domain → abstain.',
      'Approvals, permits or delegates not present in the intent → deny.',
      'Spend policy: per-payment cap plus payee and asset allowlists. Unreadable policy → abstain.',
    ],
    readout: {
      title: 'quote-match · readout',
      rows: [
        ['quote.payTo', 'payee_A (fixture)'],
        ['authorization.to', 'payee_A (fixture)'],
        ['quote.amount', '1000000'],
        ['authorization.value', '1000000'],
        ['eip712 domain', 'USDG · verified onchain'],
        ['verdict', 'allow · 0 codes'],
      ],
    },
    codes: [
      ['Q-001', 'payTo does not match quote or intent'],
      ['Q-002', 'amount does not match'],
      ['Q-003', 'asset / token does not match'],
      ['Q-004', 'chain does not match'],
      ['Q-005', 'no quote or intent to compare'],
      ['Q-006', 'approval or delegate outside the intent'],
      ['Q-007', 'EIP-712 domain unverified → abstain'],
      ['P-401', 'outside spend policy'],
      ['P-UNAVAIL', 'policy store unreadable → abstain'],
    ],
  },
  {
    id: 'simulation',
    num: '02',
    name: 'Simulation',
    tagline: 'What actually happens onchain?',
    icon: FlaskConical,
    headline: 'The execution you are actually signing.',
    rules: [
      'Runs against current RHC 4663 state through a fork, eth_call, debug_traceCall or a provider API. Method pinned after tests on v4 hooks and the pons curve [VERIFY].',
      'Outputs status, gasUsed, balanceChanges (ETH and ERC-20), surfaced approvals and the full call tree.',
      'Pons hook and PoolManager calls are named, not just logged.',
      'Outcome is compared to the intent. Payments are exact; swap slippage comes from the router intent, never from the model.',
      'Unexpected revert on a required check → deny.',
      'RPC timeout or unsupported trace → abstain. Never allow.',
    ],
    readout: {
      title: 'simulation · balance changes',
      rows: [
        ['status', 'success'],
        ['gasUsed', '0x9e21'],
        ['Δ payer', '−1.00 USDG'],
        ['approvals', 'none surfaced'],
        ['hooks called', 'pons v2 meme hook'],
        ['PoolManager', 'v4 singleton · 0x8366…0951'],
      ],
    },
    codes: [
      ['S-REVERT', 'transaction reverts'],
      ['S-DIFF', 'balance change does not match intent or quote'],
      ['S-APPROVE', 'allowance or operator outside the request'],
      ['S-FAIL', 'simulation could not run → abstain'],
    ],
  },
  {
    id: 'token',
    num: '03',
    name: 'Token risk',
    tagline: 'What is this token, really?',
    icon: Coins,
    headline: 'Identity by address. Never by ticker.',
    rules: [
      'kind is one of usdg, stock_token, pons_curve, pons_graduated_v4 or other, resolved from the address, the official registry and the factory that launched it.',
      'Holders: count and top-10 share from an indexer [VERIFY]. Raw numbers plus flags, no invented thresholds.',
      'Liquidity: curve reserves and sellableTokens(), or the v4 pool, hook and launch-locker status.',
      'Tax: feeBps, creatorTaxBps and currentSnipeTaxBps(recipient) during the first five seconds.',
      'Authorities: owner, mint and pause read from the contract. A matching ticker at another address is not the same asset.',
      'Output is facts plus configured rules. Never “good investment” and never “safe”.',
    ],
    readout: {
      title: 'token_risk · kind resolver',
      rows: [
        ['0x5fc5…d168', 'usdg · canonical'],
        ['registry hit', 'stock_token · official'],
        ['pons factory v2', 'pons_curve · pre-graduation'],
        ['hook = meme v2', 'pons_graduated_v4'],
        ['ticker twin, off registry', 'other · NOT stock_token'],
      ],
    },
    codes: [
      ['T-MINT', 'mint authority still live (outside allowlist)'],
      ['T-TAX', 'tax above configured threshold'],
      ['T-LP', 'liquidity not locked or not detected'],
      ['T-HOLDER', 'holder concentration above threshold'],
      ['T-PONS', 'curve state inconsistent or near graduation'],
      ['T-UNKNOWN', 'token kind not recognized → abstain or flag'],
    ],
  },
];

const AGG = [
  { rule: 'any required check denies', out: 'deny', tone: 'text-rose-300', Icon: ShieldX },
  { rule: 'required abstain, no deny', out: 'abstain', tone: 'text-amber-300', Icon: ShieldAlert },
  { rule: 'all required checks allow', out: 'allow', tone: 'text-emerald-300', Icon: ShieldCheck },
  { rule: 'advisory check denies', out: 'flags[] only', tone: 'text-zinc-300', Icon: Check },
];

export function ChecksPage({ navigate }: { navigate: Navigate }) {
  const [active, setActive] = useState(0);
  const tab = TABS[active];

  return (
    <div className="relative">
      <PageHeader
        kicker="Core checks · 01–03"
        lines={['Three lenses.', { text: 'One verdict.', muted: true }]}
        desc="Simulator-only tools answer “what would this do”. Payment firewalls answer “did this match the quote”. ZGuard answers both, plus what the token is, in a single call."
      />

      <section className="relative pb-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* tabs */}
          <div role="tablist" className="grid gap-3 md:grid-cols-3">
            {TABS.map((t, i) => {
              const on = i === active;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActive(i)}
                  className={`group relative overflow-hidden rounded-3xl border p-5 text-left transition-colors duration-300 ${
                    on ? 'border-white/30 bg-white/[0.06]' : 'border-white/10 bg-black hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-[11px] tracking-[0.3em] ${on ? 'text-white' : 'text-zinc-600'}`}>{t.num}</span>
                    <Icon className={`h-5 w-5 transition-colors ${on ? 'text-white' : 'text-zinc-600 group-hover:text-zinc-300'}`} strokeWidth={1.5} />
                  </div>
                  <div className={`mt-5 font-display text-2xl ${on ? 'text-white' : 'text-zinc-300'}`}>{t.name}</div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">{t.tagline}</div>
                  {on && (
                    <motion.span
                      layoutId="check-underline"
                      className="absolute inset-x-0 bottom-0 h-[2px] bg-white"
                      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab.id}
              initial={{ opacity: 0, x: 40, filter: 'blur(6px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, x: -40, filter: 'blur(6px)' }}
              transition={{ duration: 0.5, ease: EASE }}
              className="mt-6 grid gap-8 rounded-3xl border border-white/10 bg-[#070708] p-6 sm:p-10 lg:grid-cols-12"
            >
              <div className="lg:col-span-7">
                <h2 className="font-display text-3xl leading-tight text-white sm:text-4xl">{tab.headline}</h2>
                <ul className="mt-8 space-y-4">
                  {tab.rules.map((r, i) => (
                    <motion.li
                      key={r}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.07, duration: 0.45, ease: EASE }}
                      className="flex gap-3 text-[14px] leading-relaxed text-zinc-300"
                    >
                      <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-white" strokeWidth={2.5} />
                      <span>{r}</span>
                    </motion.li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-6 lg:col-span-5">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                  <div className="border-b border-white/10 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">{tab.readout.title}</div>
                  <dl className="space-y-3 p-5 font-mono text-[11px]">
                    {tab.readout.rows.map(([k, v], i) => (
                      <motion.div
                        key={k}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.25 + i * 0.09 }}
                        className="flex justify-between gap-4 border-b border-white/5 pb-2 last:border-0"
                      >
                        <dt className="text-zinc-600">{k}</dt>
                        <dd className="text-right text-zinc-200">{v}</dd>
                      </motion.div>
                    ))}
                  </dl>
                </div>

                <div>
                  <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Reason codes</div>
                  <div className="space-y-2">
                    {tab.codes.map(([code, desc], i) => (
                      <motion.div
                        key={code}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 + i * 0.05 }}
                        className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/60 px-3 py-2"
                      >
                        <span className="w-20 shrink-0 font-mono text-[10px] font-bold text-white">{code}</span>
                        <span className="text-[12px] text-zinc-400">{desc}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* aggregation */}
          <div className="mt-16">
            <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">Aggregation rules</div>
            <div className="grid gap-4 md:grid-cols-4">
              {AGG.map((a, i) => (
                <motion.div
                  key={a.rule}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.6, ease: EASE }}
                >
                  <SpotlightCard className="p-5">
                    <a.Icon className={`h-5 w-5 ${a.tone}`} strokeWidth={1.6} />
                    <div className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">{a.rule}</div>
                    <div className={`mt-2 font-display text-2xl uppercase ${a.tone}`}>→ {a.out}</div>
                  </SpotlightCard>
                </motion.div>
              ))}
            </div>
            <p className="mt-6 font-mono text-[11px] text-zinc-500">
              Allow is bound to the checked payload hash and expires after 120 seconds [ASSUMPTION]. Required checks default to all three on /v1/guard.
            </p>
          </div>

          <div className="mt-16 flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            <div>
              <div className="font-display text-2xl text-white">See the three checks run.</div>
              <div className="mt-1 font-mono text-[11px] text-zinc-500">Fixture replay in the Guard Console</div>
            </div>
            <button
              type="button"
              onClick={() => navigate('console')}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-mono text-xs font-bold text-black transition hover:gap-3"
            >
              Open Guard Console <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
