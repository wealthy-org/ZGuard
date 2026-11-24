import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Copy, Check, KeyRound, RefreshCw, Server } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE, Reveal } from '../components/Reveal';
import { FlowConnector } from '../components/Illustrations';
import { SpotlightCard } from '../components/SpotlightCard';
import type { Navigate } from '../types';
import {
  fetchTenantReceipts,
  getSavedApiKey,
  registerTenantKey,
  type StoredReceiptItem,
  type TenantBalanceInfo,
} from '../lib/zguard-api';

const ENDPOINTS: { method: 'GET' | 'POST'; path: string; auth: string; price: string }[] = [
  { method: 'GET', path: '/v1/token/{chainId}/{address}', auth: 'none', price: 'free (404 = unobserved)' },
  { method: 'POST', path: '/v1/register', auth: 'none', price: 'free · credits via X-PAYMENT' },
  { method: 'POST', path: '/v1/verify', auth: 'key · x402', price: '$0.003 (3,000 micro-USDG)' },
  { method: 'POST', path: '/v1/simulate', auth: 'key · x402', price: '$0.005 (5,000 micro-USDG)' },
  { method: 'POST', path: '/v1/token-risk', auth: 'key · x402', price: '$0.010 (10,000 micro-USDG)' },
  { method: 'POST', path: '/v1/check', auth: 'key · x402', price: '$0.005 (5,000 micro-USDG)' },
  { method: 'POST', path: '/v1/guard', auth: 'key · x402', price: '$0.015 (15,000 micro-USDG)' },
  { method: 'GET', path: '/v1/balance', auth: 'key', price: 'free' },
  { method: 'GET', path: '/v1/receipts', auth: 'key', price: 'free' },
  { method: 'GET', path: '/v1/attestation/{decisionId}', auth: 'none / key', price: 'free' },
];

const X402_STEPS = [
  'Agent calls /v1/guard with no credit left',
  'API answers HTTP 402 with a payable quote',
  'Quote is paid in USDG on eip155:4663',
  'Credit applied · request replayed',
  'HTTP 200 · decision + payload_hash + expires_at',
];

const CODE: Record<'curl' | 'ts' | 'mcp', string> = {
  curl: `curl -s $ZGUARD_API/v1/guard \\
  -H "Authorization: Bearer zg_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "network": "eip155:4663",
    "quote": { "asset": "0x5fc5…d168",
               "payTo": "<from quote>",
               "amount": "1000000" },
    "payload": { "type": "eip3009", "authorization": { … } },
    "checks": ["quote", "simulation", "token_risk"]
  }'`,
  ts: `import { ZGuardClient, guardEvmSigner } from "@zguard/sdk";

const client = new ZGuardClient({
  baseUrl: process.env.ZGUARD_API_URL,
  apiKey: process.env.ZGUARD_API_KEY,
});

const safeWallet = guardEvmSigner(walletClient, {
  guardFn: (req) => client.guard(req),
});
// Blocks signing on deny or abstain; verifies payload_hash + TTL on allow`,
  mcp: `{
  "mcpServers": {
    "zguard": {
      "command": "npx",
      "args": ["-y", "@zguard/mcp"],
      "env": { "ZGUARD_API_KEY": "zg_live_…" }
    }
  }
}

// tools: guard_payment · guard_transaction · check_token
//        check_before_use · guard_bundle`,
};

const CONFIG: [string, string, string][] = [
  ['Payment rail', 'USDG on eip155:4663 required · USDC Base / Solana optional', 'decision'],
  ['Storage engine', 'Neon Serverless Postgres (@neondatabase/serverless + Drizzle)', 'active'],
  ['Verdict TTL', '120 seconds (ZGUARD_ALLOW_TTL_SECONDS)', 'open config'],
  ['Required checks on /v1/guard', 'quote, simulation, token_risk', 'open config'],
  ['Revenue use', '100% of net API revenue to buyback and burn after token launch', 'open config'],
  ['Signer on abstain', 'refuse · override only via explicit config', 'fixed'],
  ['EIP-712 domains', 'only those read from installed contracts (USDG verified on 4663)', 'required'],
  ['Stock Token list', 'official Robinhood registry, refreshed live, never ticker-based', 'required'],
  ['Simulation method', 'eth_simulateV1 active on RHC 4663 (+ debug_traceCall fallback)', 'verified'],
  ['zk system', 'Groth16 BN254 (SP1) + Halo2-KZG · precompiles 0x06/0x07/0x08 active', 'verified'],
];

