import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  ExternalLink,
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
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE } from '../components/Reveal';
import { postLiveGuard, runGuardedWalletEip3009Demo } from '../lib/zguard-api';
import { selectChain, useWallet } from '../lib/wallet';
import { WalletStatusCard } from '../components/WalletButton';
import { BuyCreditCard } from '../components/BuyCreditCard';

type Dec = 'allow' | 'deny' | 'abstain';
type ActiveChain = 46630 | 4663;

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

const PAYEE_A = '0x000000000000000000000000000000000000aaaa';
const PAYEE_X = '0x000000000000000000000000000000000000bbbb';
/** transfer(0x…aaaa, 0) — the exact calldata the intent scenarios sign (gap QM-2). */
const TRANSFER_PAYEE_A_ZERO =
  '0xa9059cbb000000000000000000000000000000000000000000000000000000000000aaaa0000000000000000000000000000000000000000000000000000000000000000';

// --- Live Verified Robinhood Chain Testnet (46630) Contracts ---
const TESTNET_USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const TESTNET_USDG_HOLDER = '0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79';
const TESTNET_TSLA_STOCK = '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E';
const TESTNET_KOIP_PONS_CURVE = '0x9118BD806cB3906Dc6d50a4409a9e9dF48172365';
const TESTNET_PONSIDOOG_GRAD = '0x9c8CB5D0Bd313ebE5813aCfd8daa4E22DE76DFfd';
const TESTNET_MOCK_USDG_SPOOF = '0x8F9231B0F448bA9AD045348437458721676c23BC';

// --- Live Verified Robinhood Chain Mainnet (4663) Contracts ---
const MAINNET_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const MAINNET_USDG_HOLDER = '0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4';
const MAINNET_PONS_CURVE = '0x05811bBAF648E5FE455d527342Cb4DD03Fa21214';
const MAINNET_AAPL_STOCK = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9';

