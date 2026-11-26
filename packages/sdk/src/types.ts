export type Decision = "allow" | "deny" | "abstain";

export type CheckName = "quote" | "simulation" | "token_risk" | "content";

export type CheckMode = "required" | "advisory";

export type ContentVerdict = "clean_by_rules" | "findings" | "unchecked" | "blocked";

export type TokenKind =
  | "stock_token"
  | "usdg"
  | "pons_curve"
  | "pons_graduated_v4"
  | "other";

/**
 * Canonical reason codes (§5.3 Dev Brief — deliberately never uses X402- prefix).
 */
export type ReasonCode =
  | "Q-001" // payTo mismatch
  | "Q-002" // amount mismatch
  | "Q-003" // asset/token mismatch
  | "Q-004" // chain mismatch
  | "Q-005" // missing quote/intent on x402 or guarded path
  | "Q-006" // approval/permit/delegate outside one-shot transfer or intent
  | "Q-007" // EIP-712 domain unverified -> abstain
  | "Q-DECODE" // payload bytes could not be decoded -> abstain
  | "S-REVERT" // transaction simulation reverted
  | "S-DIFF" // simulated balance changes do not match quote/intent
  | "S-APPROVE" // allowance/operator surfaced outside intent
  | "S-FAIL" // simulation infrastructure/RPC failure -> abstain
  | "S-SEQUENCER" // L2 sequencer downtime / staleness -> abstain
  | "T-MINT" // mint authority live on non-allowlisted token
  | "T-TAX" // tax / snipe tax above configured threshold
  | "T-LP" // liquidity unlocked or undetected
  | "T-HOLDER" // holder concentration above configured threshold
  | "T-PONS" // pons curve state inconsistent / swept / near graduation
  | "T-UNKNOWN" // token kind / address unresolved -> abstain or flag
  | "C-FINDING" // content rules matched prompt-injection / invisible char / ticker lookalike
  | "C-SSRF" // SSRF-protected URL scan blocked internal/loopback/metadata host
  | "P-401" // outside spendPolicy (cap, payee allowlist, asset allowlist, lifetime spend)
  | "P-UNAVAIL"; // policy or storage store unavailable -> abstain

export interface QuoteInput {
  asset: string;
  payTo: string;
  amount: string;
  chainId?: number;
  network?: string;
  memo?: string;
  description?: string;
  extra?: Record<string, unknown>;
}

export interface Eip3009Authorization {
  kind?: "TransferWithAuthorization" | "ReceiveWithAuthorization";
  from: string;
  to: string;
  value: string;
  validAfter?: string | number;
  validBefore?: string | number;
  nonce?: string;
  domain?: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
  };
  signature?: string;
}

export interface RouterIntent {
  chainId: number;
  to: string;
  function: string;
  abi?: readonly unknown[];
  args?: unknown[];
  value?: string;
  from?: string;
  /** Expected output or minimum output from router code (never from model) */
  expectedOut?: {
    token: string;
    recipient: string;
    minAmountOut: string;
    slippageBps?: number;
  };
  /** Explicit approvals allowed by this intent, if any */
  allowApprovals?: Array<{
    token: string;
    spender: string;
    maxAmount: string;
  }>;
}

export interface EvmCallObject {
  from?: string;
  to: string;
  data?: string;
  value?: string;
  chainId?: number;
  gas?: string;
}

export interface SolanaSplTransfer {
  recipient: string;
  mint: string;
  amount: string;
  instruction?: string;
  instructions?: string[];
  /** Ignored for the decision: the flag is recomputed from `transaction` (caller booleans are untrusted). */
  hasApproveOrSetAuthority?: boolean;
  /** Base64 serialized Solana transaction (legacy or v0). Required for an `allow`. */
  transaction?: string;
}

export interface GuardPayload {
  type: "eip3009" | "evm_tx" | "intent" | "solana_spl";
  authorization?: Eip3009Authorization;
  /** Raw signed RLP hex tx OR call hex / EvmCallObject */
  tx?: string | EvmCallObject;
  intent?: RouterIntent;
  solanaTransfer?: SolanaSplTransfer;
}

export interface SpendPolicy {
  maxPerPayment?: Record<string, string>;
  allowedAssets?: string[];
  allowedPayees?: string[];
  maxLifetimeSpend?: Record<string, string>;
}

export interface ContentInput {
  text?: string;
  url?: string;
  symbol?: string;
  name?: string;
  tokenAddress?: string;
}

export interface GuardOptions {
  spendPolicy?: SpendPolicy;
  checkModes?: Partial<Record<CheckName, CheckMode>>;
  ttlSeconds?: number;
  enableZk?: boolean;
  zkSystem?: ZkSystemId;
  recipientForSnipeTax?: string;
}

export interface GuardRequest {
  network: string;
  quote?: QuoteInput;
  payload?: GuardPayload;
  token?: string;
  content?: ContentInput;
  checks?: Array<"quote" | "simulation" | "token_risk" | "content">;
  options?: GuardOptions;
}

export interface NormalizedTransferExpectation {
  payTo: string;
  asset: string;
  amount: string;
  chainId: number;
}

export interface QuoteCheckResult {
  decision: Decision;
  codes: ReasonCode[];
  expected: NormalizedTransferExpectation | null;
  actual: Partial<NormalizedTransferExpectation> | null;
  notes?: string[];
}

