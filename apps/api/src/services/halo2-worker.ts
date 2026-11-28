/**
 * Halo2-KZG attestation worker bridge (gap H5/H7): the API queues a prover job, GitHub Actions proves it
 * (`.github/workflows/halo2-prover.yml`) and posts the proof back; the API only trusts the onchain verifier.
 *
 *   pending  ── job queued (+ repository_dispatch)       nothing claimed
 *   proven   ── eth_call ZGuardHalo2QuoteVerifier.verifyQuote returned exactly our public values
 *   verified ── a successful verifyAndRecord receipt emitted our decisionId (API relayer key or worker tx)
 *   failed   ── worker could not prove it, or the verifier rejected the proof / returned other values
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Decision, GuardRequest, ReasonCode, ZkAttestation } from "@zguard/sdk";
import {
  ZGUARD_HALO2_VERIFIER_ABI,
  buildHalo2Job,
  checkHalo2Deployment,
  checkHalo2RecordTx,
  dispatchHalo2Prover,
  halo2DecisionKey,
  verifyHalo2Proof,
  type Halo2ChainClient,
  type Halo2Job,
} from "@zguard/zk";
import type { ZGuardAppConfig } from "../config.js";
import type { StorageStore } from "../db/store.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const PROOF_RE = /^0x([0-9a-fA-F]{2}){32,8192}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

/** Sends `verifyAndRecord`; returns the tx hash once mined (injectable for tests). */
export type Halo2RecordSender = (args: { to: Address; data: Hex }) => Promise<Hex>;

export interface Halo2Runtime {
  client: Halo2ChainClient;
  send: Halo2RecordSender | null;
}

export function halo2WorkerReady(config: ZGuardAppConfig): boolean {
  return Boolean(config.zkHalo2Enabled && config.zkHalo2VerifierAddress && ADDRESS_RE.test(config.zkHalo2VerifierAddress));
}

