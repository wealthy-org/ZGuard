#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  isAddress,
  keccak256,
  toHex,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { permRouterAbi } from "../lib/web3/abis";
import type { LiveQuote } from "../lib/web3/quote";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(process.cwd(), process.env.STAGING_MANIFEST || "deployments/robinhood-testnet.staging.json");
const evidencePath = path.resolve(process.cwd(), process.env.STAGING_E2E_OUTPUT || ".staging/e2e.json");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const allowedProviders = new Set(["UNISWAP_V4_DIRECT", "SYNTHRA_V3"]);

type StagingManifest = {
  schemaVersion: number;
  routerVersion: number;
  chainId: number;
  network: string;
  rpcUrl: string;
  explorerUrl: string;
  permRouter: Address;
  v4Adapter: Address;
  v3Adapter: Address;
  quoteSigner: Address;
  releaseStatus: string;
  nonRelease: boolean;
  stagingRoutePolicy: string;
  executionReady: boolean;
  stagingE2EVerification?: string;
  stagingE2E?: Record<string, unknown>;
};

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stagingOrigin() {
  const raw = process.env.PERM_STAGING_URL;
  required(raw, "PERM_STAGING_URL is required");
  const url = new URL(raw);
  required(url.protocol === "https:" && !url.username && !url.password, "PERM_STAGING_URL must be a credential-free HTTPS URL");
  return url;
}