export function buildScenarios(chainId: ActiveChain): Scenario[] {
  const isTestnet = chainId === 46630;
  const network = `eip155:${chainId}`;
  const usdg = isTestnet ? TESTNET_USDG : MAINNET_USDG;
  const holder = isTestnet ? TESTNET_USDG_HOLDER : MAINNET_USDG_HOLDER;
  const stockToken = isTestnet ? TESTNET_TSLA_STOCK : MAINNET_AAPL_STOCK;
  const stockSym = isTestnet ? 'TSLA' : 'AAPL';
  const ponsCurveToken = isTestnet ? TESTNET_KOIP_PONS_CURVE : MAINNET_PONS_CURVE;
  const usdgDomain = {
    name: 'Global Dollar',
    version: '1',
    chainId,
    verifyingContract: usdg,
  };

  return [
    {
      id: 'ok',
      label: `Matching USDG payment (${chainId})`,
      tag: `x402 · USDG · ${chainId}${isTestnet ? ' testnet' : ''}`,
      d: 'allow',
      reason: 'quote parity verified · simulation matches intent · canonical USDG',
      codes: [],
      hash: '0x9be1…77c3',
      ms: 390,
      checks: [
        {
          d: 'allow',
          codes: [],
          head: `payTo, asset, amount and chainId match on RHC ${chainId}`,
          rows: [
            ['payTo', '0x0000…aAaA'],
            ['amount', '0 micro (sim)'],
            ['asset', 'USDG · 6dp'],
            ['chainId', String(chainId)],
          ],
        },
        {
          d: 'allow',
          codes: [],
          head: 'success via eth_simulateV1 · no approvals',
          rows: [
            ['status', 'success'],
            ['sequencer', 'up'],
            ['approvals', 'none'],
          ],
        },
        {
          d: 'allow',
          codes: [],
          head: 'canonical USDG · mint not exposed',
          rows: [
            ['kind', 'usdg'],
            ['mintable', 'false'],
            ['venue', 'canonical'],
          ],
        },
      ],
      liveRequest: {
        network,
        quote: { asset: usdg, payTo: PAYEE_A, amount: '0', chainId },
        payload: {
          type: 'eip3009',
          authorization: {
            from: holder,
            to: PAYEE_A,
            value: '0',
            validAfter: '0',
            validBefore: '4102444800',
            nonce: '0x0000000000000000000000000000000000000000000000000000000000000001',
            domain: usdgDomain,
          },
        },
        checks: ['quote', 'simulation', 'token_risk'],
      },
    },
    {
      id: 'pons',
      label: isTestnet
        ? 'Active Pons curve scan (KOIP · 46630)'
        : 'Live Pons V2 curve scan (4663)',
      tag: `pons_curve · live RHC ${chainId}`,
      d: 'allow',
      reason: 'pons_curve verified via factory · LP locked on bonding curve',
      codes: [],
      hash: '0xc307…9e11',
      ms: 480,
      checks: [
        {
          d: 'allow',
          codes: [],
          head: 'intent matches router calldata',
          rows: [
            ['chain', String(chainId)],
            ['target', 'USDG'],
            ['value', '0'],
          ],
        },
        {
          d: 'allow',
          codes: [],
          head: `simulation succeeded on RHC ${chainId}`,
          rows: [
            ['status', 'success'],
            ['approvals', 'none'],
          ],
        },
        {
          d: 'allow',
          codes: [],
          head: 'active pons bonding curve · LP locked',
          rows: [
            ['kind', 'pons_curve'],
            ['mintable', 'false'],
            ['venue', 'pons_curve'],
          ],
        },
      ],
      liveRequest: {
        network,
        token: ponsCurveToken,
        payload: {
          type: 'intent',
          intent: {
            chainId,
            to: usdg,
            function: 'transfer(address,uint256)',
            args: [PAYEE_A, 0],
            value: '0',
            from: holder,
          },
          // QM-2: the guard compares the intent with the exact bytes that will be signed
          tx: { chainId, from: holder, to: usdg, value: '0', data: TRANSFER_PAYEE_A_ZERO },
        },
        checks: ['quote', 'simulation', 'token_risk'],
      },
    },
    {
      id: 'stock_or_grad',
      label: isTestnet
        ? 'Graduated Pons Uniswap v4 (PONSIDOOG)'
        : 'Official Stock Token (AAPL · 4663)',
      tag: isTestnet ? 'pons_graduated_v4 · 46630' : 'stock_token · 4663',
      d: 'allow',
      reason: isTestnet
        ? 'graduated Pons pool verified on Uniswap v4 PoolManager'
        : 'verified official Robinhood Stock Token',
      codes: [],
      hash: '0x6e24…7a04',
      ms: 465,
      checks: [
        {
          d: 'allow',
          codes: [],
          head: 'intent matches router calldata',
          rows: [
            ['chain', String(chainId)],
            ['value', '0'],
          ],
        },
        {
          d: 'allow',
          codes: [],
          head: `simulation succeeded on RHC ${chainId}`,
          rows: [
            ['status', 'success'],
            ['approvals', 'none'],
          ],
        },
        {
          d: 'allow',
          codes: [],
          head: isTestnet ? 'graduated Uniswap v4 pool' : 'official Stock Token',
          rows: [
            ['kind', isTestnet ? 'pons_graduated_v4' : 'stock_token'],
            ['locked', 'true'],
          ],
        },
      ],
      liveRequest: {
        network,
        token: isTestnet ? TESTNET_PONSIDOOG_GRAD : MAINNET_AAPL_STOCK,
        payload: {
          type: 'intent',
          intent: {
            chainId,
            to: usdg,
            function: 'transfer(address,uint256)',
            args: [PAYEE_A, 0],
            value: '0',
            from: holder,
          },
          // QM-2: the guard compares the intent with the exact bytes that will be signed
          tx: { chainId, from: holder, to: usdg, value: '0', data: TRANSFER_PAYEE_A_ZERO },
        },
        checks: ['quote', 'simulation', 'token_risk'],
      },
    },
    {
      id: 'spoof_or_payto',
      label: isTestnet
        ? 'Spoofed "Mock USDG" faucet token'
        : 'payTo swapped in transit (Q-001)',
      tag: isTestnet ? 'ticker spoof · open faucet · 46630' : 'x402 · interception',
      d: 'deny',
      reason: isTestnet
        ? 'open public faucet/mint selector exposed (T-MINT) + USDG lookalike'
        : 'payTo differs from quote (Q-001)',
      codes: isTestnet ? ['T-MINT'] : ['Q-001', 'S-DIFF'],
      hash: '0x8f92…23bc',
      ms: 410,
      checks: [
        {
          d: isTestnet ? 'allow' : 'deny',
          codes: isTestnet ? [] : ['Q-001'],
          head: isTestnet ? 'router intent parity ok' : 'recipient differs from quote',
          rows: [
            ['expected', '0x0000…aAaA'],
            ['actual', isTestnet ? '0x0000…aAaA' : '0x0000…bBbB ✗'],
          ],
        },
        {
          d: isTestnet ? 'allow' : 'deny',
          codes: isTestnet ? [] : ['S-DIFF'],
          head: isTestnet ? 'simulation succeeded' : 'quoted payee receives 0 USDG',
          rows: [['status', 'success']],
        },
        {
          d: isTestnet ? 'deny' : 'allow',
          codes: isTestnet ? ['T-MINT'] : [],
          head: isTestnet ? 'spoofed "USDG" with open faucet() ✗' : 'canonical USDG',
          rows: [
            ['kind', isTestnet ? 'other ✗' : 'usdg'],
            ['mintable', isTestnet ? 'true ✗' : 'false'],
          ],
        },
      ],
      liveRequest: isTestnet
        ? {
            network,
            token: TESTNET_MOCK_USDG_SPOOF,
            payload: {
              type: 'intent',
              intent: {
                chainId,
                to: usdg,
                function: 'transfer(address,uint256)',
                args: [PAYEE_A, 0],
                value: '0',
                from: holder,
              },
              tx: { chainId, from: holder, to: usdg, value: '0', data: TRANSFER_PAYEE_A_ZERO },
            },
            checks: ['quote', 'simulation', 'token_risk'],
          }
        : {
            network,
            quote: { asset: usdg, payTo: PAYEE_A, amount: '1000000', chainId },
            payload: {
              type: 'eip3009',
              authorization: {
                from: holder,
                to: PAYEE_X,
                value: '1000000',
                validAfter: '0',
                validBefore: '4102444800',
                nonce: '0x0000000000000000000000000000000000000000000000000000000000000002',
                domain: usdgDomain,
              },
            },
            checks: ['quote', 'simulation', 'token_risk'],
          },
    },
    {
      id: 'approve',
      label: 'Perm / Terminal hidden approve()',
      tag: 'permit leak · Q-006 · S-APPROVE',
      d: 'deny',
      reason: 'approval outside intent (Q-006) · unlimited allowance (S-APPROVE)',
      codes: ['Q-006', 'S-APPROVE'],
      hash: '0x7aa9…c3d0',
      ms: 430,
      checks: [
        {
          d: 'deny',
          codes: ['Q-006'],
          head: 'approve() is not present in the signed intent',
          rows: [
            ['intent', 'transfer only'],
            ['found', 'approve(spender, ∞) ✗'],
          ],
        },
        {
          d: 'deny',
          codes: ['S-APPROVE'],
          head: 'unlimited allowance would be granted',
          rows: [
            ['spender', '0x0000…bBbB'],
            ['allowance', '∞ ✗'],
          ],
        },
        {
          d: 'allow',
          codes: [],
          head: `canonical Stock Token (${stockSym})`,
          rows: [
            ['kind', 'stock_token'],
            ['mintable', 'false'],
          ],
        },
      ],
      liveRequest: {
        network,
        token: stockToken,
        payload: {
          type: 'intent',
          intent: {
            chainId,
            to: usdg,
            function: 'transfer(address,uint256)',
            args: [PAYEE_A, 0],
            value: '0',
            from: holder,
          },
          tx: {
            chainId,
            from: holder,
            to: usdg,
            value: '0',
            data: '0x095ea7b3000000000000000000000000000000000000000000000000000000000000bbbbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          },
        },
        checks: ['quote', 'simulation', 'token_risk'],
      },
    },
    {
      id: 'undecodable',
      label: 'Undecodable payload bytes',
      tag: 'malformed · fail-closed abstain',
      d: 'abstain',
      reason: 'payload not decodable · downstream checks fail-closed',
      codes: ['Q-DECODE', 'S-FAIL'],
      hash: '0x0000…0000',
      ms: 165,
      checks: [
        {
          d: 'abstain',
          codes: ['Q-DECODE'],
          head: 'calldata failed to decode · fail-closed',
          rows: [
            ['decode', 'failed ✗'],
            ['policy', 'fail-closed'],
          ],
        },
        {
          d: 'abstain',
          codes: ['S-FAIL'],
          head: 'skipped · upstream undecodable',
          rows: [
            ['status', 'unknown'],
            ['reason', 'upstream abstain'],
          ],
        },
        {
          d: 'allow',
          codes: [],
          head: 'canonical USDG',
          rows: [
            ['kind', 'usdg'],
            ['policy', 'fail-closed'],
          ],
        },
      ],
      liveRequest: {
        network,
        quote: { asset: usdg, payTo: PAYEE_A, amount: '1000000', chainId },
        payload: {
          type: 'evm_tx',
          tx: '0xdeadbeef02',
        },
        checks: ['quote', 'simulation', 'token_risk'],
      },
    },
  ];
}

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

function fallbackResponseOf(s: Scenario, chainId: ActiveChain): Record<string, unknown> {
  return {
    decision: s.d,
    reason: s.reason,
    codes: s.codes,
    payload_hash: s.hash,
    expires_at: s.d === 'allow' ? new Date(Date.now() + 120_000).toISOString() : null,
    network: `eip155:${chainId}`,
    checks: {
      quote: { decision: s.checks[0].d, codes: s.checks[0].codes },
      simulation: { decision: s.checks[1].d, codes: s.checks[1].codes },
      token_risk: { decision: s.checks[2].d, codes: s.checks[2].codes },
    },
    flags: [],
    charged: { asset: 'USDG', amount: '15000', unit: 'micro', rail: `eip155:${chainId}` },
  };
}

function mapLiveResponseToView(
  live: Record<string, unknown>,
  fallback: Scenario,
  chainId: ActiveChain
): {
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
            ? `payTo, asset, amount & chainId match on RHC ${chainId}`
            : ((q.notes as string[] | undefined)?.[0] ?? fallback.checks[0].head),
        rows: [
          ['expected', String((q.expected as Record<string, unknown>)?.payTo ?? 'intent').slice(0, 14)],
          ['amount', String((q.actual as Record<string, unknown>)?.amount ?? '0')],
          ['chainId', String(chainId)],
        ],
      }
    : fallback.checks[0];

  const simOut: CheckOut = sim
    ? {
        d: (sim.decision as Dec) ?? fallback.checks[1].d,
        codes: (sim.codes as string[]) ?? [],
        head: `${String(sim.status ?? 'unknown')} on RHC ${chainId}`,
        rows: [
          ['status', String(sim.status ?? 'unknown')],
          ['gasUsed', String(sim.gasUsed ?? 'n/a')],
          ['approvals', `${Array.isArray(sim.approvals) ? sim.approvals.length : 0}`],
        ],
      }
    : fallback.checks[1];

  const holders = (tr?.holders as { count?: number | null; top10Bps?: number | null } | undefined) ?? {};
  const trOut: CheckOut = tr
    ? {
        d: (tr.decision as Dec) ?? fallback.checks[2].d,
        codes: (tr.codes as string[]) ?? [],
        head: `${String(tr.symbol ?? tr.kind ?? 'token')} · kind=${String(tr.kind ?? 'other')}`,
        rows: [
          ['kind', String(tr.kind ?? 'other')],
          ['mintable', String((tr.authorities as Record<string, unknown>)?.mintable ?? 'null')],
          [
            'holders',
            holders.count !== null && holders.count !== undefined
              ? `${holders.count} (top10 ${holders.top10Bps ?? 'n/a'} bps)`
              : String((tr.liquidity as Record<string, unknown>)?.venue ?? 'unknown'),
          ],
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
  // D3: the Testnet/Mainnet toggle is shared with the wallet store (Navbar + Console stay in sync).
  const wallet = useWallet();
  const chainId: ActiveChain = wallet.selectedChainId;
  const [sid, setSid] = useState('ok');
  const [customToken, setCustomToken] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [stage, setStage] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [liveJson, setLiveJson] = useState<Record<string, unknown> | null>(null);
  const [liveView, setLiveView] = useState<ReturnType<typeof mapLiveResponseToView> | null>(null);
  const [apiMode, setApiMode] = useState<'live' | 'offline-fixture'>('live');

  // Browser wallet (shared store, gap D3)
  const walletAddr = wallet.address;
  const walletOnChain = Boolean(walletAddr && wallet.walletChainId === chainId);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletStatus, setWalletStatus] = useState<string | null>(null);

  const timers = useRef<number[]>([]);
  const scenarios = buildScenarios(chainId);
  const sc = scenarios.find((s) => s.id === sid) ?? scenarios[0];

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => clear, []);

  const switchChain = (next: ActiveChain) => {
    clear();
    void selectChain(next);
    setPhase('idle');
    setStage(0);
    setLog([]);
    setLiveJson(null);
    setLiveView(null);
  };

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
      `POST /v1/guard  network=eip155:${chainId}  scenario=${sc.id}`,
      `  evaluating live Robinhood Chain ${chainId === 46630 ? 'Testnet (0 gas fees)' : 'Mainnet'} state…`,
    ]);

    const t1 = window.setTimeout(() => setStage(2), 260);
    const t2 = window.setTimeout(() => setStage(3), 520);
    timers.current.push(t1, t2);

    try {
      const { status, data } = await postLiveGuard(requestBody);
      if (status >= 500) {
        throw new Error(
          `API unavailable (HTTP ${status}${typeof data.status === 'string' ? ` ${data.status}` : ''})`
        );
      }
      clear();
      setApiMode('live');
      const mapped = mapLiveResponseToView(data, sc, chainId);
      setLiveJson(data);
      setLiveView(mapped);
      setStage(3);
      setPhase('done');
      setLog((l) => [
        ...l,
        `  quote → ${mapped.checks[0].d}${mapped.checks[0].codes.length ? ` [${mapped.checks[0].codes.join(', ')}]` : ''}`,
        `  simulation → ${mapped.checks[1].d}${mapped.checks[1].codes.length ? ` [${mapped.checks[1].codes.join(', ')}]` : ''}`,
        `  token_risk → ${mapped.checks[2].d}${mapped.checks[2].codes.length ? ` [${mapped.checks[2].codes.join(', ')}]` : ''}`,
        `← ${status} OK (live RHC ${chainId}) · ${mapped.ms} ms · decision=${mapped.d}`,
      ]);
    } catch (err) {
      clear();
      setApiMode('offline-fixture');
      setLiveJson(fallbackResponseOf(sc, chainId));
      setLiveView(null);
      setStage(3);
      setPhase('done');
      setLog((l) => [
        ...l,
        ...sc.checks.map(
          (c, i) => `  ${CHECK_NAMES[i]} → ${c.d}${c.codes.length ? ` [${c.codes.join(', ')}]` : ''}`
        ),
        `✗ ${err instanceof Error ? err.message : 'API unreachable'}`,
        `← EXAMPLE FIXTURE (not a live verdict) · decision=${sc.d}`,
      ]);
    }
  };

  const handleGuardedWalletSign = async (tamperPayTo: boolean) => {
    if (!walletAddr || !walletOnChain) return;
    setWalletBusy(true);
    setWalletStatus(null);
    try {
      const res = await runGuardedWalletEip3009Demo({
        walletAddress: walletAddr,
        chainId,
        tamperPayTo,
      });
      const mapped = mapLiveResponseToView(res.guardResponse, sc, chainId);
      setLiveJson(res.guardResponse);
      setLiveView(mapped);
      setStage(3);
      setPhase('done');
      if (res.signature) {
        setWalletStatus(`ALLOW → Wallet signed EIP-712 (0 gas): ${res.signature.slice(0, 14)}…`);
      } else {
        setWalletStatus(`${res.decision.toUpperCase()} → ${res.reason}`);
      }
    } catch (err) {
      setWalletStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setWalletBusy(false);
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
        kicker={`Guard Console · POST /v1/guard · RHC ${chainId} ${chainId === 46630 ? 'Testnet (Zero-Fee)' : 'Mainnet'}`}
        lines={['Trigger the guard.', { text: 'Watch it refuse.', muted: true }]}
        desc={`Defaults to Robinhood Chain Testnet (46630) so you can run live eth_simulateV1, Blockscout holder scans, and wallet EIP-712 signing with zero real fees—or toggle to Mainnet (4663) anytime.`}
      />

      <section className="relative pb-28">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          {/* LEFT */}
          <div className="flex flex-col gap-4 lg:col-span-4">
            {/* D3: wallet status + connect at the top of the Console */}
            <WalletStatusCard />

            {/* Chain Selector */}
            <div className="rounded-3xl border border-white/10 bg-[#070708] p-4">
              <div className="mb-2.5 flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                <span>Target Network</span>
                <span className="text-emerald-300">
                  {chainId === 46630 ? 'Zero Real Fees' : 'Production'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-black p-1">
                <button
                  type="button"
                  onClick={() => switchChain(46630)}
                  className={`whitespace-nowrap rounded-xl px-1 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition sm:tracking-[0.14em] ${
                    chainId === 46630 ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Testnet · 46630
                </button>
                <button
                  type="button"
                  onClick={() => switchChain(4663)}
                  className={`whitespace-nowrap rounded-xl px-1 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition sm:tracking-[0.14em] ${
                    chainId === 4663 ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Mainnet · 4663
                </button>
              </div>
              {chainId === 46630 && (
                <div className="mt-3 flex items-center justify-between px-1 font-mono text-[10px] text-zinc-400">
                  <a
                    href="https://faucet.testnet.chain.robinhood.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    RHC Testnet Faucet <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href="https://explorer.testnet.chain.robinhood.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Explorer <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Scenarios */}
            <div className="rounded-3xl border border-white/10 bg-[#070708] p-4">
              <div className="mb-3 flex items-center justify-between px-2 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                <span>Scenarios</span>
                <span>{apiMode === 'live' ? `live RHC ${chainId}` : 'offline fallback'}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {scenarios.map((s) => {
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

            {/* Execute Guard */}
            <div className="rounded-3xl border border-white/10 bg-[#070708] p-5">
              <div className="mb-3">
                <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  Optional live token override (chain {chainId})
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
                  ['network', `eip155:${chainId}`],
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
              {!walletAddr && (
                <p className="mt-2 px-1 font-mono text-[10px] text-zinc-500" data-testid="run-connect-hint">
                  The guard runs without a wallet. Connect one first to continue to the signer step.
                </p>
              )}
            </div>

            {/* Browser Wallet Zero-Fee Testnet Guard */}
            <div className="rounded-3xl border border-white/10 bg-[#070708] p-5">
              <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" /> Browser Wallet Guard
                </span>
                <span className="text-emerald-300">0 Gas EIP-712</span>
              </div>
              <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
                Connect MetaMask / Rabby on RHC {chainId} to test <code className="text-zinc-300">guardEvmSigner</code>: wallet popup opens on <span className="text-emerald-300">allow</span>, and is blocked before popup on <span className="text-rose-300">deny</span>.
              </p>
              {!walletOnChain ? (
                <div
                  className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-amber-200"
                  data-testid="signer-connect-hint"
                >
                  {walletAddr
                    ? `Wallet is on chain ${wallet.walletChainId ?? '?'}: switch to RHC ${chainId} in the Wallet card above first.`
                    : 'Connect your wallet first (Wallet card above or the navbar). Signing buttons appear once connected.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={walletBusy}
                    onClick={() => handleGuardedWalletSign(false)}
                    className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-200 transition hover:border-emerald-300"
                  >
                    Sign Valid (Allow)
                  </button>
                  <button
                    type="button"
                    disabled={walletBusy}
                    onClick={() => handleGuardedWalletSign(true)}
                    className="rounded-xl border border-rose-400/40 bg-rose-400/10 px-2.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-rose-200 transition hover:border-rose-300"
                  >
                    Tamper payTo (Block)
                  </button>
                </div>
              )}
              {walletStatus && (
                <div className="mt-2.5 break-words rounded-xl border border-white/10 bg-black p-2.5 font-mono text-[10px] text-zinc-300">
                  {walletStatus}
                </div>
              )}
            </div>

            {/* I9 #17: real USDG top-up (x402 deposit mode) */}
            <BuyCreditCard chainId={chainId} />

            <div className="min-h-[150px] rounded-3xl border border-white/10 bg-black p-4 font-mono text-[11px] leading-[1.75]">
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
                  awaiting invocation on eip155:{chainId}<span className="animate-caret"> ▌</span>
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
                    key={sc.id + activeView.hash + chainId}
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
                      <span>ttl 120s · chain {chainId}</span>
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
                <span>{apiMode === 'live' ? `live RHC ${chainId} schema v1` : 'fixture schema v1'}</span>
              </div>
              {phase === 'done' ? (
                <motion.pre
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="max-h-[380px] overflow-auto p-5 font-mono text-[11px] leading-[1.7]"
                >
                  {JSON.stringify(liveJson ?? fallbackResponseOf(sc, chainId), null, 2)
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
