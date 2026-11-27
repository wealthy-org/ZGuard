import Link from "next/link";
import type { ReactNode } from "react";
import { IS_MAINNET, MANIFEST, PERM_CHAIN_ID } from "@/lib/web3/network";

/**
 * Perm docs content. Every page is a list of sections; the sidebar, the "On this page" list and the
 * previous/next links are derived from this file. Numbers and addresses come from the deployment
 * manifest so the docs never drift from what is deployed.
 */

type ManifestExtras = {
  explorerUrl: string;
  rpcUrl: string;
  weth?: string;
  owner?: string;
  treasury?: string;
  pauseGuardian?: string;
  quoteSigner?: string;
  deploymentBlock: number | null;
  deploymentCommitSha?: string;
  referrals?: { referrer: string; shareBpsOfNetFee: number }[];
  contracts?: Record<string, { address: string; runtimeCodehash?: string }>;
  feePolicy?: { publishedInTx?: string };
  deploymentTransactions?: ({ label?: string; hash?: string } | string)[];
  venues: { uniswapV3?: { swapRouter02: string; factory: string; quoterV2: string } | null; synthraV3?: { swapRouter02: string } | null };
};

const M = MANIFEST as typeof MANIFEST & ManifestExtras;
// Mainnet stores { label, hash }; the older testnet manifest stores bare hashes. Accept both, drop anything else.
const DEPLOY_TXS = (M.deploymentTransactions || [])
  .map((entry, index) => typeof entry === "string" ? { label: `Deployment transaction ${index + 1}`, hash: entry } : { label: entry?.label || `Deployment transaction ${index + 1}`, hash: entry?.hash || "" })
  .filter((entry) => /^0x[0-9a-fA-F]{64}$/.test(entry.hash));
const EXPLORER = M.explorerUrl.replace(/\/$/, "");
const POLICY = M.policy;
const GROSS_PCT = (POLICY.platformFeeBps / 100).toFixed(2);
const REBATE_PCT = (POLICY.rebateShareBps / 100).toFixed(0);
const NET_BPS = POLICY.platformFeeBps - (POLICY.platformFeeBps * POLICY.rebateShareBps) / 10_000;
const NET_PCT = (NET_BPS / 100).toFixed(2);
const REFERRAL_PCT = M.referrals?.[0] ? (M.referrals[0].shareBpsOfNetFee / 100).toFixed(0) : null;
const NETWORK = IS_MAINNET ? `Robinhood Chain mainnet, chain ID ${PERM_CHAIN_ID}` : `Robinhood Chain testnet, chain ID ${PERM_CHAIN_ID}`;
const V3_NAME = IS_MAINNET ? "Uniswap v3" : "Synthra v3";

// ── small presentational helpers ────────────────────────────────────────────

