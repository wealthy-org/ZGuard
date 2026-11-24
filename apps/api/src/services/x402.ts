import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
  };
  authorization?: Eip3009Authorization;
  txHash?: string;
  txSignature?: string;
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

  return {
    x402Version: 1,
    error: `Insufficient USDG credit. Submit payment on ${activeProfile.network} via X-PAYMENT header.`,
    accepts,
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

async function settleEip3009OnchainIfConfigured(params: {
  config: ZGuardAppConfig;
  publicClient: PublicClient;
  chainId: number;
  rpcUrl: string;
  tokenAddress: `0x${string}`;
  auth: Eip3009Authorization;
}): Promise<{ ok: true; settlementTxHash: string | null } | { ok: false; error: string }> {
  const { config, publicClient, chainId, rpcUrl, tokenAddress, auth } = params;
  if (config.x402SettlementMode === "offchain") {
    return { ok: true, settlementTxHash: null };
  }

  // Always verify on-chain that the nonce has not already been consumed in the ERC-3009 contract
  if (auth.nonce && /^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    try {
      const alreadyUsed = await publicClient.readContract({
        address: tokenAddress,
        abi: EIP3009_SETTLE_ABI,
        functionName: "authorizationState",
        args: [auth.from.toLowerCase() as Hex, auth.nonce as Hex],
      });
      if (alreadyUsed) {
        return { ok: false, error: "EIP-3009 nonce already marked used on-chain" };
      }
    } catch {
      // Continue if token does not expose authorizationState
    }
  }

  const pk = config.x402RelayerPrivateKey;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    if (config.x402SettlementMode === "onchain") {
      return {
        ok: false,
        error: "ZGUARD_X402_SETTLEMENT_MODE=onchain requires ZGUARD_X402_RELAYER_PRIVATE_KEY",
      };
    }
    return { ok: true, settlementTxHash: null };
  }

  const parts = auth.signature ? splitEcdsaSig(auth.signature) : null;
  if (!parts || !auth.nonce) {
    return { ok: false, error: "Cannot settle 65-byte EIP-3009 signature without r/s/v and nonce" };
  }

  try {
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
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 25_000 });
    if (receipt.status !== "success") {
      return { ok: false, error: "On-chain transferWithAuthorization reverted" };
    }
    return { ok: true, settlementTxHash: hash };
  } catch (err) {
    if (config.x402SettlementMode === "onchain") {
      return {
        ok: false,
        error: `On-chain EIP-3009 settlement failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    return { ok: true, settlementTxHash: null };
  }
}

async function verifySolanaUsdcPayment(params: {
  config: ZGuardAppConfig;
  store: StorageStore;
  network: string;
  txSignature: string;
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
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await resp.json()) as {
      result?: {
        meta?: {
          err: unknown;
          preTokenBalances?: Array<{
            accountIndex: number;
            mint: string;
            owner?: string;
            uiTokenAmount: { amount: string };
          }>;
          postTokenBalances?: Array<{
            accountIndex: number;
            mint: string;
            owner?: string;
            uiTokenAmount: { amount: string };
          }>;
        };
      } | null;
    };

    const meta = json.result?.meta;
    if (!meta || meta.err !== null) {
      return { ok: false, error: "Solana X-PAYMENT transaction not confirmed or failed" };
    }

    const preMap = new Map<number, bigint>();
    for (const b of meta.preTokenBalances ?? []) {
      if (b.mint === expectedMint && b.owner === expectedOwner) {
        preMap.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
      }
    }

    let netReceived = 0n;
    for (const b of meta.postTokenBalances ?? []) {
      if (b.mint === expectedMint && b.owner === expectedOwner) {
        const after = BigInt(b.uiTokenAmount.amount);
        const before = preMap.get(b.accountIndex) ?? 0n;
        if (after > before) netReceived += after - before;
      }
    }

    if (netReceived < params.minimumMicroUsdg) {
      return {
        ok: false,
        error: `Solana USDC transfer received ${netReceived.toString()} < required ${params.minimumMicroUsdg.toString()}`,
      };
    }

    const fresh = await params.store.consumePaymentNonce({
      nonceKey: `solana:${params.network}:${params.txSignature}`,
      tenantId: params.tenantId,
      network: params.network,
      asset: expectedMint,
      payer: "solana-payer",
      amountMicro: netReceived,
    });
    if (!fresh) {
      return { ok: false, error: "Solana X-PAYMENT signature already redeemed (replay blocked)" };
    }

    return {
      ok: true,
      creditedMicroUsdg: netReceived,
      payer: "solana-payer",
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

/**
 * Verifies an incoming `X-PAYMENT` header across:
 *   1. Robinhood Chain Testnet (`eip155:46630`) & Mainnet (`eip155:4663`) — USDG (primary mandatory rail)
 *   2. Base Mainnet (`eip155:8453`) & Base Sepolia (`eip155:84532`) — USDC (when `enableUsdcBase` is true)
 *   3. Solana Mainnet & Devnet (`solana:...`) — USDC (when `enableUsdcSolana` is true)
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

  // Path 1: Signed EIP-3009 Authorization (USDG on RHC 46630/4663 or USDC on Base 8453/84532)
  if (auth) {
    if (auth.to.toLowerCase() !== params.config.x402PayTo.toLowerCase()) {
      return {
        ok: false,
        error: `X-PAYMENT recipient ${auth.to} does not match treasury ${params.config.x402PayTo}`,
      };
    }

    const amount = BigInt(auth.value ?? "0");
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

    const settlement = await settleEip3009OnchainIfConfigured({
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
      settlementTxHash: settlement.settlementTxHash,
    };
  }

  // Path 2: On-chain confirmed ERC-20 Transfer transaction hash on RHC or Base
  if (txHash && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    try {
      const receipt = await evmClient.getTransactionReceipt({ hash: txHash as Hex });
      if (receipt.status !== "success") {
        return { ok: false, error: `X-PAYMENT transaction reverted on ${network}` };
      }

      const tokenLower = tokenAddress.toLowerCase();
      const expectedTo = params.config.x402PayTo.toLowerCase();
      let matchedAmount = 0n;
      let payer = receipt.from.toLowerCase();

      for (const lg of receipt.logs) {
        if (
          lg.address.toLowerCase() === tokenLower &&
          lg.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
          lg.topics.length >= 3
        ) {
          const fromAddr = `0x${lg.topics[1]!.slice(-40).toLowerCase()}`;
          const toAddr = `0x${lg.topics[2]!.slice(-40).toLowerCase()}`;
          if (toAddr === expectedTo) {
            matchedAmount += BigInt(lg.data);
            payer = fromAddr;
          }
        }
      }

      if (matchedAmount < params.minimumMicroUsdg) {
        return {
          ok: false,
          error: `Confirmed ${assetSymbol} transfer to ${expectedTo} was ${matchedAmount.toString()} < ${params.minimumMicroUsdg.toString()}`,
        };
      }

      const fresh = await params.store.consumePaymentNonce({
        nonceKey: `tx:${targetChainId}:${txHash.toLowerCase()}`,
        tenantId: params.tenantId,
        network,
        asset: tokenAddress,
        payer,
        amountMicro: matchedAmount,
      });

      if (!fresh) {
        return { ok: false, error: "X-PAYMENT txHash already redeemed (replay blocked)" };
      }

      return {
        ok: true,
        creditedMicroUsdg: matchedAmount,
        payer,
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
    error: "X-PAYMENT must include payload.authorization (EIP-3009) or payload.txHash / txSignature",
  };
}
