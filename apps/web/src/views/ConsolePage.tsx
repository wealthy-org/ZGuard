import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  FlaskConical,
  Fingerprint,
  KeyRound,
  Loader2,
  MinusCircle,
  Play,
  RotateCcw,
  ScanLine,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE } from '../components/Reveal';
import { postLiveGuard } from '../lib/zguard-api';

type Dec = 'allow' | 'deny' | 'abstain';

interface CheckOut {
  d: Dec;
  codes: string[];
  head: string;
  rows: [string, string][];
}

interface Scenario {
  id: string;
  label: string;
  tag: string;
  d: Dec;
  reason: string;
  codes: string[];
  hash: string;
  ms: number;
  checks: [CheckOut, CheckOut, CheckOut];
  liveRequest: Record<string, unknown>;
}

const USDG_ADDR = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const PAYEE_A = '0x000000000000000000000000000000000000aaaa';
const PAYEE_X = '0x000000000000000000000000000000000000bbbb';
// Live funded USDG holder on RHC 4663 (Paxos / pool address) so eth_simulateV1 succeeds cleanly on mainnet!
const LIVE_USDG_HOLDER = '0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4';
const PONS_CURVE_SAMPLE = '0x05811bBAF648E5FE455d527342Cb4DD03Fa21214';
const AAPL_STOCK_TOKEN = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9';

const USDG_DOMAIN = {
  name: 'Global Dollar',
  version: '1',
  chainId: 4663,
  verifyingContract: USDG_ADDR,
};

