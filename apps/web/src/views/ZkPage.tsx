import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Circle, Cpu, Fingerprint, Loader2, CircuitBoard } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE, Reveal } from '../components/Reveal';
import { OrbitIllo } from '../components/Illustrations';
import { pollZkAttestation, postLiveVerify } from '../lib/zguard-api';

type System = 'groth16' | 'halo2';
type Fixture = 'allow' | 'deny';
type ActiveChain = 46630 | 4663;

const TESTNET_USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const TESTNET_HOLDER = '0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79';
const MAINNET_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const MAINNET_HOLDER = '0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4';

const PAYEE_A = '0x000000000000000000000000000000000000aaaa';
const PAYEE_X = '0x000000000000000000000000000000000000bbbb';

const FIXTURES: Record<Fixture, { verdict: string; ruleCodes: string; quoteHash: string; txHash: string; note: string }> = {
  allow: {
    verdict: 'allow',
    ruleCodes: '0x00000000',
    quoteHash: '0x9be1…77c3',
    txHash: '0x1f0e…d290',
    note: 'fixture A · payment matches the signed quote',
  },
  deny: {
    verdict: 'deny',
    ruleCodes: '0x00000001  // Q-001',
    quoteHash: '0x77b1…e90a',
    txHash: '0x3a9c…0f42',
    note: 'fixture B · payTo rewritten after the 402 quote',
  },
};