async function main() {
  required(fs.existsSync(manifestPath), `Staging manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as StagingManifest;
  required(manifest.schemaVersion === 2 && manifest.routerVersion === 2 && manifest.chainId === 46_630, "Staging E2E requires a chain-46630 Router-v2 manifest");
  required(manifest.releaseStatus === "non-release-allowlisted-staging" && manifest.nonRelease === true, "Manifest is not explicitly marked as non-release staging");
  required(manifest.stagingRoutePolicy === "direct-v4-v3-only", "Manifest does not enforce the direct-v4/v3 staging route policy");
  required(manifest.executionReady === false, "A staging manifest must never set executionReady=true");
  for (const field of ["permRouter", "v4Adapter", "v3Adapter", "quoteSigner"] as const) {
    required(isAddress(manifest[field]), `Manifest ${field} is invalid`);
  }

  const privateKey = process.env.STAGING_TEST_PRIVATE_KEY;
  required(privateKey && /^0x[0-9a-fA-F]{64}$/.test(privateKey), "STAGING_TEST_PRIVATE_KEY is required");
  const account = privateKeyToAccount(privateKey as Hex);
  const localAllowlist = (process.env.PERM_STAGING_WALLET_ALLOWLIST || "").split(",").map((entry) => entry.trim()).filter((entry) => isAddress(entry)).map((entry) => getAddress(entry));
  required(localAllowlist.some((entry) => entry.toLowerCase() === account.address.toLowerCase()), "The canonical E2E wallet is not in PERM_STAGING_WALLET_ALLOWLIST");

  const amountIn = process.env.STAGING_E2E_AMOUNT_IN || "1000000000000";
  required(/^\d+$/.test(amountIn) && BigInt(amountIn) > 0n, "STAGING_E2E_AMOUNT_IN must be a positive base-unit integer");
  const tokenIn = process.env.STAGING_E2E_TOKEN_IN || "ETH";
  const tokenOut = process.env.STAGING_E2E_TOKEN_OUT || "NVDA";
  const routingMode = process.env.STAGING_E2E_ROUTING_MODE || "v4";
  required(["v4", "v3", "best"].includes(routingMode), "STAGING_E2E_ROUTING_MODE must be v4, v3 or best");

  const origin = stagingOrigin();
  const response = await fetch(new URL("/api/quote", origin), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": "PermStagingE2E/1.0" },
    body: JSON.stringify({
      tokenIn,
      tokenOut,
      amountIn,
      slippageBps: Number(process.env.STAGING_E2E_SLIPPAGE_BPS || "100"),
      account: account.address,
      recipient: account.address,
      referrer: ZERO_ADDRESS,
      routingMode,
    }),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const responseText = await response.text();
  required(responseText.length <= 1_000_000, "Staging quote response is too large");
  let payload: unknown;
  try { payload = JSON.parse(responseText); } catch { throw new Error("Staging quote endpoint returned invalid JSON"); }
  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : `HTTP ${response.status}`;
    throw new Error(`Staging quote failed: ${message}`);
  }
  const quote = payload as LiveQuote;
  required(quote.contractVersion === 2 && quote.chainId === 46_630, "Quote is not bound to Router v2 on chain 46630");
  required(quote.executable && quote.executionMode === "allowlisted-staging" && quote.nonRelease, "Quote is not executable under the non-release allowlisted staging policy");
  required(quote.account.toLowerCase() === account.address.toLowerCase() && quote.recipient.toLowerCase() === account.address.toLowerCase(), "Quote account binding does not match the E2E wallet");
  required(/^0x[0-9a-fA-F]{130}$/.test(quote.quoteSignature), "Quote does not contain a valid-length staging signature");
  required(quote.selected.steps.length > 0, "Quote contains no route steps");
  for (const step of quote.selected.steps) {
    required(allowedProviders.has(step.providerId), `Forbidden staging provider: ${step.providerId}`);
    required(step.hook.toLowerCase() === ZERO_ADDRESS, "Aggregator Hook execution is forbidden in staging E2E");
    if (step.providerId === "UNISWAP_V4_DIRECT") required(step.adapter.toLowerCase() === manifest.v4Adapter.toLowerCase(), "Quote uses the wrong v4 adapter");
    if (step.providerId === "SYNTHRA_V3") required(step.adapter.toLowerCase() === manifest.v3Adapter.toLowerCase(), "Quote uses the wrong v3 adapter");
  }

  const rpcUrl = process.env.RH_TESTNET_RPC_URL || manifest.rpcUrl;
  required(rpcUrl, "RH_TESTNET_RPC_URL is required");
  const chain = defineChain({
    id: 46_630,
    name: manifest.network || "Robinhood Chain Testnet",
    nativeCurrency: { name: "Testnet Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Robinhood Testnet Explorer", url: manifest.explorerUrl } },
    testnet: true,
  });
  const transport = http(rpcUrl, { retryCount: 2, timeout: 20_000 });
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  required(await publicClient.getChainId() === 46_630, "RPC is not Robinhood testnet chain 46630");
  required(getAddress(manifest.permRouter) === getAddress(process.env.NEXT_PUBLIC_PERM_ROUTER_ADDRESS || manifest.permRouter), "Runtime router override does not match the staging manifest");

  const request = {
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: BigInt(quote.amountIn),
    minAmountOut: BigInt(quote.selected.minAmountOut),
    gasEstimate: BigInt(quote.selected.gasEstimate),
    recipient: account.address,
    deadline: BigInt(quote.deadline),
    quotedAt: BigInt(quote.quotedAt),
    policyVersion: quote.policyVersion,
    chainId: BigInt(quote.chainId),
    quoteId: quote.quoteId,
    referrer: quote.referrer,
    routeData: quote.selected.routeData,
  } as const;
  required(quote.tokenIn === ZERO_ADDRESS, "The canonical bootstrap E2E currently requires native ETH input");
  const balance = await publicClient.getBalance({ address: account.address });
  required(balance > request.amountIn + parseEther("0.00001"), "Canonical E2E wallet needs more testnet ETH for input and gas");
  const latest = await publicClient.getBlock({ blockTag: "latest" });
  required(latest.timestamp <= request.deadline, "Staging quote expired before simulation");

  const simulation = await publicClient.simulateContract({
    account: account.address,
    address: manifest.permRouter,
    abi: permRouterAbi,
    functionName: "swapExactInput",
    args: [request, quote.quoteSignature, { nonce: 0n, deadline: 0n, signature: "0x" }],
    value: request.amountIn,
  });
  const transactionHash = await walletClient.writeContract({ ...simulation.request, account });
  const confirmationCount = Number(process.env.STAGING_E2E_CONFIRMATIONS || process.env.PERM_STAGING_E2E_CONFIRMATIONS || "1");
  required(Number.isInteger(confirmationCount) && confirmationCount >= 1 && confirmationCount <= 100, "STAGING_E2E_CONFIRMATIONS must be between 1 and 100");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: confirmationCount, timeout: 180_000 });
  required(receipt.status === "success", "Canonical staging E2E transaction reverted");
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  required(block.hash?.toLowerCase() === receipt.blockHash.toLowerCase(), "Canonical staging E2E receipt is not on the current chain");

  let receiptId: Hex | undefined;
  let settledAccount: Address | undefined;
  let routeSteps = 0;
  for (const log of receipt.logs.filter((item) => item.address.toLowerCase() === manifest.permRouter.toLowerCase())) {
    try {
      const decoded = decodeEventLog({ abi: permRouterAbi, data: log.data, topics: log.topics, strict: true });
      if (decoded.eventName === "SwapSettled" && decoded.args.quoteId.toLowerCase() === quote.quoteId.toLowerCase()) {
        receiptId = decoded.args.receiptId;
        settledAccount = decoded.args.account;
      }
      if (decoded.eventName === "RouteStepSettled") {
        const quotedStep = quote.selected.steps[routeSteps];
        required(quotedStep && allowedProviders.has(quotedStep.providerId), "Canonical E2E emitted an unexpected extra route step");
        required(decoded.args.providerId.toLowerCase() === keccak256(toHex(quotedStep.providerId)).toLowerCase(), "Canonical E2E emitted a forbidden route provider");
        required(decoded.args.hook.toLowerCase() === ZERO_ADDRESS, "Canonical E2E emitted a hook-backed route step");
        routeSteps += 1;
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("Canonical E2E")) throw cause;
    }
  }
  required(receiptId && settledAccount?.toLowerCase() === account.address.toLowerCase(), "Canonical staging E2E SwapSettled evidence is missing or bound to the wrong account");
  required(routeSteps === quote.selected.steps.length, "Canonical staging E2E route-step evidence is incomplete");

  const evidence = {
    schemaVersion: 1,
    purpose: "perm-non-release-allowlisted-staging-e2e",
    nonRelease: true,
    chainId: 46_630,
    router: manifest.permRouter,
    account: account.address,
    transactionHash,
    receiptId,
    quoteId: quote.quoteId,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    routeProviders: quote.selected.steps.map((step) => step.providerId),
    routeSteps,
    verifiedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  manifest.stagingE2EVerification = "passed";
  manifest.stagingE2E = evidence;
  manifest.executionReady = false;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    status: "passed",
    nonRelease: true,
    transactionHash,
    receiptId,
    evidence: path.relative(root, evidencePath),
    nextEnvironment: {
      PERM_STAGING_E2E_TX_HASH: transactionHash,
      NEXT_PUBLIC_PERM_STAGING_E2E_PASSED: "1",
    },
    reminder: "Redeploy staging, then require /api/health?requireStaging=1. Do not set the official manifest executionReady flag.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
