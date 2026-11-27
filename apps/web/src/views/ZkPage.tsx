import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Circle, CircuitBoard, Cpu, Fingerprint, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE, Reveal } from '../components/Reveal';
import { OrbitIllo } from '../components/Illustrations';
import { fetchRuntimeConfig, pollZkAttestation, postLiveVerify } from '../lib/zguard-api';
import { selectChain, useWallet, type RhcChainId } from '../lib/wallet';

/**
 * ZK page — honest status only (gap D2).
 * Every value shown comes from the live API (`POST /v1/verify` + `GET /v1/attestation/:id`). There is no
 * timer-driven "proving" animation and nothing is labelled proven unless the API says so. Without an SP1
 * prover the attestation stays `pending` and the page says why.
 */

type Fixture = 'allow' | 'deny';
type StepState = 'done' | 'running' | 'missing' | 'failed' | 'wait';

const USDG: Record<RhcChainId, string> = {
  46630: '0x7E955252E15c84f5768B83c41a71F9eba181802F',
  4663: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
};
const HOLDER: Record<RhcChainId, string> = {
  46630: '0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79',
  4663: '0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4',
};
const PAYEE_A = '0x000000000000000000000000000000000000aaaa';
const PAYEE_X = '0x000000000000000000000000000000000000bbbb';

const FIXTURE_LABEL: Record<Fixture, string> = {
  allow: 'fixture A · payment matches the signed quote',
  deny: 'fixture B · payTo rewritten after the 402 quote (expect Q-001)',
};

const shortHex = (val: unknown) => {
  const s = typeof val === 'string' ? val : '';
  return s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s || '—';
};

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />;
  if (state === 'running') return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-white" />;
  if (state === 'failed') return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />;
  if (state === 'missing') return <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />;
  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700" />;
}

