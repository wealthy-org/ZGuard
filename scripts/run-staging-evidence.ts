#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, permRouterAbi } from "../lib/web3/abis";
import type { LiveQuote } from "../lib/web3/quote";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
const manifestPath = path.resolve(process.cwd(), process.env.STAGING_MANIFEST || "deployments/robinhood-testnet.staging.json");
const evidencePath = path.resolve(process.cwd(), process.env.STAGING_EVIDENCE_OUTPUT || ".staging/e2e-suite.json");
const allowedProviders = new Set(["UNISWAP_V4_DIRECT", "SYNTHRA_V3", "REVIEWED_V2_THIRD_PARTY"]);

const evidenceAbi = parseAbi([
  "function referralShares(address referrer) view returns (uint16)",
  "function configureReferral(address referrer,uint16 shareBpsOfNetFee)",
  "function claimableFees(address token,address beneficiary) view returns (uint256)",
  "function claimFees(address token,address recipient) returns (uint256 amount)",
  "event FeeAccrued(address indexed token,address indexed beneficiary,uint256 amount)",
  "event FeeClaimed(address indexed token,address indexed beneficiary,address indexed recipient,uint256 amount)",
]);

type Scenario = "v3" | "v2" | "multiHop" | "crossVenue" | "permit2" | "referral" | "treasuryClaim" | "referralClaim";
type RoutingMode = "best" | "v4" | "v3" | "v2" | "mixed";
type StagingManifest = {
  schemaVersion: number;
  routerVersion: number;
  chainId: number;
  network: string;
  rpcUrl: string;
  explorerUrl: string;
  permit2: Address;
  permRouter: Address;
  v4Adapter: Address;
  v3Adapter: Address;
  v2Adapter?: Address;
  quoteSigner: Address;
  owner: Address;
  treasury: Address;
  releaseStatus: string;
  nonRelease: boolean;
  stagingRoutePolicy: string;
  executionReady: boolean;
};
type ScenarioEvidence = {
  transactionHash: Hex;
  receiptId?: Hex;
  quotedGasEstimate?: string;
  actualGasUsed?: string;
  gasEstimateErrorBps?: number;
  referrer?: Address;
  token?: Address;
  beneficiary?: Address;
  recipient?: Address;
  amount?: string;
  routeProviders?: string[];
  routeSteps?: number;
  blockNumber: string;
  blockHash: Hex;
  verifiedAt: string;
};
type EvidenceFile = {
  schemaVersion: 1;
  purpose: "perm-non-release-allowlisted-staging-evidence-suite";
  nonRelease: true;
  chainId: 46630;
  router: Address;
  account: Address;
  evidence: Partial<Record<"directV4" | Scenario, ScenarioEvidence>>;
  updatedAt: string;
};

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function privateKey(name: string): Hex {
  const value = process.env[name];
  required(value && /^0x[0-9a-fA-F]{64}$/.test(value), `${name} is required`);
  return value as Hex;
}

function stagingOrigin() {
  const raw = process.env.PERM_STAGING_URL;
  required(raw, "PERM_STAGING_URL is required");
  const url = new URL(raw);
  const explicitLoopback = process.env.PERM_ALLOW_LOCAL_STAGING_HTTP === "1"
    && url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  required((url.protocol === "https:" || explicitLoopback) && !url.username && !url.password, "PERM_STAGING_URL must be credential-free HTTPS, or explicit loopback HTTP");
  return url;
}

function scenarios(): Scenario[] {
  const raw = process.env.STAGING_EVIDENCE_SCENARIOS || "v3";
  const supported = new Set<Scenario>(["v3", "v2", "multiHop", "crossVenue", "permit2", "referral", "treasuryClaim", "referralClaim"]);
  const result = raw.split(",").map((item) => item.trim()).filter(Boolean);
  required(result.length > 0, "STAGING_EVIDENCE_SCENARIOS is empty");
  for (const item of result) required(supported.has(item as Scenario), `Unsupported staging evidence scenario: ${item}`);
  return [...new Set(result as Scenario[])];
}

