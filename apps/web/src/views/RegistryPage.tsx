import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Circle, Loader2, Minus } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE, Reveal } from '../components/Reveal';
import { fetchRegistryListing, postLiveTokenRisk } from '../lib/zguard-api';

type ActiveChain = 46630 | 4663;

// --- Robinhood Chain Testnet (46630) Verified Addresses ---
const TESTNET_USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const TESTNET_WETH = '0x33e4191705c386532ba27cBF171Db86919200B94';
const TESTNET_TSLA = '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E';
const TESTNET_AMZN = '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02';
const TESTNET_KOIP_CURVE = '0x9118BD806cB3906Dc6d50a4409a9e9dF48172365';
const TESTNET_PONSIDOOG_GRAD = '0x9c8CB5D0Bd313ebE5813aCfd8daa4E22DE76DFfd';
const TESTNET_MOCK_USDG = '0x8F9231B0F448bA9AD045348437458721676c23BC';

// --- Robinhood Chain Mainnet (4663) Verified Addresses ---
const MAINNET_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const MAINNET_WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
const MAINNET_AAPL = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9';
const MAINNET_PONS_CURVE = '0x05811bBAF648E5FE455d527342Cb4DD03Fa21214';
const MAINNET_PONS_GRAD = '0x3bA500F1AbabbCF0F0247D06D1c56Fd7E6C4c09D';
const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const PONS_FACTORY_V2 = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const PONS_FACTORY_V1 = '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB';
const PONS_MEME_HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';

function getPresets(chainId: ActiveChain) {
  if (chainId === 46630) {
    return [
      { label: 'USDG · canonical (46630)', addr: TESTNET_USDG },
      { label: 'TSLA · Stock Token', addr: TESTNET_TSLA },
      { label: 'AMZN · Stock Token', addr: TESTNET_AMZN },
      { label: 'KOIP · pons curve', addr: TESTNET_KOIP_CURVE },
      { label: 'PONSIDOOG · pons v4', addr: TESTNET_PONSIDOOG_GRAD },
      { label: 'Mock USDG · spoof (deny)', addr: TESTNET_MOCK_USDG },
      { label: 'WETH · canonical', addr: TESTNET_WETH },
    ];
  }
  return [
    { label: 'USDG · canonical (4663)', addr: MAINNET_USDG },
    { label: 'AAPL · Stock Token', addr: MAINNET_AAPL },
    { label: 'pons V2 curve', addr: MAINNET_PONS_CURVE },
    { label: 'pons graduated v4', addr: MAINNET_PONS_GRAD },
    { label: 'WETH · canonical', addr: MAINNET_WETH },
    { label: 'PoolManager (v4)', addr: POOL_MANAGER },
  ];
}

const STEPS = [
  { k: 'Canonical USDG address?', v: 'usdg' },
  { k: 'Official Stock Token registry?', v: 'stock_token (live)' },
  { k: 'Launched by a pons factory?', v: 'pons_curve' },
  { k: 'Graduated pool on Uniswap v4?', v: 'pons_graduated_v4' },
  { k: 'Otherwise', v: 'other · abstain or deny' },
];

interface Resolution {
  matched: number;
  kind: string;
  note: string;
  liveFacts?: [string, string][];
}

function resolveLocalFallback(raw: string, chainId: ActiveChain): Resolution {
  const a = raw.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(a)) return { matched: -1, kind: 'invalid', note: 'Not a 20-byte hex address.' };
  const usdg = (chainId === 46630 ? TESTNET_USDG : MAINNET_USDG).toLowerCase();
  const weth = (chainId === 46630 ? TESTNET_WETH : MAINNET_WETH).toLowerCase();
  if (a === usdg) return { matched: 0, kind: 'usdg', note: `Canonical USDG on RHC ${chainId}. Identity comes strictly from the contract address.` };
  if (a === TESTNET_TSLA.toLowerCase() || a === TESTNET_AMZN.toLowerCase() || a === MAINNET_AAPL.toLowerCase()) {
    return { matched: 1, kind: 'stock_token', note: 'Verified in the Robinhood Stock Token registry (18 decimals, uiMultiplier).' };
  }
  if (a === TESTNET_KOIP_CURVE.toLowerCase() || a === MAINNET_PONS_CURVE.toLowerCase()) {
    return { matched: 2, kind: 'pons_curve', note: 'Active bonding-curve token launched via Pons factory.' };
  }
  if (a === TESTNET_PONSIDOOG_GRAD.toLowerCase() || a === MAINNET_PONS_GRAD.toLowerCase()) {
    return { matched: 3, kind: 'pons_graduated_v4', note: 'Graduated Pons token trading in a locked Uniswap v4 PoolManager pool.' };
  }
  if (a === weth) return { matched: 4, kind: 'other', note: 'Canonical WETH.' };
  return {
    matched: 4,
    kind: 'other',
    note: `Querying live Robinhood Chain (${chainId}) RPC, Blockscout holders, Stock Token registry, and Pons factories…`,
  };
}