export function ZkPage() {
  const wallet = useWallet();
  const chainId = wallet.selectedChainId;
  const [fixture, setFixture] = useState<Fixture>('allow');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Record<string, unknown> | null>(null);
  const [att, setAtt] = useState<Record<string, unknown> | null>(null);
  const [verifierAddress, setVerifierAddress] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    fetchRuntimeConfig()
      .then((cfg) => setVerifierAddress(cfg?.zk?.verifierAddress ?? null))
      .catch(() => setVerifierAddress(null));
  }, []);

  const reset = (f: Fixture, next?: RhcChainId) => {
    if (next && next !== chainId) void selectChain(next);
    setFixture(f);
    setPhase('idle');
    setError(null);
    setVerdict(null);
    setAtt(null);
  };

  const run = async () => {
    if (phase === 'running') return;
    setPhase('running');
    setError(null);
    setVerdict(null);
    setAtt(null);
    try {
      const { status, data } = await postLiveVerify({
        network: `eip155:${chainId}`,
        quote: { asset: USDG[chainId], payTo: PAYEE_A, amount: '1000000', chainId },
        payload: {
          type: 'eip3009',
          authorization: {
            from: HOLDER[chainId],
            to: fixture === 'allow' ? PAYEE_A : PAYEE_X,
            value: '1000000',
            validAfter: '0',
            validBefore: '4102444800',
            nonce: '0x0000000000000000000000000000000000000000000000000000000000000099',
            domain: { name: 'Global Dollar', version: '1', chainId, verifyingContract: USDG[chainId] },
          },
        },
        options: { enableZk: true, zkSystem: 'groth16-sp1' },
      });
      if (status >= 400) throw new Error(`POST /v1/verify returned ${status}${data.reason ? `: ${String(data.reason)}` : ''}`);
      setVerdict(data);
      const decisionId = String(data.decisionId ?? '');
      if (decisionId) {
        const settled = await pollZkAttestation(decisionId);
        setAtt(settled);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase('done');
    }
  };

  const status = typeof att?.status === 'string' ? (att.status as string) : null;
  const note = typeof att?.note === 'string' ? (att.note as string) : null;
  const pub = (att?.publicInputs as Record<string, unknown> | undefined) ?? null;
  const proverMissing = Boolean(note && /prover not configured/i.test(note));

  const steps: { label: string; state: StepState; detail: string }[] = [
    {
      label: 'Quote verdict + commitments (keccak of canonical quote / tx JSON)',
      state: verdict ? 'done' : phase === 'running' ? 'running' : error ? 'failed' : 'wait',
      detail: verdict ? `decision=${String(verdict.decision)} · decisionId=${String(verdict.decisionId ?? '—')}` : '',
    },
    {
      label: 'SP1 prover (ZGUARD_ZK_SP1_PROVER_URL) returns a Groth16 proof',
      state: att?.proof ? 'done' : proverMissing ? 'missing' : status === 'failed' ? 'failed' : phase === 'running' && verdict ? 'running' : 'wait',
      detail: att?.proof ? `proof ${shortHex(att.proof)}` : proverMissing ? 'not configured on this deployment' : '',
    },
    {
      label: `ZGuardQuoteVerifier.checkSp1QuoteProof on RHC ${chainId} (SP1 gateway, BN254 pairing)`,
      state: status === 'proven' || status === 'verified' ? 'done' : status === 'failed' && att?.proof ? 'failed' : att && !att.proof ? 'missing' : 'wait',
      detail: verifierAddress ? `verifier ${shortHex(verifierAddress)}` : verifierAddress === null ? 'no verifier address configured' : '',
    },
    {
      label: 'verifySp1QuoteProof recorded onchain (verifyTx)',
      state: status === 'verified' ? 'done' : att ? 'missing' : 'wait',
      detail: att?.verifyTx ? `tx ${shortHex(att.verifyTx)}` : '',
    },
  ];

  return (
    <div className="relative">
      <PageHeader
        kicker={`ZK layer · attestation.zk · RHC ${chainId}`}
        lines={['Prove the match.', { text: 'Only when a real proof exists.', muted: true }]}
        desc="Quote-match is a pure function, so it can be proven. This page shows the live attestation status from the API. Until the SP1 prover and verifier are deployed, attestations stay pending: nothing here is labelled proven without a proof the onchain verifier accepted."
        aside={<OrbitIllo size={260} />}
      />

      <section className="relative pb-24">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <div className="space-y-4 lg:col-span-5">
            {[
              {
                icon: Cpu,
                name: 'Groth16 · SP1',
                badge: 'Scaffold · prover not deployed',
                tone: 'border-amber-400/50 text-amber-200',
                desc: 'Rule engine in Rust (packages/zk/quote-rules, unit-tested; byte-identical public values with the TypeScript SDK). The SP1 guest still has to be built with `cargo prove build` and served by a prover.',
              },
              {
                icon: CircuitBoard,
                name: 'Halo2 · KZG',
                badge: 'Circuit + verifier · not deployed',
                tone: 'border-amber-400/50 text-amber-200',
                desc: 'PSE Halo2-KZG circuit for the eip3009 rail (packages/zk/halo2-quote-circuit): the canonical quote/tx JSON bytes are public inputs, the circuit proves Q-001 and Q-002 and returns the same public values as SP1. Prover CLI, generated Solidity verifier and Foundry tests with real proofs run in CI. Not deployed and not offered by the API yet.',
              },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.name} className="rounded-3xl border border-white/10 bg-black p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-white" strokeWidth={1.5} />
                      <span className="font-display text-xl text-white">{s.name}</span>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] ${s.tone}`}>
                      {s.badge}
                    </span>
                  </div>
                  <p className="mt-4 text-[13px] leading-relaxed text-zinc-400">{s.desc}</p>
                </div>
              );
            })}

            <div className="rounded-3xl border border-white/10 bg-black p-6">
              <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Scope & onchain status</div>
              <ul className="space-y-3 text-[12px] leading-relaxed text-zinc-400">
                <li>
                  · <span className="font-mono text-white">attestation.zk.scope</span> is always “quote”.
                </li>
                <li>
                  · <span className="font-mono text-zinc-200">ZGuardQuoteVerifier.sol</span> accepts only SP1 gateway proofs; the old
                  commitment “proof” path was removed. Covered by Foundry tests (fake proofs revert).
                </li>
                <li>
                  · Verifier on this deployment:{' '}
                  <span className="font-mono text-zinc-200">
                    {verifierAddress === undefined ? 'checking…' : verifierAddress ? verifierAddress : 'not deployed / not configured'}
                  </span>
                </li>
                <li>· Testnet 46630 only until audit + multisig owner (no mainnet claims).</li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-[#070708] p-6 sm:p-8 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-full border border-white/15 bg-black p-1">
                {([46630, 4663] as RhcChainId[]).map((cid) => (
                  <button
                    key={cid}
                    type="button"
                    onClick={() => reset(fixture, cid)}
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
                    onClick={() => reset(f)}
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
              <div className="mb-3 flex items-center justify-between gap-3 text-[9px] uppercase tracking-[0.22em] text-zinc-600">
                <span>publicInputs · commitment only</span>
                <span className="truncate">{att ? `decisionId: ${String(att.decisionId)}` : 'run to fetch live values'}</span>
              </div>
              {[
                ['quoteHash', shortHex(pub?.quoteHash)],
                ['txHash', shortHex(pub?.txHash)],
                ['verdict', pub?.verdict ? String(pub.verdict) : '—'],
                ['ruleBitmask', pub?.ruleBitmask ? String(pub.ruleBitmask) : '—'],
                ['programVKey', shortHex(att?.programVKey)],
                ['scope', att ? `"${String(att.scope)}"` : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-white/5 py-2 last:border-0">
                  <span className="text-zinc-600">{k}</span>
                  <span className={k === 'verdict' ? (v === 'allow' ? 'text-emerald-300' : v === '—' ? 'text-zinc-500' : 'text-rose-300') : 'text-zinc-200'}>
                    {v}
                  </span>
                </div>
              ))}
              <div className="pt-3 text-[9px] uppercase tracking-[0.16em] text-zinc-600">{FIXTURE_LABEL[fixture]}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black p-5" data-testid="zk-pipeline">
              <ol className="space-y-3">
                {steps.map((s) => (
                  <li key={s.label} className="flex items-start gap-3 font-mono text-[11px] leading-relaxed">
                    <StepIcon state={s.state} />
                    <span className="min-w-0">
                      <span className={s.state === 'wait' ? 'text-zinc-600' : 'text-zinc-200'}>{s.label}</span>
                      {s.detail && <span className="block break-words text-[10px] text-zinc-500">{s.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <AnimatePresence>
              {phase === 'done' && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: EASE }}
                  data-testid="zk-status"
                  className={`flex flex-wrap items-center gap-4 rounded-2xl border p-5 ${
                    status === 'verified' || status === 'proven'
                      ? 'border-emerald-400/40 bg-emerald-400/[0.06]'
                      : error || status === 'failed'
                        ? 'border-rose-400/40 bg-rose-400/[0.05]'
                        : 'border-amber-400/40 bg-amber-400/[0.05]'
                  }`}
                >
                  {status === 'verified' || status === 'proven' ? (
                    <Fingerprint className="h-6 w-6 text-emerald-300" strokeWidth={1.5} />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-amber-300" strokeWidth={1.5} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                      {error ? 'API unavailable' : `Attestation status: ${status ?? 'unknown'}`}
                    </div>
                    <div className="mt-1 break-words font-mono text-[10px] text-zinc-400">
                      {error ?? note ?? (att?.verifyTx ? `verifyTx ${String(att.verifyTx)}` : 'No status note returned.')}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={run}
              disabled={phase === 'running'}
              className={`flex h-12 items-center justify-center gap-2 rounded-2xl font-mono text-[11px] font-bold uppercase tracking-[0.2em] transition-all ${
                phase === 'running' ? 'cursor-wait border border-white/15 text-zinc-500' : 'bg-white text-black hover:shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)]'
              }`}
            >
              {phase === 'running' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Waiting for API…
                </>
              ) : (
                'Request verdict + attestation'
              )}
            </button>
          </div>
        </div>
      </section>

      <section className="relative border-t border-white/10 py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <Reveal>
            <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">
              What an SP1 proof covers (once deployed)
            </div>
            <ul className="space-y-4">
              {[
                'payTo equals the quoted payee (from committed JSON)',
                'amount equals the quoted amount (from committed JSON)',
                'quoteHash / txHash = keccak of the canonical request',
                'verdict + rule bitmask as public output',
              ].map((t, i) => (
                <motion.li
                  key={t}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3 text-zinc-200"
                >
                  <CheckCircle2 className="h-4 w-4 text-white" /> {t}
                </motion.li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mb-6 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">Not proven</div>
            <ul className="space-y-4">
              {[
                'Asset / chainId / approvals / EIP-712 domain (host hints, reported separately)',
                'Simulation results (depends on RPC state)',
                'Token risk (depends on indexer and onchain state)',
              ].map((t, i) => (
                <motion.li
                  key={t}
                  initial={{ opacity: 0, x: 10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3 text-zinc-500"
                >
                  <Circle className="h-4 w-4" /> {t}
                </motion.li>
              ))}
            </ul>
            <div className="mt-8 rounded-2xl border border-white/10 bg-black p-5 font-mono text-[11px] text-zinc-400">
              GET /v1/attestation/{'{decisionId}'} → status · note · proof · publicInputs · verifyTx
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