export function createHalo2Runtime(config: ZGuardAppConfig, rpcUrl: string, chainId: number): Halo2Runtime {
  const chain = defineChain({
    id: chainId,
    name: chainId === 4663 ? "Robinhood Chain" : "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000 }) });
  const pk = config.zkVerifierPrivateKey;
  let send: Halo2RecordSender | null = null;
  if (pk && /^0x[0-9a-fA-F]{64}$/.test(pk)) {
    const wallet = createWalletClient({ account: privateKeyToAccount(pk as Hex), chain, transport: http(rpcUrl, { timeout: 15_000 }) });
    send = async ({ to, data }) => {
      const hash = await wallet.sendTransaction({ to, data });
      await client.waitForTransactionReceipt({ hash, timeout: 25_000 });
      return hash;
    };
  }
  return { client: client as unknown as Halo2ChainClient, send };
}

/**
 * Decides, before the response is sent, what a halo2-kzg attestation will be: a queued prover job or an
 * explicit "not covered / not enabled" note. Never changes the status away from `pending`.
 */
export function planHalo2Attestation(
  config: ZGuardAppConfig,
  att: ZkAttestation,
  request: Pick<GuardRequest, "network" | "quote" | "payload">,
  quoteCodes: ReasonCode[],
  quoteVerdict: Decision
): { att: ZkAttestation; job: Halo2Job | null } {
  if (!halo2WorkerReady(config)) {
    return {
      att: {
        ...att,
        note: config.zkHalo2Enabled
          ? "Halo2 worker enabled but ZGUARD_ZK_HALO2_VERIFIER_ADDRESS is not set; no proof will be produced"
          : "ZGUARD_ZK_HALO2_ENABLED is not true; no Halo2 proof will be produced, nothing is claimed proven",
      },
      job: null,
    };
  }
  const built = buildHalo2Job(request, quoteCodes, quoteVerdict);
  if ("unsupported" in built) {
    return {
      att: { ...att, note: `Outside the Halo2 circuit (${built.unsupported}); stays pending, use the SP1 path for this verdict` },
      job: null,
    };
  }
  return {
    att: { ...att, verifierAddress: config.zkHalo2VerifierAddress, note: "Halo2 proof queued for the GitHub Actions prover" },
    job: built.job,
  };
}

/** Persists the job and triggers the prover. Awaited by the route (short timeout) so serverless keeps it alive. */
export async function queueHalo2Job(
  config: ZGuardAppConfig,
  store: StorageStore,
  att: ZkAttestation,
  job: Halo2Job,
  fetchImpl?: typeof fetch
): Promise<ZkAttestation> {
  await store.setZkProverJob(att.decisionId, job as unknown as Record<string, unknown>);
  if (!config.zkGhDispatchToken || !config.zkGhRepo) {
    const upd = { ...att, note: "Halo2 job queued; no dispatch token, the scheduled/manual worker will pick it up", updatedAt: new Date().toISOString() };
    await store.upsertZkAttestation(upd);
    return upd;
  }
  const d = await dispatchHalo2Prover({ repo: config.zkGhRepo, token: config.zkGhDispatchToken, decisionId: att.decisionId, fetchImpl });
  const upd = {
    ...att,
    note: d.ok ? "Halo2 job queued and the GitHub Actions prover was dispatched" : `Halo2 job queued; ${d.note} (the scheduled worker retries)`,
    updatedAt: new Date().toISOString(),
  };
  await store.upsertZkAttestation(upd);
  return upd;
}

export interface Halo2ResultInput {
  decisionId: string;
  proof?: string;
  error?: string;
  /** Optional: a verifyAndRecord tx the worker (or anyone) already sent for this decision. */
  recordTx?: string;
}

export interface Halo2ResultOutcome {
  decisionId: string;
  status: ZkAttestation["status"] | "ignored" | "deferred";
  note: string;
}

function asJob(raw: Record<string, unknown> | null): Halo2Job | null {
  if (!raw) return null;
  const j = raw as unknown as Halo2Job;
  if (typeof j.quoteJson !== "string" || typeof j.txJson !== "string") return null;
  if (![1, 2, 3].includes(j.verdict) || typeof j.mask !== "number") return null;
  return j;
}

/** Successful deployment checks per runtime (10 min); failures are re-checked on every callback. */
const deploymentChecks = new WeakMap<Halo2Runtime, { key: string; at: number }>();

export async function processHalo2Result(
  config: ZGuardAppConfig,
  store: StorageStore,
  runtime: Halo2Runtime,
  input: Halo2ResultInput
): Promise<Halo2ResultOutcome> {
  const decisionId = String(input.decisionId ?? "");
  const att = decisionId ? await store.getZkAttestation(decisionId) : null;
  if (!att || att.system !== "halo2-kzg") return { decisionId, status: "ignored", note: "no halo2-kzg attestation" };
  const job = asJob(await store.getZkProverJob(decisionId));
  if (att.status !== "pending" || !job) return { decisionId, status: "ignored", note: `already ${att.status}` };
  const wrapper = config.zkHalo2VerifierAddress as Address | null;
  if (!wrapper || !ADDRESS_RE.test(wrapper)) return { decisionId, status: "deferred", note: "verifier address not configured" };

  const now = () => new Date().toISOString();
  const finish = async (upd: ZkAttestation, keepJob = false): Promise<Halo2ResultOutcome> => {
    await store.upsertZkAttestation(upd);
    if (!keepJob) await store.setZkProverJob(decisionId, null);
    return { decisionId, status: upd.status, note: upd.note ?? "" };
  };

  if (input.error || !input.proof) {
    return finish({
      ...att,
      status: "failed",
      bn254PrecompileVerified: false,
      note: `Halo2 worker could not prove it: ${String(input.error ?? "no proof").slice(0, 300)}`,
      updatedAt: now(),
    });
  }
  if (!PROOF_RE.test(input.proof)) {
    return finish({ ...att, status: "failed", bn254PrecompileVerified: false, note: "Halo2 worker returned malformed proof bytes", updatedAt: now() });
  }

  // The wrapper must point at the exact verifier generated from this circuit (VK baked into the code).
  const cacheKey = wrapper.toLowerCase();
  const cached = deploymentChecks.get(runtime);
  if (!cached || cached.key !== cacheKey || Date.now() - cached.at > 600_000) {
    const dep = await checkHalo2Deployment(runtime.client, wrapper);
    if (!dep.ok) return { decisionId, status: "deferred", note: `verifier deployment check failed: ${dep.note}` };
    deploymentChecks.set(runtime, { key: cacheKey, at: Date.now() });
  }

  const proof = input.proof as Hex;
  const v = await verifyHalo2Proof(runtime.client, wrapper, job, proof);
  if (!v.ok) {
    if (/HTTP request failed|timed? ?out|fetch failed|ECONN/i.test(v.note)) {
      return { decisionId, status: "deferred", note: `RPC unavailable, retry later: ${v.note}` };
    }
    return finish({ ...att, status: "failed", bn254PrecompileVerified: false, note: `Halo2 ${v.note}`, updatedAt: now() });
  }

  const proven: ZkAttestation = {
    ...att,
    proof,
    verifierAddress: wrapper,
    status: "proven",
    bn254PrecompileVerified: true,
    note: "Proof accepted by ZGuardHalo2QuoteVerifier.verifyQuote (eth_call, BN254 precompiles); not recorded onchain",
    updatedAt: now(),
  };

  let recordTx: Hex | null = input.recordTx && TX_RE.test(input.recordTx) ? (input.recordTx as Hex) : null;
  let recordNote = "";
  if (!recordTx && runtime.send) {
    try {
      recordTx = await runtime.send({
        to: wrapper,
        data: encodeFunctionData({
          abi: ZGUARD_HALO2_VERIFIER_ABI,
          functionName: "verifyAndRecord",
          args: [halo2DecisionKey(decisionId), toHex(job.quoteJson), toHex(job.txJson), job.verdict, job.mask, proof],
        }),
      });
    } catch (e) {
      recordNote = `; record tx not sent (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`;
    }
  }
  if (recordTx) {
    const r = await checkHalo2RecordTx(runtime.client, wrapper, decisionId, recordTx, job);
    if (r.ok) {
      return finish({
        ...proven,
        status: "verified",
        verifyTx: recordTx,
        verifierGasUsed: r.gasUsed,
        note: `Proof verified and recorded onchain by ZGuardHalo2QuoteVerifier.verifyAndRecord (gas ${r.gasUsed})`,
      });
    }
    recordNote = `; record tx ${recordTx} not accepted (${r.note})`;
  }
  return finish({ ...proven, note: proven.note + recordNote });
}

/** Worker view of a job (no tenant data beyond what the circuit needs). */
export function workerJobView(decisionId: string, raw: Record<string, unknown>) {
  const j = asJob(raw);
  if (!j) return null;
  return { decisionId, quoteJson: j.quoteJson, txJson: j.txJson, hints: j.hints, verdict: j.verdict, mask: j.mask };
}