function readEvidence(manifest: StagingManifest, account: Address): EvidenceFile {
  let current: EvidenceFile | undefined;
  if (fs.existsSync(evidencePath)) current = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as EvidenceFile;
  if (current) {
    required(current.nonRelease === true && current.chainId === 46_630, "Existing evidence file is not non-release chain-46630 evidence");
    required(getAddress(current.router) === getAddress(manifest.permRouter), "Existing evidence file targets another router");
    required(getAddress(current.account) === getAddress(account), "Existing evidence file targets another account");
    return current;
  }
  const result: EvidenceFile = {
    schemaVersion: 1,
    purpose: "perm-non-release-allowlisted-staging-evidence-suite",
    nonRelease: true,
    chainId: 46_630,
    router: manifest.permRouter,
    account,
    evidence: {},
    updatedAt: new Date().toISOString(),
  };
  const canonicalPath = path.resolve(process.cwd(), ".staging/e2e.json");
  if (fs.existsSync(canonicalPath)) {
    const canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf8")) as {
      transactionHash?: Hex; receiptId?: Hex; blockNumber?: string; blockHash?: Hex; verifiedAt?: string; routeProviders?: string[]; routeSteps?: number;
    };
    if (canonical.transactionHash && canonical.receiptId && canonical.blockNumber && canonical.blockHash) {
      result.evidence.directV4 = {
        transactionHash: canonical.transactionHash,
        receiptId: canonical.receiptId,
        blockNumber: canonical.blockNumber,
        blockHash: canonical.blockHash,
        verifiedAt: canonical.verifiedAt || new Date().toISOString(),
        routeProviders: canonical.routeProviders,
        routeSteps: canonical.routeSteps,
      };
    }
  }
  return result;
}