export interface BalanceChange {
  address: string;
  token: string;
  symbol?: string;
  before: string;
  after: string;
  delta: string;
}

export interface SurfacedApproval {
  owner: string;
  spender: string;
  token: string;
  /** Raw amount, "ALL" for operator approvals, or "tokenId:<id>" for an ERC-721 single-token approval. */
  amount: string;
  unlimited: boolean;
  /** Set when the allowance lives in an intermediary contract, e.g. "permit2:<address>". */
  via?: string;
}

export interface NamedCall {
  to: string;
  label?: string;
  category?: string;
  selector?: string;
  value?: string;
}

export interface SimulationCheckResult {
  decision: Decision;
  codes: ReasonCode[];
  method?: string;
  status: "success" | "revert" | "unknown";
  gasUsed: string | null;
  balanceChanges: BalanceChange[];
  approvals: SurfacedApproval[];
  calls: NamedCall[];
  notes: string[];
}

export interface TokenRiskCheckResult {
  decision: Decision;
  codes: ReasonCode[];
  token: string | null;
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  kind: TokenKind;
  holders: {
    count: number | null;
    top10Bps: number | null;
    source?: string;
  };
  liquidity: {
    venue: "pons_curve" | "uniswap_v4" | "pons_v1_v3" | "canonical" | "unknown";
    locked: boolean | null;
    detail: Record<string, unknown>;
  };
  tax: {
    buyBps: number | null;
    sellBps: number | null;
    snipeTaxBps: number | null;
    creatorTaxBps?: number | null;
    feeBps?: number | null;
  };
  authorities: {
    owner: string | null;
    mintable: boolean | null;
    pausable: boolean | null;
  };
  pons: {
    factory: string | null;
    stack?: "v2" | "v1" | null;
    curve?: string | null;
    pairToken?: string | null;
    phase?: number | null;
    graduated: boolean | null;
    readyToGraduate?: boolean | null;
    sellableTokens: string | null;
    reserves: {
      quoteReserve: string;
      tokenReserve: string;
      realQuoteReserve?: string;
      graduationThreshold?: string;
    } | null;
  };
  oracle?: {
    feedProxy: string | null;
    priceUsd: string | null;
    updatedAt: number | null;
    stale: boolean | null;
    oraclePaused?: boolean | null;
    uiMultiplier?: string | null;
  };
  sequencer?: {
    up: boolean;
    gracePeriodPassed: boolean;
    latestBlockAgeSeconds: number | null;
    source: string;
  };
  metadataScan?: ContentCheckResult;
}

export interface ContentFinding {
  rule: string;
  severity: "high" | "medium";
  detail: string;
}

export interface ContentCheckResult {
  decision: Decision;
  verdict: ContentVerdict;
  codes: ReasonCode[];
  findings?: ContentFinding[];
  urlFetch?: {
    url: string;
    fetched: boolean;
    httpStatus?: number | null;
    blockedReason?: string | null;
    bytesRead?: number;
    waivedCharge?: boolean;
  };
}

export type ZkSystemId = "groth16-sp1" | "groth16-risc0" | "halo2-kzg";

export interface ZkPublicInputs {
  quoteHash: string;
  txHash: string;
  verdict: Decision;
  ruleCodes: ReasonCode[];
  ruleBitmask: string;
}

export interface ZkAttestation {
  decisionId: string;
  system: ZkSystemId;
  /** §8.3: scope MUST ALWAYS be "quote" */
  scope: "quote";
  programVKey: string;
  proof: string | null;
  publicInputs: ZkPublicInputs;
  verifierAddress: string | null;
  verifyTx: string | null;
  bn254PrecompileVerified?: boolean;
  verifierGasUsed?: string | null;
  status: "pending" | "proven" | "verified" | "failed";
  /** Human-readable reason for the current status (e.g. prover not configured). */
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChargedInfo {
  asset: "USDG" | "USDC";
  amount: string;
  unit: "micro";
  rail?: string;
  settlementTxHash?: string | null;
}

export interface GuardResponse {
  decisionId?: string;
  decision: Decision;
  reason: string;
  codes: ReasonCode[];
  payload_hash: string;
  expires_at: string | null;
  network: string;
  checks: {
    quote?: QuoteCheckResult;
    simulation?: SimulationCheckResult;
    token_risk?: TokenRiskCheckResult;
    content?: ContentCheckResult;
  };
  flags: string[];
  charged: ChargedInfo | null;
  attestation?: {
    zk?: ZkAttestation;
  };
  receiptMeta?: {
    abstainOverride?: boolean;
    latencyMs?: number;
  };
}

export interface X402PaymentRequirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: {
    name: string;
    version: string;
    decimals: number;
    unit: "micro";
  };
}

export interface X402SettlementInfo {
  /** Effective settlement mode on the server ("onchain" | "deposit" | "offchain" dev-only | "unavailable"). */
  mode: "onchain" | "deposit" | "offchain" | "unavailable";
  /** Blocks a payment tx must have before it is credited. */
  minConfirmations: number;
  /** Human-readable instructions for paying this quote. */
  instructions: string;
  /** Deposit mode: template of the EIP-191 message to sign (see `depositClaimMessage`). */
  claimMessageTemplate?: string;
}

export interface X402QuoteResponse {
  x402Version: 1;
  error: string;
  accepts: X402PaymentRequirement[];
  settlement?: X402SettlementInfo;
}
