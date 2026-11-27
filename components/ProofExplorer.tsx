"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatUnits, isHash, type Address, type Hex } from "viem";
import Header from "./Header";
import AudioToggle from "./AudioToggle";
import Footer from "./Footer";
import LiveTokenMark from "./LiveTokenMark";
import { LIVE_TOKEN_BY_ADDRESS, LIVE_TOKEN_MAP, type LiveToken } from "@/lib/web3/tokens";
import { NETWORK_COPY, PERM_CHAIN_ID, ZERO_ADDRESS } from "@/lib/web3/config";
import { usePermDeployment } from "@/lib/web3/local-deployment";
import { useWeb3 } from "./Web3Provider";

type ReceiptStep = {
  stepIndex: number;
  providerId: Hex;
  providerLabel: string;
  adapter: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  stepRouteId?: Hex;
  hook: Address;
  hookCodehash?: Hex;
  logIndex: number;
};

type OnchainReceipt = {
  chainId: number;
  routerVersion: number;
  router: Address;
  transactionHash: Hex;
  transactionIndex: number;
  blockNumber: string;
  blockHash: Hex;
  blockTimestamp: number;
  status: string;
  confirmations: string;
  gasUsed: string;
  actualNetworkFeeWei: string;
  actualNetworkFeeEth: string;
  explorerUrl: string;
  receiptId: Hex;
  quoteId: Hex;
  account: Address;
  recipient: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  routedInput: string;
  amountOut: string;
  grossFee: string;
  rebate: string;
  netFee: string;
  referralFee: string;
  treasuryFee?: string;
  policyVersion: number;
  routeId: Hex;
  routeHash?: Hex;
  steps: ReceiptStep[];
  logIndex: number;
  legacy?: boolean;
};

type ReceiptResult = { receipt?: OnchainReceipt; error?: string; key: string; hash: string };

const MAX_INITIAL_HISTORY_PAGES = 4;
const MAX_RECEIPT_HASHES = 24;

function localReceiptHashes() {
  try {
    const value = JSON.parse(localStorage.getItem("perm:receipts") || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && isHash(item)) : [];
  } catch {
    return [];
  }
}