export function ZkPage() {
  const [chainId, setChainId] = useState<ActiveChain>(46630);
  const [system, setSystem] = useState<System>('groth16');
  const [fixture, setFixture] = useState<Fixture>('allow');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [step, setStep] = useState(0);
  const [liveAtt, setLiveAtt] = useState<Record<string, unknown> | null>(null);
  const timers = useRef<number[]>([]);
  const fx = FIXTURES[fixture];

  const steps: Record<System, string[]> = {
    groth16: [
      'Enqueue prover · quote-match rule engine (Rust) in zkVM',
      'Execute · collect execution trace and public outputs',
      'Wrap STARK → Groth16 on BN254 · commitment scalar binding',
      `Verify ZGuardQuoteVerifier.sol on RHC ${chainId} · BN254 0x07 & 0x08 precompiles`,
    ],
    halo2: [
      'Load hand-written circuit · payTo, amount, asset, chainId',
      'Prove · halo2-kzg (PSE fork) · universal powers-of-tau',
      'Compile Solidity verifier · ZGuardQuoteVerifier.sol (solc 0.8.28)',
      `Verify on RHC ${chainId} · BN254 ecPairing 0x08 + gas benchmark`,
    ],
  };

  const total = steps[system].length;

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const reset = (s: System, f: Fixture, nextChain: ActiveChain = chainId) => {
    clear();
    setChainId(nextChain);
    setSystem(s);
    setFixture(f);
    setPhase('idle');
    setStep(0);
    setLiveAtt(null);
  };

  const prove = async () => {
    if (phase === 'running') return;
    clear();
    setPhase('running');
    setStep(1);
    setLiveAtt(null);

    const t1 = window.setTimeout(() => setStep(2), 450);
    const t2 = window.setTimeout(() => setStep(3), 900);
    timers.current.push(t1, t2);

    const usdg = chainId === 46630 ? TESTNET_USDG : MAINNET_USDG;
    const holder = chainId === 46630 ? TESTNET_HOLDER : MAINNET_HOLDER;

    try {
      const verifyBody = {
        network: `eip155:${chainId}`,
        quote: {
          asset: usdg,
          payTo: PAYEE_A,
          amount: '1000000',
          chainId,
        },
        payload: {
          type: 'eip3009',
          authorization: {
            from: holder,
            to: fixture === 'allow' ? PAYEE_A : PAYEE_X,
            value: '1000000',
            validAfter: '0',
            validBefore: '4102444800',
            nonce: '0x0000000000000000000000000000000000000000000000000000000000000099',
            domain: {
              name: 'Global Dollar',
              version: '1',
              chainId,
              verifyingContract: usdg,
            },
          },
        },
        options: {
          enableZk: true,
          zkSystem: system === 'groth16' ? 'groth16-sp1' : 'halo2-kzg',
        },
      };

      const { data } = await postLiveVerify(verifyBody);
      const decisionId = String(data.decisionId ?? '');
      if (decisionId) {
        const settled = await pollZkAttestation(decisionId);
        if (settled) setLiveAtt(settled);
      }
      clear();
      setStep(total);
      setPhase('done');
    } catch {
      clear();
      setStep(total);
      setPhase('done');
    }
  };

  const progress = (step / total) * 100;
  const pubInputs = (liveAtt?.publicInputs as Record<string, unknown> | undefined) ?? null;
  const shortHex = (val: unknown, fallback: string) => {
    const s = typeof val === 'string' ? val : '';
    return s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s || fallback;
  };

  return (
    <div className="relative">
      <PageHeader
        kicker={`ZK layer · attestation.zk · RHC ${chainId}`}
        lines={['Prove the match.', { text: 'Keep the intent private.', muted: true }]}
        desc="Quote-match is a pure function, so it can be proven. ZGuardQuoteVerifier.sol is compiled with solc 0.8.28 and verified against live BN254 precompiles (0x06, 0x07, 0x08) on Robinhood Chain Testnet (46630) & Mainnet (4663)."
        aside={<OrbitIllo size={260} />}
      />

      <section className="relative pb-24">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          {/* systems */}
          <div className="space-y-4 lg:col-span-5">
            {(
              [
                {
                  id: 'groth16' as const,
                  icon: Cpu,
                  name: 'Groth16 · SP1',
                  badge: 'Required · MVP',
                  badgeTone: 'border-white bg-white text-black',
                  desc: 'The rule engine runs in Rust inside a zkVM. The STARK is wrapped into a compact Groth16 proof on BN254, cheap to verify onchain.',
                  tags: ['SP1 / RISC Zero', 'BN254', 'trusted setup', 'async'],
                },
                {
                  id: 'halo2' as const,
                  icon: CircuitBoard,
                  name: 'Halo2 · KZG',
                  badge: 'Target',
                  badgeTone: 'border-white/40 text-zinc-300',
                  desc: 'A hand-written circuit without zkVM: compares payTo, amount, asset and chainId, then emits a commitment. Universal setup via KZG.',
                  tags: ['no zkVM', 'PSE halo2 fork', 'universal setup', 'same public inputs'],
                },
              ]
            ).map((s) => {
              const on = system === s.id;
              const Icon = s.icon;
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  onClick={() => reset(s.id, fixture)}
                  whileHover={{ x: 4 }}
                  className={`block w-full rounded-3xl border p-6 text-left transition-colors duration-300 ${
                    on ? 'border-white/35 bg-white/[0.06]' : 'border-white/10 bg-black hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-white" strokeWidth={1.5} />
                      <span className="font-display text-xl text-white">{s.name}</span>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] ${s.badgeTone}`}>{s.badge}</span>
                  </div>
                  <p className="mt-4 text-[13px] leading-relaxed text-zinc-400">{s.desc}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {s.tags.map((t) => (
                      <span key={t} className="rounded border border-white/15 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-400">
                        {t}
                      </span>
                    ))}
                  </div>
                </motion.button>
              );
            })}

            <div className="rounded-3xl border border-white/10 bg-black p-6">
              <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Scope & onchain status</div>
              <ul className="space-y-3 text-[12px] leading-relaxed text-zinc-400">
                <li>· <span className="font-mono text-white">attestation.zk.scope</span> is always “quote” on every receipt.</li>
                <li>· BN254 precompiles ecAdd 0x06, ecMul 0x07, ecPairing 0x08 verified <span className="text-emerald-300">active on 46630 & 4663</span>.</li>
                <li>· <span className="font-mono text-zinc-200">ZGuardQuoteVerifier.sol</span> compiled with solc 0.8.28 (single & Merkle-batched verdicts + live gas benchmark).</li>
                <li>· Deploy to RHC Testnet (0 real fees) via <span className="font-mono text-zinc-200">pnpm deploy:verifier</span>.</li>
              </ul>
            </div>
          </div>

          {/* workbench */}
          <div className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-[#070708] p-6 sm:p-8 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-full border border-white/15 bg-black p-1">
                {([46630, 4663] as ActiveChain[]).map((cid) => (
                  <button
                    key={cid}
                    type="button"
                    onClick={() => reset(system, fixture, cid)}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition-all sm:px-3.5 sm:tracking-[0.14em] ${
                      chainId === cid ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'
                    }`}
                  >
                    {cid === 46630 ? 'Testnet · 46630' : 'Mainnet · 4663'}
                  </button>
                ))}
              </div>
              <div className="flex rounded-full border border-white/15 bg-black p-1">
                {(['allow', 'deny'] as Fixture[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => reset(system, f)}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-all sm:px-4 sm:tracking-[0.16em] ${
                      fixture === f ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'
                    }`}
                  >
                    {f === 'allow' ? 'allow' : 'deny · Q-001'}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black p-5 font-mono text-[11px]">
              <div className="mb-3 flex items-center justify-between text-[9px] uppercase tracking-[0.22em] text-zinc-600">
                <span>publicInputs · commitment only</span>
                <span>{liveAtt ? `decisionId: ${String(liveAtt.decisionId)}` : 'intent not revealed'}</span>
              </div>
              {[
                ['quoteHash', shortHex(pubInputs?.quoteHash, fx.quoteHash)],
                ['txHash', shortHex(pubInputs?.txHash, fx.txHash)],
                ['verdict', String(pubInputs?.verdict ?? fx.verdict)],
                ['ruleBitmask', String(pubInputs?.ruleBitmask ?? fx.ruleCodes)],
                ['verifierGasUsed', String(liveAtt?.verifierGasUsed ?? 'measured on prove')],
                ['scope', `"${String(liveAtt?.scope ?? 'quote')}"`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-white/5 py-2 last:border-0">
                  <span className="text-zinc-600">{k}</span>
                  <span className={k === 'verdict' ? (v === 'allow' ? 'text-emerald-300' : 'text-rose-300') : 'text-zinc-200'}>{v}</span>
                </div>
              ))}
              <div className="pt-3 text-[9px] uppercase tracking-[0.16em] text-zinc-600">{fx.note}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black p-5">
              <ol className="space-y-3">
                {steps[system].map((s, i) => {
                  const state = step > i ? 'done' : step === i && phase === 'running' ? 'run' : 'wait';
                  return (
                    <li key={s} className="flex items-start gap-3 font-mono text-[11px] leading-relaxed">
                      {state === 'done' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-white" />
                      ) : state === 'run' ? (
                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-white" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700" />
                      )}
                      <span className={state === 'wait' ? 'text-zinc-600' : 'text-zinc-200'}>{s}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/10">
                <motion.div className="h-full bg-white" animate={{ width: `${progress}%` }} transition={{ duration: 0.45, ease: 'easeOut' }} />
              </div>
              <div className="mt-2 text-right font-mono text-[9px] text-zinc-600">{Math.round(progress)}%</div>
            </div>

            <AnimatePresence>
              {phase === 'done' && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: EASE }}
                  className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/30 bg-white/[0.05] p-5"
                >
                  <Fingerprint className="h-6 w-6 text-white" strokeWidth={1.5} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      {liveAtt
                        ? `Status: ${String(liveAtt.status)} · BN254 0x08=${String(liveAtt.bn254PrecompileVerified)} · verifierGasUsed=${String(liveAtt.verifierGasUsed ?? 'n/a')}`
                        : 'Proof generated · offline fallback'}
                    </div>
                    <div className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                      {liveAtt?.proof
                        ? `proof: ${shortHex(liveAtt.proof, '')} · verifyTx: ${liveAtt.verifyTx ? shortHex(liveAtt.verifyTx, '') : 'simulated via eth_simulateV1'}`
                        : 'verifyTx: pending · scope: "quote"'}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={prove}
              disabled={phase === 'running'}
              className={`flex h-12 items-center justify-center gap-2 rounded-2xl font-mono text-[11px] font-bold uppercase tracking-[0.2em] transition-all ${
                phase === 'running' ? 'cursor-wait border border-white/15 text-zinc-500' : 'bg-white text-black hover:shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)]'
              }`}
            >
              {phase === 'running' ? `Proving on RHC ${chainId}…` : phase === 'done' ? 'Prove again' : `Prove ${system === 'groth16' ? 'Groth16' : 'Halo2-KZG'} verdict`}
            </button>
          </div>
        </div>
      </section>

      <section className="relative border-t border-white/10 py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <Reveal>
            <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">Proven</div>
            <ul className="space-y-4">
              {['payTo equals the quoted payee', 'amount equals the quoted amount', 'asset and chainId match the quote', 'rule codes Q-001 … Q-007 as public output'].map((t, i) => (
                <motion.li key={t} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="flex items-center gap-3 text-zinc-200">
                  <CheckCircle2 className="h-4 w-4 text-white" /> {t}
                </motion.li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">Not proven</div>
            <ul className="space-y-4">
              {['Simulation results (depends on RPC state)', 'Token risk (depends on indexer and onchain state)', 'Intent contents (only commitments are published)'].map((t, i) => (
                <motion.li key={t} initial={{ opacity: 0, x: 10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="flex items-center gap-3 text-zinc-500">
                  <Circle className="h-4 w-4" /> {t}
                </motion.li>
              ))}
            </ul>
            <div className="mt-8 rounded-2xl border border-white/10 bg-black p-5 font-mono text-[11px] text-zinc-400">
              GET /v1/attestation/{'{decisionId}'} → status · proof · publicInputs · verifierGasUsed
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
