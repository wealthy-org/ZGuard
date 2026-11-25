import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, BookOpen, Check } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Reveal } from '../components/Reveal';
import { SpotlightCard } from '../components/SpotlightCard';
import { scrollToEl } from '../lib/scroll';
import { X_URL } from '../types';

/* ------------------------------ building blocks ------------------------------ */

function CodeBlock({ title, code, className = '' }: { title: string; code: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-white/10 bg-black ${className}`}>
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0a0a0b] px-4 py-2.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">{title}</span>
        <span className="flex gap-1">
          <i className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
          <i className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
          <i className="h-1.5 w-1.5 rounded-full bg-white" />
        </span>
      </div>
      <pre className="overflow-x-auto whitespace-pre p-4 font-mono text-[11px] leading-[1.75] text-zinc-300">{code}</pre>
    </div>
  );
}

function Table({ head, rows, className = '' }: { head: string[]; rows: (string | number)[][]; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-2xl border border-white/10 bg-[#070708] ${className}`}>
      <table className="w-full min-w-[520px] text-left">
        <thead>
          <tr className="border-b border-white/10 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">
            {head.map((h) => (
              <th key={h} className="px-5 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-[11px]">
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/5 last:border-0 transition-colors hover:bg-white/[0.03]">
              {r.map((c, j) => (
                <td key={j} className={`px-5 py-3 align-top ${j === 0 ? 'whitespace-nowrap text-zinc-200' : 'text-zinc-400'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Note({ kind, children }: { kind: 'assume' | 'verify' | 'rule'; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    assume: 'border-amber-300/25 bg-amber-300/[0.06] text-amber-200/90',
    verify: 'border-sky-300/25 bg-sky-300/[0.06] text-sky-200/90',
    rule: 'border-white/15 bg-white/[0.04] text-zinc-300',
  };
  const labels: Record<string, string> = { assume: 'ASSUMPTION', verify: 'VERIFY', rule: 'RULE' };
  return (
    <div className={`rounded-xl border px-4 py-3 text-[12px] leading-relaxed ${styles[kind]}`}>
      <span className="mr-2 font-mono text-[9px] font-bold uppercase tracking-[0.2em]">{labels[kind]}</span>
      {children}
    </div>
  );
}

function Section({
  id,
  num,
  title,
  children,
}: {
  id: string;
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-white/10 py-12 first:border-t-0 first:pt-0">
      <Reveal>
        <div className="mb-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">
          <span>{num}</span>
          <span className="h-px w-6 bg-white/25" />
        </div>
        <h2 className="font-display text-3xl text-white sm:text-4xl">{title}</h2>
      </Reveal>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

const P = ({ children }: { children: React.ReactNode }) => <p className="max-w-3xl text-[14px] leading-relaxed text-zinc-400">{children}</p>;

/* ------------------------------ content ------------------------------ */

const SIDEBAR = [
  { id: 'overview', num: '01', title: 'Overview' },
  { id: 'quickstart', num: '02', title: 'Quick start' },
  { id: 'checks', num: '03', title: 'The three checks' },
  { id: 'decisions', num: '04', title: 'Decision engine' },
  { id: 'api', num: '05', title: 'API reference' },
  { id: 'signer', num: '06', title: 'Signer wrapper' },
  { id: 'rhc', num: '07', title: 'Robinhood Chain 4663' },
  { id: 'billing', num: '08', title: 'x402 billing' },
  { id: 'zk', num: '09', title: 'ZK attestation' },
  { id: 'config', num: '10', title: 'Open config' },
  { id: 'mvp', num: '11', title: 'MVP & success criteria' },
];

export function DocsPage() {
  const [active, setActive] = useState(SIDEBAR[0].id);
  const mainRef = useRef<HTMLDivElement>(null);
  // Examples use the origin this page is served from (the web proxies /v1/* to the API).
  const [apiBase, setApiBase] = useState('https://<your-zguard-host>');
  useEffect(() => {
    setApiBase(window.location.origin);
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: '-25% 0px -65% 0px' }
    );
    SIDEBAR.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (el) scrollToEl(el, 110);
  };

  return (
    <div className="relative">
      <PageHeader
        kicker="Documentation · dev brief reference"
        lines={['The full guard,', { text: 'on one page.', muted: true }]}
        desc="Everything ZGuard does, from the three checks to the zk layer, written as a reference. Unverified values are marked VERIFY, undecided values ASSUMPTION — nothing is silently filled in."
        aside={
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300 transition hover:border-white/50 hover:text-white"
          >
            @zguard_rhc on X <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        }
      />

      <div className="relative pb-28">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          {/* Sidebar */}
          <aside className="lg:col-span-3">
            <div className="lg:sticky lg:top-28">
              <div className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">
                <BookOpen className="h-3.5 w-3.5" />
                Contents
              </div>
              {/* mobile chips */}
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:hidden">
                {SIDEBAR.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => go(s.id)}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition ${
                      active === s.id ? 'border-white bg-white text-black' : 'border-white/15 text-zinc-400'
                    }`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
              {/* desktop list */}
              <nav className="hidden lg:block">
                {SIDEBAR.map((s) => {
                  const on = active === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => go(s.id)}
                      className="group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left"
                    >
                      {on && (
                        <motion.span
                          layoutId="docs-active"
                          className="absolute inset-0 rounded-lg border border-white/20 bg-white/[0.06]"
                          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                        />
                      )}
                      <span className={`relative font-mono text-[10px] ${on ? 'text-white' : 'text-zinc-600'}`}>{s.num}</span>
                      <span className={`relative text-[13px] transition-colors ${on ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                        {s.title}
                      </span>
                      {on && <span className="relative ml-auto h-1 w-1 rounded-full bg-white" />}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* Content */}
          <div ref={mainRef} className="lg:col-span-9">
            {/* 01 Overview */}
            <Section id="overview" num="01" title="Overview & positioning">
              <P>
                ZGuard is the scanner and guard layer for agents and terminals that transact on Robinhood Chain.
                Before an agent signs a payment or a swap, and before it trusts token metadata, one API call
                answers three questions: is this the quote that was received, what actually happens onchain,
                and what state is the token in.
              </P>
              <P>
                Positioning: <span className="text-white">“One check before an agent or terminal signs on Robinhood Chain:
                is this the same quote, what happens onchain, and what is the token’s condition.”</span> Not a launchpad,
                not a social network, not a trading venue. Output is a verdict —{' '}
                <code className="font-mono text-white">allow</code> / <code className="font-mono text-white">deny</code> /{' '}
                <code className="font-mono text-white">abstain</code> — plus per-check detail. Text findings are{' '}
                <code className="font-mono text-white">clean_by_rules</code> or <code className="font-mono text-white">findings</code>.
              </P>
              <Note kind="rule">
                ZGuard never claims “safe”. A 404 on a token lookup means “not observed”, not allow. Canonical asset
                identity is only the address in the official registry — never the ticker.
              </Note>
              <Table
                head={['Surface', 'Package / service', 'Function']}
                rows={[
                  ['SDK / CLI (local)', '@zguard/sdk · CLI', 'Offline quote-match core, API client, EVM signer wrapper. Apache-2.0 [ASSUMPTION]'],
                  ['MCP server', '@zguard/mcp', 'guard_payment · guard_transaction · check_token · check_before_use · guard_bundle'],
                  ['Hosted API', 'POST /v1/…', 'verify · simulate · token-risk · check · guard, paid per call via x402'],
                  ['Signer wrapper', 'guardEvmSigner', 'Refuses to sign unless a valid allow exists for the exact payload hash'],
                ]}
              />
            </Section>

            {/* 02 Quick start */}
            <Section id="quickstart" num="02" title="Quick start">
              <P>
                Testnet only (RHC 46630). <code className="font-mono text-white">@zguard/sdk</code> and{' '}
                <code className="font-mono text-white">@zguard/mcp</code> are not published to npm yet, so build them from the
                repo. Every example below was run as-is against this deployment.
              </P>
              <CodeBlock
                title="terminal · build from the repo"
                code={`git clone https://github.com/wealthy-org/ZGuard.git && cd ZGuard
corepack pnpm install
corepack pnpm --filter @zguard/sdk build && corepack pnpm --filter @zguard/mcp build

# in your own project (adjust the path)
pnpm add file:../ZGuard/packages/sdk`}
              />
              <CodeBlock
                title="curl · hosted API (testnet 46630)"
                code={`export ZGUARD_API=${apiBase}

# free testnet key (limited per IP per hour)
KEY=$(curl -s -X POST $ZGUARD_API/v1/register | sed -E 's/.*"apiKey":"([^"]+)".*/\\1/')

curl -s $ZGUARD_API/v1/guard \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"network":"eip155:46630",
       "quote":{"asset":"0x7E955252E15c84f5768B83c41a71F9eba181802F","payTo":"0x000000000000000000000000000000000000aaaa","amount":"0","chainId":46630},
       "payload":{"type":"eip3009","authorization":{
         "from":"0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79","to":"0x000000000000000000000000000000000000aaaa",
         "value":"0","validAfter":"0","validBefore":"4102444800",
         "nonce":"0x0000000000000000000000000000000000000000000000000000000000000001",
         "domain":{"name":"Global Dollar","version":"1","chainId":46630,"verifyingContract":"0x7E955252E15c84f5768B83c41a71F9eba181802F"}}},
       "checks":["quote","simulation","token_risk"]}'

# → {"decision":"allow", "payload_hash":"0x…", "expires_at":…}
# change "to" in the authorization → deny (payTo mismatch)
# no credit left → HTTP 402 with a payable USDG quote on eip155:46630`}
              />
              <CodeBlock
                title="sdk · example.mjs (node example.mjs)"
                code={`import { ZGuardClient } from "@zguard/sdk";

const zg = new ZGuardClient({ baseUrl: "${apiBase}" });
if (!process.env.ZGUARD_API_KEY) zg.setApiKey((await zg.register()).apiKey);

const usdg = "0x7E955252E15c84f5768B83c41a71F9eba181802F"; // USDG on 46630
const quote = { asset: usdg, payTo: "0x000000000000000000000000000000000000aaaa", amount: "0", chainId: 46630 };
const authorization = {
  from: "0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79", to: quote.payTo, value: "0",
  validAfter: "0", validBefore: "4102444800", nonce: "0x" + "00".repeat(31) + "01",
  domain: { name: "Global Dollar", version: "1", chainId: 46630, verifyingContract: usdg },
};

const r = await zg.guard({
  network: "eip155:46630",
  quote,                                  // from the HTTP 402 channel — never from the model
  payload: { type: "eip3009", authorization },
  checks: ["quote", "simulation", "token_risk"],
});
if (r.decision !== "allow") throw new Error(\`blocked: \${r.codes.join(", ")}\`);
// allow is bound to r.payload_hash and expires at r.expires_at (~120s).
// API unreachable → abstain S-FAIL (never allow); no credit → X402PaymentRequiredError with the quote.`}
              />
              <CodeBlock
                title="mcp · claude code / cursor"
                code={`{
  "mcpServers": {
    "zguard": {
      "command": "node",
      "args": ["/absolute/path/to/ZGuard/packages/mcp/dist/index.js"],
      "env": {
        "ZGUARD_API_URL": "${apiBase}",
        "ZGUARD_API_KEY": "zg_live_…",
        "ZGUARD_ACTIVE_CHAIN_ID": "46630"
      }
    }
  }
}`}
              />
              <Note kind="verify">
                Tools: guard_payment · guard_transaction · check_token · check_before_use · guard_bundle. The base URL is the
                origin of this page; self-hosted deployments use their own.
              </Note>
            </Section>

            {/* 03 Checks */}
            <Section id="checks" num="03" title="The three checks">
              <P>
                Each check returns its own verdict plus reason codes. On <code className="font-mono text-white">/v1/guard</code> all
                three are <span className="text-white">required</span> by default [ASSUMPTION].
              </P>
              <Table
                head={['Check', 'Question', 'Key rules']}
                rows={[
                  ['quote', 'Does the tx equal the quote / intent?', 'Compare payTo, asset, amount, chainId byte-for-byte. No quote on an x402 path → deny Q-005. Approvals/delegates outside intent → Q-006. Unverified EIP-712 domain → abstain Q-007. Undecodable bytes → abstain.'],
                  ['simulation', 'What happens on RHC 4663 right now?', 'Run against current state (fork / eth_call / debug_traceCall [VERIFY method]). Emit status, gasUsed, balanceChanges, approvals, call tree (v4 PoolManager and pons hooks named). Revert → S-REVERT. RPC failure → S-FAIL abstain, never allow.'],
                  ['token_risk', 'What is this token on chain 4663?', 'kind ∈ usdg | stock_token | pons_curve | pons_graduated_v4 | other, resolved by address + registry + launching factory. Report holders, LP, tax (incl. 5s snipe tax), mint/owner authorities, pons state. Mint open on “other” → T-MINT.'],
                ]}
              />
              <Note kind="rule">
                Token risk reports onchain facts plus configured rules. It never evaluates whether a token is a good
                investment, and text scans match shapes, not meaning — novel phrasing can pass, as with the reference class.
              </Note>
            </Section>

            {/* 04 Decision engine */}
            <Section id="decisions" num="04" title="Decision engine & aggregation">
              <P>Aggregation rules for the effective decision [ASSUMPTION until locked in config]:</P>
              <Table
                head={['Situation', 'Effective decision']}
                rows={[
                  ['any required check denies', 'deny'],
                  ['no deny, but a required check abstains', 'abstain'],
                  ['all required checks allow', 'allow (bound to payload hash, expires_at ≈ +120s [ASSUMPTION])'],
                  ['advisory check denies', 'flags[] only — does not downgrade allow'],
                ]}
              />
              <Note kind="rule">
                Fail-closed: storage failure or unreadable payload → abstain, never allow. Abstain is not permission.
                An allow binds the canonical hash of quote + tx/authorization + relevant token address; unknown fields are
                ignored and must not change the hash.
              </Note>
            </Section>

            {/* 05 API reference */}
            <Section id="api" num="05" title="API reference">
              <P>Versioned path <code className="font-mono text-white">/v1</code>. Auth is an API key (<code className="font-mono text-white">zg_…</code> [ASSUMPTION] prefix — deliberately not the reference’s prefix) or x402 payment.</P>
              <Table
                head={['Method', 'Path', 'Auth', 'Price [ASSUMPTION]']}
                rows={[
                  ['GET', '/v1/token/{chainId}/{address}', 'none', 'free (404 = not observed, not allow)'],
                  ['POST', '/v1/register', 'none', 'free · X-PAYMENT tops up credit'],
                  ['POST', '/v1/verify', 'key · x402', '$0.003'],
                  ['POST', '/v1/simulate', 'key · x402', '$0.005'],
                  ['POST', '/v1/token-risk', 'key · x402', '$0.01'],
                  ['POST', '/v1/check', 'key · x402', '$0.005'],
                  ['POST', '/v1/guard', 'key · x402', '$0.015 bundled'],
                  ['GET', '/v1/balance', 'key', 'free'],
                  ['GET', '/v1/attestation/{decisionId}', 'key', '[VERIFY]'],
                ]}
              />
              <CodeBlock
                title="POST /v1/guard · request"
                code={`{
  "network": "eip155:4663",
  "quote":   { "asset": "0x5fc5…d168", "payTo": "0x…", "amount": "1000000" },
  "payload": { "type": "eip3009 | evm_tx | intent",
               "authorization": {}, "tx": "0x…", "intent": { … } },
  "token": "0x…",
  "content": { "text": "…", "url": "https://…" },
  "checks": ["quote", "simulation", "token_risk"],
  "options": { "spendPolicy": { "maxPerPayment": { "0x5fc5…d168": "1000000" } } }
}`}
              />
              <CodeBlock
                title="canonical response (abridged)"
                code={`{
  "decision": "allow | deny | abstain",
  "reason": "short summary",
  "codes": ["Q-001"],
  "payload_hash": "0x…",
  "expires_at": "2026-11-24T04:00:00.000+08:00",
  "network": "eip155:4663",
  "checks": {
    "quote":        { "decision", "codes", "expected", "actual" },
    "simulation":   { "decision", "codes", "status", "gasUsed",
                      "balanceChanges": […], "approvals": […], "calls": […] },
    "token_risk":   { "decision", "codes", "kind", "holders", "liquidity",
                      "tax", "authorities", "pons" },
    "content":      { "decision", "verdict": "clean_by_rules | findings | unchecked", "codes" }
  },
  "flags": [],
  "charged": { "asset": "USDG", "amount": "15000", "unit": "micro" },
  "attestation": { "zk": { "system": "groth16-sp1 | groth16-risc0 | halo2-kzg",
                           "scope": "quote", "status": "pending | proven | verified | failed",
  "note": "why it is still pending (e.g. SP1 prover not configured)", … } }
}`}
              />
              <P>Reason codes (prefixes deliberately differ from the reference’s <code className="font-mono">X402-</code>):</P>
              <Table
                head={['Code', 'Check', 'Meaning']}
                rows={[
                  ['Q-001', 'quote', 'destination does not match quote/intent'],
                  ['Q-002', 'quote', 'amount does not match'],
                  ['Q-003', 'quote', 'asset/token does not match'],
                  ['Q-004', 'quote', 'chain does not match'],
                  ['Q-005', 'quote', 'no quote/intent on an x402 path → deny'],
                  ['Q-006', 'quote', 'approval/delegate outside the one-shot transfer'],
                  ['Q-007', 'quote', 'EIP-712 domain unverified → abstain'],
                  ['S-REVERT', 'simulation', 'transaction reverts'],
                  ['S-DIFF', 'simulation', 'balance change differs from intent/quote'],
                  ['S-APPROVE', 'simulation', 'allowance/operator appears outside the request'],
                  ['S-FAIL', 'simulation', 'simulation could not run → abstain'],
                  ['T-MINT', 'token risk', 'mint authority live outside the official allowlist'],
                  ['T-TAX', 'token risk', 'tax / snipe tax above configured threshold'],
                  ['T-LP', 'token risk', 'liquidity not locked / not detected'],
                  ['T-HOLDER', 'token risk', 'holder concentration above threshold'],
                  ['T-PONS', 'token risk', 'curve state inconsistent or near graduation'],
                  ['T-UNKNOWN', 'token risk', 'token kind unrecognized → abstain or flag'],
                  ['C-FINDING', 'content', 'text rules found an instruction/payload pattern'],
                  ['P-401', 'policy', 'payee/asset/amount outside spend policy'],
                  ['P-UNAVAIL', 'policy', 'policy store unreadable → abstain'],
                ]}
              />
              <Note kind="assume">Thresholds for T-TAX / T-HOLDER are open config — until locked, raw numbers plus flags are reported and nothing auto-denies except an open mint on kind=other.</Note>
            </Section>

            {/* 06 Signer */}
            <Section id="signer" num="06" title="Signer wrapper">
              <P>
                <code className="font-mono text-white">guardEvmSigner</code> wraps every signing path —{' '}
                <code className="font-mono text-white">signTypedData</code>, <code className="font-mono text-white">signTransaction</code>,{' '}
                <code className="font-mono text-white">sendTransaction</code> and equivalents — plus EIP-3009 authorization checks. It refuses to sign when:
              </P>
              <ul className="space-y-2.5">
                {[
                  'there is no quote/intent to compare (x402 path),',
                  'no allow verdict exists for this exact payload hash,',
                  'the allow has expired, or',
                  'the payload to sign differs from the one that was checked.',
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-[13px] text-zinc-300">
                    <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-white" strokeWidth={2.5} />
                    {t}
                  </li>
                ))}
              </ul>
              <Note kind="rule">
                Default on abstain: refuse. A “sign anyway on abstain” mode may exist only as an explicit operator config
                override and must be recorded in the receipt.
              </Note>
            </Section>

            {/* 07 RHC */}
            <Section id="rhc" num="07" title="Robinhood Chain 4663">
              <Table
                head={['Property', 'Mainnet', 'Testnet']}
                rows={[
                  ['Chain ID', '4663', '46630 (testing only)'],
                  ['Gas token', 'ETH', 'ETH'],
                  ['Public RPC', 'https://rpc.mainnet.chain.robinhood.com (rate-limited)', 'https://rpc.testnet.chain.robinhood.com'],
                  ['Explorer', 'robinhoodchain.blockscout.com', 'explorer.testnet.chain.robinhood.com'],
                  ['Sequencer feed', 'wss://feed.mainnet.chain.robinhood.com', 'wss://feed.testnet.chain.robinhood.com'],
                ]}
              />
              <Table
                head={['Asset', 'Address', 'Note']}
                rows={[
                  ['WETH', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', '18 dp'],
                  ['USDG', '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', '6 dp · EIP-3009 read from the contract, never guessed'],
                  ['USDG supply control (Paxos)', '0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4', 'Paxos, not the token itself'],
                  ['Stock Tokens / tokenized ETFs', 'official registry, generated live', 'same ticker ≠ same asset'],
                ]}
              />
              <Table
                head={['pons V2 role', 'Address']}
                rows={[
                  ['Factory', '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e'],
                  ['Meme hook (every graduated v4 pool)', '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044'],
                  ['Fee escrow', '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e'],
                  ['Buyback vault', '0x42df2a798f82289E177311362e8f5ccC45c1219c'],
                  ['Launch locker', '0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952'],
                  ['Launch & buy router', '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948'],
                  ['Launch deployer', '0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42'],
                  ['Graduation executor', '0xC7819B64A1dAECD7eC19856d026cb14EfBd89046'],
                  ['Graduation guard', '0xf5695117b99B6f6401e67d4195BD653628176C6C'],
                ]}
              />
              <Table
                head={['Uniswap v4 / pons V1', 'Address']}
                rows={[
                  ['PoolManager (chain singleton)', '0x8366a39CC670B4001A1121B8F6A443A643e40951'],
                  ['OpenHooks PonsCurveAggregator', '0xb091eC27074C7a0C1bA896C063cc677F89202888 (unaudited)'],
                  ['pons V1 factory (legacy tokens)', '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB'],
                  ['pons V1 liquidity locker', '0x736D76699C26D0d966744cAe304C000d471f7F35'],
                ]}
              />
              <Table
                head={['Chainlink feed (mainnet directory)', 'Proxy', 'Note']}
                rows={[
                  ['USDG / USD', '0x61B7e5650328764B076A108EFF5fa7282a1B9aD2', '8 dp · heartbeat 86400 s'],
                  ['ETH / USD', '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9', '8 dp · heartbeat 86400 s'],
                ]}
              />
              <Note kind="verify">
                Resolve the pons stack from the factory that launched the token — never assume the newest stack. Public
                launching is currently closed; read canLaunch(address) before offering a create flow. Universal Router,
                Position Manager and Permit2 on RHC are not verified here. Re-read the official Chainlink directory at
                implementation time instead of relying on a stale copy.
              </Note>
            </Section>

            {/* 08 Billing */}
            <Section id="billing" num="08" title="x402 billing">
              <P>
                Prepaid per call, no subscription, no minimum. Payment rail: USDG on the active chain (testnet{' '}
                <code className="font-mono text-white">eip155:46630</code> today). When credit runs dry the API answers HTTP 402
                with a payable quote. Credit is added only after USDG has really moved onchain, with{' '}
                <code className="font-mono text-white">ZGUARD_X402_MIN_CONFIRMATIONS</code> (default 3) confirmations. A signature
                alone never creates credit.
              </P>
              <CodeBlock
                title="billing loop"
                code={`1. POST /v1/guard with no credit
2. ← 402 + x402 quote { network: "eip155:46630", asset: USDG, amount, payTo, settlement.mode }
3. agent pays (mode "onchain" or "deposit", see below)
4. credit applied after confirmations · request replayed
5. ← 200 + decision + payload_hash + expires_at

local quote-match: free, offline, no key — always`}
              />
              <CodeBlock
                title="settlement modes"
                code={`onchain  · X-PAYMENT = signed EIP-3009 transferWithAuthorization
           the relayer broadcasts it; credit only if the receipt succeeds
deposit  · no relayer needed
           1. send USDG to payTo yourself
           2. sign (EIP-191, same wallet):
              "ZGuard credit claim\\ntx:<txHash lowercase>\\nchain:<chainId>"
           3. X-PAYMENT: {"network":"eip155:46630",
                          "payload":{"txHash":"0x…","claimSignature":"0x…"}}
           credit = USDG transferred from the signer to payTo; each tx is claimable once
offchain · dev only, refused when NODE_ENV=production`}
              />
              <Note kind="assume">
                Revenue model: 100% of net hosted-API revenue to buyback and burn of the pons-launched product token
                ($ZGUARD ticker unconfirmed) after launch, unless an operational treasury share is set. Burn address
                0x000000000000000000000000000000000000dEaD. Third-party reference token addresses are never used.
              </Note>
            </Section>

            {/* 09 ZK */}
            <Section id="zk" num="09" title="ZK attestation">
              <P>
                Only quote-match is proven — it is a pure function. Simulation and token risk stay proofless because they
                depend on RPC state. <code className="font-mono text-white">attestation.zk.scope</code> must be{' '}
                <code className="font-mono text-white">"quote"</code> on every receipt.
              </P>
              <Table
                head={['Path', 'System', 'Status']}
                rows={[
                  ['1', 'Groth16 on BN254 — rule engine in Rust inside a zkVM (SP1 or RISC Zero), STARK wrapped to Groth16, verified by ZGuardQuoteVerifier (testnet 46630 first)', 'scaffold · prover not deployed'],
                  ['2', 'Halo2-KZG — hand-written circuit (payTo, amount, asset, chainId → commitment), PSE fork, Solidity verifier via snark-verifier, universal powers-of-tau setup', 'skeleton · not available'],
                ]}
              />
              <CodeBlock
                title="attestation.zk schema"
                code={`{
  "system": "groth16-sp1 | groth16-risc0 | halo2-kzg",
  "scope": "quote",                        // always "quote"
  "programVKey": "0x…",
  "proof": "0x…",
  "publicInputs": { "quoteHash": "0x…", "txHash": "0x…",
                    "verdict": "allow|deny|abstain", "ruleCodes": […] },
  "verifierAddress": "0x…",
  "verifyTx": "0x…",
  "status": "pending | proven | verified | failed",
  "note": "why it is still pending (e.g. SP1 prover not configured)"
}`}
              />
              <Note kind="verify">
                Hard requirements: BN254 precompiles ecAdd 0x06 / ecMul 0x07 / ecPairing 0x08 active on 4663; SP1 or RISC
                Zero verifier gateway deployed on 4663 (else self-deploy); gas cost of verification measured on 4663.
                quoteHash / txHash are commitments — intent contents are never revealed. Proofs are async: the decision
                is instant, the proof lands in the receipt and via webhook. Zcash’s IPA variant was rejected for EVM cost;
                shielded payments (Railgun, Privacy Pools, Aztec) on RHC are unverified and deferred.
              </Note>
            </Section>

            {/* 10 Config */}
            <Section id="config" num="10" title="Open config">
              <P>Values that must never be silently hardcoded — they live in env / config file / dashboard, with documented defaults.</P>
              <Table
                head={['Key', 'Proposed default', 'Status']}
                rows={[
                  ['Product name / API domain / key prefix', 'ZGuard · TBD · zg_', 'name locked · rest ASSUMPTION'],
                  ['Token ticker', '$ZGUARD', 'ASSUMPTION — not locked'],
                  ['Production RPC + fallback', 'Alchemy recommended + public RPC as non-prod fallback', 'operator choice'],
                  ['Prices /v1/verify · simulate · token-risk · check · guard', '$0.003 · $0.005 · $0.01 · $0.005 · $0.015', 'ASSUMPTION'],
                  ['x402 asset', 'USDG on 4663 required · USDC Base/Solana optional', 'decision'],
                  ['Revenue split buyback vs operations', '100% to buyback after token launch', 'ASSUMPTION'],
                  ['required vs advisory on /v1/guard', 'all three required', 'ASSUMPTION'],
                  ['allow TTL', '120 seconds', 'ASSUMPTION'],
                  ['T-TAX / T-HOLDER thresholds', 'TBD — report raw + flag meanwhile', 'ASSUMPTION'],
                  ['spend policy default', 'off unless set by tenant', 'same as reference'],
                  ['signer on abstain', 'refuse', 'fixed unless explicit override'],
                  ['EIP-712 domain allowlist', 'only domains read from installed contracts', 'required'],
                  ['Stock Token list', 'official registry, refreshed', 'never a static file'],
                  ['simulation method', 'pinned after v4-hook + pons-curve tests', 'VERIFY'],
                  ['SDK license', 'Apache-2.0', 'ASSUMPTION'],
                  ['zk system', 'Groth16 BN254 via SP1 (required) + Halo2-KZG (target)', 'ASSUMPTION'],
                  ['on-chain verify per proof vs batch (merkle root)', 'batch per N verdicts', 'ASSUMPTION'],
                  ['prover', 'prover network (SP1)', 'ASSUMPTION'],
                ]}
              />
            </Section>

            {/* 11 MVP */}
            <Section id="mvp" num="11" title="MVP & success criteria">
              <P>MVP must exist before the product is offered:</P>
              <ul className="space-y-2.5">
                {[
                  'Hosted endpoints: register, verify, simulate, token-risk, check, guard, token lookup, balance.',
                  'TypeScript SDK: offline quote-match + API client + EVM signer wrapper for USDG/x402 and routine RHC txs.',
                  'One MCP server with the five tools, working in Claude Code and Cursor at minimum (OpenClaw once the host is verified).',
                  'Three checks in POST /v1/guard on chain 4663; asset awareness for USDG, WETH, registry Stock Tokens, pons V1/V2 curve and graduated v4 pools, PoolManager v4.',
                  'Default-on in Perm and the RHC/pons terminal: no guard call, no signature — disabling it in dev must fail visibly, never silently. Status today: SDK helpers + tests (enabled:false throws GuardDisabledError); repo integrations pending.',
                  'x402 billing in USDG on RHC; receipt/dashboard page (balance, decision log, payload hashes) — not a social product.',
                  'zk layer: Groth16 (required) and Halo2-KZG (target), verifier on 4663, async attestation.zk. Status today: SP1 guest scaffold, verifier not deployed, attestations pending.',
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-[13px] text-zinc-300">
                    <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-white" strokeWidth={2.5} />
                    {t}
                  </li>
                ))}
              </ul>
              <P>Measurable success criteria (proven with logs, receipts or tx tests — not claims):</P>
              <Table
                head={['#', 'Criterion']}
                rows={[
                  ['1', 'One /v1/guard call on 4663 returns quote + simulation + token_risk plus the aggregate decision.'],
                  ['2', 'Quote-match fixtures: match → allow; payTo swapped → deny Q-001; amount swapped → deny Q-002; undecodable → abstain; no quote → deny Q-005. Signer refuses (b)–(e).'],
                  ['3', 'Simulation matches onchain balances after a real test tx for a v4 hook swap and a pons curve trade; deliberate revert → S-REVERT.'],
                  ['4', 'Token risk distinguishes usdg, stock_token, pons_curve, pons_graduated_v4; a ticker twin off-registry is never labelled stock_token.'],
                  ['5', 'A Perm swap and a terminal swap/buy cannot reach a signature without calling the guard.'],
                  ['6', 'MCP check_token and guard_bundle return the same schema as the API.'],
                  ['7', 'Paid calls settle in USDG credit; empty balance → HTTP 402 with a payable quote on eip155:4663. Local quote-match stays free without a key.'],
                  ['8', 'Fail-closed: API off or simulation RPC failing → effective decision is not allow and the signer refuses.'],
                  ['9', 'After the token exists, buyback units are traceable to a buy tx and a burn transfer to the published address.'],
                  ['10', 'allow and deny-Q-001 fixtures each have a Groth16 proof that passes the on-chain verifier on 4663 (Halo2-KZG too if shipped); scope “quote” everywhere.'],
                ]}
              />
              <Note kind="assume">Latency target: p95 for full /v1/guard under 800 ms on RHC with a production RPC; local quote-match under 10 ms. To be measured and reported.</Note>
              <Reveal>
                <SpotlightCard className="mt-4 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="font-display text-xl text-white">Phase 2 (not release-blocking)</div>
                      <div className="mt-1 text-[12px] text-zinc-500">
                        USDC Base/Solana rails · coding-agent hooks · signed metadata attestations + badges · /v1/watch webhooks ·
                        preset intents for Universal Router/Permit2/bridge · own holder index + payee reputation + velocity caps ·
                        LLM-assisted text scan · chains beyond 4663 · automatic onchain buyback/burn.
                      </div>
                    </div>
                  </div>
                </SpotlightCard>
              </Reveal>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