export default function ProofExplorer() {
  const deployment = usePermDeployment();
  const { account } = useWeb3();
  const [query, setQuery] = useState("");
  const [manualHash, setManualHash] = useState("");
  const [results, setResults] = useState<ReceiptResult[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [loading, setLoading] = useState(true);

  const loadHashes = useCallback(async (hashes: string[]) => {
    const unique = [...new Set(hashes.filter((hash) => isHash(hash)))].slice(0, MAX_RECEIPT_HASHES);
    if (!unique.length) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const fetchHash = async (hash: string): Promise<ReceiptResult[]> => {
      try {
        const response = await fetch(`/api/receipts?tx=${encodeURIComponent(hash)}`, { cache: "no-store" });
        const data = await response.json() as {
          transaction?: Omit<OnchainReceipt, "receiptId" | "quoteId" | "account" | "recipient" | "tokenIn" | "tokenOut" | "amountIn" | "routedInput" | "amountOut" | "grossFee" | "rebate" | "netFee" | "referralFee" | "policyVersion" | "routeId" | "steps" | "logIndex">;
          settlements?: Array<Partial<OnchainReceipt>>;
          error?: string;
        };
        if (!response.ok || !data.transaction || !data.settlements) throw new Error(data.error || "Receipt unavailable");
        return data.settlements.map((settlement) => {
          const receipt = { ...data.transaction, ...settlement } as OnchainReceipt;
          return { hash, key: `${hash}:${receipt.logIndex}`, receipt };
        });
      } catch (cause) {
        return [{ hash, key: hash, error: cause instanceof Error ? cause.message : "Receipt unavailable" }];
      }
    };
    const groups: ReceiptResult[][] = [];
    for (let start = 0; start < unique.length; start += 4) {
      groups.push(...await Promise.all(unique.slice(start, start + 4).map(fetchHash)));
    }
    const next = groups.flat();
    setResults(next);
    const firstValid = next.find((item) => item.receipt)?.key;
    setSelectedKey((current) => current && next.some((item) => item.key === current) ? current : firstValid);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const local = localReceiptHashes();
      const indexed: string[] = [];
      let before: string | null | undefined;

      // The RPC fallback deliberately scans a bounded block window. Follow its
      // cursor so an empty newest window cannot hide older official receipts.
      // A hosted indexer normally satisfies this in a single request.
      try {
        for (let page = 0; page < MAX_INITIAL_HISTORY_PAGES && indexed.length < MAX_RECEIPT_HASHES; page += 1) {
          const params = new URLSearchParams();
          if (account) params.set("account", account);
          if (before) params.set("before", before);
          const response = await fetch(`/api/history${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
          const data = await response.json() as {
            items?: Array<{ transactionHash: string }>;
            nextBefore?: string | null;
            error?: string;
          };
          if (!response.ok) throw new Error(data.error || "History unavailable");
          indexed.push(...(data.items?.map((item) => item.transactionHash) || []));
          before = data.nextBefore;
          if (!before) break;
        }
      } catch {
        // Locally stored receipt hashes remain verifiable when history is unavailable.
      }

      if (!cancelled) await loadHashes([...local, ...indexed]);
    };
    void run();
    return () => { cancelled = true; };
  }, [account, loadHashes]);

  const addManual = () => {
    if (!isHash(manualHash)) return;
    const existing = localReceiptHashes();
    const next = [manualHash, ...existing.filter((hash) => hash.toLowerCase() !== manualHash.toLowerCase())].slice(0, 30);
    try { localStorage.setItem("perm:receipts", JSON.stringify(next)); } catch { /* Verification still works when storage is unavailable. */ }
    setManualHash("");
    void loadHashes([...next, ...results.map((item) => item.hash)]);
  };

  const filtered = useMemo(() => results.filter(({ receipt, hash }) => {
    if (!query) return true;
    const routeText = receipt?.steps.map((step) => `${step.providerLabel} ${step.adapter} ${step.stepRouteId || ""}`).join(" ") || "";
    const haystack = receipt ? `${hash} ${receipt.receiptId} ${receipt.account} ${receipt.recipient} ${receipt.routeId} ${routeText}` : hash;
    return haystack.toLowerCase().includes(query.toLowerCase());
  }), [results, query]);
  const selected = results.find((item) => item.key === selectedKey)?.receipt;

  const tokenFor = (address: Address): LiveToken => LIVE_TOKEN_BY_ADDRESS[address.toLowerCase()] || {
    symbol: "ETH", displaySymbol: "TOKEN", name: "Unknown token", address, decimals: 18, color: "#64748b", venue: "both",
  };
  const inputToken = selected ? tokenFor(selected.tokenIn) : LIVE_TOKEN_MAP.ETH;
  const outputToken = selected ? tokenFor(selected.tokenOut) : LIVE_TOKEN_MAP.NVDA;
  const fmt = (raw: string, token: LiveToken) => {
    const [whole, fraction] = formatUnits(BigInt(raw), token.decimals).split(".");
    const groupedWhole = BigInt(whole).toLocaleString("en-US");
    return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
  };

  return (
    <main className="app-page light-app proofs-page">
      <Header extra={<AudioToggle />} />
      <div className="app-aurora" aria-hidden="true"><i /><i /><i /><b /><b /></div>
      <section className="data-shell app-enter">
        <header className="data-hero">
          <span className="section-kicker">OFFICIAL SETTLEMENT PROOF · {NETWORK_COPY.kicker}</span>
          <h1>Exact router. Exact event. Every step.</h1>
          <p>Proofs are accepted only from the official manifest router. Router overrides are rejected, every SwapSettled event is decoded, and v2 receipts include each adapter, provider, pool identity, and hook claim.</p>
          <div className="data-disclaimer"><i /> No official successful event means no receipt and no rebate claim</div>
        </header>

        <section className="proof-workbench data-panel">
          <div className="proof-list-panel">
            <header><div><span className="section-kicker">ONCHAIN + INDEXED HISTORY</span><h2>Settlement records</h2></div><span className="proof-count">{filtered.filter((item) => item.receipt).length.toString().padStart(2, "0")}</span></header>
            <label className="proof-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tx, receipt, account, or route" /></label>
            <div className="manual-receipt"><input value={manualHash} onChange={(event) => setManualHash(event.target.value.trim())} placeholder="Paste an official Perm transaction hash" /><button type="button" onClick={addManual} disabled={!isHash(manualHash)}>Verify</button></div>
            <div className="proof-list">
              {filtered.map((item, index) => {
                const receipt = item.receipt;
                const first = receipt ? tokenFor(receipt.tokenIn) : LIVE_TOKEN_MAP.ETH;
                const second = receipt ? tokenFor(receipt.tokenOut) : LIVE_TOKEN_MAP.NVDA;
                const provider = receipt?.steps.map((step) => step.providerLabel).join(" → ");
                return <button type="button" key={item.key} className={selectedKey === item.key ? "active" : ""} onClick={() => receipt && setSelectedKey(item.key)} style={{ "--row-delay": `${index * 55}ms` } as CSSProperties} disabled={!receipt}>
                  <span className="live-pair"><LiveTokenMark token={first} size={30} /><LiveTokenMark token={second} size={30} /></span>
                  <span><b>{receipt ? `${first.displaySymbol} → ${second.displaySymbol}` : "Unverified transaction"}</b><small>{receipt ? provider || "Legacy settlement" : item.error}</small></span>
                  <em>{receipt ? `${receipt.transactionHash.slice(0, 8)}…` : "INVALID"}</em>{receipt && <i>✓</i>}
                </button>;
              })}
              {loading && <div className="proof-empty">Reading official router logs from chain {PERM_CHAIN_ID}…</div>}
              {!loading && !filtered.length && <div className="proof-empty">No official receipt found. Connect the settlement wallet, execute a {NETWORK_COPY.testnet ? "testnet " : ""}swap, or paste a transaction hash.</div>}
            </div>
          </div>

          {selected ? <article className="proof-document" key={selected.receiptId}>
            <header><div className="proof-mark"><img src="/perm-mark.png" alt="" /></div><div><span>PERM SETTLEMENT RECEIPT · V{selected.routerVersion}</span><b>{selected.receiptId.slice(0, 12)}…{selected.receiptId.slice(-6)}</b></div><em><i /> OFFICIAL ROUTER</em></header>
            <div className="proof-pair"><LiveTokenMark token={inputToken} size={46} /><span><i /><i /><i /></span><LiveTokenMark token={outputToken} size={46} /><div><b>{inputToken.displaySymbol} → {outputToken.displaySymbol}</b><small>{selected.steps.map((step) => step.providerLabel).join(" → ") || "Legacy route"}</small></div></div>
            <dl>
              <div><dt>Actual input</dt><dd>{fmt(selected.amountIn, inputToken)} {inputToken.displaySymbol}</dd></div>
              <div><dt>Routed input</dt><dd>{fmt(selected.routedInput, inputToken)} {inputToken.displaySymbol}</dd></div>
              <div><dt>Actual recipient output</dt><dd>{fmt(selected.amountOut, outputToken)} {outputToken.displaySymbol}</dd></div>
              <div><dt>Gross Perm fee</dt><dd>{fmt(selected.grossFee, inputToken)} {inputToken.displaySymbol}</dd></div>
              <div className="proof-saved"><dt>Fee rebate</dt><dd>−{fmt(selected.rebate, inputToken)} {inputToken.displaySymbol}</dd></div>
              <div><dt>Net Perm fee</dt><dd>{fmt(selected.netFee, inputToken)} {inputToken.displaySymbol}</dd></div>
              <div><dt>Actual network fee</dt><dd>{selected.actualNetworkFeeEth} ETH</dd></div>
              <div><dt>Route steps</dt><dd>{selected.steps.length}</dd></div>
              <div><dt>Policy version</dt><dd><code>perm-v{selected.policyVersion}</code></dd></div>
              <div><dt>Recipient</dt><dd><code>{selected.recipient.slice(0, 8)}…{selected.recipient.slice(-6)}</code></dd></div>
            </dl>
            <section className="proof-route-steps"><span>PROVEN ROUTE</span>{selected.steps.map((step) => <div key={`${selected.receiptId}-${step.stepIndex}`}><b>{step.stepIndex + 1}. {step.providerLabel}</b><code>{step.stepRouteId ? `${step.stepRouteId.slice(0, 14)}…` : "legacy provider identity"}</code><small>{step.hook === ZERO_ADDRESS ? "no hook claim" : `hook ${step.hook.slice(0, 10)}… · code ${step.hookCodehash ? `${step.hookCodehash.slice(0, 12)}…` : "legacy/not recorded"}`}</small></div>)}</section>
            <div className="proof-hash"><span>CANONICAL CHAIN IDENTITY</span><div><a href={selected.explorerUrl} target="_blank" rel="noopener noreferrer"><code>tx {selected.transactionHash.slice(0, 18)}…{selected.transactionHash.slice(-12)} · log {selected.logIndex}</code></a><code>block {selected.blockHash.slice(0, 18)}…{selected.blockHash.slice(-12)}</code></div></div>
            <footer><span><i /> Chain {selected.chainId}</span><span><i /> Block {selected.blockNumber}</span><span><i /> {selected.confirmations} confirmations</span></footer><div className="proof-scan" />
          </article> : <article className="proof-document proof-document-empty"><img src="/perm-mark.png" alt="" /><span className="section-kicker">NO FABRICATED PROOF</span><h2>{deployment.router ? "Execute or verify a transaction" : "Publish Router v2 first"}</h2><p>Perm does not substitute demo records when no official settlement event exists.</p></article>}
        </section>
      </section>
      <div className="footer-shell app-footer"><Footer /></div>
    </main>
  );
}