const SCENARIOS: Scenario[] = [
  {
    id: 'ok',
    label: 'Matching USDG payment',
    tag: 'x402 · USDG · 4663',
    d: 'allow',
    reason: 'quote parity verified · simulation matches intent · canonical USDG',
    codes: [],
    hash: '0x9be1…77c3',
    ms: 412,
    checks: [
      { d: 'allow', codes: [], head: 'payTo, asset, amount and chainId match the quote', rows: [['payTo', '0x0000…aAaA'], ['amount', '1,000,000 micro'], ['asset', 'USDG · 6dp'], ['chainId', '4663']] },
      { d: 'allow', codes: [], head: 'success · 2 balance changes · no approvals', rows: [['status', 'success'], ['Δ payer', '−1.00 USDG'], ['approvals', 'none']] },
      { d: 'allow', codes: [], head: 'canonical USDG · mint not exposed', rows: [['kind', 'usdg'], ['mintable', 'false'], ['venue', 'canonical']] },
    ],
    liveRequest: {
      network: 'eip155:4663',
      quote: { asset: USDG_ADDR, payTo: PAYEE_A, amount: '0', chainId: 4663 },
      payload: {
        type: 'eip3009',
        authorization: {
          from: LIVE_USDG_HOLDER,
          to: PAYEE_A,
          value: '0',
          validAfter: '0',
          validBefore: '4102444800',
          nonce: '0x0000000000000000000000000000000000000000000000000000000000000001',
          domain: USDG_DOMAIN,
        },
      },
      checks: ['quote', 'simulation', 'token_risk'],
    },
  },
  {
    id: 'payto',
    label: 'payTo swapped in transit',
    tag: 'x402 · interception',
    d: 'deny',
    reason: 'payTo differs from quote (Q-001)',
    codes: ['Q-001', 'S-DIFF'],
    hash: '0x1d04…ab28',
    ms: 388,
    checks: [
      { d: 'deny', codes: ['Q-001'], head: 'recipient differs from the signed quote', rows: [['expected', '0x0000…aAaA'], ['actual', '0x0000…bBbB ✗']] },
      { d: 'deny', codes: ['S-DIFF'], head: 'quoted payee receives 0 USDG in simulation', rows: [['status', 'success'], ['Δ quoted payee', '0 ✗']] },
      { d: 'allow', codes: [], head: 'canonical USDG', rows: [['kind', 'usdg'], ['mintable', 'false']] },
    ],
    liveRequest: {
      network: 'eip155:4663',
      quote: { asset: USDG_ADDR, payTo: PAYEE_A, amount: '1000000', chainId: 4663 },
      payload: {
        type: 'eip3009',
        authorization: {
          from: LIVE_USDG_HOLDER,
          to: PAYEE_X,
          value: '1000000',
          validAfter: '0',
          validBefore: '4102444800',
          nonce: '0x0000000000000000000000000000000000000000000000000000000000000002',
          domain: USDG_DOMAIN,
        },
      },
      checks: ['quote', 'simulation', 'token_risk'],
    },
  },
  {
    id: 'amount',
    label: 'Amount tampered ×250',
    tag: 'x402 · amount',
    d: 'deny',
    reason: 'amount 250000000 ≠ quote 1000000 (Q-002)',
    codes: ['Q-002'],
    hash: '0x55f2…01bd',
    ms: 395,
    checks: [
      { d: 'deny', codes: ['Q-002'], head: 'authorization is 250× the quoted amount', rows: [['expected', '1,000,000'], ['actual', '250,000,000 ✗']] },
      { d: 'deny', codes: ['S-REVERT'], head: 'would attempt 250 USDG transfer on RHC', rows: [['status', 'revert / diff'], ['Δ payer', '−250.00 USDG']] },
      { d: 'allow', codes: [], head: 'canonical USDG', rows: [['kind', 'usdg'], ['mintable', 'false']] },
    ],
    liveRequest: {
      network: 'eip155:4663',
      quote: { asset: USDG_ADDR, payTo: PAYEE_A, amount: '1000000', chainId: 4663 },
      payload: {
        type: 'eip3009',
        authorization: {
          from: LIVE_USDG_HOLDER,
          to: PAYEE_A,
          value: '250000000',
          validAfter: '0',
          validBefore: '4102444800',
          nonce: '0x0000000000000000000000000000000000000000000000000000000000000003',
          domain: USDG_DOMAIN,
        },
      },
      checks: ['quote', 'simulation', 'token_risk'],
    },
  },
  {
    id: 'pons',
    label: 'Live pons V2 curve token scan',
    tag: 'pons curve · RHC 4663 live',
    d: 'allow',
    reason: 'pons_curve verified via PonsFactoryV2 · LP locked on curve',
    codes: [],
    hash: '0xc307…9e11',
    ms: 510,
    checks: [
      { d: 'allow', codes: [], head: 'intent matches router calldata', rows: [['chain', '4663'], ['target', 'USDG'], ['value', '0']] },
      { d: 'allow', codes: [], head: 'simulation succeeded on RHC 4663', rows: [['status', 'success'], ['approvals', 'none']] },
      { d: 'allow', codes: [], head: 'pons V2 curve token · mintable=false', rows: [['kind', 'pons_curve'], ['mintable', 'false'], ['stack', 'pons v2']] },
    ],
    liveRequest: {
      network: 'eip155:4663',
      token: PONS_CURVE_SAMPLE,
      payload: {
        type: 'intent',
        intent: {
          chainId: 4663,
          to: USDG_ADDR,
          function: 'transfer(address,uint256)',
          args: [PAYEE_A, 0],
          value: '0',
          from: LIVE_USDG_HOLDER,
        },
      },
      checks: ['quote', 'simulation', 'token_risk'],
    },
  },
  {
    id: 'undecodable',
    label: 'Undecodable payload bytes',
    tag: 'malformed · abstain',
    d: 'abstain',
    reason: 'payload not decodable · downstream checks fail-closed',
    codes: ['Q-DECODE', 'S-FAIL', 'T-UNKNOWN'],
    hash: '0x0000…0000',
    ms: 171,
    checks: [
      { d: 'abstain', codes: ['Q-DECODE'], head: 'calldata failed to decode at offset 0x02', rows: [['decode', 'failed ✗'], ['policy', 'fail-closed']] },
      { d: 'abstain', codes: ['S-FAIL'], head: 'not run · no intent to simulate', rows: [['status', 'unknown'], ['reason', 'upstream abstain']] },
      { d: 'abstain', codes: ['T-UNKNOWN'], head: 'token not derivable from payload', rows: [['kind', 'other'], ['policy', 'fail-closed']] },
    ],
    liveRequest: {
      network: 'eip155:4663',
      quote: { asset: USDG_ADDR, payTo: PAYEE_A, amount: '1000000', chainId: 4663 },
      payload: {
        type: 'evm_tx',
        tx: '0xdeadbeef02',
      },
      checks: ['quote', 'simulation', 'token_risk'],
    },
  },
  {
    id: 'approve',
    label: 'Hidden approve() in swap',
    tag: 'permit leak · delegate',
    d: 'deny',
    reason: 'approval outside intent (Q-006) · unlimited allowance (S-APPROVE)',
    codes: ['Q-006', 'S-APPROVE'],
    hash: '0x7aa9…c3d0',
    ms: 447,
    checks: [
      { d: 'deny', codes: ['Q-006'], head: 'approve() is not present in the signed intent', rows: [['intent', 'transfer only'], ['found', 'approve(spender, ∞) ✗']] },
      { d: 'deny', codes: ['S-APPROVE'], head: 'unlimited allowance would be granted', rows: [['spender', '0x0000…bBbB'], ['allowance', '∞ ✗']] },
      { d: 'allow', codes: [], head: 'canonical Stock Token (AAPL)', rows: [['kind', 'stock_token'], ['mintable', 'false']] },
    ],
    liveRequest: {
      network: 'eip155:4663',
      token: AAPL_STOCK_TOKEN,
      payload: {
        type: 'intent',
        intent: {
          chainId: 4663,
          to: USDG_ADDR,
          function: 'transfer(address,uint256)',
          args: [PAYEE_A, 0],
          value: '0',
          from: LIVE_USDG_HOLDER,
        },
        tx: {
          chainId: 4663,
          from: LIVE_USDG_HOLDER,
          to: USDG_ADDR,
          value: '0',
          // approve(0x000000000000000000000000000000000000bBbB, maxUint256)
          data: '0x095ea7b3000000000000000000000000000000000000000000000000000000000000bbbbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        },
      },
      checks: ['quote', 'simulation', 'token_risk'],
    },
  },
];

const CHECK_NAMES = ['quote', 'simulation', 'token_risk'];
const CHECK_ICONS: LucideIcon[] = [ScanLine, FlaskConical, Fingerprint];
const NODES: { k: string; I: LucideIcon }[] = [
  { k: 'payload', I: Send },
  { k: 'quote', I: ScanLine },
  { k: 'simulate', I: FlaskConical },
  { k: 'token', I: Fingerprint },
  { k: 'signer', I: KeyRound },
];

const TONE: Record<Dec, string> = {
  allow: 'text-emerald-300',
  deny: 'text-rose-300',
  abstain: 'text-amber-300',
};

const DEC_ICON: Record<Dec, LucideIcon> = { allow: ShieldCheck, deny: ShieldX, abstain: ShieldAlert };
const ROW_ICON: Record<Dec, LucideIcon> = { allow: CheckCircle2, deny: XCircle, abstain: MinusCircle };

function fallbackResponseOf(s: Scenario): Record<string, unknown> {
  return {
    decision: s.d,
    reason: s.reason,
    codes: s.codes,
    payload_hash: s.hash,
    expires_at: s.d === 'allow' ? new Date(Date.now() + 120_000).toISOString() : null,
    network: 'eip155:4663',
    checks: {
      quote: { decision: s.checks[0].d, codes: s.checks[0].codes },
      simulation: { decision: s.checks[1].d, codes: s.checks[1].codes },
      token_risk: { decision: s.checks[2].d, codes: s.checks[2].codes },
    },
    flags: [],
    charged: { asset: 'USDG', amount: '15000', unit: 'micro' },
  };
}

function mapLiveResponseToView(live: Record<string, unknown>, fallback: Scenario): {
  d: Dec;
  reason: string;
  codes: string[];
  hash: string;
  ms: number;
  checks: [CheckOut, CheckOut, CheckOut];
} {
  const d = (live.decision as Dec) || fallback.d;
  const reason = String(live.reason || fallback.reason);
  const codes = Array.isArray(live.codes) ? (live.codes as string[]) : fallback.codes;
  const fullHash = String(live.payload_hash || fallback.hash);
  const hash =
    fullHash.length > 16 ? `${fullHash.slice(0, 6)}…${fullHash.slice(-4)}` : fullHash;
  const meta = (live.receiptMeta as { latencyMs?: number } | undefined) ?? {};
  const ms = typeof meta.latencyMs === 'number' ? meta.latencyMs : fallback.ms;

  const checksObj = (live.checks as Record<string, Record<string, unknown>> | undefined) ?? {};
  const q = checksObj.quote;
  const sim = checksObj.simulation;
  const tr = checksObj.token_risk;

  const qOut: CheckOut = q
    ? {
        d: (q.decision as Dec) ?? fallback.checks[0].d,
        codes: (q.codes as string[]) ?? [],
        head:
          q.decision === 'allow'
            ? 'payTo, asset, amount and chainId match on RHC 4663'
            : ((q.mismatches as string[] | undefined)?.[0] ?? fallback.checks[0].head),
        rows: [
          ['expected', String((q.expected as Record<string, unknown>)?.payTo ?? 'intent').slice(0, 14)],
          ['amount', String((q.actual as Record<string, unknown>)?.amount ?? '0')],
          ['domain', q.domainVerified ? 'verified onchain' : 'intent'],
        ],
      }
    : fallback.checks[0];

  const simOut: CheckOut = sim
    ? {
        d: (sim.decision as Dec) ?? fallback.checks[1].d,
        codes: (sim.codes as string[]) ?? [],
        head: `${String(sim.status ?? 'unknown')} via ${String(sim.method ?? 'eth_simulateV1')}`,
        rows: [
          ['status', String(sim.status ?? 'unknown')],
          ['gasUsed', String(sim.gasUsed ?? 'n/a')],
          ['approvals', `${Array.isArray(sim.approvals) ? sim.approvals.length : 0}`],
        ],
      }
    : fallback.checks[1];

  const trOut: CheckOut = tr
    ? {
        d: (tr.decision as Dec) ?? fallback.checks[2].d,
        codes: (tr.codes as string[]) ?? [],
        head: `${String(tr.symbol ?? tr.kind ?? 'token')} · kind=${String(tr.kind ?? 'other')}`,
        rows: [
          ['kind', String(tr.kind ?? 'other')],
          ['mintable', String((tr.authorities as Record<string, unknown>)?.mintable ?? 'null')],
          ['venue', String((tr.liquidity as Record<string, unknown>)?.venue ?? 'unknown')],
        ],
      }
    : fallback.checks[2];

  return { d, reason, codes, hash, ms, checks: [qOut, simOut, trOut] };
}

function JsonLine({ line }: { line: string }) {
  const m = line.match(/^(\s*)("[^"]+")(:\s*)(.*)$/);
  if (!m) return <div className="text-zinc-300">{line}</div>;
  const [, indent, key, sep, raw] = m;
  const comma = raw.endsWith(',') ? ',' : '';
  const v = comma ? raw.slice(0, -1) : raw;
  let cls = 'text-zinc-200';
  if (v === '"allow"') cls = 'font-semibold text-emerald-300';
  else if (v === '"deny"') cls = 'font-semibold text-rose-300';
  else if (v === '"abstain"') cls = 'font-semibold text-amber-300';
  else if (/^-?\d/.test(v)) cls = 'text-sky-200';
  else if (/^(true|false|null)$/.test(v)) cls = 'text-fuchsia-300';
  return (
    <div>
      <span>{indent}</span>
      <span className="text-zinc-500">{key}</span>
      <span className="text-zinc-500">{sep}</span>
      <span className={cls}>{v}</span>
      <span className="text-zinc-500">{comma}</span>
    </div>
  );
}

export function ConsolePage() {
  const [sid, setSid] = useState('ok');
  const [customToken, setCustomToken] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [stage, setStage] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [liveJson, setLiveJson] = useState<Record<string, unknown> | null>(null);
  const [liveView, setLiveView] = useState<ReturnType<typeof mapLiveResponseToView> | null>(null);
  const [apiMode, setApiMode] = useState<'live' | 'offline-fixture'>('live');
  const timers = useRef<number[]>([]);
  const sc = SCENARIOS.find((s) => s.id === sid) ?? SCENARIOS[0];

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => clear, []);

  const select = (id: string) => {
    clear();
    setSid(id);
    setPhase('idle');
    setStage(0);
    setLog([]);
    setLiveJson(null);
    setLiveView(null);
  };

  const run = async () => {
    if (phase === 'running') return;
    clear();
    setPhase('running');
    setStage(1);
    setLiveJson(null);
    setLiveView(null);

    const requestBody =
      customToken.trim().startsWith('0x') && customToken.trim().length === 42
        ? { ...sc.liveRequest, token: customToken.trim() }
        : sc.liveRequest;

    setLog([
      `POST /v1/guard  network=eip155:4663  scenario=${sc.id}`,
      '  quote sourced from 402 channel · evaluating live RHC 4663 state…',
    ]);

    const t1 = window.setTimeout(() => setStage(2), 260);
    const t2 = window.setTimeout(() => setStage(3), 520);
    timers.current.push(t1, t2);

    try {
      const { status, data } = await postLiveGuard(requestBody);
      clear();
      setApiMode('live');
      const mapped = mapLiveResponseToView(data, sc);
      setLiveJson(data);
      setLiveView(mapped);
      setStage(3);
      setPhase('done');
      setLog((l) => [
        ...l,
        `  quote → ${mapped.checks[0].d}${mapped.checks[0].codes.length ? ` [${mapped.checks[0].codes.join(', ')}]` : ''}`,
        `  simulation → ${mapped.checks[1].d}${mapped.checks[1].codes.length ? ` [${mapped.checks[1].codes.join(', ')}]` : ''}`,
        `  token_risk → ${mapped.checks[2].d}${mapped.checks[2].codes.length ? ` [${mapped.checks[2].codes.join(', ')}]` : ''}`,
        `← ${status} OK (live RHC 4663) · ${mapped.ms} ms · decision=${mapped.d}`,
      ]);
    } catch {
      clear();
      setApiMode('offline-fixture');
      setLiveJson(fallbackResponseOf(sc));
      setLiveView(null);
      setStage(3);
      setPhase('done');
      setLog((l) => [
        ...l,
        ...sc.checks.map(
          (c, i) => `  ${CHECK_NAMES[i]} → ${c.d}${c.codes.length ? ` [${c.codes.join(', ')}]` : ''}`
        ),
        `← offline fallback · ${sc.ms} ms · decision=${sc.d}`,
      ]);
    }
  };

  const activeView = liveView ?? {
    d: sc.d,
    reason: sc.reason,
    codes: sc.codes,
    hash: sc.hash,
    ms: sc.ms,
    checks: sc.checks,
  };

  const pos = phase === 'idle' ? 0 : phase === 'done' ? 4 : stage + 1;
  const signerOk = phase === 'done' && activeView.d === 'allow';
  const DecIcon = DEC_ICON[activeView.d];

  const checkStatus = (i: number): 'pending' | 'running' | 'done' =>
    phase === 'idle' ? 'pending' : stage > i || phase === 'done' ? 'done' : 'running';

  return (
    <div className="relative">
      <PageHeader
        kicker="Guard Console · POST /v1/guard"
        lines={['Trigger the guard.', { text: 'Watch it refuse.', muted: true }]}
        desc="Executes live quote-match, eth_simulateV1 simulation and token risk on Robinhood Chain (4663) via /v1/guard, then releases or blocks the signer."
      />

      <section className="relative pb-28">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          {/* LEFT */}
          <div className="flex flex-col gap-4 lg:col-span-4">
            <div className="rounded-3xl border border-white/10 bg-[#070708] p-4">
              <div className="mb-3 flex items-center justify-between px-2 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                <span>Scenarios</span>
                <span>{apiMode === 'live' ? 'live RHC 4663' : 'offline fallback'}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {SCENARIOS.map((s) => {
                  const active = s.id === sid;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => select(s.id)}
                      className={`group flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all duration-300 ${
                        active ? 'border-white/30 bg-white/[0.07]' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all ${active ? 'scale-150 bg-white' : 'bg-zinc-700'}`} />
                      <span className="min-w-0">
                        <span className={`block truncate text-[13px] font-medium ${active ? 'text-white' : 'text-zinc-300'}`}>{s.label}</span>
                        <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">{s.tag}</span>
                      </span>
                      <span className={`ml-auto font-mono text-[9px] uppercase ${TONE[s.d]} opacity-70`}>{s.d}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#070708] p-5">
              <div className="mb-3">
                <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  Optional live token override (chain 4663)
                </label>
                <input
                  value={customToken}
                  onChange={(e) => setCustomToken(e.target.value)}
                  placeholder="0x… (leave blank for scenario token)"
                  spellCheck={false}
                  className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 font-mono text-[11px] text-zinc-200 outline-none focus:border-white/40"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                {[
                  ['network', 'eip155:4663'],
                  ['payload', sc.id === 'undecodable' ? 'opaque bytes' : 'eip3009 / intent'],
                  ['checks', 'quote · sim · token'],
                  ['policy', 'required ×3'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-white/10 bg-black/60 px-3 py-2.5">
                    <div className="text-zinc-600">{k}</div>
                    <div className="mt-1 truncate normal-case tracking-normal text-zinc-200">{v}</div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={run}
                disabled={phase === 'running'}
                className={`group relative mt-4 flex h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-2xl font-mono text-[12px] font-bold uppercase tracking-[0.2em] transition-all ${
                  phase === 'running'
                    ? 'cursor-wait border border-white/15 bg-white/5 text-zinc-400'
                    : 'bg-white text-black hover:shadow-[0_0_50px_-10px_rgba(255,255,255,0.5)]'
                }`}
              >
                {phase === 'running' && <span className="shimmer absolute inset-0" />}
                {phase === 'running' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Evaluating
                  </>
                ) : phase === 'done' ? (
                  <>
                    <RotateCcw className="h-4 w-4" /> Run again
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> POST /v1/guard
                  </>
                )}
              </button>
            </div>

            <div className="min-h-[170px] rounded-3xl border border-white/10 bg-black p-4 font-mono text-[11px] leading-[1.75]">
              <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2 text-[9px] uppercase tracking-[0.22em] text-zinc-600">
                <span>guard.log</span>
                <span className="flex gap-1">
                  <i className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  <i className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  <i className="h-1.5 w-1.5 rounded-full bg-white" />
                </span>
              </div>
              {log.length === 0 ? (
                <div className="text-zinc-600">
                  awaiting invocation<span className="animate-caret"> ▌</span>
                </div>
              ) : (
                log.map((line, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="whitespace-pre-wrap text-zinc-400">
                    {line}
                  </motion.div>
                ))
              )}
            </div>
          </div>

          {/* RIGHT */}
          <div className="flex flex-col gap-4 lg:col-span-8">
            {/* pipeline */}
            <div className="rounded-3xl border border-white/10 bg-[#070708] p-6">
              <div className="relative flex items-start justify-between">
                <div className="absolute left-5 right-5 top-5 h-px bg-white/10" />
                <div
                  className="absolute left-5 top-5 h-px bg-white transition-[width] duration-700 ease-out"
                  style={{ width: `calc(${(pos / 4) * 100}% - ${(pos / 4) * 40}px)` }}
                />
                {NODES.map((n, i) => {
                  const active = i <= pos;
                  const current = i === pos;
                  const Icon = n.I;
                  return (
                    <div key={n.k} className="relative z-10 flex flex-col items-center gap-2">
                      <motion.div
                        animate={{ scale: current ? 1.12 : 1 }}
                        className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors duration-500 ${
                          active ? 'border-white bg-white text-black' : 'border-white/20 bg-black text-zinc-500'
                        } ${current && phase === 'running' ? 'shadow-[0_0_24px_rgba(255,255,255,0.6)]' : ''}`}
                      >
                        <Icon className="h-4 w-4" />
                      </motion.div>
                      <span className={`font-mono text-[9px] uppercase tracking-[0.16em] ${active ? 'text-zinc-300' : 'text-zinc-600'}`}>
                        {n.k === 'signer' && phase === 'done' ? (signerOk ? 'released' : 'refused') : n.k}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* checks */}
            <div className="grid gap-3 sm:grid-cols-3">
              {activeView.checks.map((c, i) => {
                const st = checkStatus(i);
                const Icon = CHECK_ICONS[i];
                const RowIcon = ROW_ICON[c.d];
                return (
                  <div key={CHECK_NAMES[i]} className={`flex flex-col rounded-3xl border bg-[#070708] p-5 transition-colors duration-500 ${st === 'done' ? 'border-white/25' : 'border-white/10'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-black text-zinc-200">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="font-mono text-[11px] text-zinc-200">checks.{CHECK_NAMES[i]}</span>
                      </div>
                      {st === 'running' && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
                      {st === 'done' && <RowIcon className={`h-4 w-4 ${TONE[c.d]}`} />}
                    </div>
                    <div className="mt-4 min-h-[88px] border-t border-white/10 pt-4">
                      {st !== 'done' ? (
                        <div className="space-y-2.5">
                          {[92, 70, 48].map((w) => (
                            <div key={w} className="h-2 overflow-hidden rounded-full bg-white/5">
                              <div className="shimmer h-full w-full" style={{ width: `${w}%` }} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                          <p className="text-[12px] font-medium leading-snug text-zinc-100">{c.head}</p>
                          <dl className="mt-3 space-y-1 font-mono text-[10px]">
                            {c.rows.map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-2">
                                <dt className="uppercase tracking-wide text-zinc-600">{k}</dt>
                                <dd className="truncate text-right text-zinc-300">{v}</dd>
                              </div>
                            ))}
                          </dl>
                        </motion.div>
                      )}
                    </div>
                    <div className="mt-3 flex min-h-[20px] flex-wrap gap-1">
                      {st === 'done' &&
                        c.codes.map((code) => (
                          <span key={code} className={`rounded-md border border-current/30 px-1.5 py-0.5 font-mono text-[9px] ${TONE[c.d]}`}>
                            {code}
                          </span>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* decision */}
            <div
              className={`relative overflow-hidden rounded-3xl border bg-[#070708] px-6 py-5 transition-all duration-700 ${
                phase === 'done' ? 'border-white/30 shadow-[0_0_80px_-24px_rgba(255,255,255,0.25)]' : 'border-white/10'
              }`}
            >
              {phase !== 'done' ? (
                <div className="flex h-[76px] items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.24em] text-zinc-600">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-zinc-500" />
                  awaiting aggregate decision
                </div>
              ) : (
                <AnimatePresence>
                  <motion.div
                    key={sc.id + activeView.hash}
                    initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 0.55, ease: EASE }}
                    className="flex flex-wrap items-center gap-5"
                  >
                    <DecIcon className={`h-11 w-11 shrink-0 ${TONE[activeView.d]}`} strokeWidth={1.4} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-4">
                        <span className={`font-display text-4xl uppercase leading-none tracking-tight sm:text-5xl ${TONE[activeView.d]}`}>{activeView.d}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                          {activeView.d === 'allow' ? 'signer: pass' : 'signer: block'}
                        </span>
                      </div>
                      <p className="mt-2 truncate font-mono text-[11px] text-zinc-400">{activeView.reason}</p>
                    </div>
                    <div className="hidden flex-col items-end gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600 md:flex">
                      <span>hash {activeView.hash}</span>
                      <span>ttl 120s · bound</span>
                      <span className={TONE[activeView.d]}>{activeView.codes.length ? activeView.codes.join(' · ') : 'no reason codes'}</span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              )}
            </div>

            {/* JSON */}
            <div className="flex-1 overflow-hidden rounded-3xl border border-white/10 bg-black">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                <span>POST /v1/guard → response.json</span>
                <span>{apiMode === 'live' ? 'live schema v1' : 'fixture schema v1'}</span>
              </div>
              {phase === 'done' ? (
                <motion.pre
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="max-h-[340px] overflow-auto p-5 font-mono text-[11px] leading-[1.7]"
                >
                  {JSON.stringify(liveJson ?? fallbackResponseOf(sc), null, 2)
                    .split('\n')
                    .map((ln, i) => (
                      <JsonLine key={i} line={ln} />
                    ))}
                </motion.pre>
              ) : (
                <div className="flex h-[170px] flex-col items-center justify-center gap-3 text-zinc-600">
                  <div className="flex h-8 items-end gap-1">
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                      <motion.span
                        key={i}
                        className="w-1.5 rounded-sm bg-white/30"
                        animate={{ height: ['20%', '100%', '20%'] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.09, ease: 'easeInOut' }}
                        style={{ height: '20%' }}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em]">response buffer armed</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
