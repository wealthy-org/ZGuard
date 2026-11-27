"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import Header from "./Header";
import AudioToggle from "./AudioToggle";
import Footer from "./Footer";
import LiveTokenMark from "./LiveTokenMark";
import { useWeb3 } from "./Web3Provider";
import { erc20Abi, permRouterAbi } from "@/lib/web3/abis";
import {
  IS_MAINNET,
  NETWORK_COPY,
  PERMIT2_ADDRESS,
  REVIEWED_V2_CLIENT_ENABLED,
  REVIEWED_V2,
  AGGREGATOR_HOOKS_CLIENT_ENABLED,
  PERM_CHAIN_ID,
  PERM_EXPLORER,
  V3_VENUE,
  ZERO_ADDRESS,
  getRobinhoodPublicClient,
} from "@/lib/web3/config";
import {
  LIVE_TOKENS,
  LIVE_TOKEN_MAP,
  type LiveToken,
  type LiveTokenSymbol,
} from "@/lib/web3/tokens";
import type { LiveQuote } from "@/lib/web3/quote";
import { usePermDeployment } from "@/lib/web3/local-deployment";
import { submitWalletTransactionWithRecovery } from "@/lib/web3/wallet-transaction";
import { ZGuardBlockedError, fetchZGuardStatus, guardPermSwap, type ZGuardStatus } from "@/lib/zguard/client";

type PickerSide = "sell" | "buy" | null;
type TxStage = "idle" | "approving" | "signing" | "simulating" | "guarding" | "submitting" | "confirming" | "success" | "error";
const BUSY_STAGES: TxStage[] = ["approving", "signing", "simulating", "guarding", "submitting", "confirming"];
type RoutingMode = "best" | "v4" | "v3" | "v2" | "mixed" | "hooks";

type TxStatus = {
  stage: TxStage;
  message?: string;
  hash?: Hex;
};

type ReferralStatus = "none" | "checking" | "active" | "invalid" | "unconfigured" | "error";

type AllowanceState = {
  account?: Address;
  token?: Address;
  router: bigint;
  permit2: bigint;
};

const publicClient = getRobinhoodPublicClient();

function randomPermitNonce() {
  const words = new Uint32Array(8);
  crypto.getRandomValues(words);
  return BigInt(`0x${[...words].map((word) => word.toString(16).padStart(8, "0")).join("")}`);
}

