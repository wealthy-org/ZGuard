import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  RHC_PUBLIC_RPC_TESTNET,
  canonicalQuoteAndTxJson,
  computeQuoteAndTxCommitments,
  type Decision,
  type GuardRequest,
  type ReasonCode,
  type ZkAttestation,
  type ZkSystemId,
} from "@zguard/sdk";
import {
  ZGUARD_VERIFIER_ABI,
  ZGUARD_VERIFIER_BYTECODE,
  ZGUARD_VERIFIER_DEPLOYED_BYTECODE,
} from "./verifier-artifact.js";

export {
  ZGUARD_VERIFIER_ABI,
  ZGUARD_VERIFIER_BYTECODE,
  ZGUARD_VERIFIER_DEPLOYED_BYTECODE,
};

const RULE_CODE_BITS: Partial<Record<ReasonCode, number>> = {
  "Q-001": 1 << 0,
  "Q-002": 1 << 1,
  "Q-003": 1 << 2,
  "Q-004": 1 << 3,
  "Q-005": 1 << 4,
  "Q-006": 1 << 5,
  "Q-007": 1 << 6,
  "Q-DECODE": 1 << 7,
  "P-401": 1 << 8,
  "P-UNAVAIL": 1 << 9,
};

export function encodeRuleBitmask(codes: ReasonCode[]): { numeric: number; hex: `0x${string}` } {
  let mask = 0;
  for (const c of codes) {
    const bit = RULE_CODE_BITS[c];
    if (bit !== undefined) mask |= bit;
  }
  return {
    numeric: mask >>> 0,
    hex: `0x${(mask >>> 0).toString(16).padStart(8, "0")}` as `0x${string}`,
  };
}

/**
 * PLACEHOLDER until `cargo prove build` + `vkey` produce the real SP1 program verification key.
 * Set ZGUARD_ZK_SP1_PROGRAM_VKEY (passed via `programVKeyOverride`) once the guest is built.
 */
export const PLACEHOLDER_PROGRAM_VKEY_NOTE =
  "placeholder vkey = keccak256('zguard:quote-verifier:v1:<system>'); not a real SP1 program vkey";

export function getProgramVKey(system: ZkSystemId, programVKeyOverride?: string | null): `0x${string}` {
  if (programVKeyOverride && /^0x[0-9a-fA-F]{64}$/.test(programVKeyOverride)) {
    return programVKeyOverride.toLowerCase() as `0x${string}`;
  }
  return keccak256(toHex(`zguard:quote-verifier:v1:${system}`));
}

export function isPlaceholderProgramVKey(system: ZkSystemId, vkey: string): boolean {
  return vkey.toLowerCase() === keccak256(toHex(`zguard:quote-verifier:v1:${system}`)).toLowerCase();
}

export function encodeQuotePublicValues(attestation: Pick<ZkAttestation, "publicInputs">): Hex {
  const verdictCode =
    attestation.publicInputs.verdict === "allow"
      ? 1
      : attestation.publicInputs.verdict === "deny"
        ? 2
        : 3;

  return encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint8" },
      { type: "uint32" },
    ],
    [
      keccak256(toHex("quote")),
      attestation.publicInputs.quoteHash as Hex,
      attestation.publicInputs.txHash as Hex,
      verdictCode,
      Number(BigInt(attestation.publicInputs.ruleBitmask)),
    ]
  );
}

/** Builds the SP1 guest input (canonical JSON + private hints) for a quote verdict. */
export function buildSp1GuestInput(
  request: Pick<GuardRequest, "network" | "quote" | "payload">,
  quoteCodes: ReasonCode[]
): { quoteJson: string; txJson: string; hints: Record<string, boolean> } {
  const { quoteJson, txJson } = canonicalQuoteAndTxJson(request);
  return {
    quoteJson,
    txJson,
    hints: {
      asset_mismatch: quoteCodes.includes("Q-003"),
      chain_mismatch: quoteCodes.includes("Q-004"),
      unexpected_approval: quoteCodes.includes("Q-006"),
      domain_verified: !quoteCodes.includes("Q-007"),
    },
  };
}

