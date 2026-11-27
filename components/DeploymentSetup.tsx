"use client";

import { useEffect, useState } from "react";
import { formatEther, isAddress, keccak256, toHex, type Abi, type Address, type Hex } from "viem";
import Header from "./Header";
import AudioToggle from "./AudioToggle";
import Footer from "./Footer";
import { shortAddress, useWeb3 } from "./Web3Provider";
import routerArtifact from "@/lib/web3/artifacts/PermRouter.json";
import v4Artifact from "@/lib/web3/artifacts/PermV4Adapter.json";
import v3Artifact from "@/lib/web3/artifacts/PermV3Adapter.json";
import { permRouterAbi, permV3AdapterAbi, permV4AdapterAbi } from "@/lib/web3/abis";
import { runtimeMatchesArtifact } from "@/lib/web3/bytecode";
import {
  PERMIT2_ADDRESS,
  POOL_MANAGER_ADDRESS,
  PERM_CHAIN_ID,
  PERM_EXPLORER,
  V3_VENUE,
  getRobinhoodPublicClient,
} from "@/lib/web3/config";
import {
  LOCAL_DEPLOYMENT_ENABLED,
  clearLocalDeployment,
  saveLocalDeployment,
  usePermDeployment,
  type LocalPermDeployment,
} from "@/lib/web3/local-deployment";

type Step = "idle" | "router" | "v4" | "v3" | "configure" | "verify" | "complete" | "error";
const publicClient = getRobinhoodPublicClient();

