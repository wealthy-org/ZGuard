// Langkah 7 — one smallest-amount mainnet swap through the DEPLOYED app, before the main recording.
//
// It exercises exactly the path the recording uses: hosted /api/quote → remote signer → PermRouter
// on Robinhood Chain → hosted /api/receipts. Every value is checked independently, not trusted:
//   - the quote's EIP-712 id is rebuilt locally and its signature recovers to PermRouter.quoteSigner()
//   - fee policy and fee amounts are re-read from the contract (previewFees)
//   - the route steps only use the manifest adapters
//   - after settlement, SwapSettled / RouteStepSettled are decoded from the receipt and must match
//
// Run it YOURSELF on your machine. Never paste SMOKE_PRIVATE_KEY anywhere else.
//
//   PERM_APP_URL=https://www.useperm.xyz \
//   SMOKE_PRIVATE_KEY=0x...            # the allowlisted recording wallet (holds ~0.003 ETH)
//   [SMOKE_TOKEN=NVDA] [SMOKE_AMOUNT_ETH=0.001] [SMOKE_SLIPPAGE_BPS=100] [SMOKE_ROUTING_MODE=best]
//   [MANIFEST=deployments/robinhood-mainnet.json] [RH_MAINNET_RPC_URL=...]
//   CONFIRM_MAINNET=1                  # without it the script stops after the simulation (dry run)
//   pnpm mainnet:smoke
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatEther,
  formatUnits,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  parseEther,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { permRouterAbi } from "../../lib/web3/abis";
import { PERM_QUOTE_TYPES } from "../../lib/server/quote-signer";

const fail = (message: string): never => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
const ok = (message: string) => console.log(`✓ ${message}`);

