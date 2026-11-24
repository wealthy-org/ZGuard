import { type Hex, type PublicClient } from "viem";
import {
  NETWORK_BASE_MAINNET,
  NETWORK_RHC_MAINNET,
  NETWORK_SOLANA_MAINNET,
  RHC_CANONICAL_ASSETS,
  RHC_MAINNET_CHAIN_ID,
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

export interface ParsedXPayment {
  x402Version?: number;
  scheme?: string;
  network?: string;
  payload?: {
    authorization?: Eip3009Authorization;
    txHash?: string;
  };
  authorization?: Eip3009Authorization;
  txHash?: string;
}

export function buildX402Quote(
  config: ZGuardAppConfig,
  resourcePath: string,
  requiredMicroUsdg: bigint,
  description: string
): X402QuoteResponse {
  const accepts: X402PaymentRequirement[] = [
    {
      scheme: "exact",
      network: NETWORK_RHC_MAINNET,
      maxAmountRequired: requiredMicroUsdg.toString(),
      resource: `${config.publicApiUrl.replace(/\/+$/, "")}${resourcePath}`,
      description,
      mimeType: "application/json",
      payTo: config.x402PayTo,
      maxTimeoutSeconds: 300,
      asset: RHC_CANONICAL_ASSETS.USDG.address,
      extra: {
        name: RHC_CANONICAL_ASSETS.USDG.eip712Domain.name,
        version: RHC_CANONICAL_ASSETS.USDG.eip712Domain.version,
        decimals: RHC_CANONICAL_ASSETS.USDG.decimals,
        unit: "micro",
      },
    },
  ];

  if (config.enableUsdcBase) {
    accepts.push({
      scheme: "exact",
      network: NETWORK_BASE_MAINNET,
      maxAmountRequired: requiredMicroUsdg.toString(),
      resource: `${config.publicApiUrl.replace(/\/+$/, "")}${resourcePath}`,
      description: `${description} (USDC on Base optional rail)`,
      mimeType: "application/json",
      payTo: config.x402PayTo,
      maxTimeoutSeconds: 300,
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      extra: {
        name: "USD Coin",
        version: "2",
        decimals: 6,
        unit: "micro",
      },
    });
  }

  if (config.enableUsdcSolana) {
    accepts.push({
      scheme: "exact",
      network: NETWORK_SOLANA_MAINNET,
      maxAmountRequired: requiredMicroUsdg.toString(),
      resource: `${config.publicApiUrl.replace(/\/+$/, "")}${resourcePath}`,
      description: `${description} (USDC on Solana optional rail)`,
      mimeType: "application/json",
      payTo: config.x402PayTo,
      maxTimeoutSeconds: 300,
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
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
    error: "Insufficient USDG credit. Submit payment on eip155:4663 via X-PAYMENT header.",
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

/**
 * Verifies an incoming `X-PAYMENT` header on `eip155:4663` (USDG):
 * - Path 1: Cryptographic EIP-3009 signature verification against USDG's onchain EIP-712 domain
 *           + recipient/amount check + replay nonce consumption in Neon/store.
 * - Path 2: Confirmed on-chain RHC 4663 USDG Transfer txHash receipt verification + replay protection.
 */
export async function verifyAndConsumeXPayment(params: {
  config: ZGuardAppConfig;
  client: PublicClient;
  store: StorageStore;
  rawHeader: string;
  minimumMicroUsdg: bigint;
  tenantId: string | null;
}): Promise<
  | { ok: true; creditedMicroUsdg: bigint; payer: string }
  | { ok: false; error: string }
> {
  const parsed = decodeXPaymentHeader(params.rawHeader);
  if (!parsed) {
    return { ok: false, error: "Malformed X-PAYMENT header (expected JSON or base64 JSON)" };
  }

  const network = parsed.network ?? NETWORK_RHC_MAINNET;
  if (network !== NETWORK_RHC_MAINNET) {
    return { ok: false, error: `Unsupported X-PAYMENT network ${network}; expected eip155:4663` };
  }

  const auth = parsed.payload?.authorization ?? parsed.authorization;
  const txHash = parsed.payload?.txHash ?? parsed.txHash;

  // Path 1: Signed EIP-3009 USDG authorization
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
        error: `X-PAYMENT amount ${amount.toString()} < required ${params.minimumMicroUsdg.toString()} micro-USDG`,
      };
    }

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (auth.validBefore !== undefined && BigInt(auth.validBefore) <= nowSec) {
      return { ok: false, error: "X-PAYMENT EIP-3009 authorization has expired (validBefore)" };
    }
    if (auth.validAfter !== undefined && BigInt(auth.validAfter) > nowSec + 60n) {
      return { ok: false, error: "X-PAYMENT EIP-3009 authorization is not yet valid (validAfter)" };
    }

    const domain = getVerifiedEip712Domain(
      RHC_MAINNET_CHAIN_ID,
      RHC_CANONICAL_ASSETS.USDG.address
    );
    if (!domain) {
      return { ok: false, error: "USDG EIP-712 domain not verified" };
    }

    const sigValid = await verifyEip3009Signature(auth, domain);
    if (!sigValid) {
      return { ok: false, error: "Invalid EIP-3009 signature over USDG domain on RHC 4663" };
    }

    const nonceKey = `eip3009:${RHC_MAINNET_CHAIN_ID}:${auth.from.toLowerCase()}:${(
      auth.nonce ?? ""
    ).toLowerCase()}`;
    const fresh = await params.store.consumePaymentNonce({
      nonceKey,
      tenantId: params.tenantId,
      network,
      asset: RHC_CANONICAL_ASSETS.USDG.address,
      payer: auth.from,
      amountMicro: amount,
    });

    if (!fresh) {
      return { ok: false, error: "X-PAYMENT nonce already consumed (replay blocked)" };
    }

    return { ok: true, creditedMicroUsdg: amount, payer: auth.from };
  }

  // Path 2: On-chain confirmed USDG Transfer transaction hash on RHC 4663
  if (txHash && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    try {
      const receipt = await params.client.getTransactionReceipt({ hash: txHash as Hex });
      if (receipt.status !== "success") {
        return { ok: false, error: "X-PAYMENT transaction reverted on RHC 4663" };
      }

      const usdgLower = RHC_CANONICAL_ASSETS.USDG.address.toLowerCase();
      const expectedTo = params.config.x402PayTo.toLowerCase();
      let matchedAmount = 0n;
      let payer = receipt.from.toLowerCase();

      for (const lg of receipt.logs) {
        if (
          lg.address.toLowerCase() === usdgLower &&
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
          error: `Confirmed USDG transfer to ${expectedTo} was ${matchedAmount.toString()} < ${params.minimumMicroUsdg.toString()}`,
        };
      }

      const fresh = await params.store.consumePaymentNonce({
        nonceKey: `tx:${RHC_MAINNET_CHAIN_ID}:${txHash.toLowerCase()}`,
        tenantId: params.tenantId,
        network,
        asset: RHC_CANONICAL_ASSETS.USDG.address,
        payer,
        amountMicro: matchedAmount,
      });

      if (!fresh) {
        return { ok: false, error: "X-PAYMENT txHash already redeemed (replay blocked)" };
      }

      return { ok: true, creditedMicroUsdg: matchedAmount, payer };
    } catch (err) {
      return {
        ok: false,
        error: `Could not verify X-PAYMENT txHash on RHC 4663: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  return { ok: false, error: "X-PAYMENT must include EIP-3009 authorization or confirmed RHC txHash" };
}
