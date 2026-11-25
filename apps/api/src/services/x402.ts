import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Chain,
  type Hex,
  recoverMessageAddress,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  BASE_USDC_ASSETS,
  NETWORK_BASE_MAINNET,
  NETWORK_BASE_SEPOLIA,
  NETWORK_RHC_MAINNET,
  NETWORK_RHC_TESTNET,
  NETWORK_SOLANA_DEVNET,
  NETWORK_SOLANA_MAINNET,
  RHC_MAINNET_CHAIN_ID,
  RHC_TESTNET_CHAIN_ID,
  SOLANA_USDC_MINTS,
  depositClaimMessage,
  getRhcChainProfile,
  getVerifiedEip712Domain,
  verifyEip3009Signature,
  type Eip3009Authorization,
  type X402PaymentRequirement,
  type X402QuoteResponse,
} from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";
import type { StorageStore } from "../db/store.js";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const EIP3009_SETTLE_ABI = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

export interface ParsedXPayment {
  x402Version?: number;
  scheme?: string;
  network?: string;
  payload?: {
    authorization?: Eip3009Authorization;
    txHash?: string;
    txSignature?: string;
    claimSignature?: string;
    claimer?: string;
  };
  authorization?: Eip3009Authorization;
  txHash?: string;
  txSignature?: string;
  claimSignature?: string;
  claimer?: string;
}

export function buildX402Quote(
  config: ZGuardAppConfig,
  resourcePath: string,
  requiredMicroUsdg: bigint,
  description: string
): X402QuoteResponse {
  const activeProfile = getRhcChainProfile(config.activeChainId);

  const accepts: X402PaymentRequirement[] = [
    {
      scheme: "exact",
      network: activeProfile.network,
      maxAmountRequired: requiredMicroUsdg.toString(),
      resource: `${config.publicApiUrl.replace(/\/+$/, "")}${resourcePath}`,
      description,
      mimeType: "application/json",
      payTo: config.x402PayTo,
      maxTimeoutSeconds: 300,
      asset: activeProfile.usdgAddress,
      extra: {
        name: activeProfile.usdgDomain.name,
        version: activeProfile.usdgDomain.version,
        decimals: 6,
        unit: "micro",
      },
    },
  ];

  if (config.enableUsdcBase) {
    const baseAsset = activeProfile.isTestnet
      ? BASE_USDC_ASSETS.SEPOLIA
      : BASE_USDC_ASSETS.MAINNET;
    accepts.push({
      scheme: "exact",
      network: baseAsset.network,
      maxAmountRequired: requiredMicroUsdg.toString(),
      resource: `${config.publicApiUrl.replace(/\/+$/, "")}${resourcePath}`,
      description: `${description} (USDC on ${activeProfile.isTestnet ? "Base Sepolia" : "Base"} optional rail)`,
      mimeType: "application/json",
      payTo: config.x402PayTo,
      maxTimeoutSeconds: 300,
      asset: baseAsset.address,
      extra: {
        name: baseAsset.name,
        version: baseAsset.version,
        decimals: 6,
        unit: "micro",
      },
    });
  }

  if (config.enableUsdcSolana) {
    const solNetwork = activeProfile.isTestnet
      ? NETWORK_SOLANA_DEVNET
      : NETWORK_SOLANA_MAINNET;
    const solMint = activeProfile.isTestnet
      ? SOLANA_USDC_MINTS.DEVNET
      : SOLANA_USDC_MINTS.MAINNET;
    accepts.push({
      scheme: "exact",
      network: solNetwork,
      maxAmountRequired: requiredMicroUsdg.toString(),
      resource: `${config.publicApiUrl.replace(/\/+$/, "")}${resourcePath}`,
      description: `${description} (USDC on Solana optional rail)`,
      mimeType: "application/json",
      payTo: config.x402SolanaPayTo || config.x402PayTo,
      maxTimeoutSeconds: 300,
      asset: solMint,
      extra: {
        name: "USD Coin",
        version: "1",
        decimals: 6,
        unit: "micro",
      },
    });
  }

  const modeRes = resolveSettlementMode(config);
  const mode = modeRes.ok ? modeRes.mode : "unavailable";
  const instructions =
    mode === "deposit"
      ? `Deposit mode: (1) transfer >= ${requiredMicroUsdg.toString()} micro-USDG to ${config.x402PayTo} on ${activeProfile.network}; (2) wait ${config.x402MinConfirmations} confirmation(s); (3) sign depositClaimMessage(txHash, ${config.activeChainId}) with the SAME wallet (personal_sign); (4) retry with X-PAYMENT {"network":"${activeProfile.network}","payload":{"txHash":"0x…","claimSignature":"0x…"}}.`
      : mode === "onchain"
        ? `On-chain mode: sign an EIP-3009 TransferWithAuthorization for USDG to ${config.x402PayTo} and send it in X-PAYMENT; the relayer settles it and credit is granted only after a successful receipt.`
        : mode === "offchain"
          ? "DEV/TEST offchain mode: EIP-3009 signatures are checked but NOT settled. Never use in production."
          : `Payments are currently unavailable: ${modeRes.ok ? "" : modeRes.error}`;

  return {
    x402Version: 1,
    error: `Insufficient USDG credit. Submit payment on ${activeProfile.network} via X-PAYMENT header.`,
    accepts,
    settlement: {
      mode,
      minConfirmations: config.x402MinConfirmations,
      instructions,
      ...(mode === "deposit"
        ? { claimMessageTemplate: "ZGuard credit claim\ntx:<txHash lowercase>\nchain:<chainId>" }
        : {}),
    },
  };
}