async function main() {
  const root = path.resolve(__dirname, "../..");
  const manifestPath = path.resolve(root, process.env.MANIFEST || "deployments/robinhood-mainnet.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.chainId !== 4663) fail(`${manifestPath} is not a chain-4663 manifest`);
  if (!manifest.permRouter) fail(`${path.relative(root, manifestPath)} has no permRouter yet — deploy first (langkah 1)`);
  const router = getAddress(manifest.permRouter) as Address;
  const adapters = new Set([manifest.v4Adapter, manifest.v3Adapter, manifest.v2Adapter, manifest.wethAdapter].filter(Boolean).map((value: string) => getAddress(value)));

  const appUrl = (process.env.PERM_APP_URL || "").replace(/\/$/, "");
  if (!/^https?:\/\//.test(appUrl)) fail("PERM_APP_URL is required, e.g. https://www.useperm.xyz");
  const key = process.env.SMOKE_PRIVATE_KEY || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) fail("SMOKE_PRIVATE_KEY must be the recording wallet key (0x + 64 hex)");
  const account = privateKeyToAccount(key as Hex);
  const rpcUrl = process.env.RH_MAINNET_RPC_URL || manifest.rpcUrl;
  const chain = defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 2, timeout: 20_000 }) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  if ((await client.getChainId()) !== 4663) fail(`RPC ${rpcUrl} is not chain 4663`);

  const tokenSymbol = process.env.SMOKE_TOKEN || "NVDA";
  const amountIn = parseEther(process.env.SMOKE_AMOUNT_ETH || "0.001");
  const slippageBps = Number(process.env.SMOKE_SLIPPAGE_BPS || 100);
  const routingMode = process.env.SMOKE_ROUTING_MODE || "best";
  // A localhost RPC is an anvil/hardhat fork: its tx hashes do not exist on Blockscout and must never be used as evidence.
  const isFork = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/.test(rpcUrl);
  const explorer = isFork ? "FORK (not on Blockscout)" : manifest.explorerUrl || "https://robinhoodchain.blockscout.com";

  console.log(`Perm smoke swap · ${formatEther(amountIn)} ETH → ${tokenSymbol} · wallet ${account.address}`);
  console.log(`  app ${appUrl} · router ${router} · rpc ${rpcUrl}`);

  const balance = await client.getBalance({ address: account.address });
  if (balance < amountIn + parseEther("0.0005")) fail(`wallet has ${formatEther(balance)} ETH; need ≥ ${formatEther(amountIn + parseEther("0.0005"))}`);
  ok(`balance ${formatEther(balance)} ETH`);

  // 1. Onchain truth first
  const [onchainSigner, activeVersion, paused] = await Promise.all([
    client.readContract({ address: router, abi: permRouterAbi, functionName: "quoteSigner" }),
    client.readContract({ address: router, abi: permRouterAbi, functionName: "activePolicyVersion" }),
    client.readContract({ address: router, abi: [{ type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }] as const, functionName: "paused" }),
  ]);
  if (paused) fail("PermRouter is paused");
  const policy = await client.readContract({ address: router, abi: permRouterAbi, functionName: "feePolicies", args: [activeVersion] });
  if (!policy[2]) fail(`fee policy v${activeVersion} is disabled`);
  ok(`fee policy v${activeVersion}: ${policy[0]} bps gross, ${policy[1] / 100}% rebate (onchain)`);
  if (policy[0] !== 20 || policy[1] !== 2_500) console.warn(`⚠ policy is not the 0.20% / 25% the recording guide narrates`);

  // 2. Hosted quote
  const response = await fetch(`${appUrl}/api/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tokenIn: "ETH",
      tokenOut: tokenSymbol,
      amountIn: amountIn.toString(),
      slippageBps,
      account: account.address,
      recipient: account.address,
      routingMode,
    }),
  });
  const quote = await response.json();
  if (!response.ok) fail(`/api/quote HTTP ${response.status}: ${quote.error || JSON.stringify(quote)}`);
  if (quote.chainId !== 4663) fail(`quote chainId ${quote.chainId} — the deployed app is not the mainnet build (NEXT_PUBLIC_PERM_CHAIN_ID=4663)`);
  if (!quote.executable) fail(`quote is not executable: ${quote.deploymentReason || "unknown reason"}`);
  ok(`quote ${quote.quoteId.slice(0, 10)}… · ${quote.candidates.length} candidates · selected ${quote.selected.providerLabel}`);
  for (const candidate of quote.candidates) {
    console.log(`    ${candidate === quote.candidates[0] ? "→" : " "} ${candidate.providerLabel.padEnd(48)} ${formatUnits(BigInt(candidate.amountOut), 18)} ${tokenSymbol}`);
  }
  for (const step of quote.selected.steps) {
    if (!adapters.has(getAddress(step.adapter))) fail(`route step uses adapter ${step.adapter}, not one from the manifest`);
  }
  ok("route uses only manifest adapters");

  // 3. Independent EIP-712 rebuild + signer recovery
  const message = {
    account: account.address,
    tokenIn: getAddress(quote.tokenIn),
    tokenOut: getAddress(quote.tokenOut),
    amountIn: BigInt(quote.amountIn),
    minAmountOut: BigInt(quote.selected.minAmountOut),
    gasEstimate: BigInt(quote.selected.gasEstimate),
    recipient: account.address,
    deadline: BigInt(quote.deadline),
    quotedAt: BigInt(quote.quotedAt),
    policyVersion: quote.policyVersion,
    chainId: 4663n,
    referrer: getAddress(quote.referrer),
    routeHash: keccak256(quote.selected.routeData),
  } as const;
  const domain = { name: "Perm", version: "2", chainId: 4663, verifyingContract: router } as const;
  if (hashTypedData({ domain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message }) !== quote.quoteId) fail("quoteId does not match the locally rebuilt EIP-712 payload");
  const recovered = await recoverTypedDataAddress({ domain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message, signature: quote.quoteSignature });
  if (recovered !== getAddress(onchainSigner)) fail(`signature recovers to ${recovered}, PermRouter.quoteSigner() is ${onchainSigner}`);
  ok(`signature recovers to PermRouter.quoteSigner() ${onchainSigner}`);

  const preview = await client.readContract({ address: router, abi: permRouterAbi, functionName: "previewFees", args: [amountIn, quote.policyVersion] });
  if (preview[0] !== BigInt(quote.grossFee) || preview[1] !== BigInt(quote.rebate) || preview[2] !== BigInt(quote.netFee)) fail("quote fees differ from PermRouter.previewFees");
  ok(`fees match previewFees: gross ${formatEther(preview[0])} · rebate ${formatEther(preview[1])} · net ${formatEther(preview[2])} ETH`);

  // 4. Simulate, then (only with CONFIRM_MAINNET=1) send
  const request = {
    tokenIn: message.tokenIn,
    tokenOut: message.tokenOut,
    amountIn: message.amountIn,
    minAmountOut: message.minAmountOut,
    gasEstimate: message.gasEstimate,
    recipient: message.recipient,
    deadline: message.deadline,
    quotedAt: message.quotedAt,
    policyVersion: message.policyVersion,
    chainId: message.chainId,
    quoteId: quote.quoteId as Hex,
    referrer: message.referrer,
    routeData: quote.selected.routeData as Hex,
  };
  const permitInput = { nonce: 0n, deadline: 0n, signature: "0x" as Hex };
  const simulation = await client.simulateContract({
    account,
    address: router,
    abi: permRouterAbi,
    functionName: "swapExactInput",
    args: [request, quote.quoteSignature, permitInput],
    value: amountIn,
  });
  ok(`simulation: amountOut ${formatUnits(simulation.result[1].amountOut, 18)} ${tokenSymbol} (min ${formatUnits(message.minAmountOut, 18)})`);
  if (process.env.CONFIRM_MAINNET !== "1") {
    console.log("\nDry run complete. Re-run with CONFIRM_MAINNET=1 to broadcast this smallest-amount swap.");
    return;
  }

  const hash = await wallet.writeContract(simulation.request);
  console.log(`  sent ${hash}\n  ${explorer}/tx/${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
  if (receipt.status !== "success") fail(`transaction reverted: ${explorer}/tx/${hash}`);
  ok(`settled in block ${receipt.blockNumber} · gas ${receipt.gasUsed}`);

  const steps: Array<Record<string, unknown>> = [];
  let settled: Record<string, unknown> | undefined;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== router) continue;
    try {
      const decoded = decodeEventLog({ abi: permRouterAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "RouteStepSettled") steps.push(decoded.args as Record<string, unknown>);
      if (decoded.eventName === "SwapSettled") settled = decoded.args as Record<string, unknown>;
    } catch { /* other router events */ }
  }
  if (!settled) fail("no SwapSettled event in the receipt");
  const s = settled as { grossFee: bigint; rebate: bigint; netFee: bigint; amountOut: bigint; quoteId: Hex; receiptId: Hex };
  if (s.quoteId !== quote.quoteId) fail("SwapSettled.quoteId differs from the signed quote");
  if (s.grossFee !== preview[0] || s.rebate !== preview[1] || s.netFee !== preview[2]) fail("settled fees differ from the previewed fees");
  if (s.amountOut < message.minAmountOut) fail("amountOut below the signed minimum");
  ok(`SwapSettled: out ${formatUnits(s.amountOut, 18)} ${tokenSymbol} · gross ${formatEther(s.grossFee)} · rebate ${formatEther(s.rebate)} · net ${formatEther(s.netFee)} ETH · ${steps.length} route step(s)`);

  // 5. The hosted proof page must see it (it waits RECEIPT_MIN_CONFIRMATIONS, default 12)
  let proofOk = false;
  for (let attempt = 0; attempt < 24 && !proofOk; attempt += 1) {
    const proof = await fetch(`${appUrl}/api/receipts?tx=${hash}`);
    if (proof.ok) proofOk = true;
    else await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (proofOk) ok(`${appUrl}/proofs shows the receipt`);
  else console.warn(`⚠ /api/receipts did not return the receipt within 2 minutes; check ${appUrl}/proofs manually`);

  const out = path.resolve(root, process.env.SMOKE_OUTPUT
    || (isFork ? "deployments/mainnet/smoke-test.fork.rehearsal.json" : "deployments/mainnet/smoke-test.json"));
  if (isFork && path.basename(out) === "smoke-test.json") fail("refusing to write fork evidence to smoke-test.json");
  fs.writeFileSync(out, `${JSON.stringify({
    chainId: 4663,
    fork: isFork,
    router,
    transactionHash: hash,
    explorerUrl: `${explorer}/tx/${hash}`,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    account: account.address,
    tokenOut: tokenSymbol,
    amountInWei: amountIn.toString(),
    amountOut: s.amountOut.toString(),
    grossFee: s.grossFee.toString(),
    rebate: s.rebate.toString(),
    netFee: s.netFee.toString(),
    routeSteps: steps.length,
    selectedRoute: quote.selected.providerLabel,
    proofPageVerified: proofOk,
    at: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(isFork
    ? `\nSaved ${path.relative(root, out)} (fork rehearsal — NOT mainnet evidence).`
    : `\nSaved ${path.relative(root, out)}. Use this hash as PERM_STAGING_E2E_TX_HASH (runbook §6).`);
}

main().catch((cause) => fail(cause instanceof Error ? cause.message : String(cause)));