export interface ZkProverOptions {
  rpcUrl?: string;
  chainId?: number;
  sp1ProverUrl?: string;
  verifierAddress?: string;
  /** Optional funded relayer private key (e.g. Testnet 46630 faucet wallet) to broadcast `verifyTx` on-chain */
  verifierPrivateKey?: string;
  /** Canonical JSON + hints for the SP1 guest (from `canonicalQuoteAndTxJson`). */
  guestInput?: { quoteJson: string; txJson: string; hints?: Record<string, boolean> } | null;
  onUpdated?: (attestation: ZkAttestation) => Promise<void> | void;
  webhookUrl?: string;
}

/**
 * Creates the initial synchronous `pending` ZK attestation attached to a `/v1/guard` or `/v1/verify`
 * response (§8.3: decision is returned immediately; proof settles asynchronously).
 * `scope` is strictly hardcoded to `"quote"`.
 */
export function buildInitialZkAttestation(params: {
  decisionId: string;
  system: ZkSystemId;
  request: Pick<GuardRequest, "network" | "quote" | "payload">;
  quoteVerdict: Decision;
  quoteCodes: ReasonCode[];
  verifierAddress?: string | null;
  programVKeyOverride?: string | null;
}): ZkAttestation {
  const { quoteHash, txHash } = computeQuoteAndTxCommitments(params.request);
  const quoteOnlyCodes = params.quoteCodes.filter(
    (c) => c.startsWith("Q-") || c.startsWith("P-")
  );
  const { hex: ruleBitmask } = encodeRuleBitmask(quoteOnlyCodes);

  return {
    decisionId: params.decisionId,
    system: params.system,
    scope: "quote", // §8.3: NEVER anything other than "quote"
    programVKey: getProgramVKey(params.system, params.programVKeyOverride),
    proof: null,
    publicInputs: {
      quoteHash,
      txHash,
      verdict: params.quoteVerdict,
      ruleCodes: quoteOnlyCodes,
      ruleBitmask,
    },
    verifierAddress: params.verifierAddress || null,
    verifyTx: null,
    bn254PrecompileVerified: false,
    verifierGasUsed: null,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Asynchronous SP1 proof settlement (gap C1/C9 — honest semantics):
 *
 *  - No `sp1ProverUrl`  -> attestation stays `pending` with a note. Nothing is claimed proven.
 *  - Prover returns `{ proof, publicValues }`. publicValues MUST equal the values ZGuard committed to,
 *    otherwise `failed`.
 *  - `verifierAddress` set -> `checkSp1QuoteProof` eth_call (the SP1 gateway performs the BN254
 *    pairing). Success -> `proven`. Revert -> `failed`.
 *  - `verifierPrivateKey` set as well -> broadcast `verifySp1QuoteProof`; a successful receipt is the
 *    ONLY way to reach `verified`. A remote prover's own claim of "verified" is ignored.
 *  - Proof received but no verifier configured -> stays `pending` (proof attached, unverified).
 *
 * The former "Path B" (e(P,G2)·e(-P,G2) == 1, true for every P) was removed: it proved nothing.
 */
export async function proveQuoteAttestationAsync(
  initial: ZkAttestation,
  opts: ZkProverOptions = {}
): Promise<ZkAttestation> {
  const rpcUrl = opts.rpcUrl ?? RHC_PUBLIC_RPC_TESTNET;
  const now = () => new Date().toISOString();
  const finish = async (att: ZkAttestation): Promise<ZkAttestation> => {
    await opts.onUpdated?.(att);
    if (opts.webhookUrl && (att.status === "proven" || att.status === "verified")) {
      fetch(opts.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: `attestation.zk.${att.status}`, attestation: att }),
      }).catch(() => undefined);
    }
    return att;
  };

  if (initial.system !== "groth16-sp1") {
    return finish({
      ...initial,
      scope: "quote",
      status: "pending",
      bn254PrecompileVerified: false,
      note: `${initial.system} is a skeleton (no prover/verifier); nothing is claimed proven`,
      updatedAt: now(),
    });
  }

  if (!opts.sp1ProverUrl) {
    return finish({
      ...initial,
      scope: "quote",
      status: "pending",
      bn254PrecompileVerified: false,
      note: "SP1 prover not configured (ZGUARD_ZK_SP1_PROVER_URL); no proof generated, nothing is claimed proven",
      updatedAt: now(),
    });
  }

  const expectedPublicValues = encodeQuotePublicValues(initial).toLowerCase();
  const fail = (note: string) =>
    finish({ ...initial, scope: "quote", status: "failed", bn254PrecompileVerified: false, note, updatedAt: now() });

  let proof: Hex;
  try {
    const resp = await fetch(opts.sp1ProverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: initial.decisionId,
        system: initial.system,
        programVKey: initial.programVKey,
        publicInputs: initial.publicInputs,
        publicValues: expectedPublicValues,
        // Guest inputs: see packages/zk/sp1-quote-guest/src/main.rs
        guestInput: opts.guestInput ?? null,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return fail(`SP1 prover returned HTTP ${resp.status}`);
    const remote = (await resp.json()) as { proof?: string; publicValues?: string };
    if (!remote.proof || !/^0x([0-9a-fA-F]{2})+$/.test(remote.proof)) return fail("SP1 prover returned no proof bytes");
    if (!remote.publicValues || remote.publicValues.toLowerCase() !== expectedPublicValues) {
      return fail("SP1 prover publicValues do not match the committed quote verdict");
    }
    proof = remote.proof as Hex;
  } catch (err) {
    return fail(`SP1 prover unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const verifier =
    opts.verifierAddress && /^0x[0-9a-fA-F]{40}$/.test(opts.verifierAddress) ? (opts.verifierAddress as Hex) : null;
  if (!verifier) {
    return finish({
      ...initial,
      scope: "quote",
      proof,
      status: "pending",
      bn254PrecompileVerified: false,
      note: "Proof received but not verified: ZGUARD_ZK_VERIFIER_ADDRESS is not configured",
      updatedAt: now(),
    });
  }

  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 12_000 }) });
  try {
    await client.readContract({
      address: verifier,
      abi: ZGUARD_VERIFIER_ABI,
      functionName: "checkSp1QuoteProof",
      args: [expectedPublicValues as Hex, proof],
    });
  } catch (err) {
    return fail(`Verifier rejected proof: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }

  let verifyTx: string | null = null;
  let verifierGasUsed: string | null = null;
  let note = "Proof accepted by ZGuardQuoteVerifier.checkSp1QuoteProof (eth_call); not recorded onchain";
  if (opts.verifierPrivateKey && /^0x[0-9a-fA-F]{64}$/.test(opts.verifierPrivateKey)) {
    try {
      const detectedChainId = opts.chainId ?? (await client.getChainId());
      const chainObj: Chain = defineChain({
        id: detectedChainId,
        name: detectedChainId === 4663 ? "Robinhood Chain" : "Robinhood Chain Testnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });
      const account = privateKeyToAccount(opts.verifierPrivateKey as Hex);
      const wallet = createWalletClient({ account, chain: chainObj, transport: http(rpcUrl, { timeout: 15_000 }) });
      const txHash = await wallet.sendTransaction({
        to: verifier,
        data: encodeFunctionData({
          abi: ZGUARD_VERIFIER_ABI,
          functionName: "verifySp1QuoteProof",
          args: [keccak256(toHex(initial.decisionId)), expectedPublicValues as Hex, proof],
        }),
      });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 25_000 });
      if (receipt.status === "success") {
        verifyTx = txHash;
        verifierGasUsed = receipt.gasUsed.toString();
        note = "Proof verified and recorded onchain by verifySp1QuoteProof";
      } else {
        note = "verifySp1QuoteProof transaction reverted; attestation remains proven (eth_call) only";
      }
    } catch (err) {
      note = `verifySp1QuoteProof broadcast failed (${err instanceof Error ? err.message.split("\n")[0] : String(err)}); proven via eth_call only`;
    }
  }

  return finish({
    ...initial,
    scope: "quote",
    proof,
    verifierAddress: verifier,
    verifyTx,
    verifierGasUsed,
    bn254PrecompileVerified: true,
    status: verifyTx ? "verified" : "proven",
    note,
    updatedAt: now(),
  });
}

export { buildSp1QuoteFixtures, SP1_FIXTURE_REQUESTS, type Sp1QuoteFixture } from "./sp1-fixtures.js";
