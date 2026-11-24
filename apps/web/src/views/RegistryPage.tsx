import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Circle, Loader2, Minus } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE, Reveal } from '../components/Reveal';
import { postLiveTokenRisk } from '../lib/zguard-api';

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const AAPL = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9';
const PONS_CURVE_TOKEN = '0x05811bBAF648E5FE455d527342Cb4DD03Fa21214';
const PONS_GRADUATED_TOKEN = '0x3bA500F1AbabbCF0F0247D06D1c56Fd7E6C4c09D';
const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const PONS_FACTORY_V2 = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const PONS_FACTORY_V1 = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
const PONS_MEME_HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';

const PRESETS = [
  { label: 'USDG · canonical', addr: USDG },
  { label: 'AAPL · Stock Token', addr: AAPL },
  { label: 'pons V2 curve', addr: PONS_CURVE_TOKEN },
  { label: 'pons graduated v4', addr: PONS_GRADUATED_TOKEN },
  { label: 'WETH · other', addr: WETH },
  { label: 'PoolManager (v4)', addr: POOL_MANAGER },
];

const STEPS = [
  { k: 'Canonical USDG address?', v: 'usdg' },
  { k: 'Official Stock Token registry?', v: 'stock_token (live)' },
  { k: 'Launched by a pons factory (V2 or V1)?', v: 'pons_curve' },
  { k: 'Graduated pool with pons meme hook?', v: 'pons_graduated_v4' },
  { k: 'Otherwise', v: 'other · abstain or flag' },
];

interface Resolution {
  matched: number; // index into STEPS, -1 = invalid
  kind: string;
  note: string;
  liveFacts?: [string, string][];
}

function resolveLocalFallback(raw: string): Resolution {
  const a = raw.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(a)) return { matched: -1, kind: 'invalid', note: 'Not a 20-byte hex address.' };
  if (a === USDG.toLowerCase()) return { matched: 0, kind: 'usdg', note: 'Canonical USDG. Identity comes from the address, per Paxos and Robinhood docs.' };
  if (a === AAPL.toLowerCase()) return { matched: 1, kind: 'stock_token', note: 'Verified in the live Robinhood Stock Token registry (ERC-8056 scaled UI).' };
  if (a === PONS_CURVE_TOKEN.toLowerCase()) return { matched: 2, kind: 'pons_curve', note: 'Active bonding-curve token launched via PonsFactoryV2 (phase 0).' };
  if (a === PONS_GRADUATED_TOKEN.toLowerCase()) return { matched: 3, kind: 'pons_graduated_v4', note: 'Graduated Pons V2 token trading in a permanently locked Uniswap v4 pool with meme hook.' };
  if (a === WETH.toLowerCase()) return { matched: 4, kind: 'other', note: 'Canonical WETH. Not a Stock Token and not a pons token.' };
  if ([POOL_MANAGER, PONS_FACTORY_V2, PONS_FACTORY_V1, PONS_MEME_HOOK].map((x) => x.toLowerCase()).includes(a)) {
    return { matched: 4, kind: 'other', note: 'Protocol contract, not a token. token_risk abstains (T-UNKNOWN).' };
  }
  return {
    matched: 4,
    kind: 'other',
    note: 'Querying live Robinhood Chain (4663) RPC, Stock Token registry, and Pons V1/V2 factories…',
  };
}

function stepIndexForKind(kind: string): number {
  if (kind === 'usdg') return 0;
  if (kind === 'stock_token') return 1;
  if (kind === 'pons_curve') return 2;
  if (kind === 'pons_graduated_v4') return 3;
  return 4;
}