function writeEvidence(value: EvidenceFile) {
  value.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  required(fs.existsSync(manifestPath), `Staging manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as StagingManifest;
  required(manifest.schemaVersion === 2 && manifest.routerVersion === 2 && manifest.chainId === 46_630, "Evidence runner requires the chain-46630 Router-v2 staging manifest");
  required(manifest.releaseStatus === "non-release-allowlisted-staging" && manifest.nonRelease === true, "Manifest is not explicitly non-release staging");
  required(
    (manifest.stagingRoutePolicy === "direct-v4-v3-only" || manifest.stagingRoutePolicy === "reviewed-direct-v4-v3-v2-only")
      && manifest.executionReady === false,
    "Staging route or execution boundary is unsafe",
  );
  for (const field of ["permit2", "permRouter", "v4Adapter", "v3Adapter", "owner", "treasury"] as const) {
    required(isAddress(manifest[field]), `Manifest ${field} is invalid`);
  }
  required(getAddress(manifest.permit2) === getAddress(PERMIT2), "Manifest Permit2 address is unexpected");

  const account = privateKeyToAccount(privateKey("STAGING_TEST_PRIVATE_KEY"));
  const allowlist = (process.env.PERM_STAGING_WALLET_ALLOWLIST || "").split(",").map((item) => item.trim()).filter((item) => isAddress(item)).map(getAddress);
  required(allowlist.some((item) => item.toLowerCase() === account.address.toLowerCase()), "Evidence account is not in PERM_STAGING_WALLET_ALLOWLIST");

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
  required(await publicClient.getChainId() === 46_630, "RPC is not chain 46630");
  required((await publicClient.getBytecode({ address: manifest.permRouter })) !== undefined, "Staging router has no runtime code");
  const origin = stagingOrigin();
  const output = readEvidence(manifest, account.address);
  const selectedScenarios = scenarios();

  async function waitFor(hash: Hex) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000 });
    required(receipt.status === "success", `Transaction reverted: ${hash}`);
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    required(block.hash?.toLowerCase() === receipt.blockHash.toLowerCase(), `Transaction is not canonical: ${hash}`);
    return receipt;
  }

  async function exactApproval(token: Address, spender: Address, amount: bigint) {
    const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
    if (allowance >= amount) return;
    if (allowance > 0n) {
      const reset = await walletClient.writeContract({ account, chain, address: token, abi: erc20Abi, functionName: "approve", args: [spender, 0n] });
      await waitFor(reset);
    }
    const approval = await walletClient.writeContract({ account, chain, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    await waitFor(approval);
  }

  async function quote(tokenIn: string, tokenOut: string, amountIn: string, routingMode: RoutingMode, referrer: Address) {
    required(/^\d+$/.test(amountIn) && BigInt(amountIn) > 0n, "Scenario amount must be a positive integer");
    const response = await fetch(new URL("/api/quote", origin), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "user-agent": "PermStagingEvidence/1.0" },
      body: JSON.stringify({
        tokenIn,
        tokenOut,
        amountIn,
        slippageBps: Number(process.env.STAGING_EVIDENCE_SLIPPAGE_BPS || "100"),
        account: account.address,
        recipient: account.address,
        referrer,
        routingMode,
      }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const text = await response.text();
    required(text.length <= 1_000_000, "Quote response is too large");
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new Error("Quote endpoint returned invalid JSON"); }
    if (!response.ok) {
      const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : `HTTP ${response.status}`;
      throw new Error(`Quote failed: ${message}`);
    }
    const result = payload as LiveQuote;
    required(result.contractVersion === 2 && result.chainId === 46_630, "Quote is not Router v2 on chain 46630");
    required(result.executable && result.executionMode === "allowlisted-staging" && result.nonRelease, "Quote is outside the allowlisted non-release staging boundary");
    required(getAddress(result.account) === account.address && getAddress(result.recipient) === account.address, "Quote account binding is wrong");
    required(getAddress(result.referrer) === getAddress(referrer), "Quote referrer binding is wrong");
    required(/^0x[0-9a-fA-F]{130}$/.test(result.quoteSignature), "Quote signature is invalid");
    required(result.selected.steps.length > 0, "Quote has no route steps");
    for (const step of result.selected.steps) {
      required(allowedProviders.has(step.providerId), `Forbidden provider in staging evidence: ${step.providerId}`);
      required(getAddress(step.hook) === ZERO_ADDRESS, "Hook-backed evidence is forbidden without an approved hook");
      if (step.providerId === "UNISWAP_V4_DIRECT") required(getAddress(step.adapter) === getAddress(manifest.v4Adapter), "Quote uses the wrong v4 adapter");
      if (step.providerId === "SYNTHRA_V3") required(getAddress(step.adapter) === getAddress(manifest.v3Adapter), "Quote uses the wrong v3 adapter");
      if (step.providerId === "REVIEWED_V2_THIRD_PARTY") {
        required(process.env.PERM_STAGING_ALLOW_REVIEWED_V2 === "1", "Reviewed third-party V2 evidence is not explicitly enabled");
        required(manifest.v2Adapter && isAddress(manifest.v2Adapter), "Manifest has no reviewed V2 adapter");
        required(getAddress(step.adapter) === getAddress(manifest.v2Adapter), "Quote uses the wrong v2 adapter");
      }
    }
    return result;
  }

  async function executeSwap(name: "v3" | "v2" | "multiHop" | "crossVenue" | "permit2" | "referral", liveQuote: LiveQuote, usePermit2: boolean) {
    const request = {
      tokenIn: liveQuote.tokenIn,
      tokenOut: liveQuote.tokenOut,
      amountIn: BigInt(liveQuote.amountIn),
      minAmountOut: BigInt(liveQuote.selected.minAmountOut),
      gasEstimate: BigInt(liveQuote.selected.gasEstimate),
      recipient: account.address,
      deadline: BigInt(liveQuote.deadline),
      quotedAt: BigInt(liveQuote.quotedAt),
      policyVersion: liveQuote.policyVersion,
      chainId: BigInt(liveQuote.chainId),
      quoteId: liveQuote.quoteId,
      referrer: liveQuote.referrer,
      routeData: liveQuote.selected.routeData,
    } as const;
    let permitInput = { nonce: 0n, deadline: 0n, signature: "0x" as Hex };
    if (getAddress(liveQuote.tokenIn) !== ZERO_ADDRESS) {
      const balance = await publicClient.readContract({ address: liveQuote.tokenIn, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
      required(balance >= request.amountIn, `${name} account has insufficient input-token balance`);
      if (usePermit2) {
        await exactApproval(liveQuote.tokenIn, manifest.permit2, request.amountIn);
        const nonce = BigInt(`0x${randomBytes(32).toString("hex")}`);
        const deadline = BigInt(liveQuote.deadline);
        const signature = await walletClient.signTypedData({
          account,
          domain: { name: "Permit2", chainId: 46_630, verifyingContract: manifest.permit2 },
          types: {
            TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
            PermitTransferFrom: [
              { name: "permitted", type: "TokenPermissions" },
              { name: "spender", type: "address" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "PermitTransferFrom",
          message: { permitted: { token: liveQuote.tokenIn, amount: request.amountIn }, spender: manifest.permRouter, nonce, deadline },
        });
        permitInput = { nonce, deadline, signature };
      } else {
        await exactApproval(liveQuote.tokenIn, manifest.permRouter, request.amountIn);
      }
    } else {
      const nativeBalance = await publicClient.getBalance({ address: account.address });
      required(nativeBalance > request.amountIn + parseEther("0.00001"), `${name} account needs more testnet ETH`);
    }
    const latest = await publicClient.getBlock({ blockTag: "latest" });
    required(latest.timestamp <= request.deadline, `${name} quote expired before simulation`);
    const simulation = await publicClient.simulateContract({
      account: account.address,
      address: manifest.permRouter,
      abi: permRouterAbi,
      functionName: "swapExactInput",
      args: [request, liveQuote.quoteSignature, permitInput],
      value: getAddress(liveQuote.tokenIn) === ZERO_ADDRESS ? request.amountIn : 0n,
    });
    const transactionHash = await walletClient.writeContract({ ...simulation.request, account });
    const receipt = await waitFor(transactionHash);
    let receiptId: Hex | undefined;
    let settledAccount: Address | undefined;
    const providers: string[] = [];
    for (const log of receipt.logs.filter((item) => getAddress(item.address) === getAddress(manifest.permRouter))) {
      try {
        const decoded = decodeEventLog({ abi: permRouterAbi, data: log.data, topics: log.topics, strict: true });
        if (decoded.eventName === "SwapSettled" && decoded.args.quoteId.toLowerCase() === liveQuote.quoteId.toLowerCase()) {
          receiptId = decoded.args.receiptId;
          settledAccount = decoded.args.account;
        }
        if (decoded.eventName === "RouteStepSettled") {
          const step = liveQuote.selected.steps[providers.length];
          required(step, `${name} emitted an unexpected route step`);
          providers.push(step.providerId);
        }
      } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith(name)) throw cause;
      }
    }
    required(receiptId && settledAccount && getAddress(settledAccount) === account.address, `${name} SwapSettled evidence is missing`);
    required(providers.length === liveQuote.selected.steps.length, `${name} route-step evidence is incomplete`);
    if (name === "v3") required(providers.includes("SYNTHRA_V3"), "v3 evidence did not use Synthra v3");
    if (name === "v2") required(providers.length === 1 && providers[0] === "REVIEWED_V2_THIRD_PARTY", "v2 evidence did not use the reviewed third-party V2 venue");
    if (name === "multiHop") required(providers.length >= 2 && getAddress(liveQuote.tokenIn) !== ZERO_ADDRESS && getAddress(liveQuote.tokenOut) !== ZERO_ADDRESS, "multiHop evidence is not token-to-token multi-step execution");
    if (name === "crossVenue") required(
      providers.length === 2 && providers.includes("UNISWAP_V4_DIRECT") && providers.includes("SYNTHRA_V3"),
      "crossVenue evidence is not an explicit v4/v3 execution",
    );
    if (name === "permit2") required(permitInput.signature !== "0x" && getAddress(liveQuote.tokenIn) !== ZERO_ADDRESS, "permit2 evidence did not use a signature transfer");
    if (name === "referral") required(getAddress(liveQuote.referrer) !== ZERO_ADDRESS, "referral evidence has no referrer");
    const gasDelta = request.gasEstimate > receipt.gasUsed ? request.gasEstimate - receipt.gasUsed : receipt.gasUsed - request.gasEstimate;
    const gasEstimateErrorBps = Number(gasDelta * 10_000n / receipt.gasUsed);
    required(gasEstimateErrorBps <= 3_000, `${name} gas estimate error is ${gasEstimateErrorBps} bps`);
    output.evidence[name] = {
      transactionHash,
      receiptId,
      quotedGasEstimate: request.gasEstimate.toString(),
      actualGasUsed: receipt.gasUsed.toString(),
      gasEstimateErrorBps,
      ...(name === "referral" ? { referrer: getAddress(liveQuote.referrer) } : {}),
      routeProviders: providers,
      routeSteps: providers.length,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      verifiedAt: new Date().toISOString(),
    };
    writeEvidence(output);
    return output.evidence[name];
  }

  async function configureReferral() {
    required(process.env.CONFIRM_STAGING_ADMIN_EVIDENCE === "I_UNDERSTAND_TESTNET_ONLY", "Referral setup requires CONFIRM_STAGING_ADMIN_EVIDENCE=I_UNDERSTAND_TESTNET_ONLY");
    const owner = privateKeyToAccount(privateKey("DEPLOYER_PRIVATE_KEY"));
    const referrer = privateKeyToAccount(privateKey("STAGING_REFERRER_PRIVATE_KEY"));
    required(owner.address === getAddress(manifest.owner), "DEPLOYER_PRIVATE_KEY does not control the staging owner");
    required(referrer.address !== account.address && referrer.address !== owner.address, "Referrer must be independent of the test account and owner");
    const share = Number(process.env.STAGING_REFERRAL_SHARE_BPS || "5000");
    required(Number.isInteger(share) && share > 0 && share <= 10_000, "STAGING_REFERRAL_SHARE_BPS must be 1..10000");
    const current = await publicClient.readContract({ address: manifest.permRouter, abi: evidenceAbi, functionName: "referralShares", args: [referrer.address] });
    if (Number(current) !== share) {
      const ownerWallet = createWalletClient({ account: owner, chain, transport });
      const hash = await ownerWallet.writeContract({ account: owner, chain, address: manifest.permRouter, abi: evidenceAbi, functionName: "configureReferral", args: [referrer.address, share] });
      await waitFor(hash);
    }
    return referrer;
  }

  async function claim(name: "treasuryClaim" | "referralClaim") {
    required(process.env.CONFIRM_STAGING_ADMIN_EVIDENCE === "I_UNDERSTAND_TESTNET_ONLY", "Claims require CONFIRM_STAGING_ADMIN_EVIDENCE=I_UNDERSTAND_TESTNET_ONLY");
    const beneficiary = name === "treasuryClaim"
      ? privateKeyToAccount(privateKey(process.env.STAGING_TREASURY_PRIVATE_KEY ? "STAGING_TREASURY_PRIVATE_KEY" : "DEPLOYER_PRIVATE_KEY"))
      : privateKeyToAccount(privateKey("STAGING_REFERRER_PRIVATE_KEY"));
    if (name === "treasuryClaim") required(beneficiary.address === getAddress(manifest.treasury), "Treasury key does not control the staging treasury");
    const token = ZERO_ADDRESS;
    const amount = await publicClient.readContract({ address: manifest.permRouter, abi: evidenceAbi, functionName: "claimableFees", args: [token, beneficiary.address] });
    required(amount > 0n, `${name} has no native fee available to claim`);
    let balance = await publicClient.getBalance({ address: beneficiary.address });
    if (balance < parseEther("0.00002")) {
      required(process.env.CONFIRM_STAGING_ADMIN_EVIDENCE === "I_UNDERSTAND_TESTNET_ONLY", "Funding a staging claim wallet requires explicit confirmation");
      const funding = await walletClient.sendTransaction({ account, chain, to: beneficiary.address, value: parseEther("0.00005") });
      await waitFor(funding);
      balance = await publicClient.getBalance({ address: beneficiary.address });
      required(balance > 0n, `${name} beneficiary funding failed`);
    }
    const beneficiaryWallet = createWalletClient({ account: beneficiary, chain, transport });
    const transactionHash = await beneficiaryWallet.writeContract({ account: beneficiary, chain, address: manifest.permRouter, abi: evidenceAbi, functionName: "claimFees", args: [token, account.address] });
    const receipt = await waitFor(transactionHash);
    let claimed: { token: Address; beneficiary: Address; recipient: Address; amount: bigint } | undefined;
    for (const log of receipt.logs.filter((item) => getAddress(item.address) === getAddress(manifest.permRouter))) {
      try {
        const decoded = decodeEventLog({ abi: evidenceAbi, data: log.data, topics: log.topics, strict: true });
        if (decoded.eventName === "FeeClaimed") claimed = decoded.args;
      } catch { /* Ignore unrelated router logs. */ }
    }
    required(claimed && getAddress(claimed.beneficiary) === beneficiary.address && claimed.amount > 0n, `${name} FeeClaimed evidence is missing`);
    output.evidence[name] = {
      transactionHash,
      token: getAddress(claimed.token),
      beneficiary: getAddress(claimed.beneficiary),
      recipient: getAddress(claimed.recipient),
      amount: claimed.amount.toString(),
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash,
      verifiedAt: new Date().toISOString(),
    };
    writeEvidence(output);
    return output.evidence[name];
  }

  let referrer: ReturnType<typeof privateKeyToAccount> | undefined;
  for (const scenario of selectedScenarios) {
    let result: ScenarioEvidence;
    if (scenario === "v3") {
      result = await executeSwap("v3", await quote("ETH", "TSLA", process.env.STAGING_V3_AMOUNT_IN || "1000000000000", "v3", ZERO_ADDRESS), false);
    } else if (scenario === "v2") {
      result = await executeSwap("v2", await quote("ETH", "TSLA", process.env.STAGING_V2_AMOUNT_IN || "10000000000", "v2", ZERO_ADDRESS), false);
    } else if (scenario === "multiHop") {
      result = await executeSwap("multiHop", await quote("NVDA", "AAPL", process.env.STAGING_MULTIHOP_AMOUNT_IN || "1000000000", "best", ZERO_ADDRESS), false);
    } else if (scenario === "crossVenue") {
      result = await executeSwap("crossVenue", await quote("NVDA", "TSLA", process.env.STAGING_CROSS_VENUE_AMOUNT_IN || "1000000000", "mixed", ZERO_ADDRESS), false);
    } else if (scenario === "permit2") {
      result = await executeSwap("permit2", await quote("TSLA", "ETH", process.env.STAGING_PERMIT2_AMOUNT_IN || "1000000000000000", "v3", ZERO_ADDRESS), true);
    } else if (scenario === "referral") {
      referrer ||= await configureReferral();
      result = await executeSwap("referral", await quote("ETH", "NVDA", process.env.STAGING_REFERRAL_AMOUNT_IN || "1000000000000", "v4", referrer.address), false);
    } else {
      result = await claim(scenario);
    }
    console.log(JSON.stringify({ scenario, status: "passed", nonRelease: true, transactionHash: result.transactionHash, receiptId: result.receiptId }, null, 2));
  }
  console.log(JSON.stringify({
    status: "passed",
    nonRelease: true,
    evidence: path.relative(process.cwd(), evidencePath),
    completed: Object.keys(output.evidence),
    reminder: "This evidence belongs to allowlisted staging only. It does not satisfy governance, custody, WalletConnect, hook, or external-assurance release gates.",
  }, null, 2));
}

main().catch((error) => {
  const detail = error as { shortMessage?: string; message?: string };
  console.error(detail.shortMessage || detail.message || error);
  process.exitCode = 1;
});