function Hint({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return <div className={`pd-hint ${tone}`}><span aria-hidden="true">{tone === "warn" ? "!" : "i"}</span><div>{children}</div></div>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="pd-table" tabIndex={0}>
      <table>
        <thead><tr>{head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Addr({ value, label }: { value?: string | null; label?: string }) {
  if (!value) return <span className="pd-muted">not deployed</span>;
  return <a className="pd-addr" href={`${EXPLORER}/address/${value}`} target="_blank" rel="noopener noreferrer"><code>{label || value}</code> ↗</a>;
}

function Tx({ hash }: { hash?: string | null }) {
  if (!hash) return <span className="pd-muted">not recorded</span>;
  return <a className="pd-addr" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"><code>{hash.slice(0, 10)}…{hash.slice(-8)}</code> ↗</a>;
}

function Flow({ items }: { items: string[] }) {
  return <div className="pd-flow">{items.map((item, index) => <span key={item}>{index > 0 && <i>→</i>}<b>{item}</b></span>)}</div>;
}

function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="pd-steps">{items.map((item, index) => <li key={index}>{item}</li>)}</ol>;
}

function Code({ children }: { children: string }) {
  return <pre className="pd-code" tabIndex={0}><code>{children}</code></pre>;
}

// ── page model ──────────────────────────────────────────────────────────────

export type DocSection = { id: string; title: string; body: ReactNode };
export type DocPage = { slug: string; title: string; lead: ReactNode; description: string; keywords?: string; sections: DocSection[] };
export type DocGroup = { title: string; pages: DocPage[] };

// Real mainnet settlements, also listed in deployments/mainnet/PROOF_MAINNET.md.
const EXAMPLE_TXS: { feature: string; hash: string; result: string }[] = IS_MAINNET ? [
  { feature: "Uniswap v4 swap", hash: "0xa7f8c185663cdf2ad2eae85a916eca6f1727b6213e2a0ca39193fea88f0f1f9f", result: "0.0005 ETH → 0.006295 NVDA" },
  { feature: "Cross-venue v4 → v3", hash: "0x1a645ad8b7da93657f219653f0005fc107431ef387bf9e5e2d886c6094fb8d03", result: "0.005 NVDA → ETH → 0.002281 AAPL" },
  { feature: "Permit2 signature swap", hash: "0xb2eda1e74b3e41b8885198b2b39b3a05312e6c85c7fcb6b817fc6c9a296c3619", result: "0.002 AAPL → 0.000385 ETH" },
  { feature: "Referral swap", hash: "0x60b80e89785495959282cae6666718e96431ea06fa09bfe846e530d41f9a6da9", result: "net fee split 50 / 50 referrer / treasury" },
  { feature: "Referrer fee claim", hash: "0x3075c65d2d6b1b56f08cbe6df5f1bb980b64c83c769234937d3042b0cbb9e007", result: "0.000000375 ETH claimed" },
] : [];

const TRY_LINKS = [
  { href: "/trade", label: "Swap" },
  { href: "/rebate", label: "Fee rebate" },
  { href: "/proofs", label: "Proof explorer" },
];

export { TRY_LINKS };

const startHere: DocPage[] = [
  {
    slug: "introduction",
    title: "Introduction",
    description: "What Perm is, who it is for, and the key numbers of the deployment.",
    keywords: "overview about perm router",
    lead: <>Perm is a swap router on Robinhood Chain. Before you sign, it compares the routes it supports on Uniswap v4 and {V3_NAME}, shows every fee line, and lowers its own platform fee with an instant fee rebate. Every settled swap leaves a receipt you can check on Blockscout.</>,
    sections: [
      {
        id: "what-perm-is",
        title: "What Perm is",
        body: <>
          <p>Most swap screens show one number and hide how it was built. Perm shows the parts: which venue each step uses, the gross Perm fee, the fee rebate, the net fee, the minimum you will receive and the network fee. The router then settles the trade on-chain and emits events that prove what happened.</p>
          <p>Perm does not run its own pools. It routes through existing Uniswap pools and only through adapters the router owner has enabled.</p>
        </>,
      },
      {
        id: "who-it-is-for",
        title: "Who it is for",
        body: <Table head={["You are", "What you do with Perm"]} rows={[
          ["Trader", <>Swap ETH and Robinhood stock tokens through Uniswap v4 direct pools and {V3_NAME}, including routes with up to four steps.</>],
          ["Referrer", <>Share a <code>/trade?referrer=</code> link and claim a share of the net Perm fee from swaps that use it.</>],
          ["Verifier", <>Paste any Perm transaction into the proof explorer, or read the events straight from the chain.</>],
          ["Builder", <>Read quotes and receipts from the HTTP API and the router events.</>],
        ]} />,
      },
      {
        id: "key-facts",
        title: "Key facts",
        body: <Table head={["Item", "Value"]} rows={[
          ["Network", NETWORK],
          ["Venues", IS_MAINNET ? "Uniswap v4 direct pools (no hook) · Uniswap v3" : "Uniswap v4 · Synthra v3"],
          ["Platform fee", `${GROSS_PCT}% gross, policy v${POLICY.version}`],
          ["Fee rebate", `${REBATE_PCT}% of the Perm fee, applied at settlement`],
          ["Net Perm fee", `${NET_PCT}%`],
          ["Quote validity", "90 seconds (the router rejects anything older than 120 seconds)"],
          ["Route length", "Up to 4 steps in one transaction"],
          ["Status", IS_MAINNET ? "Allowlisted mainnet showcase, not a public release" : "Testnet staging"],
        ]} />,
      },
      {
        id: "status",
        title: "Current status",
        body: <>
          <p>The contracts are deployed and their source is verified on Blockscout. Trading through the app is limited to allowlisted wallets while the deployment is in its non-release phase. See <Link href="/docs/release-status">Release status</Link> for what that means.</p>
          <Hint>Stock tokens on Robinhood Chain are tokens, not shares. Holding one does not give you shareholder rights. Read <Link href="/docs/stock-tokens">Stock tokens</Link> before you trade.</Hint>
        </>,
      },
    ],
  },
  {
    slug: "how-perm-works",
    title: "How Perm works",
    description: "The four parts that work together on every Perm swap.",
    keywords: "architecture flow signer router quote",
    lead: "Four parts work together on every swap: the quote engine, the quote signer, the router and the receipt.",
    sections: [
      { id: "flow", title: "The flow", body: <Flow items={["Quote engine compares routes", "Signer signs the quote", "Router settles", "Receipt on Blockscout"]} /> },
      {
        id: "quote-engine",
        title: "1. The quote engine compares routes",
        body: <p>When you enter an amount, Perm asks the Uniswap v4 quoter and the {V3_NAME} quoter for every eligible pool, including multi-step routes through ETH and USDG. It removes routes that are far off the best result, takes the Perm fee out first, and ranks the rest by the amount you would actually receive.</p>,
      },
      {
        id: "signer",
        title: "2. The quote signer binds it",
        body: <p>The selected route is signed as an EIP-712 message by a dedicated quote signer. The signature binds your account, both tokens, the amount, the minimum output, the recipient, the fee policy version, the referrer, the chain and a hash of the exact route. The signer key holds no funds and runs as a separate service. See <Link href="/docs/quotes">Quotes and freshness</Link>.</p>,
      },
      {
        id: "router",
        title: "3. The router settles",
        body: <p><code>PermRouter</code> checks the signature, the deadline and the quote age, takes the net Perm fee, and runs each step through an enabled adapter. After the last step it measures what the recipient actually received and reverts if that is below the signed minimum. If anything fails, the whole transaction reverts and no fee is taken.</p>,
      },
      {
        id: "receipt",
        title: "4. The receipt proves it",
        body: <p>Each swap emits one <code>RouteStepSettled</code> event per step and one <code>SwapSettled</code> event with the amounts and the full fee breakdown. The <Link href="/proofs">proof explorer</Link> reads these events from the chain; you can also open them directly on Blockscout.</p>,
      },
    ],
  },
  {
    slug: "faq",
    title: "FAQ",
    description: "Short answers to common questions about Perm.",
    keywords: "questions help",
    lead: "Short answers to the questions people ask most.",
    sections: [
      {
        id: "general",
        title: "General",
        body: <Table head={["Question", "Answer"]} rows={[
          ["Is Perm a DEX?", "No. Perm is a router. It does not hold liquidity; it routes through Uniswap pools."],
          ["Will Perm always give me the most output?", "No router can promise that. Perm compares the routes it supports and shows you the result and every fee before you sign."],
          ["What is the fee rebate?", `A ${REBATE_PCT}% reduction of Perm's own ${GROSS_PCT}% fee, applied inside the swap. You do not claim it; you simply pay a ${NET_PCT}% net fee.`],
          ["Are stock tokens shares?", "No. They are tokens on Robinhood Chain and do not carry shareholder rights."],
          ["Why can't I swap?", "During the non-release phase only allowlisted wallets can execute swaps. Quotes and proofs stay public."],
        ]} />,
      },
      {
        id: "trading",
        title: "Trading",
        body: <Table head={["Question", "Answer"]} rows={[
          ["Why did my quote expire?", "Quotes are valid for 90 seconds. Perm refreshes them automatically; confirm the new numbers before signing."],
          ["Why do I see two wallet prompts when I sell a token?", "If your Permit2 allowance does not cover the trade, you first approve the exact amount to Permit2, then sign the trade. When the allowance already covers it, only the signature is needed."],
          ["What does \"V4 only\" mean?", "Only Uniswap v4 pools without a hook are used."],
          ["My wallet shows \"Transaction submitted\" forever.", "That is almost always the wallet's RPC. Switch the Robinhood Chain RPC in your wallet and try again; nothing was sent if no transaction hash appears on Blockscout."],
        ]} />,
      },
    ],
  },
  {
    slug: "official-links",
    title: "Official links and safety",
    description: "Where to find the real Perm and how to avoid scams.",
    keywords: "scam phishing twitter github",
    lead: "Use only these links. Perm never asks for your seed phrase or private key.",
    sections: [
      {
        id: "links",
        title: "Official links",
        body: <Table head={["What", "Link"]} rows={[
          ["App", <a key="app" href="https://www.useperm.xyz" target="_blank" rel="noopener noreferrer">www.useperm.xyz</a>],
          ["X", <a key="x" href="https://x.com/usepermonx" target="_blank" rel="noopener noreferrer">@usepermonx</a>],
          ["Source code", <a key="gh" href="https://github.com/wealthy-org/Perm" target="_blank" rel="noopener noreferrer">github.com/wealthy-org/Perm</a>],
          ["Explorer", <a key="ex" href={EXPLORER} target="_blank" rel="noopener noreferrer">{EXPLORER.replace("https://", "")}</a>],
          ["Contracts", <Link key="c" href="/docs/contracts">Contract addresses</Link>],
        ]} />,
      },
      {
        id: "safety",
        title: "Stay safe",
        body: <ul>
          <li>Perm will never message you first, ask you to &quot;validate&quot; a wallet or ask for a seed phrase.</li>
          <li>Check that the contract in your wallet prompt matches <code>PermRouter</code> on the <Link href="/docs/contracts">contracts page</Link>.</li>
          <li>Permit2 signatures move tokens. Only sign them on www.useperm.xyz.</li>
        </ul>,
      },
    ],
  },
];

const guides: DocPage[] = [
  {
    slug: "swap",
    title: "How to swap on Perm",
    description: "Step-by-step guide to a swap on Robinhood Chain with Perm.",
    keywords: "trade guide wallet connect",
    lead: "Paying with ETH takes one wallet confirmation. Selling a token takes a Permit2 signature, plus an exact approval when your Permit2 allowance does not cover the trade.",
    sections: [
      {
        id: "steps",
        title: "Steps",
        body: <Steps items={[
          <>Open <Link href="/trade">/trade</Link> and connect your wallet. Perm asks your wallet to switch to {NETWORK}.</>,
          "Choose what you pay and what you receive, then type an amount.",
          <>Pick a routing mode. <b>Highest net output</b> compares everything; the other tabs limit the venues. See <Link href="/docs/trade">Routing modes</Link>.</>,
          "Read the breakdown: route, platform fee, fee rebate, net fee, minimum received and network fee.",
          "Set slippage (0.1%, 0.5% or 1%) and confirm in your wallet before the 90-second quote expires.",
          "Open the transaction on Blockscout from the success message to see the receipt events.",
        ]} />,
      },
      {
        id: "gas",
        title: "Keep some ETH for gas",
        body: <p>When you pay with ETH, Perm keeps a small reserve for the network fee, so the MAX button never uses your whole balance. A typical one-step swap uses about 250,000 gas.</p>,
      },
      {
        id: "if-it-fails",
        title: "If a swap reverts",
        body: <p>If the price moves past your slippage or the quote is too old, the router reverts. Your tokens stay in your wallet, no Perm fee is taken and no fee rebate or referral is recorded. The network fee for the failed transaction is not refunded.</p>,
      },
    ],
  },
  {
    slug: "permit2",
    title: "Token approvals with Permit2",
    description: "Why the first sale of a token needs an approval and later trades only a signature.",
    keywords: "approve allowance signature",
    lead: "Perm uses Uniswap's Permit2 so each trade moves only the exact amount you signed for.",
    sections: [
      {
        id: "how",
        title: "How it works",
        body: <Steps items={[
          <>If your Permit2 allowance does not cover the trade, your wallet first asks you to approve the token to Permit2 (<code>0x0000…8BA3</code>). Perm asks for exactly the trade amount, never an unlimited allowance.</>,
          "You then sign a Permit2 message for that trade's amount. The router pulls exactly that amount during settlement, so no transaction is needed for the authorization itself.",
          "When you pay with native ETH, no approval or Permit2 signature is needed.",
        ]} />,
      },
      {
        id: "why",
        title: "Why Permit2",
        body: <p>The router never needs a standing allowance on your tokens. Each signature is tied to one amount, one spender and a deadline, and it cannot be replayed. Inside the router, every allowance to an adapter is set to the exact amount and reset to zero in the same transaction.</p>,
      },
      {
        id: "example",
        title: "Example on mainnet",
        body: IS_MAINNET ? <p>An exact AAPL approval to Permit2, then a signature swap of 0.002 AAPL to ETH: <Tx hash="0x433d03ce5945f0add0aa13012d658ea3a5020dcf7d6da9a5262925132c462d6f" /> and <Tx hash="0xb2eda1e74b3e41b8885198b2b39b3a05312e6c85c7fcb6b817fc6c9a296c3619" />.</p> : <p>Available after the mainnet deployment.</p>,
      },
    ],
  },
  {
    slug: "multi-hop",
    title: "Multi-hop and cross-venue routes",
    description: "How Perm chains up to four steps across Uniswap v4 and v3 in one transaction.",
    keywords: "multihop route usdg hub cross venue",
    lead: "When no single pool is the best path, Perm chains up to four steps, and each step can use a different venue.",
    sections: [
      {
        id: "hubs",
        title: "Route hubs",
        body: <Table head={["Hub", "Used for"]} rows={[
          ["ETH", "Stock token → ETH → stock token, for example NVDA → ETH → AAPL."],
          ["USDG", "AMZN, NFLX and MSFT, whose liquidity sits against USDG: ETH → USDG → AMZN."],
        ]} />,
      },
      {
        id: "cross-venue",
        title: "Cross-venue",
        body: <>
          <p>The <b>V4 ↔ V3</b> mode forces a route that uses both venues, so you can see a step on Uniswap v4 hand its output to a step on {V3_NAME}. The router checks that each step spends exactly what the previous step delivered.</p>
          {IS_MAINNET && <p>Example: 0.005 NVDA → ETH on Uniswap v4 → AAPL on Uniswap v3 in one transaction: <Tx hash="0x1a645ad8b7da93657f219653f0005fc107431ef387bf9e5e2d886c6094fb8d03" />.</p>}
        </>,
      },
      {
        id: "limits",
        title: "Limits",
        body: <p>The router accepts at most four steps. Perm compares complete routes; it does not split one trade across several routes at once.</p>,
      },
    ],
  },
  {
    slug: "verify-a-swap",
    title: "How to verify a swap",
    description: "Check any Perm swap in the proof explorer, on Blockscout or from the command line.",
    keywords: "proof blockscout cli receipt check",
    lead: "Every number Perm shows after a swap comes from on-chain events. You can check them three ways.",
    sections: [
      {
        id: "proof-explorer",
        title: "1. Proof explorer",
        body: <p>Open <Link href="/proofs">/proofs</Link>, paste the transaction hash and press <b>Verify</b>. Perm reads the receipt from the official router only and shows each route step, the fee breakdown and a link to Blockscout.</p>,
      },
      {
        id: "blockscout",
        title: "2. Blockscout",
        body: <p>Open the transaction on <a href={EXPLORER} target="_blank" rel="noopener noreferrer">Blockscout</a> and select <b>Logs</b>. Look for <code>RouteStepSettled</code> (one per step), <code>FeeAccrued</code> and <code>SwapSettled</code>. Field meanings are on the <Link href="/docs/events">Events</Link> page.</p>,
      },
      {
        id: "cli",
        title: "3. Command line",
        body: <>
          <p>The repository includes a read-only proof reader. It needs no key, decodes the events, and recomputes the fee checks against the on-chain fee policy.</p>
          <Code>{"node scripts/mainnet/proof-receipt.cjs <tx-hash> [more hashes] [--md proof.md]"}</Code>
        </>,
      },
      ...(EXAMPLE_TXS.length ? [{
        id: "examples",
        title: "Example receipts",
        body: <Table head={["Feature", "Transaction", "Result"]} rows={EXAMPLE_TXS.map((tx) => [tx.feature, <Tx key={tx.hash} hash={tx.hash} />, tx.result])} />,
      }] : []),
    ],
  },
];

const usePerm: DocPage[] = [
  {
    slug: "trade",
    title: "Routing modes",
    description: "What each routing tab on /trade does.",
    keywords: "modes tabs best v4 v3 mixed",
    lead: "The tabs above the swap form decide which venues Perm may use.",
    sections: [
      {
        id: "modes",
        title: "Modes",
        body: <Table head={["Tab", "What Perm may use"]} rows={[
          ["Highest net output", `Every eligible route on Uniswap v4 and ${V3_NAME}, ranked by what you receive after the Perm fee.`],
          ["V4 only", "Uniswap v4 direct pools without a hook."],
          [V3_NAME, `${V3_NAME} pools only.`],
          ["V4 ↔ V3", "Routes that combine both venues."],
        ]} />,
      },
      {
        id: "eligibility",
        title: "Which pools are eligible",
        body: <p>Only pools that passed a liquidity check are quoted. Uniswap v2 and hook pools are not enabled on this deployment. See <Link href="/docs/venues">Venues</Link> and <Link href="/docs/hooks">Hooks</Link>.</p>,
      },
      {
        id: "breakdown",
        title: "Reading the breakdown",
        body: <Table head={["Line", "Meaning"]} rows={[
          ["Platform fee", `Perm's gross fee, ${GROSS_PCT}% of the input.`],
          ["Fee rebate", `${REBATE_PCT}% of the platform fee, removed before the swap.`],
          ["Net fee", `What Perm actually keeps, ${NET_PCT}% of the input.`],
          ["Minimum received", "The lowest output the router accepts, from your slippage setting."],
          ["Network fee", "Estimated gas in ETH, paid to the chain, not to Perm."],
        ]} />,
      },
    ],
  },
  {
    slug: "stock-tokens",
    title: "Stock tokens",
    description: "What Robinhood stock tokens are and which ones Perm routes.",
    keywords: "nvda aapl tsla amzn equity",
    lead: "Robinhood stock tokens are ERC-20 tokens on Robinhood Chain that track a listed stock or ETF.",
    sections: [
      {
        id: "not-shares",
        title: "Tokens, not shares",
        body: <Hint tone="warn">A stock token is not a share. It does not give voting rights, dividends or any claim on the company. Its on-chain price comes from pool liquidity and can differ from the stock market price.</Hint>,
      },
      {
        id: "listed",
        title: "Tokens Perm routes",
        body: <p>NVDA, AAPL, TSLA, SPCX, META, GOOGL, SPY, PLTR, AMD, QQQ, COIN, AMZN, NFLX and MSFT, each only where a pool passed the liquidity check. AMZN, NFLX and MSFT route through USDG.</p>,
      },
      {
        id: "price-gap",
        title: "Why prices can differ",
        body: <p>Pools trade around the clock, stock markets do not, and thin pools move more on each trade. Always read the minimum received before you sign.</p>,
      },
    ],
  },
  {
    slug: "fees",
    title: "Fees and fee rebate",
    description: "Exactly how the Perm fee and the fee rebate are calculated.",
    keywords: "fee rebate bps formula policy",
    lead: `Perm charges a ${GROSS_PCT}% platform fee and gives ${REBATE_PCT}% of it back inside the same swap, so you pay ${NET_PCT}% net.`,
    sections: [
      {
        id: "formula",
        title: "Formula",
        body: <>
          <Code>{`grossFee    = floor(amountIn × ${POLICY.platformFeeBps} / 10,000)
feeRebate   = floor(grossFee × ${POLICY.rebateShareBps} / 10,000)
netFee      = grossFee − feeRebate
routedInput = amountIn − netFee`}</Code>
          <p>The fee is taken from the input token. The fee rebate is not a payout: it is simply never charged, so there is nothing to claim and no second transaction.</p>
        </>,
      },
      {
        id: "example",
        title: "Example",
        body: <Table head={["Input", "Gross fee", "Fee rebate", "Net fee", "Routed"]} rows={[
          ["0.0005 ETH", "0.000001 ETH", "0.00000025 ETH", "0.00000075 ETH", "0.00049925 ETH"],
          ["100 USDG", "0.20 USDG", "0.05 USDG", "0.15 USDG", "99.85 USDG"],
        ]} />,
      },
      {
        id: "policy",
        title: "Versioned policy",
        body: <p>Fee settings live on-chain as numbered policies. A published version can never be edited, only enabled, disabled or replaced by a new version, and the hard cap is 1%. Every quote signs the policy version it used.{M.feePolicy?.publishedInTx && <> Policy v{POLICY.version} was published in <Tx hash={M.feePolicy.publishedInTx} />.</>}</p>,
      },
      {
        id: "other-costs",
        title: "Other costs",
        body: <p>Uniswap pool fees are already inside the quoted output. The network fee is paid in ETH to the chain and is shown separately.</p>,
      },
    ],
  },
  {
    slug: "referrals",
    title: "Referrals",
    description: "How referral links work and how referrers are paid.",
    keywords: "referrer link share",
    lead: "A configured referrer earns a share of the net Perm fee from swaps that arrive through its link.",
    sections: [
      {
        id: "how",
        title: "How it works",
        body: <Steps items={[
          <>The router owner configures a referrer and its share. {REFERRAL_PCT ? `The current referrer receives ${REFERRAL_PCT}% of the net fee.` : ""}</>,
          <>The referrer shares <code>www.useperm.xyz/trade?referrer=0x…</code>. The app checks the address against the router and shows <b>Referral active</b>.</>,
          "The referrer is signed into the quote, so it cannot be swapped out after you sign.",
          <>At settlement the referral share is reserved for the referrer and the rest for the treasury. The referrer claims it on <Link href="/docs/claims">/rebate#claims</Link>.</>,
        ]} />,
      },
      {
        id: "rules",
        title: "Rules",
        body: <ul>
          <li>A wallet cannot refer itself; the quote is refused.</li>
          <li>The referral share comes out of Perm&apos;s net fee. It never reduces your fee rebate and is never charged on top.</li>
        </ul>,
      },
      ...(IS_MAINNET ? [{ id: "example", title: "Example", body: <p>Referral swap <Tx hash="0x60b80e89785495959282cae6666718e96431ea06fa09bfe846e530d41f9a6da9" /> and the referrer&apos;s claim <Tx hash="0x3075c65d2d6b1b56f08cbe6df5f1bb980b64c83c769234937d3042b0cbb9e007" />.</p> }] : []),
    ],
  },
  {
    slug: "claims",
    title: "Claiming fees",
    description: "How the treasury and referrers withdraw reserved fees.",
    keywords: "claim treasury pull payment",
    lead: "Fees are reserved inside the router and pulled by their owner. A claim never blocks a swap.",
    sections: [
      {
        id: "pull-payments",
        title: "Pull payments",
        body: <p>Instead of sending fees during the swap, the router records them with a <code>FeeAccrued</code> event. A beneficiary that cannot receive tokens therefore can never make a swap fail. Reserved fees are excluded from the owner&apos;s rescue function and stay claimable.</p>,
      },
      {
        id: "how",
        title: "How to claim",
        body: <Steps items={[
          <>Connect the treasury or referrer wallet and open <Link href="/rebate#claims">/rebate#claims</Link>.</>,
          "Press Refresh to load the claimable amount for each token.",
          <>Press <b>Claim</b> on a token row and confirm. The router emits <code>FeeClaimed</code>.</>,
        ]} />,
      },
    ],
  },
  {
    slug: "proofs",
    title: "Proof explorer",
    description: "What the proof explorer shows and where its data comes from.",
    keywords: "receipt evidence explorer",
    lead: "The proof explorer turns router events into a readable receipt.",
    sections: [
      {
        id: "what",
        title: "What it shows",
        body: <p>For each settlement: account, recipient, tokens, amount in and out, each route step with its venue and adapter, gross fee, fee rebate, net fee, referral and treasury shares, fee policy version and confirmations.</p>,
      },
      {
        id: "source",
        title: "Where the data comes from",
        body: <p>Receipts are read from the chain through the RPC, only from the official router in the deployment manifest. Reverted transactions and receipts without a <code>SwapSettled</code> event from that router are rejected. Claims are not swaps, so they appear on Blockscout rather than in the explorer.</p>,
      },
    ],
  },
];

const routing: DocPage[] = [
  {
    slug: "venues",
    title: "Venues",
    description: "Which venues Perm routes through and how pools are admitted.",
    keywords: "uniswap v4 v3 v2 synthra pools liquidity",
    lead: "Perm only routes through venues whose adapter the router owner has enabled.",
    sections: [
      {
        id: "enabled",
        title: "Enabled venues",
        body: <Table head={["Venue", "Adapter", "Notes"]} rows={[
          ["Uniswap v4 direct", <Addr key="v4" value={MANIFEST.v4Adapter} label="PermV4Adapter" />, "Pools without a hook, through the official PoolManager."],
          [V3_NAME, <Addr key="v3" value={MANIFEST.v3Adapter} label="PermV3Adapter" />, IS_MAINNET ? "Through the canonical Uniswap v3 SwapRouter02." : "Through the reviewed Synthra Router02."],
        ]} />,
      },
      {
        id: "not-enabled",
        title: "Not enabled",
        body: <Table head={["Venue", "Why"]} rows={[
          ["Uniswap v2", "Adapter not deployed on this deployment."],
          ["Hook pools", <>Off on this deployment. See <Link key="h" href="/docs/hooks">Hooks</Link>.</>],
          ...(IS_MAINNET ? [["Synthra", "No Synthra pools exist on Robinhood Chain mainnet."]] : []),
        ]} />,
      },
      {
        id: "admission",
        title: "How pools are admitted",
        body: <p>Pools are discovered from on-chain events and kept only if they pass a liquidity check at a small trade size. The resulting list is versioned in the repository. At quote time, routes far below the best result are dropped.</p>,
      },
    ],
  },
  {
    slug: "quotes",
    title: "Quotes and freshness",
    description: "What a signed Perm quote contains and how long it lives.",
    keywords: "eip712 signer deadline replay",
    lead: "A Perm quote is a signed promise about one exact trade. The router executes nothing that was not signed.",
    sections: [
      {
        id: "fields",
        title: "What is signed",
        body: <div className="pd-chips">{["account", "tokenIn", "tokenOut", "amountIn", "minAmountOut", "gasEstimate", "recipient", "deadline", "quotedAt", "policyVersion", "chainId", "referrer", "routeHash"].map((field) => <code key={field}>{field}</code>)}</div>,
      },
      {
        id: "freshness",
        title: "Freshness",
        body: <p>The app sets a 90-second deadline. On-chain, the router also rejects any quote older than 120 seconds, and each quote can be used once.</p>,
      },
      {
        id: "signer",
        title: "The signer",
        body: <p>On mainnet the signer runs as a separate service that only signs for the configured chain and router, only for allowlisted accounts and only up to a per-quote amount cap. Its key holds no funds. The router stores the signer address{M.quoteSigner ? <> (<Addr value={M.quoteSigner} />)</> : null}, and the owner can rotate it.</p>,
      },
    ],
  },
  {
    slug: "hooks",
    title: "Hooks",
    description: "How Perm treats Uniswap v4 hooks and why hook pools are off on this deployment.",
    keywords: "hook aggregator boundary codehash",
    lead: "A Uniswap v4 hook belongs to a pool, not to a router. Perm treats hook pools as a separate, opt-in venue.",
    sections: [
      {
        id: "boundary",
        title: "A router is not a hook",
        body: <>
          <p>A hook is attached to a pool through its <code>PoolKey</code> and only runs when that pool is used. Changing the router does not attach a Perm hook to anyone&apos;s pool, and Perm does not run a hook of its own.</p>
          <Table head={["Responsibility", "Perm router", "A hook pool"]} rows={[
            ["Minimum output, deadline, recipient", "Enforced on every swap", "Not relied on"],
            ["Fee rebate", "Calculated at settlement", "Only if that pool implements one"],
            ["Proof", "Router events", "Hook events when available"],
          ]} />
        </>,
      },
      {
        id: "status",
        title: "Status on this deployment",
        body: <Hint>Hook routing is off. Every route uses Uniswap v4 pools without a hook or {V3_NAME}, and every receipt records <code>hook = 0x0</code>.</Hint>,
      },
      {
        id: "admission",
        title: "How a hook would be admitted",
        body: <Steps items={[
          "The hook is found on-chain and must report a known version and the official PoolManager.",
          "Its permission bits must match the expected set.",
          <>The owner pins its runtime codehash on the v4 adapter. If the code ever changes, the route stops working.</>,
          "Any Uniswap fee charged by the hook must already be included in the quote.",
        ]} />,
      },
    ],
  },
];

const contractsRows: ReactNode[][] = [
  ["PermRouter", <Addr key="r" value={MANIFEST.permRouter} />],
  ["PermV4Adapter", <Addr key="v4" value={MANIFEST.v4Adapter} />],
  ["PermV3Adapter", <Addr key="v3" value={MANIFEST.v3Adapter} />],
];

const build: DocPage[] = [
  {
    slug: "contracts",
    title: "Contract addresses",
    description: "Perm contract addresses, dependencies and deployment transactions.",
    keywords: "address deployment router adapter blockscout",
    lead: <>All Perm contracts on {NETWORK}. Source code is verified on Blockscout and Sourcify.</>,
    sections: [
      { id: "perm", title: "Perm contracts", body: <Table head={["Contract", "Address"]} rows={contractsRows} /> },
      {
        id: "roles",
        title: "Roles",
        body: <Table head={["Role", "Address"]} rows={[
          ["Owner", <Addr key="o" value={M.owner} />],
          ["Pause guardian", <Addr key="g" value={M.pauseGuardian} />],
          ["Treasury", <Addr key="t" value={M.treasury} />],
          ["Quote signer (no funds)", <Addr key="s" value={M.quoteSigner} />],
        ]} />,
      },
      {
        id: "dependencies",
        title: "Dependencies",
        body: <Table head={["Contract", "Address"]} rows={[
          ["Uniswap v4 PoolManager", <Addr key="pm" value={MANIFEST.poolManager} />],
          ["Uniswap v4 Quoter", <Addr key="q" value={MANIFEST.v4Quoter} />],
          ...(M.venues.uniswapV3 ? [["Uniswap v3 SwapRouter02", <Addr key="sr" value={M.venues.uniswapV3.swapRouter02} />]] : []),
          ["Permit2", <Addr key="p2" value={MANIFEST.permit2} />],
          ...(M.weth ? [["WETH", <Addr key="w" value={M.weth} />]] : []),
        ]} />,
      },
      ...(DEPLOY_TXS.length ? [{
        id: "deployment",
        title: "Deployment transactions",
        body: <>
          <Table head={["Step", "Transaction"]} rows={DEPLOY_TXS.map((tx) => [tx.label, <Tx key={tx.hash} hash={tx.hash} />])} />
          <p>Deployed at block {M.deploymentBlock}{M.deploymentCommitSha ? <> from commit <code>{M.deploymentCommitSha.slice(0, 7)}</code></> : null}. The full record is <code>{IS_MAINNET ? "deployments/robinhood-mainnet.json" : "deployments/robinhood-testnet.json"}</code> in the repository.</p>
        </>,
      }] : []),
    ],
  },
  {
    slug: "events",
    title: "Events",
    description: "The router events that make up a Perm receipt.",
    keywords: "logs swapsettled routestepsettled feeaccrued feeclaimed schema",
    lead: "A Perm receipt is built only from these router events.",
    sections: [
      {
        id: "swap-settled",
        title: "SwapSettled",
        body: <>
          <p>One per swap. Holds the totals and the full fee breakdown.</p>
          <Code>{"SwapSettled(receiptId, quoteId, account, recipient, tokenIn, tokenOut,\n  amountIn, routedInput, amountOut, grossFee, rebate, netFee,\n  referralFee, treasuryFee, policyVersion, routeId, routeHash)"}</Code>
        </>,
      },
      {
        id: "route-step-settled",
        title: "RouteStepSettled",
        body: <>
          <p>One per route step, in order. <code>providerId</code> names the venue; <code>hook</code> and <code>hookCodehash</code> are zero for hookless pools.</p>
          <Code>{"RouteStepSettled(receiptId, stepIndex, providerId, adapter,\n  tokenIn, tokenOut, amountIn, amountOut, stepRouteId, hook, hookCodehash)"}</Code>
        </>,
      },
      {
        id: "fees",
        title: "FeeAccrued and FeeClaimed",
        body: <Code>{"FeeAccrued(token, beneficiary, amount)\nFeeClaimed(token, beneficiary, recipient, amount)"}</Code>,
      },
      {
        id: "checks",
        title: "Checks you can recompute",
        body: <ul>
          <li><code>grossFee = floor(amountIn × platformFeeBps / 10,000)</code></li>
          <li><code>rebate = floor(grossFee × rebateShareBps / 10,000)</code></li>
          <li><code>netFee = grossFee − rebate = referralFee + treasuryFee</code></li>
          <li><code>routedInput = amountIn − netFee</code> and equals the first step&apos;s <code>amountIn</code></li>
        </ul>,
      },
    ],
  },
  {
    slug: "api",
    title: "HTTP API",
    description: "Public endpoints for quotes, receipts, history and health.",
    keywords: "endpoint rest json quote receipts health",
    lead: "The app's own endpoints are public and return JSON. Amounts are integers in token base units.",
    sections: [
      {
        id: "quote",
        title: "POST /api/quote",
        body: <>
          <p>Returns the compared candidates and, when execution is allowed for the account, a signed quote.</p>
          <Code>{`{
  "tokenIn": "ETH",
  "tokenOut": "NVDA",
  "amountIn": "500000000000000",
  "slippageBps": 50,
  "routingMode": "best",          // best | v4 | v3 | mixed
  "account": "0x…",               // optional
  "recipient": "0x…",             // optional
  "referrer": "0x…"               // optional
}`}</Code>
        </>,
      },
      { id: "receipts", title: "GET /api/receipts?tx=0x…", body: <p>Decodes the settlement events of one transaction from the official router.</p> },
      { id: "history", title: "GET /api/history?account=0x…", body: <p>Recent settlements for an account, newest first. Use <code>before</code> to page.</p> },
      { id: "health", title: "GET /api/health", body: <p>Deployment status: chain, block number, router configuration and readiness flags.</p> },
    ],
  },
];

const security: DocPage[] = [
  {
    slug: "admin",
    title: "Admin and permissions",
    description: "What the owner and the pause guardian can and cannot do.",
    keywords: "owner guardian pause ownable timelock",
    lead: "The router has an owner and a pause guardian. Their powers are limited and every change emits an event.",
    sections: [
      {
        id: "owner",
        title: "The owner can",
        body: <ul>
          <li>Enable or disable an adapter, and set the hook provider.</li>
          <li>Publish a new fee policy version (capped at 1%) and switch the active version.</li>
          <li>Configure referrers, change the treasury, the quote signer and the pause guardian.</li>
          <li>Unpause the router.</li>
          <li>Rescue tokens sent to the router by mistake, but never fees that are reserved for a beneficiary.</li>
        </ul>,
      },
      {
        id: "cannot",
        title: "The owner cannot",
        body: <ul>
          <li>Edit a published fee policy or exceed the 1% cap.</li>
          <li>Move a user&apos;s tokens outside a swap the user signed.</li>
          <li>Take reserved treasury or referral fees.</li>
        </ul>,
      },
      {
        id: "guardian",
        title: "Pause guardian",
        body: <p>The owner or the pause guardian can pause swaps at once. Only the owner can resume. Ownership moves in two steps (transfer, then accept).</p>,
      },
    ],
  },
  {
    slug: "risks",
    title: "Risks and safeguards",
    description: "Known risks of using Perm and the safeguards in place.",
    keywords: "risk safety slippage audit",
    lead: "Using any on-chain router carries risk. These are the main ones and what Perm does about them.",
    sections: [
      {
        id: "safeguards",
        title: "Safeguards",
        body: <Table head={["Risk", "Safeguard"]} rows={[
          ["Price moves before your swap lands", "Signed minimum output, checked against what the recipient actually received."],
          ["Stale or replayed quote", "90-second deadline, 120-second on-chain age limit, one-time quote IDs."],
          ["Unknown venue or contract", "Only owner-enabled adapters; each adapter targets fixed, reviewed contracts."],
          ["Leftover allowances", "Exact approvals that are reset to zero in the same transaction; Permit2 per trade."],
          ["Beneficiary that cannot receive funds", "Pull-payment fee reserves; a claim never blocks a swap."],
          ["Emergency", "Owner or guardian can pause at once."],
        ]} />,
      },
      {
        id: "risks",
        title: "Risks that remain",
        body: <ul>
          <li>An external security review of the contracts has not been completed yet. The contracts are unit-tested and rehearsed against a mainnet fork.</li>
          <li>Thin pools can give a poor price even within your slippage setting.</li>
          <li>Stock tokens can trade away from the stock market price, and they are not shares.</li>
          <li>Uniswap and Permit2 are external contracts that Perm relies on.</li>
        </ul>,
      },
    ],
  },
  {
    slug: "release-status",
    title: "Release status",
    description: "What the current non-release mainnet phase means.",
    keywords: "staging allowlist non-release executionready",
    lead: "Perm is live on mainnet in an allowlisted, non-release phase.",
    sections: [
      {
        id: "what",
        title: "What that means",
        body: <Table head={["Item", "Status"]} rows={[
          ["Contracts", "Deployed, source verified on Blockscout and Sourcify"],
          ["Quotes and proofs", "Public"],
          ["Swaps through the app", "Allowlisted wallets only"],
          ["Public release", "Not yet; execution stays gated until the release checks are met"],
        ]} />,
      },
      {
        id: "health",
        title: "Check it yourself",
        body: <p><code>GET /api/health</code> reports <code>staging-ready-non-release</code> while this phase lasts.</p>,
      },
    ],
  },
];

export const DOC_GROUPS: DocGroup[] = [
  { title: "Start here", pages: startHere },
  { title: "Guides", pages: guides },
  { title: "Use Perm", pages: usePerm },
  { title: "Routing", pages: routing },
  { title: "Build on Perm", pages: build },
  { title: "Security", pages: security },
];

export const DOC_PAGES: (DocPage & { group: string })[] = DOC_GROUPS.flatMap((group) => group.pages.map((page) => ({ ...page, group: group.title })));

/** Sidebar data only (serialisable for the client component). */
export const DOC_NAV = DOC_GROUPS.map((group) => ({
  title: group.title,
  pages: group.pages.map((page) => ({ slug: page.slug, title: page.title, keywords: page.keywords || "" })),
}));

export function getDoc(slug: string) {
  const index = DOC_PAGES.findIndex((page) => page.slug === slug);
  if (index < 0) return null;
  return { page: DOC_PAGES[index], previous: DOC_PAGES[index - 1] || null, next: DOC_PAGES[index + 1] || null };
}