export default function DeploymentSetup() {
  const { account, isCorrectChain, connect, switchNetwork, walletClient } = useWeb3();
  const deployment = usePermDeployment();
  const [treasury, setTreasury] = useState("");
  const [quoteSigner, setQuoteSigner] = useState("");
  const [balance, setBalance] = useState<bigint>();
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState<string>();
  const [transactions, setTransactions] = useState<Hex[]>([]);

  useEffect(() => {
    if (account && !treasury) setTreasury(account);
    if (account) publicClient.getBalance({ address: account }).then(setBalance).catch(() => setBalance(undefined));
  }, [account, treasury]);

  useEffect(() => {
    if (deployment.ready && step === "idle") setStep("complete");
  }, [deployment.ready, step]);

  const deploy = async () => {
    if (!LOCAL_DEPLOYMENT_ENABLED) {
      setStep("error");
      setMessage("Production browser overrides are disabled. Use the reviewed CLI deployment flow in docs/DEPLOYMENT.md.");
      return;
    }
    if (!account) return void connect().catch((cause) => { setStep("error"); setMessage(cause instanceof Error ? cause.message : "Wallet connection failed"); });
    if (!isCorrectChain) return void switchNetwork().catch((cause) => { setStep("error"); setMessage(cause instanceof Error ? cause.message : "Network switch failed"); });
    if (!isAddress(treasury)) return void (setStep("error"), setMessage("Enter a valid treasury address."));
    if (!isAddress(quoteSigner)) return void (setStep("error"), setMessage("Enter the public address of the server quote signer."));

    setTransactions([]);
    setMessage(undefined);
    try {
      const targetCodes = await Promise.all([
        publicClient.getCode({ address: POOL_MANAGER_ADDRESS }),
        publicClient.getCode({ address: PERMIT2_ADDRESS }),
        publicClient.getCode({ address: V3_VENUE.swapRouter02 }),
        publicClient.getCode({ address: V3_VENUE.weth }),
      ]);
      if (targetCodes.some((code) => !code || code === "0x")) throw new Error("A required immutable venue target has no bytecode on chain 46630");
      const wallet = walletClient();

      setStep("router");
      setMessage("Deploy signed-quote PermRouter v2.");
      const routerHash = await wallet.deployContract({
        account, chain: wallet.chain, abi: routerArtifact.abi as Abi, bytecode: routerArtifact.bytecode as Hex,
        args: [account, treasury as Address, quoteSigner as Address, PERMIT2_ADDRESS],
      });
      setTransactions([routerHash]);
      const routerReceipt = await publicClient.waitForTransactionReceipt({ hash: routerHash });
      if (routerReceipt.status !== "success" || !routerReceipt.contractAddress) throw new Error("PermRouter v2 deployment reverted");
      const router = routerReceipt.contractAddress;

      setStep("v4");
      setMessage("Deploy codehash-pinned Uniswap v4 adapter.");
      const v4Hash = await wallet.deployContract({ account, chain: wallet.chain, abi: v4Artifact.abi as Abi, bytecode: v4Artifact.bytecode as Hex, args: [account, router, POOL_MANAGER_ADDRESS] });
      setTransactions((current) => [...current, v4Hash]);
      const v4Receipt = await publicClient.waitForTransactionReceipt({ hash: v4Hash });
      if (v4Receipt.status !== "success" || !v4Receipt.contractAddress) throw new Error("PermV4Adapter deployment reverted");
      const v4Adapter = v4Receipt.contractAddress;

      setStep("v3");
      setMessage("Deploy immutable Synthra SwapRouter02 adapter.");
      const v3Hash = await wallet.deployContract({ account, chain: wallet.chain, abi: v3Artifact.abi as Abi, bytecode: v3Artifact.bytecode as Hex, args: [account, router, V3_VENUE.swapRouter02, V3_VENUE.weth] });
      setTransactions((current) => [...current, v3Hash]);
      const v3Receipt = await publicClient.waitForTransactionReceipt({ hash: v3Hash });
      if (v3Receipt.status !== "success" || !v3Receipt.contractAddress) throw new Error("PermV3Adapter deployment reverted");
      const v3Adapter = v3Receipt.contractAddress;

      setStep("configure");
      setMessage("Allowlist both reviewed adapters. Each confirmation is a separate admin transaction.");
      const v4ConfigHash = await wallet.writeContract({ account, chain: wallet.chain, address: router, abi: permRouterAbi, functionName: "configureAdapter", args: [v4Adapter, keccak256(toHex("UNISWAP_V4_DIRECT")), true] });
      setTransactions((current) => [...current, v4ConfigHash]);
      if ((await publicClient.waitForTransactionReceipt({ hash: v4ConfigHash })).status !== "success") throw new Error("V4 adapter configuration reverted");
      const v3ConfigHash = await wallet.writeContract({ account, chain: wallet.chain, address: router, abi: permRouterAbi, functionName: "configureAdapter", args: [v3Adapter, keccak256(toHex(V3_VENUE.providerId)), true] });
      setTransactions((current) => [...current, v3ConfigHash]);
      if ((await publicClient.waitForTransactionReceipt({ hash: v3ConfigHash })).status !== "success") throw new Error("V3 adapter configuration reverted");
      // Hook execution remains disabled. A governed configureHookProvider call is
      // allowed only after docs/HOOK_ONBOARDING.md evidence has passed review.

      setStep("verify");
      setMessage("Verify compiled runtime templates, immutable targets, policy, signer and adapter registry.");
      const [
        routerCode, v4Code, v3Code, version, policy, signer, guardian, routerTreasury, routerPermit2,
        v4Config, v3Config, v4PinnedCodehash, v3PinnedCodehash, hookProviderId,
        v4Router, v4PoolManager, v3Router, v3SwapRouter, v3Weth,
      ] = await Promise.all([
        publicClient.getCode({ address: router }), publicClient.getCode({ address: v4Adapter }), publicClient.getCode({ address: v3Adapter }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "activePolicyVersion" }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "feePolicies", args: [1] }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "quoteSigner" }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "pauseGuardian" }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "treasury" }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "permit2" }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "adapters", args: [v4Adapter] }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "adapters", args: [v3Adapter] }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "adapterCodehashes", args: [v4Adapter] }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "adapterCodehashes", args: [v3Adapter] }),
        publicClient.readContract({ address: router, abi: permRouterAbi, functionName: "hookProviderIds", args: [v4Adapter] }),
        publicClient.readContract({ address: v4Adapter, abi: permV4AdapterAbi, functionName: "permRouter" }),
        publicClient.readContract({ address: v4Adapter, abi: permV4AdapterAbi, functionName: "poolManager" }),
        publicClient.readContract({ address: v3Adapter, abi: permV3AdapterAbi, functionName: "permRouter" }),
        publicClient.readContract({ address: v3Adapter, abi: permV3AdapterAbi, functionName: "swapRouter" }),
        publicClient.readContract({ address: v3Adapter, abi: permV3AdapterAbi, functionName: "weth" }),
      ]);
      if (!routerCode || !v4Code || !v3Code || !runtimeMatchesArtifact(routerCode, routerArtifact) || !runtimeMatchesArtifact(v4Code, v4Artifact) || !runtimeMatchesArtifact(v3Code, v3Artifact)) {
        throw new Error("Deployed runtime bytecode does not match the compiled artifact template");
      }
      if (version !== 1 || policy[0] !== 20 || policy[1] !== 2_500 || !policy[2] || !v4Config[0] || !v3Config[0]
        || v4PinnedCodehash !== keccak256(v4Code) || v3PinnedCodehash !== keccak256(v3Code)
        || hookProviderId !== `0x${"0".repeat(64)}`) throw new Error("Onchain v2 configuration/codehash mismatch or unreviewed hook identity enabled");
      if (signer.toLowerCase() !== quoteSigner.toLowerCase()) throw new Error("Onchain quote signer mismatch");
      if (guardian.toLowerCase() !== account.toLowerCase() || routerTreasury.toLowerCase() !== treasury.toLowerCase() || routerPermit2.toLowerCase() !== PERMIT2_ADDRESS.toLowerCase()) throw new Error("Router immutable/admin configuration mismatch");
      if (v4Router.toLowerCase() !== router.toLowerCase() || v4PoolManager.toLowerCase() !== POOL_MANAGER_ADDRESS.toLowerCase()) throw new Error("V4 adapter immutable configuration mismatch");
      if (v3Router.toLowerCase() !== router.toLowerCase() || v3SwapRouter.toLowerCase() !== V3_VENUE.swapRouter02.toLowerCase() || v3Weth.toLowerCase() !== V3_VENUE.weth.toLowerCase()) throw new Error("V3 adapter immutable configuration mismatch");

      const record: LocalPermDeployment = {
        chainId: PERM_CHAIN_ID,
        routerVersion: 2,
        permRouter: router,
        v4Adapter,
        v3Adapter,
        permit2: PERMIT2_ADDRESS,
        quoteSigner: quoteSigner as Address,
        owner: account,
        treasury: treasury as Address,
        pauseGuardian: account,
        deploymentBlock: routerReceipt.blockNumber.toString(),
        deploymentTransactions: [routerHash, v4Hash, v3Hash, v4ConfigHash, v3ConfigHash],
        generatedAt: new Date().toISOString(),
        source: "browser-wallet",
      };
      saveLocalDeployment(record);
      setStep("complete");
      setMessage("Development deployment verified. Export the manifest, configure the server signer key, publish sources, and review before shared use.");
      setBalance(await publicClient.getBalance({ address: account }));
    } catch (cause) {
      const detail = cause as { shortMessage?: string; message?: string };
      setStep("error");
      setMessage(detail.shortMessage || detail.message || "Deployment failed");
    }
  };

  const exportManifest = () => {
    if (!deployment.local) return;
    const file = new Blob([`${JSON.stringify({
      schemaVersion: 2,
      network: "Robinhood Chain Testnet",
      rpcUrl: "https://rpc.testnet.chain.robinhood.com",
      explorerUrl: PERM_EXPLORER,
      poolManager: POOL_MANAGER_ADDRESS,
      synthraV3: V3_VENUE,
      ...deployment.local,
      sourceVerification: "pending",
    }, null, 2)}\n`], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "robinhood-testnet-v2.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const actionLabel = step === "complete" ? "Router v2 active" : !LOCAL_DEPLOYMENT_ENABLED ? "Use CLI deployment" : !account ? "Connect deployment wallet" : !isCorrectChain ? "Switch to RH Testnet" : step === "idle" || step === "error" ? "Deploy Router v2 stack" : "Deployment in progress…";
  const busy = ["router", "v4", "v3", "configure", "verify"].includes(step);
  const steps: Array<[Step, string, string, string]> = [
    ["router", "01", "Deploy PermRouter v2", "EIP-712 signer, Permit2, pull-fees, route steps and rescue accounting."],
    ["v4", "02", "Deploy V4 adapter", "Immutable PoolManager and runtime-codehash-pinned hooks."],
    ["v3", "03", "Deploy V3 adapter", "Immutable reviewed Synthra Router02 and WETH targets."],
    ["configure", "04", "Allowlist adapters", "Enable direct v4 and Synthra v3; register a distinct hook evidence ID without approving any hook."],
    ["verify", "05", "Verify configuration", "Read bytecode, policy, signer and adapter registry from chain."],
  ];

  return <main className="app-page light-app setup-page">
    <Header extra={<AudioToggle />} /><div className="app-aurora" aria-hidden="true"><i /><i /><i /><b /><b /></div>
    <section className="data-shell app-enter">
      <header className="data-hero"><span className="section-kicker">ROUTER V2 TESTNET RELEASE</span><h1>Deploy, verify, then publish.</h1><p>The v2 stack closes unsigned quotes, push-fee failures, self-referral, missing route identity and address-only hook verification while adding v3 and multi-hop execution.</p><div className="data-disclaimer"><i /> Production browser address overrides are disabled · shared releases use a reviewed manifest and CLI verification</div></header>
      <section className="setup-workbench data-panel">
        <div className="setup-controls"><span className="section-kicker">DEPLOYMENT PARAMETERS</span><h2>Robinhood Chain Testnet</h2>
          <dl><div><dt>Chain ID</dt><dd>46630</dd></div><div><dt>Owner</dt><dd>{account ? shortAddress(account) : "Connect wallet"}</dd></div><div><dt>Wallet balance</dt><dd>{balance === undefined ? "—" : `${Number(formatEther(balance)).toFixed(5)} ETH`}</dd></div><div><dt>PoolManager</dt><dd><code>{shortAddress(POOL_MANAGER_ADDRESS)}</code></dd></div><div><dt>Permit2</dt><dd><code>{shortAddress(PERMIT2_ADDRESS)}</code></dd></div><div><dt>Policy v1</dt><dd>20 bps · 25% rebate</dd></div></dl>
          <label><span>Treasury / fee claimant</span><input value={treasury} onChange={(event) => setTreasury(event.target.value.trim())} placeholder="0x…" /></label>
          <label><span>Server quote signer public address</span><input value={quoteSigner} onChange={(event) => setQuoteSigner(event.target.value.trim())} placeholder="0x… (never enter the private key here)" /></label>
          <p>For a shared release, use <code>contracts:deploy:testnet</code> with a testnet-only deployer, Safe/timelock ownership, source verification, and a server-side signer key. Never paste a private key into this page.</p>
          <button className="connect-action" type="button" disabled={busy || step === "complete" || !LOCAL_DEPLOYMENT_ENABLED} onClick={() => void deploy()}>{actionLabel}</button>
          {message && <div className={`transaction-status ${step === "error" ? "error" : step === "complete" ? "success" : "confirming"}`}><i /><span>{message}</span></div>}
        </div>
        <div className="setup-progress"><span className="section-kicker">SEQUENCED RELEASE STEPS</span>{steps.map(([id, number, title, copy]) => {
          const order: Step[] = ["idle", "router", "v4", "v3", "configure", "verify", "complete"];
          const complete = step === "complete" || order.indexOf(step) > order.indexOf(id);
          return <article key={id} className={`${complete ? "complete" : ""}${step === id ? " active" : ""}`}><b>{complete ? "✓" : number}</b><div><h3>{title}</h3><p>{copy}</p></div></article>;
        })}
          {transactions.length > 0 && <div className="setup-transactions"><span>TRANSACTIONS</span>{transactions.map((hash) => <a key={hash} href={`${PERM_EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer">{hash.slice(0, 12)}…{hash.slice(-8)} ↗</a>)}</div>}
          {deployment.ready && deployment.router && <div className="setup-result"><b>{deployment.local ? "DEVELOPMENT V2 ACTIVE" : "SHARED ROUTER V2 MANIFEST"}</b><code>Router {shortAddress(deployment.router)}</code><code>V4 {shortAddress(deployment.v4Adapter)}</code><code>V3 {shortAddress(deployment.v3Adapter)}</code>{deployment.local && <div><button type="button" onClick={exportManifest}>Export v2 manifest</button><button type="button" onClick={() => { clearLocalDeployment(); setStep("idle"); setMessage(undefined); }}>Forget local config</button></div>}<small>{deployment.local ? "Local state is development-only and never overrides production." : "Execution is enabled only when the shared manifest reports Router v2."}</small></div>}
        </div>
      </section>
    </section><div className="footer-shell app-footer"><Footer /></div>
  </main>;
}