function X402Flow() {
  const [active, setActive] = useState<number>(0);
  useEffect(() => {
    const t = window.setInterval(() => setActive((v: number) => (v + 1) % X402_STEPS.length), 1300);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="space-y-3">
      {X402_STEPS.map((s, i) => {
        const on = i === active;
        return (
          <motion.div
            key={s}
            animate={{ x: on ? 8 : 0, opacity: on ? 1 : 0.45 }}
            transition={{ duration: 0.4, ease: EASE }}
            className={`flex items-center gap-4 rounded-2xl border px-5 py-3.5 ${on ? 'border-white/50 bg-white/[0.06]' : 'border-white/10 bg-black'}`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] ${on ? 'bg-white text-black' : 'border border-white/20 text-zinc-500'}`}>
              {i + 1}
            </span>
            <span className="text-[13px] text-zinc-200">{s}</span>
            {on && <ArrowRight className="ml-auto h-4 w-4 text-white" />}
          </motion.div>
        );
      })}
    </div>
  );
}

function LiveTenantPanel() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantBalanceInfo | null>(null);
  const [receipts, setReceipts] = useState<StoredReceiptItem[]>([]);
  const [revenue, setRevenue] = useState<{ totalChargedMicroUsdg: string; totalBuybackMicroUsdg: string; receiptCount: number }>({
    totalChargedMicroUsdg: '0',
    totalBuybackMicroUsdg: '0',
    receiptCount: 0,
  });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async (key: string | null) => {
    try {
      const res = await fetchTenantReceipts(key);
      setTenant(res.tenant);
      setReceipts(res.receipts);
      setRevenue(res.revenue);
    } catch {
      // Ignore when offline
    }
  }, []);

  useEffect(() => {
    const saved = getSavedApiKey();
    setApiKey(saved);
    void loadData(saved);
  }, [loadData]);

  const handleRegister = async () => {
    setBusy(true);
    try {
      const created = await registerTenantKey();
      setApiKey(created.apiKey);
      await loadData(created.apiKey);
    } catch {
      // Ignore
    } finally {
      setBusy(false);
    }
  };

  const copyKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[#070708] p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
            Live Tenant & Receipt Ledger · /v1/register · /v1/balance · /v1/receipts
          </div>
          <h3 className="mt-2 font-display text-2xl text-white">
            API Key, USDG Credit & Decision Receipts
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData(apiKey)}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-300 transition hover:border-white/40 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button
            type="button"
            onClick={handleRegister}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-black transition hover:opacity-90"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {apiKey ? 'New Tenant Key' : 'POST /v1/register'}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-black p-4 sm:col-span-2">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">Active API key</div>
          <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[11px] text-zinc-200">
            <span className="truncate">{apiKey ?? 'No key provisioned yet — click POST /v1/register'}</span>
            {apiKey && (
              <button type="button" onClick={copyKey} className="shrink-0 text-zinc-400 hover:text-white">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">Tenant Credit (USDG)</div>
          <div className="mt-2 font-mono text-lg text-white">
            {tenant ? `${Number(tenant.creditMicroUsdg).toLocaleString()} µUSDG` : '—'}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black p-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">Buyback Ledger</div>
          <div className="mt-2 font-mono text-lg text-white">
            {Number(revenue.totalBuybackMicroUsdg).toLocaleString()} µUSDG
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-black">
        <table className="w-full min-w-[640px] text-left font-mono text-[11px]">
          <thead>
            <tr className="border-b border-white/10 text-[9px] uppercase tracking-[0.18em] text-zinc-600">
              <th className="px-4 py-3 font-medium">Decision ID</th>
              <th className="px-3 py-3 font-medium">Endpoint</th>
              <th className="px-3 py-3 font-medium">Verdict</th>
              <th className="px-3 py-3 font-medium">Codes</th>
              <th className="px-3 py-3 font-medium">Payload Hash</th>
              <th className="px-4 py-3 text-right font-medium">Charged</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                  No receipts recorded yet. Trigger a call in Guard Console or ZK Layer to stream live receipts here.
                </td>
              </tr>
            ) : (
              receipts.slice(0, 8).map((r) => (
                <tr key={r.decisionId} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-zinc-300">{r.decisionId}</td>
                  <td className="px-3 py-3 text-zinc-400">{r.endpoint}</td>
                  <td className="px-3 py-3">
                    <span
                      className={
                        r.decision === 'allow'
                          ? 'text-emerald-300'
                          : r.decision === 'deny'
                            ? 'text-rose-300'
                            : 'text-amber-300'
                      }
                    >
                      {r.decision}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-zinc-400">{r.codes.length ? r.codes.join(', ') : '—'}</td>
                  <td className="px-3 py-3 text-zinc-500">
                    {r.payloadHash.slice(0, 8)}…{r.payloadHash.slice(-6)}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300">{r.chargedMicroUsdg} µUSDG</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ApiPage({ navigate }: { navigate: Navigate }) {
  const [tab, setTab] = useState<'curl' | 'ts' | 'mcp'>('curl');
  const tabs: ['curl' | 'ts' | 'mcp', string][] = [
    ['curl', 'cURL'],
    ['ts', 'TypeScript SDK'],
    ['mcp', 'MCP config'],
  ];

  return (
    <div className="relative">
      <PageHeader
        kicker="API & pricing · x402"
        lines={['Pay per call.', { text: 'In USDG, on RHC.', muted: true }]}
        desc="No subscription and no minimum. When credit runs dry, HTTP 402 returns a payable quote. Local quote-match stays free, offline and key-less."
      />

      <section className="relative pb-24">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <Reveal className="lg:col-span-7">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#070708]">
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Endpoints · v1</span>
                <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                  <Server className="h-3 w-3" /> hosted + local SDK
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-white/10 text-[9px] uppercase tracking-[0.18em] text-zinc-600">
                      <th className="px-6 py-3 font-medium">Method</th>
                      <th className="px-3 py-3 font-medium">Path</th>
                      <th className="px-3 py-3 font-medium">Auth</th>
                      <th className="px-6 py-3 font-medium">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ENDPOINTS.map((e, i) => (
                      <motion.tr
                        key={e.path}
                        initial={{ opacity: 0, x: -8 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.04 }}
                        className="border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]"
                      >
                        <td className="px-6 py-3">
                          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${e.method === 'GET' ? 'bg-white/10 text-zinc-200' : 'bg-white text-black'}`}>{e.method}</span>
                        </td>
                        <td className="px-3 py-3 text-zinc-200">{e.path}</td>
                        <td className="px-3 py-3 text-zinc-500">{e.auth}</td>
                        <td className="px-6 py-3 text-zinc-300">{e.price}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1} className="lg:col-span-5">
            <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-[#070708] p-6">
              <div className="mb-5 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">x402 billing loop</div>
              <X402Flow />
              <div className="mt-6 flex items-center gap-2 font-mono text-[10px] text-zinc-600">
                <KeyRound className="h-3 w-3" /> Register via POST /v1/register → key zg_…
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* §8.1 Simple Receipt & Tenant Balance Dashboard */}
      <section className="relative border-t border-white/10 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <LiveTenantPanel />
          </Reveal>
        </div>
      </section>

      <section className="relative border-t border-white/10 py-24">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <Reveal className="lg:col-span-7">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
              <div className="flex gap-1 overflow-x-auto border-b border-white/10 bg-[#070708] p-2">
                {tabs.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition ${tab === id ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <motion.pre
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="overflow-x-auto whitespace-pre p-6 font-mono text-[11px] leading-[1.75] text-zinc-300"
              >
                {CODE[tab]}
              </motion.pre>
            </div>
          </Reveal>

          <Reveal delay={0.1} className="lg:col-span-5">
            <div className="flex h-full flex-col justify-between rounded-3xl border border-white/10 bg-[#070708] p-6">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">Revenue loop · proposed</div>
                <h3 className="mt-4 font-display text-2xl leading-tight text-white">Net API revenue flows to buyback and burn.</h3>
              </div>
              <div className="my-8 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-stretch xl:flex-row xl:items-center">
                {[
                  { t: 'Hosted API revenue', d: 'USDG on RHC' },
                  { t: 'Buyback', d: '$ZGUARD (open config)' },
                  { t: 'Burn', d: '0x…dEaD' },
                ].map((n, i) => (
                  <div key={n.t} className="flex min-w-0 flex-1 flex-col items-stretch sm:flex-row sm:items-center lg:flex-col lg:items-stretch xl:flex-row xl:items-center">
                    <div className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-black p-4">
                      <div className="font-display text-sm text-white">{n.t}</div>
                      <div className="mt-1 font-mono text-[10px] text-zinc-500">{n.d}</div>
                    </div>
                    {i < 2 && <span className="sm:hidden lg:block xl:hidden"><FlowConnector delay={i * 0.6} vertical /></span>}
                    {i < 2 && <span className="hidden sm:block lg:hidden xl:block xl:[&>div]:!w-8"><FlowConnector delay={i * 0.6} /></span>}
                  </div>
                ))}
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-zinc-600">
                The ticker, supply and fee split stay configurable via env. Local tooling never requires holding the token. Burn address: 0x000000000000000000000000000000000000dEaD.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative border-t border-white/10 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="mb-8 font-mono text-[11px] uppercase tracking-[0.28em] text-zinc-500">Open config</div>
          </Reveal>
          <SpotlightCard className="p-0">
            <div className="divide-y divide-white/5">
              {CONFIG.map(([k, v, tag], i) => (
                <motion.div
                  key={k}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="grid gap-2 px-6 py-4 md:grid-cols-12 md:items-center md:gap-4"
                >
                  <span className="text-[13px] text-zinc-300 md:col-span-4">{k}</span>
                  <span className="text-[12px] text-zinc-500 md:col-span-6">{v}</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-400 md:col-span-2 md:text-right">{tag}</span>
                </motion.div>
              ))}
            </div>
          </SpotlightCard>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8">
            <div>
              <div className="font-display text-2xl text-white">Try a guard call in the browser.</div>
              <div className="mt-1 font-mono text-[11px] text-zinc-500">Scenarios execute live against Robinhood Chain (4663)</div>
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