function Resolver() {
  const [input, setInput] = useState(USDG);
  const [loading, setLoading] = useState(false);
  const [liveRes, setLiveRes] = useState<Resolution | null>(null);
  const localRes = useMemo(() => resolveLocalFallback(input), [input]);

  useEffect(() => {
    const trimmed = input.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      setLiveRes(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    postLiveTokenRisk(trimmed)
      .then(({ status, data }) => {
        if (cancelled || status !== 200) return;
        const tr = (data.token_risk ?? (data.checks as Record<string, unknown> | undefined)?.token_risk) as
          | Record<string, unknown>
          | undefined;
        if (!tr) return;
        const kind = String(tr.kind ?? 'other');
        const sym = tr.symbol ? `${String(tr.symbol)} (${String(tr.name ?? '')})` : 'unlisted';
        const liq = (tr.liquidity as Record<string, unknown> | undefined) ?? {};
        const tax = (tr.tax as Record<string, unknown> | undefined) ?? {};
        const oracle = (tr.oracle as Record<string, unknown> | undefined) ?? {};
        const codes = Array.isArray(tr.codes) ? (tr.codes as string[]) : [];

        const facts: [string, string][] = [
          ['decision', String(tr.decision ?? 'abstain')],
          ['token', sym],
          ['venue', String(liq.venue ?? 'unknown')],
        ];
        if (oracle.priceUsd) {
          facts.push(['chainlink price', `$${String(oracle.priceUsd)}`]);
        }
        if (oracle.uiMultiplier) {
          facts.push(['uiMultiplier (18dp)', String(oracle.uiMultiplier)]);
        }
        if (tax.buyBps !== null && tax.buyBps !== undefined) {
          facts.push(['buy / sell bps', `${String(tax.buyBps)} / ${String(tax.sellBps)} bps`]);
        }
        if (codes.length > 0) {
          facts.push(['codes', codes.join(', ')]);
        }

        setLiveRes({
          matched: stepIndexForKind(kind),
          kind,
          note: `Live RHC 4663 verdict: ${String(tr.decision)} · venue=${String(liq.venue ?? 'unknown')}${
            codes.length ? ` · codes=[${codes.join(', ')}]` : ''
          }`,
          liveFacts: facts,
        });
      })
      .catch(() => {
        if (!cancelled) setLiveRes(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [input]);

  const res = liveRes ?? localRes;

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-5 rounded-3xl border border-white/10 bg-[#070708] p-6 lg:col-span-5">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          <label>Token address · chain 4663</label>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
        </div>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3.5 font-mono text-[12px] text-white outline-none transition focus:border-white/50"
        />
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setInput(p.addr)}
              className={`rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
                input.toLowerCase() === p.addr.toLowerCase() ? 'border-white bg-white text-black' : 'border-white/15 text-zinc-400 hover:border-white/40 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-zinc-600">
          Identity is the address, never the ticker. Two tokens with the same symbol at different addresses are different assets.
        </p>
      </div>

      <div className="space-y-3 lg:col-span-7">
        {STEPS.map((s, i) => {
          const evaluated = res.matched >= 0 && i <= res.matched;
          const hit = res.matched === i;
          return (
            <motion.div
              key={`${input}-${i}`}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: evaluated ? 1 : 0.35, x: 0 }}
              transition={{ delay: i * 0.08, duration: 0.45, ease: EASE }}
              className={`flex items-center gap-4 rounded-2xl border px-5 py-4 transition-colors duration-500 ${
                hit ? 'border-white/60 bg-white/[0.07]' : 'border-white/10 bg-black'
              }`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${hit ? 'border-white bg-white text-black' : 'border-white/20 text-zinc-500'}`}>
                {hit ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : evaluated ? <Minus className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
              </span>
              <span className="flex-1 text-[13px] text-zinc-300">{s.k}</span>
              <span className="font-mono text-[10px] text-zinc-500">{s.v}</span>
            </motion.div>
          );
        })}

        <AnimatePresence mode="wait">
          <motion.div
            key={res.kind + input}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="mt-4 rounded-2xl border border-white/25 bg-white/[0.04] p-5"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">resolved kind · POST /v1/token-risk</div>
            <div className="mt-2 font-display text-3xl text-white">{res.kind}</div>
            <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{res.note}</p>
            {res.liveFacts && (
              <dl className="mt-4 grid gap-2 border-t border-white/10 pt-4 font-mono text-[10px] sm:grid-cols-2">
                {res.liveFacts.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 rounded-lg border border-white/5 bg-black/50 px-3 py-1.5">
                    <dt className="uppercase text-zinc-600">{k}</dt>
                    <dd className="truncate text-zinc-200">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function DataTable({ title, rows }: { title: string; rows: [string, string, string?][] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#070708]">
      <div className="border-b border-white/10 px-6 py-4 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">{title}</div>
      <div className="divide-y divide-white/5">
        {rows.map(([label, value, note], i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05 }}
            className="grid gap-1 px-6 py-3.5 transition-colors hover:bg-white/[0.03] md:grid-cols-12 md:items-center md:gap-4"
          >
            <span className="text-[12px] text-zinc-300 md:col-span-4">{label}</span>
            <span className="break-all font-mono text-[11px] text-white md:col-span-6">{value}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600 md:col-span-2 md:text-right">{note ?? ''}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function RegistryPage() {
  return (
    <div className="relative">
      <PageHeader
        kicker="RHC registry · chain 4663"
        lines={['Identity by address.', { text: 'Never by ticker.', muted: true }]}
        desc="Canonical assets, pons contracts and Uniswap v4 references for Robinhood Chain. Every address below comes from the brief's sources and live onchain verification."
      />

      <section className="relative pb-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="mb-8 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">01 — Live token kind resolver (chain 4663)</div>
          </Reveal>
          <Resolver />
        </div>
      </section>

      <section className="relative border-t border-white/10 py-24">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <Reveal>
            <DataTable
              title="02 — Canonical assets"
              rows={[
                ['WETH', WETH, '18 dp'],
                ['USDG', USDG, '6 dp · EIP-3009'],
                ['USDG supply control (Paxos)', '0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4', 'not the token'],
                ['Stock Tokens (e.g. AAPL)', AAPL, 'live registry · 18 dp'],
              ]}
            />
          </Reveal>
          <Reveal delay={0.1}>
            <DataTable
              title="03 — Uniswap v4 & aggregator"
              rows={[
                ['PoolManager (chain singleton)', POOL_MANAGER, 'v4'],
                ['pons V2 meme hook', PONS_MEME_HOOK, 'graduated pools'],
                ['OpenHooks PonsCurveAggregator', '0xb091eC27074C7a0C1bA896C063cc677F89202888', 'unaudited'],
                ['Universal Router · Permit2 · Position Manager', 'open config', '[VERIFY]'],
              ]}
            />
          </Reveal>
          <Reveal>
            <DataTable
              title="04 — pons V2 stack"
              rows={[
                ['Factory', PONS_FACTORY_V2, 'current'],
                ['Fee escrow', '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e'],
                ['Buyback vault', '0x42df2a798f82289E177311362e8f5ccC45c1219c'],
                ['Launch locker', '0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952'],
                ['Launch & buy router', '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948'],
                ['Launch deployer', '0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42'],
                ['Graduation executor', '0xC7819B64A1dAECD7eC19856d026cb14EfBd89046'],
                ['Graduation guard', '0xf5695117b99B6f6401e67d4195BD653628176C6C'],
              ]}
            />
          </Reveal>
          <Reveal delay={0.1} className="space-y-6">
            <DataTable
              title="05 — pons V1 (no longer launching)"
              rows={[
                ['Factory', PONS_FACTORY_V1, 'legacy tokens'],
                ['Liquidity locker', '0x736D76699C26D0d966744cAe304C000d471f7F35', 'legacy'],
              ]}
            />
            <DataTable
              title="06 — Chainlink feeds (mainnet directory)"
              rows={[
                ['USDG / USD', '0x61B7e5650328764B076A108EFF5fa7282a1B9aD2', '8 dp · 86400 s'],
                ['ETH / USD', '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9', '8 dp · 86400 s'],
              ]}
            />
          </Reveal>
        </div>
        <div className="mx-auto mt-8 max-w-7xl px-4 font-mono text-[10px] leading-relaxed text-zinc-600 sm:px-6 lg:px-8">
          Pons docs: resolve the stack from the factory that launched the token, never assume the newest stack. Public launching is checked dynamically via canLaunch(address).
        </div>
      </section>
    </div>
  );
}