export default function TradeApp() {
  const { account, isCorrectChain, connecting, connect, switchNetwork, walletClient } = useWeb3();
  const deployment = usePermDeployment();
  const [sellSymbol, setSellSymbol] = useState<LiveTokenSymbol>("ETH");
  const [buySymbol, setBuySymbol] = useState<LiveTokenSymbol>("NVDA");
  const [amount, setAmount] = useState("0.01");
  const [slippage, setSlippage] = useState(0.5);
  const [routingMode, setRoutingMode] = useState<RoutingMode>("best");
  const [preferPermit2, setPreferPermit2] = useState(true);
  const [details, setDetails] = useState(true);
  const [picker, setPicker] = useState<PickerSide>(null);
  const [tokenSearch, setTokenSearch] = useState("");
  const [recipient, setRecipient] = useState("");
  const [referrer, setReferrer] = useState<Address>(ZERO_ADDRESS);
  const [referralStatus, setReferralStatus] = useState<ReferralStatus>("none");
  const [referralShareBps, setReferralShareBps] = useState(0);
  const [allowances, setAllowances] = useState<AllowanceState>({ router: 0n, permit2: 0n });
  const [quote, setQuote] = useState<LiveQuote>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteTick, setQuoteTick] = useState(0);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [balanceAccount, setBalanceAccount] = useState<Address>();
  const balanceRequest = useRef(0);
  const pickerRef = useRef<HTMLElement>(null);
  const [tx, setTx] = useState<TxStatus>({ stage: "idle" });
  // ZGuard gate (default-on). Until the status loads it is assumed enforce, never off.
  const [zguard, setZguard] = useState<ZGuardStatus>({ mode: "enforce", ready: false, network: "", problem: null });

  useEffect(() => {
    let cancelled = false;
    void fetchZGuardStatus().then((status) => { if (!cancelled) setZguard(status); });
    return () => { cancelled = true; };
  }, []);

  const sellToken = LIVE_TOKEN_MAP[sellSymbol];
  const buyToken = LIVE_TOKEN_MAP[buySymbol];
  const recipientAddress = recipient.trim() || account || "";
  const recipientValid = Boolean(recipientAddress && isAddress(recipientAddress));
  const slippageBps = Math.round(slippage * 100);
  const hasReferral = referrer !== ZERO_ADDRESS;
  const selfReferral = Boolean(account && hasReferral && account.toLowerCase() === referrer.toLowerCase());
  const referralReady = referralStatus === "none" || referralStatus === "active";
  const referralIssue = selfReferral
    ? "Self-referral is not permitted. Open the trade page without your own referral link."
    : referralStatus === "invalid"
      ? "The referral link contains an invalid address."
      : referralStatus === "unconfigured"
        ? "This address is not an active Router referral. No referral quote was created."
        : referralStatus === "error"
          ? "The referral could not be verified against the Router."
          : undefined;

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("referrer")?.trim();
    if (!raw) {
      setReferrer(ZERO_ADDRESS);
      setReferralStatus("none");
      return;
    }
    if (!isAddress(raw)) {
      setReferrer(ZERO_ADDRESS);
      setReferralStatus("invalid");
      return;
    }
    const address = getAddress(raw);
    if (address === ZERO_ADDRESS) {
      setReferrer(ZERO_ADDRESS);
      setReferralStatus("invalid");
      return;
    }
    setReferrer(address);
    setReferralStatus("checking");
  }, []);

  useEffect(() => {
    if (!hasReferral || !deployment.router) return;
    let cancelled = false;
    setReferralStatus("checking");
    void publicClient.readContract({
      address: deployment.router,
      abi: permRouterAbi,
      functionName: "referralShares",
      args: [referrer],
    }).then((share) => {
      if (cancelled) return;
      const bps = Number(share);
      setReferralShareBps(bps);
      setReferralStatus(bps > 0 ? "active" : "unconfigured");
    }).catch(() => {
      if (!cancelled) setReferralStatus("error");
    });
    return () => { cancelled = true; };
  }, [deployment.router, hasReferral, referrer]);

  const parsedAmount = useMemo(() => {
    try {
      const parsed = parseUnits(amount || "0", sellToken.decimals);
      return parsed > 0n ? parsed : 0n;
    } catch {
      return 0n;
    }
  }, [amount, sellToken.decimals]);

  const refreshBalances = useCallback(async () => {
    const requestId = ++balanceRequest.current;
    setBalanceAccount(undefined);
    if (!account) {
      setBalances({});
      return;
    }
    const next: Record<string, bigint> = {};
    const balanceTokens = [...new Map([sellToken, buyToken, LIVE_TOKEN_MAP.ETH].map((token) => [token.symbol, token])).values()];
    await Promise.all(balanceTokens.map(async (token) => {
      try {
        next[token.symbol] = token.address === ZERO_ADDRESS
          ? await publicClient.getBalance({ address: account })
          : await publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
      } catch {
        next[token.symbol] = 0n;
      }
    }));
    if (requestId !== balanceRequest.current) return;
    setBalances((current) => ({ ...current, ...next }));
    setBalanceAccount(account);
  }, [account, sellToken, buyToken]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    let cancelled = false;
    if (!account || !deployment.router || sellToken.address === ZERO_ADDRESS) {
      setAllowances({ account, token: sellToken.address, router: 0n, permit2: 0n });
      return;
    }
    void Promise.all([
      publicClient.readContract({
        address: sellToken.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, deployment.router],
      }),
      publicClient.readContract({
        address: sellToken.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, deployment.permit2 || PERMIT2_ADDRESS],
      }),
    ]).then(([router, permit2]) => {
      if (!cancelled) setAllowances({ account, token: sellToken.address, router, permit2 });
    }).catch(() => {
      if (!cancelled) setAllowances({ account, token: sellToken.address, router: 0n, permit2: 0n });
    });
    return () => { cancelled = true; };
  }, [account, deployment.permit2, deployment.router, quoteTick, sellToken.address]);

  useEffect(() => {
    const timer = window.setInterval(() => setQuoteTick((value) => value + 1), 25_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!picker) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPicker(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(pickerRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled])") || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [picker]);

  useEffect(() => {
    setQuote(undefined);
    setQuoteError(undefined);
    if (!parsedAmount || slippageBps < 1 || slippageBps > 2_000 || !referralReady || selfReferral) {
      setQuoteLoading(false);
      if (referralIssue) setQuoteError(referralIssue);
      return;
    }
    setQuoteLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tokenIn: sellSymbol,
            tokenOut: buySymbol,
            amountIn: parsedAmount.toString(),
            slippageBps,
            account: account || ZERO_ADDRESS,
            recipient: recipientValid ? recipientAddress : ZERO_ADDRESS,
            referrer,
            routingMode,
          }),
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json() as LiveQuote & { error?: string };
        if (!response.ok) throw new Error(data.error || "Live quote failed");
        setQuote(data);
      } catch (cause) {
        if ((cause as { name?: string }).name !== "AbortError") {
          setQuoteError(cause instanceof Error ? cause.message : "Live quote failed");
        }
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [sellSymbol, buySymbol, parsedAmount, slippageBps, routingMode, quoteTick, account, recipientAddress, recipientValid, referralIssue, referralReady, referrer, selfReferral]);

  const quoteMatchesInput = Boolean(
    quote
      && quote.amountIn === parsedAmount.toString()
      && quote.tokenIn.toLowerCase() === sellToken.address.toLowerCase()
      && quote.tokenOut.toLowerCase() === buyToken.address.toLowerCase()
      && quote.slippageBps === slippageBps
      && quote.routingMode === routingMode
      && account && quote.account.toLowerCase() === account.toLowerCase()
      && recipientValid && quote.recipient.toLowerCase() === recipientAddress.toLowerCase()
      && quote.referrer.toLowerCase() === referrer.toLowerCase(),
  );

  const gasReserve = quote ? BigInt(quote.selected.estimatedNetworkFeeWei) * 5n / 4n : parseEther("0.00002");
  const requiredNative = (sellToken.address === ZERO_ADDRESS ? parsedAmount : 0n) + gasReserve;
  const sellBalance = balances[sellSymbol];
  const nativeBalance = balances.ETH;
  const balancesReady = Boolean(account && balanceAccount?.toLowerCase() === account.toLowerCase());
  const tokenBalanceEnough = balancesReady && sellBalance !== undefined && sellBalance >= parsedAmount;
  const gasBalanceEnough = balancesReady && nativeBalance !== undefined && nativeBalance >= requiredNative;
  const balanceEnough = tokenBalanceEnough && gasBalanceEnough;
  const allowancesCurrent = Boolean(
    account
      && allowances.account?.toLowerCase() === account.toLowerCase()
      && allowances.token?.toLowerCase() === sellToken.address.toLowerCase(),
  );
  const permit2Ready = sellToken.address !== ZERO_ADDRESS
    && allowancesCurrent
    && parsedAmount > 0n
    && allowances.permit2 >= parsedAmount;
  const routerAllowanceReady = sellToken.address !== ZERO_ADDRESS
    && allowancesCurrent
    && parsedAmount > 0n
    && allowances.router >= parsedAmount;

  const formatTokenAmount = (raw: string | bigint | undefined, token: LiveToken, maximum = 6) => {
    if (raw === undefined) return "—";
    const [whole = "0", fraction = ""] = formatUnits(BigInt(raw), token.decimals).split(".");
    const grouped = BigInt(whole || "0").toLocaleString("en-US");
    if (!fraction) return grouped;
    const firstNonzero = fraction.search(/[1-9]/);
    const end = whole === "0" && firstNonzero >= maximum ? Math.min(fraction.length, firstNonzero + 3) : maximum;
    const visible = fraction.slice(0, end).replace(/0+$/, "");
    return visible ? `${grouped}.${visible}` : grouped;
  };

  const formatExactTokenAmount = (raw: string | bigint | undefined, token: LiveToken) => {
    if (raw === undefined) return "—";
    const [whole, fraction] = formatUnits(BigInt(raw), token.decimals).split(".");
    const groupedWhole = BigInt(whole).toLocaleString("en-US");
    return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
  };

  const openPicker = (side: Exclude<PickerSide, null>) => {
    setTokenSearch("");
    setPicker(side);
  };

  const chooseToken = (symbol: LiveTokenSymbol) => {
    if (picker === "sell") {
      setSellSymbol(symbol);
      if (symbol === buySymbol) setBuySymbol(symbol === "ETH" ? "NVDA" : "ETH");
    } else if (picker === "buy") {
      setBuySymbol(symbol);
      if (symbol === sellSymbol) setSellSymbol(symbol === "ETH" ? "NVDA" : "ETH");
    }
    setPicker(null);
    setTx({ stage: "idle" });
  };

  const flip = () => {
    setSellSymbol(buySymbol);
    setBuySymbol(sellSymbol);
    if (quote?.selected.amountOut) setAmount(formatUnits(BigInt(quote.selected.amountOut), buyToken.decimals));
    setTx({ stage: "idle" });
  };

  const setMax = () => {
    const balance = balances[sellSymbol];
    if (balance === undefined) return;
    if (sellToken.address !== ZERO_ADDRESS) return setAmount(formatUnits(balance, sellToken.decimals));
    const reserve = quote ? BigInt(quote.selected.estimatedNetworkFeeWei) * 3n / 2n : parseEther("0.00003");
    setAmount(formatUnits(balance > reserve ? balance - reserve : 0n, sellToken.decimals));
  };

  const filteredTokens = LIVE_TOKENS.filter((token) => `${token.symbol} ${token.name}`.toLowerCase().includes(tokenSearch.toLowerCase()));

  const refreshAfterApproval = async (hash: Hex, message: string) => {
    await publicClient.waitForTransactionReceipt({ hash });
    setQuote(undefined);
    setQuoteTick((value) => value + 1);
    setTx({ stage: "success", hash, message: `${message} A fresh route is loading; review it and press Swap again.` });
    await refreshBalances();
  };

  const execute = async () => {
    if (!account) return void connect().catch((cause) => setTx({ stage: "error", message: cause instanceof Error ? cause.message : "Wallet connection failed" }));
    if (!isCorrectChain) return void switchNetwork().catch((cause) => setTx({ stage: "error", message: cause instanceof Error ? cause.message : "Network switch failed" }));
    if (!quote || !deployment.router || !recipientValid || !quoteMatchesInput || !quote.executable || !balanceEnough) return;

    try {
      const wallet = walletClient();
      const request = {
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: BigInt(quote.amountIn),
        minAmountOut: BigInt(quote.selected.minAmountOut),
        gasEstimate: BigInt(quote.selected.gasEstimate),
        recipient: recipientAddress as Address,
        deadline: BigInt(quote.deadline),
        quotedAt: BigInt(quote.quotedAt),
        policyVersion: quote.policyVersion,
        chainId: BigInt(quote.chainId),
        quoteId: quote.quoteId,
        referrer: quote.referrer,
        routeData: quote.selected.routeData,
      } as const;
      let permitInput = { nonce: 0n, deadline: 0n, signature: "0x" as Hex };

      if (quote.tokenIn !== ZERO_ADDRESS) {
        const [routerAllowance, permitAllowance] = await Promise.all([
          publicClient.readContract({ address: quote.tokenIn, abi: erc20Abi, functionName: "allowance", args: [account, deployment.router] }),
          publicClient.readContract({ address: quote.tokenIn, abi: erc20Abi, functionName: "allowance", args: [account, deployment.permit2 || PERMIT2_ADDRESS] }),
        ]);
        if (preferPermit2 && permitAllowance >= request.amountIn) {
          setTx({ stage: "signing", message: "Sign a one-trade Permit2 authorization. This is not an onchain transaction." });
          const nonce = randomPermitNonce();
          const deadline = BigInt(quote.deadline);
          const signature = await wallet.signTypedData({
            account,
            domain: { name: "Permit2", chainId: PERM_CHAIN_ID, verifyingContract: deployment.permit2 || PERMIT2_ADDRESS },
            types: {
              TokenPermissions: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              PermitTransferFrom: [
                { name: "permitted", type: "TokenPermissions" },
                { name: "spender", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
              ],
            },
            primaryType: "PermitTransferFrom",
            message: {
              permitted: { token: quote.tokenIn, amount: request.amountIn },
              spender: deployment.router,
              nonce,
              deadline,
            },
          });
          permitInput = { nonce, deadline, signature };
        } else if (routerAllowance < request.amountIn) {
          const spender = preferPermit2 ? (deployment.permit2 || PERMIT2_ADDRESS) : deployment.router;
          setTx({ stage: "approving", message: `Approve exactly ${formatTokenAmount(request.amountIn, sellToken)} ${sellToken.displaySymbol} to ${preferPermit2 ? "Permit2" : "PermRouter"}` });
          const approval = await wallet.writeContract({
            account,
            chain: wallet.chain,
            address: quote.tokenIn,
            abi: erc20Abi,
            functionName: "approve",
            args: [spender, request.amountIn],
          });
          await refreshAfterApproval(approval, "Exact approval confirmed.");
          return;
        }
      }

      const latest = await publicClient.getBlock({ blockTag: "latest" });
      if (latest.timestamp > BigInt(quote.deadline)) {
        setQuoteTick((value) => value + 1);
        throw new Error("Quote expired. A fresh signed route is loading; confirm again.");
      }

      setTx({ stage: "simulating", message: "Simulating the exact signed multi-venue route…" });
      const simulation = await publicClient.simulateContract({
        account,
        address: deployment.router,
        abi: permRouterAbi,
        functionName: "swapExactInput",
        args: [request, quote.quoteSignature, permitInput],
        value: quote.tokenIn === ZERO_ADDRESS ? request.amountIn : 0n,
      });

      const router = deployment.router;
      // ZGuard gate: the exact bytes below are checked by ZGuard and are the only bytes sent to the wallet.
      const swapData = encodeFunctionData({ abi: permRouterAbi, functionName: "swapExactInput", args: simulation.request.args });
      const swapValue = simulation.request.value ?? 0n;
      setTx({ stage: "guarding", message: "ZGuard is checking the exact swap (quote parity, simulation, token risk)…" });
      const guard = await guardPermSwap({ chainId: PERM_CHAIN_ID, router, from: account, data: swapData, value: swapValue });
      const guardNote = guard.mode === "off" ? " ZGuard was switched off for this deployment." : ` ZGuard allow ${guard.verdict.decisionId ?? ""}`.trimEnd() + ".";

      let recoveryFromBlock = await publicClient.getBlockNumber();
      setTx({ stage: "submitting", message: "Confirm in your wallet. If its response is delayed, Perm will recover the canonical settlement…" });
      const hash = await submitWalletTransactionWithRecovery({
        submit: () => wallet.sendTransaction({ account, chain: wallet.chain, to: router, data: swapData, value: swapValue }),
        findCanonicalHash: async () => {
          const latestBlock = await publicClient.getBlockNumber();
          if (latestBlock < recoveryFromBlock) return undefined;
          const logs = await publicClient.getContractEvents({
            address: router,
            abi: permRouterAbi,
            eventName: "SwapSettled",
            args: { quoteId: request.quoteId, account },
            fromBlock: recoveryFromBlock,
            toBlock: latestBlock,
          });
          recoveryFromBlock = latestBlock + 1n;
          return logs[0]?.transactionHash;
        },
      });
      setTx({ stage: "confirming", hash, message: NETWORK_COPY.confirmationMessage });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error("The transaction reverted; no fee or rebate receipt was created.");

      try {
        const stored = JSON.parse(localStorage.getItem("perm:receipts") || "[]");
        const saved = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
        localStorage.setItem("perm:receipts", JSON.stringify([hash, ...saved.filter((item) => item !== hash)].slice(0, 30)));
      } catch {
        try { localStorage.setItem("perm:receipts", JSON.stringify([hash])); } catch { /* Onchain success must not be relabeled as a UI failure. */ }
      }
      setTx({ stage: "success", hash, message: `Settled onchain. Every route step is now available in the proof.${guardNote}` });
      await refreshBalances();
      setQuoteTick((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ZGuardBlockedError) return setTx({ stage: "error", message: cause.message });
      const detail = cause as { shortMessage?: string; message?: string };
      setTx({ stage: "error", message: detail.shortMessage || detail.message || "Transaction failed" });
    }
  };

  const primaryLabel = (() => {
    if (connecting) return "Connecting wallet…";
    if (!account) return "Connect wallet";
    if (!isCorrectChain) return `Switch to ${NETWORK_COPY.shortName}`;
    if (!deployment.ready) return IS_MAINNET ? "Execution not enabled yet" : deployment.stagingConfigured ? "Staging E2E pending" : "Deploy Router v2";
    if (!recipientValid) return "Enter a valid recipient";
    if (!balancesReady) return "Loading balances…";
    if (!balanceEnough) return "Insufficient balance / gas";
    if (quoteLoading) return "Comparing verified routes…";
    if (!quote) return quoteError ? "Route unavailable" : "Enter an amount";
    if (!quoteMatchesInput) return "Waiting for matching quote…";
    if (!quote.executable) return "Signed execution unavailable";
    if (BUSY_STAGES.includes(tx.stage)) return tx.message || "Working…";
    if (zguard.mode === "enforce" && !zguard.ready) return "ZGuard unavailable · swap blocked";
    return `Swap on ${NETWORK_COPY.shortName}`;
  })();

  const buttonDisabled = Boolean(account && isCorrectChain && (
    !deployment.ready || !quote || !quoteMatchesInput || !quote.executable || !recipientValid || !balanceEnough || quoteLoading
    || BUSY_STAGES.includes(tx.stage)
    || (zguard.mode === "enforce" && !zguard.ready)
  ));
  const quoteKey = quote?.quoteId || `${sellSymbol}-${buySymbol}-${amount}`;
  const netFeeBps = quote ? quote.platformFeeBps * (10_000 - quote.rebateShareBps) / 10_000 : undefined;

  return (
    <main className="app-page trade-page light-app">
      <Header extra={<AudioToggle />} />
      <div className="app-aurora" aria-hidden="true"><i /><i /><i /><b /><b /></div>

      <section className="trade-shell app-enter">
        <div className="trade-intro">
          <span className="section-kicker">PERM ROUTER V2 · {NETWORK_COPY.kicker}</span>
          <h1>Signed quotes. Multi-venue execution.</h1>
          <p>Perm compares Uniswap v4 and {V3_VENUE.shortLabel} candidates, supports token-to-token routes through ETH, applies the live fee policy, and signs every executable route before settlement.</p>
          <div className="intro-points"><span><i>01</i> EIP-712 quote</span><span><i>02</i> Multi-hop routes</span><span><i>03</i> Step-level proof</span></div>
        </div>

        <div className="token-marquee" aria-label={`${NETWORK_COPY.name} execution assets`}><div>
          {[...LIVE_TOKENS, ...LIVE_TOKENS].map((token, index) => <span key={`${token.symbol}-${index}`}><LiveTokenMark token={token} size={21} /><b>{token.displaySymbol}</b><small>{token.venue.replace("uniswap-", "").replace("synthra-", "")}</small></span>)}
        </div></div>

        <div className="trade-grid">
          <section className="swap-panel glass-panel" aria-label="Executable swap">
            <header className="panel-header"><div><span className="section-kicker">EXACT INPUT</span><h2>Signed route</h2></div><button className="network-chip" type="button" onClick={() => void switchNetwork().catch(() => undefined)}><i /> {NETWORK_COPY.chipLabel} <span>{PERM_CHAIN_ID}</span></button></header>
            <div className={`preview-banner${deployment.ready ? " live-banner" : ""}`}><i /> {
              IS_MAINNET
                ? deployment.mode === "allowlisted-staging"
                  ? "Router v2 on Robinhood Chain · allowlisted wallets · every settlement verifiable on Blockscout"
                  : deployment.ready
                    ? "Router v2 on Robinhood Chain · every settlement verifiable on Blockscout"
                    : "Read-only quotes · execution is not enabled for this wallet yet"
                : deployment.mode === "allowlisted-staging"
                  ? deployment.ready
                    ? "Allowlisted Router v2 staging · non-release · testnet assets only"
                    : "Allowlisted Router v2 staging · canonical E2E required before UI execution"
                  : deployment.ready
                    ? "Router v2 execution · testnet assets have no monetary value"
                    : "Router v1 is read-only · deploy and publish v2 before execution"
            }</div>
            {zguard.mode === "off"
              ? <div className="referral-banner invalid zguard-banner" role="alert"><i /><span><b>UNGUARDED</b> · ZGuard is switched off for this deployment (PERM_ZGUARD_MODE=off). Swaps are not checked before signing.</span></div>
              : zguard.ready
                ? <div className="referral-banner active zguard-banner"><i /><span>ZGuard on · every swap is checked before your wallet signs</span></div>
                : <div className="referral-banner invalid zguard-banner" role="alert"><i /><span>ZGuard is required but unavailable{zguard.problem ? ` (${zguard.problem})` : ""}. Swaps are blocked until it is reachable.</span></div>}
            {referralStatus === "checking" && <div className="referral-banner checking"><i /><span>Verifying referral against Router v2…</span></div>}
            {referralStatus === "active" && <div className="referral-banner active"><i /><span>Referral active</span><code>{referrer.slice(0, 8)}…{referrer.slice(-6)}</code><b>{(referralShareBps / 100).toFixed(2).replace(/\.00$/, "")}% of net fee</b></div>}
            {referralIssue && <div className="referral-banner invalid"><i /><span>{referralIssue}</span></div>}

            <div className="mode-tabs" role="group" aria-label="Routing mode">
              <button type="button" className={routingMode === "best" ? "active" : ""} onClick={() => setRoutingMode("best")}>Highest net output</button>
              <button type="button" className={routingMode === "v4" ? "active" : ""} onClick={() => setRoutingMode("v4")}>V4 only</button>
              <button type="button" className={routingMode === "v3" ? "active" : ""} onClick={() => setRoutingMode("v3")}>{V3_VENUE.shortLabel}</button>
              {REVIEWED_V2_CLIENT_ENABLED && <button type="button" className={routingMode === "v2" ? "active" : ""} onClick={() => setRoutingMode("v2")}>{REVIEWED_V2.shortLabel}</button>}
              <button type="button" className={routingMode === "mixed" ? "active" : ""} onClick={() => setRoutingMode("mixed")}>V4 ↔ V3</button>
              {(IS_MAINNET ? AGGREGATOR_HOOKS_CLIENT_ENABLED : true) && <button type="button" disabled={!IS_MAINNET && deployment.allowlistedStaging} className={routingMode === "hooks" ? "active" : ""} onClick={() => setRoutingMode("hooks")}>Aggregator Hook</button>}
            </div>
            <div className="mode-warning">{IS_MAINNET
              ? `Eligible venues on Robinhood Chain: Uniswap v4 direct pools (no hook) and Uniswap v3 pools that passed a liquidity check${REVIEWED_V2_CLIENT_ENABLED ? ", plus Uniswap v2 pairs with enough depth" : ""}${AGGREGATOR_HOOKS_CLIENT_ENABLED ? ", plus Uniswap Aggregator Hook pools (Slipstream source, codehash-pinned, Uniswap protocol fee included in the quote)" : ""}. AMZN, NFLX and MSFT route through USDG. "V4 only" never uses a hook.`
              : deployment.allowlistedStaging
                ? "Aggregator Hook mode is disabled in non-release staging. Only verified direct v4 and Synthra v3 routes are eligible."
                : "Hook mode fails closed when no reviewed Aggregator Hook deployment is configured. Plain routes are never relabeled as hook routes."}</div>

            <label className="token-box">
              <span className="token-box-label">YOU PAY</span>
              <div className="token-row"><input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} aria-label={`Amount in ${sellSymbol}`} placeholder="0.0" /><button className="token-chip" type="button" onClick={() => openPicker("sell")}><LiveTokenMark token={sellToken} size={29} />{sellToken.displaySymbol}<span>⌄</span></button></div>
              <div className="token-sub"><span>Balance: {account ? formatTokenAmount(balances[sellSymbol], sellToken) : "connect wallet"}</span><button type="button" onClick={setMax}>MAX</button></div>
            </label>

            <div className="flip-row"><button type="button" onClick={flip} aria-label="Reverse tokens"><span>↓</span><span>↑</span></button></div>

            <div className="token-box output-box">
              <span className="token-box-label">YOU RECEIVE · LIVE ESTIMATE</span>
              <div className="token-row"><output key={quoteKey} className="quote-value">{quote ? formatTokenAmount(quote.selected.amountOut, buyToken) : quoteLoading ? "…" : "—"}</output><button className="token-chip" type="button" onClick={() => openPicker("buy")}><LiveTokenMark token={buyToken} size={29} />{buyToken.displaySymbol}<span>⌄</span></button></div>
              <div className="token-sub"><span>{quote?.selected.providerLabel || quoteError || "Awaiting verified candidates"}</span><span>{quote ? `block ${quote.blockNumber}` : ""}</span></div>
            </div>

            <button className="quote-summary" type="button" onClick={() => setDetails((value) => !value)} aria-expanded={details}><span><i className="route-dot" />Route, fee &amp; recipient</span><b>{details ? "−" : "+"}</b></button>
            {details && <div className="fee-breakdown">
              <div><span>Platform fee <small>gross · {quote?.platformFeeBps ?? "—"} bps</small></span><b>{formatExactTokenAmount(quote?.grossFee, sellToken)} {sellToken.displaySymbol}</b></div>
              <div className="rebate-line"><span>Fee rebate <small>{quote ? quote.rebateShareBps / 100 : "—"}% of Perm fee</small></span><b>−{formatExactTokenAmount(quote?.rebate, sellToken)} {sellToken.displaySymbol}</b></div>
              <div><span>Net platform fee <small>{netFeeBps === undefined ? "—" : `${netFeeBps} bps`}</small></span><b>{formatExactTokenAmount(quote?.netFee, sellToken)} {sellToken.displaySymbol}</b></div>
              <div><span>Minimum received <small>{slippage}% slippage</small></span><b>{formatTokenAmount(quote?.selected.minAmountOut, buyToken)} {buyToken.displaySymbol}</b></div>
              <div><span>Estimated network fee</span><b>{quote ? `${Number(formatEther(BigInt(quote.selected.estimatedNetworkFeeWei))).toPrecision(3)} ETH` : "—"}</b></div>
              <div><span>Gas-adjusted output</span><b>{quote?.selected.gasAdjustedOutput ? `${formatTokenAmount(quote.selected.gasAdjustedOutput, buyToken)} ${buyToken.displaySymbol}` : "shown separately"}</b></div>
              <div><span>Price impact estimate</span><b>{quote?.selected.priceImpactBps === undefined ? "unavailable" : `${(quote.selected.priceImpactBps / 100).toFixed(2)}%`}</b></div>
              <div><span>Fee policy</span><b><code>perm-v{quote?.policyVersion ?? "—"}</code></b></div>
              <label className="recipient-control"><span>Recipient</span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={account || "0x…"} /></label>
            </div>}

            <div className="slippage-row"><span>Slippage tolerance</span><div>{[0.1, 0.5, 1].map((value) => <button key={value} type="button" className={slippage === value ? "active" : ""} onClick={() => setSlippage(value)}>{value}%</button>)}<label className="custom-slippage"><input type="number" min="0.01" max="20" step="0.01" value={slippage} onChange={(event) => setSlippage(Math.min(20, Math.max(0.01, Number(event.target.value) || 0.01)))} /><span>%</span></label></div></div>
            <label className="permit-toggle"><input type="checkbox" checked={preferPermit2} onChange={(event) => setPreferPermit2(event.target.checked)} /><span>Use Permit2 signature when an allowance is available</span></label>
            <div className={`permit-readiness${sellToken.address === ZERO_ADDRESS || permit2Ready || (!preferPermit2 && routerAllowanceReady) ? " ready" : ""}`}>
              <i />
              <span>{sellToken.address === ZERO_ADDRESS
                ? "Native input: no token approval required."
                : !account
                  ? "Connect a wallet to inspect Permit2 and Router allowances."
                  : !allowancesCurrent
                    ? "Checking Permit2 and PermRouter allowances…"
                    : preferPermit2
                      ? permit2Ready
                        ? "Permit2 ready: the next token authorization is an offchain signature."
                        : "One-time exact Permit2 approval is required before signature-only transfer."
                      : routerAllowanceReady
                        ? "Exact PermRouter allowance is ready."
                        : "An exact PermRouter approval will be required before the swap."}</span>
            </div>
            {account && balancesReady && !balanceEnough && <div className="transaction-status error"><i /><span>{!tokenBalanceEnough ? `Insufficient ${sellToken.displaySymbol} balance.` : "Insufficient ETH for the reserved network gas."}</span></div>}
            {quote?.selected.priceImpactBps !== undefined && quote.selected.priceImpactBps >= 100 && <div className="transaction-status error"><i /><span>High estimated price impact: {(quote.selected.priceImpactBps / 100).toFixed(2)}%. Reduce size or review another route.</span></div>}
            {account && quoteError && <div className="transaction-status error"><i /><span>{quoteError}</span></div>}
            {quote && !quote.executable && quote.deploymentReason && <div className="transaction-status error"><i /><span>{quote.deploymentReason}</span></div>}

            {account && isCorrectChain && !deployment.ready && !IS_MAINNET ? <Link className="connect-action setup-action" href="/setup">{deployment.stagingConfigured ? "Staging E2E pending" : "Prepare Router v2 deployment"}</Link> : <button className="connect-action" type="button" disabled={buttonDisabled} onClick={() => void execute()}>{primaryLabel}</button>}
            {tx.message && <div className={`transaction-status ${tx.stage}`}><i /><span>{tx.message}</span>{tx.hash && <a href={`${PERM_EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer">Explorer ↗</a>}</div>}
            {tx.stage === "success" && tx.message?.startsWith("Settled") && <Link className="receipt-link" href="/proofs">Open settlement receipt →</Link>}
            <p className="swap-note">{NETWORK_COPY.assetBoundary}{IS_MAINNET ? " Quotes are estimates until settlement; the minimum received is enforced onchain." : ""}</p>

            {picker && <div className="token-picker-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPicker(null)}><section ref={pickerRef} className="token-picker" role="dialog" aria-modal="true" aria-labelledby="token-picker-title">
              <header><div><span className="section-kicker">CHAIN {PERM_CHAIN_ID}</span><h3 id="token-picker-title">{IS_MAINNET ? "Choose a token" : "Choose a testnet asset"}</h3></div><button type="button" onClick={() => setPicker(null)} aria-label="Close token picker">×</button></header>
              <label className="token-search"><span>⌕</span><input autoFocus value={tokenSearch} onChange={(event) => setTokenSearch(event.target.value)} placeholder="Search name or symbol" /></label>
              <div className="token-list">{filteredTokens.map((token) => {
                const current = picker === "sell" ? sellSymbol === token.symbol : buySymbol === token.symbol;
                return <button key={token.symbol} type="button" className={current ? "active" : ""} onClick={() => chooseToken(token.symbol)}><LiveTokenMark token={token} size={34} /><span><b>{token.displaySymbol}</b><small>{token.name}</small></span><em>{token.venue.replace("uniswap-", "").replace("synthra-", "")}</em>{current && <i>✓</i>}</button>;
              })}</div>
              <p>Token-to-token requests are routed through verified direct or ETH-intermediate venue steps; unavailable candidates are excluded.</p>
            </section></div>}
          </section>

          <aside className="route-panel glass-panel" aria-label="Live route comparison">
            <header className="panel-header route-panel-header"><div><span className="section-kicker">VALID CANDIDATES</span><h2>Same amount. Same policy.</h2></div><span className="fresh-chip"><i /> {quote ? "SIGNED" : "WAITING"}</span></header>
            <div className="pair-context"><span><LiveTokenMark token={sellToken} size={25} /><LiveTokenMark token={buyToken} size={25} /></span><div><b>{sellToken.displaySymbol} → {buyToken.displaySymbol}</b><small>exact input · chain {PERM_CHAIN_ID}</small></div><em>{quote?.candidates.length || 0} valid</em></div>
            <div className="route-list">
              {quote?.candidates.map((route, index) => <article className={`candidate${index === 0 ? " selected" : ""}`} key={route.routeId} style={{ "--row-delay": `${index * 60}ms` } as CSSProperties}>
                <div className="candidate-rank">{index === 0 ? "✓" : index + 1}</div>
                <div className="candidate-main"><div><h3>{route.providerLabel}</h3><span className="verified-chip">{route.routeKind.toUpperCase()}</span></div><p>{route.hook === ZERO_ADDRESS ? `${route.steps.length} verified step${route.steps.length > 1 ? "s" : ""} · no hook claim` : route.verifiedHook ? "Onchain codehash-verified hook" : "Hook unavailable"}</p><div className="route-path">{route.steps.map((step, stepIndex) => <span key={`${route.routeId}-${stepIndex}`}><em>{step.providerId === "WETH_WRAP" ? "WRAP · 1:1" : `${step.providerId === "SYNTHRA_V3" || step.providerId === "UNISWAP_V3" ? "V3" : step.providerId === "REVIEWED_V2_THIRD_PARTY" || step.providerId === "UNISWAP_V2" ? "V2" : step.providerId === "UNISWAP_V4_AGGREGATOR_HOOK" ? "V4 HOOK" : "V4"} · ${step.poolFee >= 0x800000 ? "dynamic" : `${step.poolFee / 10_000}%`}`}</em>{stepIndex < route.steps.length - 1 && <i />}</span>)}</div></div>
                <div className="candidate-output"><b>{formatTokenAmount(route.amountOut, buyToken)}</b><span>{buyToken.displaySymbol}</span><small>{Number(formatEther(BigInt(route.estimatedNetworkFeeWei))).toPrecision(3)} ETH gas</small></div>
              </article>)}
              {!quote && <div className="route-empty">{quoteLoading ? "Reading verified onchain quoters…" : quoteError || "Enter an amount to compare routes."}</div>}
            </div>
            <div className="comparison-note"><span>WHY THIS ROUTE</span><p>{quote ? quote.selected.gasNormalized ? "Candidates with a valid ETH-to-output conversion are ranked by estimated output after network gas." : "Output is ranked directly; gas remains separate where no trustworthy conversion exists." : "Invalid, stale, unverified-hook, or reverting candidates fail closed."}</p></div>
            <div className="receipt-preview"><div className="receipt-preview-head"><span>SETTLEMENT GATE</span><i>{deployment.ready ? "V2 READY" : IS_MAINNET ? "READ-ONLY" : "DEPLOY V2"}</i></div><div><span>Quote</span><b>EIP-712 server signature</b></div><div><span>Approval</span><b>exact or Permit2</b></div><div><span>Min output</span><b>recipient-bound</b></div><div><span>Receipt</span><b>route-step events</b></div></div>
          </aside>
        </div>
      </section>

      <section className="trade-explainer app-reveal"><div><span className="section-kicker">EXECUTION MODEL</span><h2>Every executable field is signed and checked.</h2></div><div className="explainer-grid"><article><b>01</b><h3>Signed accounting</h3><p>The fee policy, account, recipient, minimum, route hash, chain and expiry are part of one EIP-712 quote.</p></article><article><b>02</b><h3>Restricted adapters</h3><p>{IS_MAINNET ? "Every step uses an allowlisted adapter with immutable venue targets: the Uniswap v4 PoolManager and Uniswap v3 SwapRouter02." : "Every step uses an allowlisted adapter with immutable venue targets; v4 hooks are pinned to runtime codehash."}</p></article><article><b>03</b><h3>Proof after execution</h3><p>The router emits route and per-step identities only after actual recipient output passes the minimum.</p></article></div><Link href="/docs" className="button secondary">Read security boundaries</Link></section>
      <div className="footer-shell app-footer"><Footer /></div>
    </main>
  );
}
