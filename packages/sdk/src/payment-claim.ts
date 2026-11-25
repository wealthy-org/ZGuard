/**
 * x402 deposit-claim helpers (gap X402-4).
 *
 * A `txHash` alone proves that *someone* paid the treasury, not *who* is claiming the credit.
 * Anyone watching the chain could copy a public txHash and claim it first. To bind a claim to the
 * payer, the client signs a short EIP-191 message with the SAME wallet that sent the USDG transfer:
 *
 *   ZGuard credit claim
 *   tx:<txHash lowercase>
 *   chain:<chainId>
 *
 * The server only credits `Transfer(from = recovered signer, to = payTo)` logs inside that tx.
 */

/** Builds the exact EIP-191 message a payer signs to claim credit for a deposit transaction. */
export function depositClaimMessage(txHash: string, chainId: number | string): string {
  return `ZGuard credit claim\ntx:${txHash.trim().toLowerCase()}\nchain:${String(chainId).trim()}`;
}

/** X-PAYMENT body for a deposit claim (send as JSON or base64 JSON in the `X-PAYMENT` header). */
export interface DepositClaimPayment {
  network: string;
  payload: {
    txHash: string;
    /** EIP-191 (personal_sign) signature over `depositClaimMessage(txHash, chainId)` (EVM rails). */
    claimSignature: string;
    /** Solana rail only: base58 public key of the payer that signed the claim (ed25519). */
    claimer?: string;
  };
}

/** Convenience builder for the `X-PAYMENT` header value of a deposit claim. */
export function buildDepositClaimHeader(params: {
  network: string;
  txHash: string;
  claimSignature: string;
  claimer?: string;
}): string {
  const body: DepositClaimPayment = {
    network: params.network,
    payload: {
      txHash: params.txHash,
      claimSignature: params.claimSignature,
      ...(params.claimer ? { claimer: params.claimer } : {}),
    },
  };
  return JSON.stringify(body);
}