function decodeXPaymentHeader(rawHeader: string): ParsedXPayment | null {
  const trimmed = rawHeader.trim();
  try {
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed) as ParsedXPayment;
    }
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    return JSON.parse(decoded) as ParsedXPayment;
  } catch {
    return null;
  }
}

function splitEcdsaSig(sigHex: string): { v: number; r: Hex; s: Hex } | null {
  const clean = sigHex.startsWith("0x") ? sigHex.slice(2) : sigHex;
  if (clean.length !== 130) return null;
  const r = `0x${clean.slice(0, 64)}` as Hex;
  const s = `0x${clean.slice(64, 128)}` as Hex;
  let v = parseInt(clean.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}

export type EffectiveSettlementMode = "onchain" | "deposit" | "offchain";

/**
 * Resolves the settlement mode actually used at runtime (gap X402-1).
 * `auto` never means "credit without settlement": it is `onchain` with a relayer, otherwise `deposit`.
 */
export function resolveSettlementMode(
  config: ZGuardAppConfig
): { ok: true; mode: EffectiveSettlementMode } | { ok: false; error: string } {
  const hasRelayer = Boolean(
    config.x402RelayerPrivateKey && /^0x[0-9a-fA-F]{64}$/.test(config.x402RelayerPrivateKey)
  );
  switch (config.x402SettlementMode) {
    case "offchain":
      if (config.isProduction) {
        return {
          ok: false,
          error:
            "ZGUARD_X402_SETTLEMENT_MODE=offchain is a dev/test mode and is refused when NODE_ENV=production",
        };
      }
      return { ok: true, mode: "offchain" };
    case "onchain":
      if (!hasRelayer) {
        return {
          ok: false,
          error: "ZGUARD_X402_SETTLEMENT_MODE=onchain requires a valid ZGUARD_X402_RELAYER_PRIVATE_KEY",
        };
      }
      return { ok: true, mode: "onchain" };
    case "deposit":
      return { ok: true, mode: "deposit" };
    case "auto":
    default:
      return { ok: true, mode: hasRelayer ? "onchain" : "deposit" };
  }
}

/**
 * Settles an EIP-3009 authorization on-chain through the relayer. Returns `ok` ONLY when the
 * `transferWithAuthorization` receipt is `success` with the required confirmations (gap X402-1/X402-2).
 * Every failure path rejects; the payment nonce is NOT consumed on failure.
 */
async function settleEip3009Onchain(params: {
  config: ZGuardAppConfig;
  publicClient: PublicClient;
  chainId: number;
  rpcUrl: string;
  tokenAddress: `0x${string}`;
  auth: Eip3009Authorization;
}): Promise<{ ok: true; settlementTxHash: string } | { ok: false; error: string }> {
  const { config, publicClient, chainId, rpcUrl, tokenAddress, auth } = params;
  const pk = config.x402RelayerPrivateKey;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    return { ok: false, error: "On-chain settlement requires ZGUARD_X402_RELAYER_PRIVATE_KEY" };
  }
  if (!auth.nonce || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    return { ok: false, error: "EIP-3009 authorization is missing a bytes32 nonce" };
  }
  const parts = auth.signature ? splitEcdsaSig(auth.signature) : null;
  if (!parts) {
    return { ok: false, error: "Cannot settle EIP-3009 authorization without a 65-byte signature" };
  }

  try {
    const [alreadyUsed, balance] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: EIP3009_SETTLE_ABI,
        functionName: "authorizationState",
        args: [auth.from.toLowerCase() as Hex, auth.nonce as Hex],
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: EIP3009_SETTLE_ABI,
        functionName: "balanceOf",
        args: [auth.from.toLowerCase() as Hex],
      }),
    ]);
    if (alreadyUsed) {
      return { ok: false, error: "EIP-3009 nonce already marked used on-chain" };
    }
    if (balance < BigInt(auth.value)) {
      return {
        ok: false,
        error: `Payer balance ${balance.toString()} is below the authorized amount ${auth.value}`,
      };
    }

    const chainObj: Chain = defineChain({
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const account = privateKeyToAccount(pk as Hex);
    const wallet = createWalletClient({
      account,
      chain: chainObj,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    const hash = await wallet.writeContract({
      address: tokenAddress,
      abi: EIP3009_SETTLE_ABI,
      functionName: "transferWithAuthorization",
      args: [
        auth.from.toLowerCase() as Hex,
        auth.to.toLowerCase() as Hex,
        BigInt(auth.value),
        BigInt(auth.validAfter ?? 0),
        BigInt(auth.validBefore ?? 0),
        auth.nonce as Hex,
        parts.v,
        parts.r,
        parts.s,
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: Math.max(1, config.x402MinConfirmations),
      timeout: 40_000,
    });
    if (receipt.status !== "success") {
      return { ok: false, error: "On-chain transferWithAuthorization reverted" };
    }
    return { ok: true, settlementTxHash: hash };
  } catch (err) {
    // X402-2: every settlement failure is a rejection, in every mode.
    return {
      ok: false,
      error: `On-chain EIP-3009 settlement failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Solana optional rail helpers (ed25519 claim binding + finalized commitment)
// ---------------------------------------------------------------------------------------------

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function decodeBase58(input: string): Uint8Array | null {
  const str = input.trim();
  if (!str) return null;
  let num = 0n;
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const ch of str) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function decodeSignatureBytes(sig: string): Uint8Array | null {
  const t = sig.trim();
  if (/^0x[0-9a-fA-F]+$/.test(t)) return Uint8Array.from(Buffer.from(t.slice(2), "hex"));
  const b58 = decodeBase58(t);
  if (b58 && b58.length === 64) return b58;
  try {
    const b64 = Buffer.from(t, "base64");
    if (b64.length === 64) return Uint8Array.from(b64);
  } catch {
    // ignore
  }
  return null;
}

/** Verifies an ed25519 signature from a base58 Solana public key over a UTF-8 message. */
export function verifySolanaClaimSignature(
  claimerBase58: string,
  message: string,
  signature: string
): boolean {
  const pub = decodeBase58(claimerBase58);
  const sig = decodeSignatureBytes(signature);
  if (!pub || pub.length !== 32 || !sig || sig.length !== 64) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pub)]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(sig));
  } catch {
    return false;
  }
}


async function verifySolanaUsdcPayment(params: {
  config: ZGuardAppConfig;
  store: StorageStore;
  network: string;
  txSignature: string;
  claimer: string | undefined;
  claimSignature: string | undefined;
  minimumMicroUsdg: bigint;
  tenantId: string | null;
}): Promise<
  | {
      ok: true;
      creditedMicroUsdg: bigint;
      payer: string;
      assetSymbol: "USDC";
      rail: string;
      settlementTxHash: string;
    }
  | { ok: false; error: string }
> {
  const isDevnet = params.network === NETWORK_SOLANA_DEVNET;
  const rpcUrl = isDevnet ? params.config.solanaDevnetRpcUrl : params.config.solanaRpcUrl;
  const expectedMint = isDevnet ? SOLANA_USDC_MINTS.DEVNET : SOLANA_USDC_MINTS.MAINNET;
  const expectedOwner = params.config.x402SolanaPayTo || params.config.x402PayTo;

  // X402-4 (Solana): the claim must be signed by the wallet that actually sent the USDC.
  if (!params.claimer || !params.claimSignature) {
    return {
      ok: false,
      error:
        "Solana X-PAYMENT requires payload.claimer (payer public key) and payload.claimSignature over depositClaimMessage(txSignature, network)",
    };
  }
  const message = depositClaimMessage(params.txSignature, params.network);
  if (!verifySolanaClaimSignature(params.claimer, message, params.claimSignature)) {
    return { ok: false, error: "Invalid Solana claimSignature (must be signed by the paying wallet)" };
  }

  try {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          params.txSignature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await resp.json()) as {
      result?: {
        meta?: {
          err: unknown;
          preTokenBalances?: SolTokenBalance[];
          postTokenBalances?: SolTokenBalance[];
        };
      } | null;
    };

    const meta = json.result?.meta;
    if (!meta || meta.err !== null) {
      return { ok: false, error: "Solana X-PAYMENT transaction not finalized or failed" };
    }

    const sumFor = (list: SolTokenBalance[] | undefined, owner: string) => {
      const m = new Map<number, bigint>();
      for (const b of list ?? []) {
        if (b.mint === expectedMint && b.owner === owner) {
          m.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
        }
      }
      return m;
    };

    const preTreasury = sumFor(meta.preTokenBalances, expectedOwner);
    const postTreasury = sumFor(meta.postTokenBalances, expectedOwner);
    let netReceived = 0n;
    for (const [idx, after] of postTreasury) {
      const before = preTreasury.get(idx) ?? 0n;
      if (after > before) netReceived += after - before;
    }

    const preClaimer = sumFor(meta.preTokenBalances, params.claimer);
    const postClaimer = sumFor(meta.postTokenBalances, params.claimer);
    let netSent = 0n;
    for (const [idx, before] of preClaimer) {
      const after = postClaimer.get(idx) ?? 0n;
      if (before > after) netSent += before - after;
    }

    const credited = netReceived < netSent ? netReceived : netSent;
    if (credited < params.minimumMicroUsdg) {
      return {
        ok: false,
        error: `Solana USDC sent by ${params.claimer} to treasury was ${credited.toString()} < required ${params.minimumMicroUsdg.toString()}`,
      };
    }

    const fresh = await params.store.consumePaymentNonce({
      nonceKey: `solana:${params.network}:${params.txSignature}`,
      tenantId: params.tenantId,
      network: params.network,
      asset: expectedMint,
      payer: params.claimer,
      amountMicro: credited,
    });
    if (!fresh) {
      return { ok: false, error: "Solana X-PAYMENT signature already redeemed (replay blocked)" };
    }

    return {
      ok: true,
      creditedMicroUsdg: credited,
      payer: params.claimer,
      assetSymbol: "USDC",
      rail: params.network,
      settlementTxHash: params.txSignature,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Solana RPC verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

interface SolTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

/**
 * Verifies an incoming `X-PAYMENT` header across:
 *   1. Robinhood Chain Testnet (`eip155:46630`) & Mainnet (`eip155:4663`) — USDG (primary mandatory rail)
 *   2. Base Mainnet (`eip155:8453`) & Base Sepolia (`eip155:84532`) — USDC (when `enableUsdcBase` is true)
 *   3. Solana Mainnet & Devnet (`solana:...`) — USDC (when `enableUsdcSolana` is true)
 *
 * Credit is only ever returned for money that verifiably arrived at the treasury (gap X402-1/2/4).
 */
export async function verifyAndConsumeXPayment(params: {
  config: ZGuardAppConfig;
  client: PublicClient;
  getRhcClient?: (chainId: number) => PublicClient;
  store: StorageStore;
  rawHeader: string;
  minimumMicroUsdg: bigint;
  tenantId: string | null;
}): Promise<
  | {
      ok: true;
      creditedMicroUsdg: bigint;
      payer: string;
      assetSymbol: "USDG" | "USDC";
      rail: string;
      settlementTxHash: string | null;
    }
  | { ok: false; error: string }
> {
  const parsed = decodeXPaymentHeader(params.rawHeader);
  if (!parsed) {
    return { ok: false, error: "Malformed X-PAYMENT header (expected JSON or base64 JSON)" };
  }

  const modeRes = resolveSettlementMode(params.config);
  if (!modeRes.ok) {
    return { ok: false, error: modeRes.error };
  }
  const mode = modeRes.mode;

  const activeProfile = getRhcChainProfile(params.config.activeChainId);
  const network = parsed.network ?? activeProfile.network;

  // Optional Solana USDC rail
  if (network === NETWORK_SOLANA_MAINNET || network === NETWORK_SOLANA_DEVNET) {
    if (!params.config.enableUsdcSolana) {
      return { ok: false, error: "Solana USDC payment rail is disabled in open config" };
    }
    const sig = parsed.payload?.txSignature ?? parsed.txSignature ?? parsed.txHash;
    if (!sig) {
      return { ok: false, error: "Solana X-PAYMENT requires payload.txSignature" };
    }
    return verifySolanaUsdcPayment({
      config: params.config,
      store: params.store,
      network,
      txSignature: sig,
      claimer: parsed.payload?.claimer ?? parsed.claimer,
      claimSignature: parsed.payload?.claimSignature ?? parsed.claimSignature,
      minimumMicroUsdg: params.minimumMicroUsdg,
      tenantId: params.tenantId,
    });
  }

  // Determine target EVM rail (RHC 46630, RHC 4663, Base 8453, or Base Sepolia 84532)
  let targetChainId: number;
  let tokenAddress: `0x${string}`;
  let assetSymbol: "USDG" | "USDC";
  let evmClient: PublicClient;
  let rpcUrl: string;

  if (network === NETWORK_RHC_TESTNET || network === NETWORK_RHC_MAINNET) {
    targetChainId =
      network === NETWORK_RHC_MAINNET ? RHC_MAINNET_CHAIN_ID : RHC_TESTNET_CHAIN_ID;
    const prof = getRhcChainProfile(targetChainId);
    tokenAddress = prof.usdgAddress;
    assetSymbol = "USDG";
    evmClient =
      targetChainId === params.config.activeChainId
        ? params.client
        : (params.getRhcClient?.(targetChainId) ??
          createPublicClient({ transport: http(prof.defaultRpcUrl, { timeout: 10_000 }) }));
    rpcUrl =
      targetChainId === RHC_MAINNET_CHAIN_ID
        ? params.config.rhcMainnetRpcUrl
        : params.config.rhcTestnetRpcUrl;
  } else if (network === NETWORK_BASE_MAINNET || network === NETWORK_BASE_SEPOLIA) {
    if (!params.config.enableUsdcBase) {
      return { ok: false, error: "Base USDC payment rail is disabled in open config" };
    }
    const baseSpec =
      network === NETWORK_BASE_SEPOLIA ? BASE_USDC_ASSETS.SEPOLIA : BASE_USDC_ASSETS.MAINNET;
    targetChainId = baseSpec.chainId;
    tokenAddress = baseSpec.address;
    assetSymbol = "USDC";
    rpcUrl =
      network === NETWORK_BASE_SEPOLIA
        ? params.config.baseSepoliaRpcUrl
        : params.config.baseRpcUrl;
    evmClient = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000 }) });
  } else {
    return {
      ok: false,
      error: `Unsupported X-PAYMENT network ${network}; expected ${activeProfile.network}`,
    };
  }

  const auth = parsed.payload?.authorization ?? parsed.authorization;
  const txHash = parsed.payload?.txHash ?? parsed.txHash;
  const claimSignature = parsed.payload?.claimSignature ?? parsed.claimSignature;

  // Path 1: Signed EIP-3009 Authorization (settled by relayer, or offchain in dev/test only)
  if (auth) {
    if (mode === "deposit") {
      return {
        ok: false,
        error:
          "This API runs in deposit settlement mode: transfer USDG to payTo yourself, then send X-PAYMENT {network, payload:{txHash, claimSignature}} signed over depositClaimMessage(txHash, chainId)",
      };
    }
    if (!auth.to || !auth.from || auth.value === undefined) {
      return { ok: false, error: "Malformed EIP-3009 authorization (from/to/value required)" };
    }
    if (auth.to.toLowerCase() !== params.config.x402PayTo.toLowerCase()) {
      return {
        ok: false,
        error: `X-PAYMENT recipient ${auth.to} does not match treasury ${params.config.x402PayTo}`,
      };
    }

    let amount: bigint;
    try {
      amount = BigInt(auth.value);
    } catch {
      return { ok: false, error: "X-PAYMENT amount is not an integer" };
    }
    if (amount < params.minimumMicroUsdg) {
      return {
        ok: false,
        error: `X-PAYMENT amount ${amount.toString()} < required ${params.minimumMicroUsdg.toString()} micro-${assetSymbol}`,
      };
    }

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (auth.validBefore !== undefined && BigInt(auth.validBefore) <= nowSec) {
      return { ok: false, error: "X-PAYMENT EIP-3009 authorization has expired (validBefore)" };
    }
    if (auth.validAfter !== undefined && BigInt(auth.validAfter) > nowSec + 60n) {
      return { ok: false, error: "X-PAYMENT EIP-3009 authorization is not yet valid (validAfter)" };
    }

    const domain = getVerifiedEip712Domain(targetChainId, tokenAddress);
    if (!domain) {
      return { ok: false, error: `${assetSymbol} EIP-712 domain not verified on chain ${targetChainId}` };
    }

    const sigValid = await verifyEip3009Signature(auth, domain);
    if (!sigValid) {
      return {
        ok: false,
        error: `Invalid EIP-3009 signature over ${assetSymbol} domain on chain ${targetChainId}`,
      };
    }

    let settlementTxHash: string | null = null;
    if (mode === "onchain") {
      const settlement = await settleEip3009Onchain({
        config: params.config,
        publicClient: evmClient,
        chainId: targetChainId,
        rpcUrl,
        tokenAddress,
        auth,
      });
      if (!settlement.ok) {
        return { ok: false, error: settlement.error };
      }
      settlementTxHash = settlement.settlementTxHash;
    }
    // mode === "offchain": dev/test only (refused in production by resolveSettlementMode)

    const nonceKey = `eip3009:${targetChainId}:${auth.from.toLowerCase()}:${(
      auth.nonce ?? ""
    ).toLowerCase()}`;
    const fresh = await params.store.consumePaymentNonce({
      nonceKey,
      tenantId: params.tenantId,
      network,
      asset: tokenAddress,
      payer: auth.from,
      amountMicro: amount,
    });

    if (!fresh) {
      return { ok: false, error: "X-PAYMENT nonce already consumed (replay blocked)" };
    }

    return {
      ok: true,
      creditedMicroUsdg: amount,
      payer: auth.from,
      assetSymbol,
      rail: network,
      settlementTxHash,
    };
  }

  // Path 2: Deposit claim — confirmed ERC-20 Transfer txHash + claimSignature from the payer (X402-4)
  if (txHash && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    if (!claimSignature || !/^0x[0-9a-fA-F]{130}$/.test(claimSignature)) {
      return {
        ok: false,
        error:
          "X-PAYMENT txHash claims require payload.claimSignature: an EIP-191 signature by the paying wallet over depositClaimMessage(txHash, chainId)",
      };
    }

    let claimer: string;
    try {
      claimer = (
        await recoverMessageAddress({
          message: depositClaimMessage(txHash, targetChainId),
          signature: claimSignature as Hex,
        })
      ).toLowerCase();
    } catch {
      return { ok: false, error: "Invalid claimSignature (could not recover signer)" };
    }

    try {
      const receipt = await evmClient.getTransactionReceipt({ hash: txHash as Hex });
      if (receipt.status !== "success") {
        return { ok: false, error: `X-PAYMENT transaction reverted on ${network}` };
      }

      if (params.config.x402MinConfirmations > 0) {
        const head = await evmClient.getBlockNumber();
        const confirmations = head - receipt.blockNumber + 1n;
        if (confirmations < BigInt(params.config.x402MinConfirmations)) {
          return {
            ok: false,
            error: `X-PAYMENT transaction has ${confirmations.toString()} confirmation(s); ${params.config.x402MinConfirmations} required. Retry shortly.`,
          };
        }
      }

      const tokenLower = tokenAddress.toLowerCase();
      const expectedTo = params.config.x402PayTo.toLowerCase();
      let matchedAmount = 0n;

      for (const lg of receipt.logs) {
        if (
          lg.address.toLowerCase() === tokenLower &&
          lg.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
          lg.topics.length >= 3
        ) {
          const fromAddr = `0x${lg.topics[1]!.slice(-40).toLowerCase()}`;
          const toAddr = `0x${lg.topics[2]!.slice(-40).toLowerCase()}`;
          // X402-4: only transfers FROM the claim signer TO the treasury count.
          if (toAddr === expectedTo && fromAddr === claimer) {
            matchedAmount += BigInt(lg.data);
          }
        }
      }

      if (matchedAmount === 0n) {
        return {
          ok: false,
          error: `No ${assetSymbol} transfer from claim signer ${claimer} to ${expectedTo} in ${txHash}`,
        };
      }
      if (matchedAmount < params.minimumMicroUsdg) {
        return {
          ok: false,
          error: `Confirmed ${assetSymbol} transfer from ${claimer} to ${expectedTo} was ${matchedAmount.toString()} < ${params.minimumMicroUsdg.toString()}`,
        };
      }

      const fresh = await params.store.consumePaymentNonce({
        nonceKey: `tx:${targetChainId}:${txHash.toLowerCase()}`,
        tenantId: params.tenantId,
        network,
        asset: tokenAddress,
        payer: claimer,
        amountMicro: matchedAmount,
      });

      if (!fresh) {
        return { ok: false, error: "X-PAYMENT txHash already redeemed (replay blocked)" };
      }

      return {
        ok: true,
        creditedMicroUsdg: matchedAmount,
        payer: claimer,
        assetSymbol,
        rail: network,
        settlementTxHash: txHash,
      };
    } catch (err) {
      return {
        ok: false,
        error: `Could not verify X-PAYMENT txHash on ${network}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  return {
    ok: false,
    error:
      mode === "deposit"
        ? "X-PAYMENT must include payload.txHash + payload.claimSignature (deposit mode)"
        : "X-PAYMENT must include payload.authorization (EIP-3009) or payload.txHash + payload.claimSignature",
  };
}

/**
 * Returns the payer an X-PAYMENT header CLAIMS to come from, without any network call.
 * Used only for pre-verification rate limiting (gap C5, per-payer budget); never for crediting.
 */
export async function peekXPaymentPayer(
  rawHeader: string,
  activeChainId: number
): Promise<string | null> {
  const parsed = decodeXPaymentHeader(rawHeader);
  if (!parsed) return null;
  const auth = parsed.payload?.authorization ?? parsed.authorization;
  if (auth?.from && /^0x[0-9a-fA-F]{40}$/.test(auth.from)) return auth.from.toLowerCase();
  const claimer = parsed.payload?.claimer ?? parsed.claimer;
  if (claimer) return claimer;
  const txHash = parsed.payload?.txHash ?? parsed.txHash;
  const claimSignature = parsed.payload?.claimSignature ?? parsed.claimSignature;
  if (txHash && claimSignature && /^0x[0-9a-fA-F]{130}$/.test(claimSignature)) {
    const network = parsed.network ?? "";
    const m = network.match(/^eip155:(\d+)$/);
    const chainId = m ? Number(m[1]) : activeChainId;
    try {
      return (
        await recoverMessageAddress({
          message: depositClaimMessage(txHash, chainId),
          signature: claimSignature as Hex,
        })
      ).toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}