function stepIndexForKind(kind: string): number {
  if (kind === 'usdg') return 0;
  if (kind === 'stock_token') return 1;
  if (kind === 'pons_curve') return 2;
  if (kind === 'pons_graduated_v4') return 3;
  return 4;
}

function Resolver({ chainId, setChainId }: { chainId: ActiveChain; setChainId: (c: ActiveChain) => void }) {
  const [input, setInput] = useState(TESTNET_USDG);
  const [loading, setLoading] = useState(false);
  const [liveRes, setLiveRes] = useState<Resolution | null>(null);
  const presets = getPresets(chainId);
  const localRes = useMemo(() => resolveLocalFallback(input, chainId), [input, chainId]);

  const handleChainChange = (next: ActiveChain) => {
    setChainId(next);
    setLiveRes(null);
    setInput(next === 46630 ? TESTNET_USDG : MAINNET_USDG);
  };

  useEffect(() => {
    const trimmed = input.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      setLiveRes(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    postLiveTokenRisk(trimmed, `eip155:${chainId}`)
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
        const holders = (tr.holders as Record<string, unknown> | undefined) ?? {};
        const codes = Array.isArray(tr.codes) ? (tr.codes as string[]) : [];

        const facts: [string, string][] = [
          ['decision', String(tr.decision ?? 'abstain')],
          ['token', sym],
          ['venue', String(liq.venue ?? 'unknown')],
        ];
        if (holders.count !== null && holders.count !== undefined) {
          facts.push([
            'holders · top10',
            `${String(holders.count)} holders · ${String(holders.top10Bps ?? 'n/a')} bps`,
          ]);
        }
        if (oracle.priceUsd) {
          facts.push(['oracle price', `$${String(oracle.priceUsd)}`]);
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
          note: `Live RHC ${chainId} verdict: ${String(tr.decision)} · venue=${String(liq.venue ?? 'unknown')}${
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
  }, [input, chainId]);

  const res = liveRes ?? localRes;

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="space-y-5 rounded-3xl border border-white/10 bg-[#070708] p-6 lg:col-span-5">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          <label>Token address · chain {chainId}</label>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
        </div>

        <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/10 bg-black p-1">
          <button
            type="button"
            onClick={() => handleChainChange(46630)}
            className={`whitespace-nowrap rounded-xl px-1 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition sm:tracking-[0.14em] ${
              chainId === 46630 ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Testnet · 46630
          </button>
          <button
            type="button"
            onClick={() => handleChainChange(4663)}
            className={`whitespace-nowrap rounded-xl px-1 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition sm:tracking-[0.14em] ${
              chainId === 4663 ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Mainnet · 4663
          </button>
        </div>

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          className="w-full rounded-2xl border border-white/15 bg-black px-4 py-3.5 font-mono text-[12px] text-white outline-none transition focus:border-white/50"
        />
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
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
          Identity is the address, never the ticker. Spoofed symbols like Mock USDG (0x8F92…23BC) on Testnet 46630 are caught immediately.
        </p>
      </div>

      <div className="space-y-3 lg:col-span-7">
        {STEPS.map((s, i) => {
          const evaluated = res.matched >= 0 && i <= res.matched;
          const hit = res.matched === i;
          return (
            <motion.div
              key={`${input}-${chainId}-${i}`}
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
            key={res.kind + input + chainId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="mt-4 rounded-2xl border border-white/25 bg-white/[0.04] p-5"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">resolved kind · POST /v1/token-risk (eip155:{chainId})</div>
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
            key={`${label}-${value}`}
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
  const [chainId, setChainId] = useState<ActiveChain>(46630);
  const [liveStocks, setLiveStocks] = useState<Array<{ symbol: string; name: string; address: string }>>([]);

  useEffect(() => {
    fetchRegistryListing(chainId)
      .then((res) => {
        if (res && Array.isArray(res.stockTokens)) {
          setLiveStocks(res.stockTokens.slice(0, 6));
        }
      })
      .catch(() => undefined);
  }, [chainId]);

  return (
    <div className="relative">
      <PageHeader
        kicker={`RHC registry · chain ${chainId} ${chainId === 46630 ? 'Testnet' : 'Mainnet'}`}
        lines={['Identity by address.', { text: 'Never by ticker.', muted: true }]}
        desc="Canonical assets, official Robinhood Stock Tokens, Pons bonding-curve stacks, and Uniswap v4 references verified on both Robinhood Chain Testnet (46630) and Mainnet (4663)."
      />

      <section className="relative pb-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="mb-8 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">
              01 — Live token kind & Blockscout holder resolver (chain {chainId})
            </div>
          </Reveal>
          <Resolver chainId={chainId} setChainId={setChainId} />
        </div>
      </section>

      <section className="relative border-t border-white/10 py-24">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <Reveal>
            <DataTable
              title={`02 — Canonical assets (${chainId === 46630 ? 'Testnet 46630' : 'Mainnet 4663'})`}
              rows={
                chainId === 46630
                  ? [
                      ['USDG (Global Dollar)', TESTNET_USDG, '6 dp · EIP-3009'],
                      ['WETH', TESTNET_WETH, '18 dp'],
                      ['USDC (Testnet)', '0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F', '6 dp'],
                      ['Mock USDG (Spoofed Faucet)', TESTNET_MOCK_USDG, 'denied · T-MINT'],
                    ]
                  : [
                      ['WETH', MAINNET_WETH, '18 dp'],
                      ['USDG', MAINNET_USDG, '6 dp · EIP-3009'],
                      ['USDG supply control (Paxos)', '0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4', 'not the token'],
                      ['Stock Tokens (e.g. AAPL)', MAINNET_AAPL, 'live registry · 18 dp'],
                    ]
              }
            />
          </Reveal>
          <Reveal delay={0.1}>
            <DataTable
              title={`03 — Verified Official Stock Tokens (${chainId})`}
              rows={
                liveStocks.length > 0
                  ? liveStocks.map((s) => [`${s.symbol} · ${s.name}`, s.address, '18 dp · oracle'])
                  : [
                      ['TSLA · Tesla', TESTNET_TSLA, '18 dp'],
                      ['AMZN · Amazon', TESTNET_AMZN, '18 dp'],
                      ['AMD · Advanced Micro Devices', '0x71178BAc73cBeb415514eB542a8995b82669778d', '18 dp'],
                      ['PLTR · Palantir', '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0', '18 dp'],
                      ['NFLX · Netflix', '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93', '18 dp'],
                    ]
              }
            />
          </Reveal>
          <Reveal>
            <DataTable
              title={`04 — Pons stack (${chainId === 46630 ? 'Testnet 46630' : 'Mainnet V2'})`}
              rows={
                chainId === 46630
                  ? [
                      ['Pons Testnet Factory A', '0xB5B7A2f6c4EAFa2D73918fcA32d50e2126339eb9', 'verified'],
                      ['Pons Testnet Factory B', '0xD8c7dC435Eced48E279FD8138DeC1E9b55DB0563', 'verified'],
                      ['Pons CurveDeployer', '0x2975AF1F342CE4f522a7ba452253931811Cd0c5d', 'deployer'],
                      ['KOIP (active curve)', TESTNET_KOIP_CURVE, 'pons_curve'],
                      ['PONSIDOOG (graduated)', TESTNET_PONSIDOOG_GRAD, 'pons_graduated_v4'],
                    ]
                  : [
                      ['Factory V2', PONS_FACTORY_V2, 'current'],
                      ['Factory V1 (legacy)', PONS_FACTORY_V1, 'legacy'],
                      ['Buyback vault', '0x42df2a798f82289E177311362e8f5ccC45c1219c'],
                      ['Launch locker', '0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952'],
                      ['Graduation executor', '0xC7819B64A1dAECD7eC19856d026cb14EfBd89046'],
                    ]
              }
            />
          </Reveal>
          <Reveal delay={0.1}>
            <DataTable
              title="05 — Uniswap v4 & Oracles"
              rows={[
                ['PoolManager (singleton 46630 & 4663)', POOL_MANAGER, 'Uniswap v4'],
                ['pons V2 meme hook (Mainnet)', PONS_MEME_HOOK, 'graduated pools'],
                ['Robinhood Live Price API', 'https://api.robinhood.com/rhj/prices/{SYM}', 'tokenBid/Ask'],
                ['Testnet Blockscout v2 API', 'https://explorer.testnet.chain.robinhood.com/api/v2', 'holders'],
              ]}
            />
          </Reveal>
        </div>
      </section>
    </div>
  );
}
