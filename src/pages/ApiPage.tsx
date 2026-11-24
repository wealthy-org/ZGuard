import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, KeyRound, Server } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { EASE, Reveal } from '../components/Reveal';
import { FlowConnector } from '../components/Illustrations';
import { SpotlightCard } from '../components/SpotlightCard';
import type { Navigate } from '../types';

const ENDPOINTS: { method: 'GET' | 'POST'; path: string; auth: string; price: string }[] = [
  { method: 'GET', path: '/v1/token/{chainId}/{address}', auth: 'none', price: 'free' },
  { method: 'POST', path: '/v1/register', auth: 'none', price: 'free · credits via X-PAYMENT' },
  { method: 'POST', path: '/v1/verify', auth: 'key · x402', price: '$0.003 [ASSUMPTION]' },
  { method: 'POST', path: '/v1/simulate', auth: 'key · x402', price: '$0.005 [ASSUMPTION]' },
  { method: 'POST', path: '/v1/token-risk', auth: 'key · x402', price: '$0.01 [ASSUMPTION]' },
  { method: 'POST', path: '/v1/check', auth: 'key · x402', price: '$0.005 [ASSUMPTION]' },
  { method: 'POST', path: '/v1/guard', auth: 'key · x402', price: '$0.015 bundled [ASSUMPTION]' },
  { method: 'GET', path: '/v1/balance', auth: 'key', price: 'free' },
  { method: 'GET', path: '/v1/attestation/{decisionId}', auth: 'key', price: '[VERIFY]' },
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
  ts: `import { guard } from "@zguard/sdk"; // Apache-2.0 [ASSUMPTION]

const r = await guard({
  network: "eip155:4663",
  quote,                 // from the 402 channel, never the model
  payload: { type: "eip3009", authorization },
  checks: ["quote", "simulation", "token_risk"],
});

if (r.decision !== "allow") throw new GuardBlocked(r.codes);
// allow is hash-bound · expires_at ≈ +120s`,
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
  ['Verdict TTL', '120 seconds', 'ASSUMPTION'],
  ['Required checks on /v1/guard', 'quote, simulation, token_risk', 'ASSUMPTION'],
  ['Revenue use', '100% of net API revenue to buyback and burn after token launch', 'ASSUMPTION'],
  ['Signer on abstain', 'refuse · override only via explicit config', 'fixed'],
  ['EIP-712 domains', 'only those read from installed contracts', 'required'],
  ['Stock Token list', 'official registry, refreshed, not a static file', 'required'],
  ['Simulation method', 'pinned after v4 hook and curve tests', 'VERIFY'],
  ['zk system', 'Groth16 BN254 (required) · Halo2-KZG (target)', 'ASSUMPTION'],
];

function X402Flow() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setActive((v) => (v + 1) % X402_STEPS.length), 1300);
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

      <section className="relative border-t border-white/10 py-24">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <Reveal className="lg:col-span-7">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
              <div className="flex gap-1 border-b border-white/10 bg-[#070708] p-2">
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
              <div className="my-8 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                {[
                  { t: 'Hosted API revenue', d: 'USDG on RHC' },
                  { t: 'Buyback', d: '$ZGUARD [ASSUMPTION]' },
                  { t: 'Burn', d: '0x…dEaD' },
                ].map((n, i) => (
                  <div key={n.t} className="flex flex-1 flex-col items-stretch sm:flex-row sm:items-center">
                    <div className="flex-1 rounded-2xl border border-white/15 bg-black p-4">
                      <div className="font-display text-sm text-white">{n.t}</div>
                      <div className="mt-1 font-mono text-[10px] text-zinc-500">{n.d}</div>
                    </div>
                    {i < 2 && <FlowConnector delay={i * 0.6} vertical />}
                    {i < 2 && <span className="hidden sm:block"><FlowConnector delay={i * 0.6} /></span>}
                  </div>
                ))}
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-zinc-600">
                The ticker, supply and fee split are not locked. Local tooling never requires holding the token. Burn address: 0x000000000000000000000000000000000000dEaD.
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
              <div className="mt-1 font-mono text-[11px] text-zinc-500">Fixtures replay the brief's acceptance tests</div>
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
