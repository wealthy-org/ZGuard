/**
 * Gap H5/H7: Halo2-KZG attestation pipeline in the API.
 *
 *  - offline (always): coverage mirror vs the circuit fixtures, queue + repository_dispatch, worker auth,
 *    proof callback → proven / verified / failed / deferred with a mocked verifier chain.
 *  - real EVM (opt-in, CI halo2.yml): ZGUARD_TEST_ANVIL_RPC=http://127.0.0.1:8545 deploys the generated
 *    verifier on anvil and runs the committed proofs; with ZGUARD_TEST_HALO2_BIN=<zguard-halo2> it proves the
 *    API's own queued jobs with the real prover CLI and settles them onchain.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeEventTopics,
  fromHex,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { GuardResponse, ZkAttestation } from "@zguard/sdk";
import {
  HALO2_VERIFIER_BYTECODE,
  HALO2_VERIFIER_CODEHASH,
  HALO2_VERIFIER_DEPLOYED_BYTECODE,
  HALO2_DISPATCH_EVENT,
  SP1_FIXTURE_REQUESTS,
  ZGUARD_HALO2_VERIFIER_ABI,
  ZGUARD_HALO2_VERIFIER_BYTECODE,
  buildHalo2Job,
  checkHalo2Deployment,
  halo2Coverage,
  halo2DecisionKey,
  halo2PublicValues,
  verifyHalo2Proof,
  type Halo2ChainClient,
} from "@zguard/zk";
import { evaluateQuoteMatch } from "@zguard/sdk";
import { createZGuardApp } from "../src/app.js";
import { LocalJsonStore } from "../src/db/store.js";
import { createHalo2Runtime, type Halo2Runtime } from "../src/services/halo2-worker.js";
import { offlineConfig, registerTenant } from "./helpers.js";

const FIXTURES = fileURLToPath(new URL("../../../packages/zk/fixtures/", import.meta.url));
const proofFixtures = JSON.parse(readFileSync(join(FIXTURES, "halo2-quote-proofs.json"), "utf8")).fixtures as Array<{
  name: string;
  covered: boolean;
  quoteJson?: string;
  txJson?: string;
  verdict: 1 | 2 | 3;
  mask: number;
  proof?: Hex;
  expectedPublicValues?: string;
}>;
const sp1Fixtures = JSON.parse(readFileSync(join(FIXTURES, "sp1-quote-fixtures.json"), "utf8")) as Array<{
  name: string;
  quoteJson: string;
  txJson: string;
}>;

const WRAPPER = "0x00000000000000000000000000000000000a11ce" as Address;
const INNER = "0x0000000000000000000000000000000000000b0b" as Address;
const SECRET = "worker-secret-0123456789";
const GOOD_PROOF = `0x${"ab".repeat(64)}` as Hex;

function mockRuntime(opts: { codehashOk?: boolean; withSender?: boolean; rpcDown?: boolean } = {}) {
  const sent: Hex[] = [];
  const recorded = new Map<Hex, { args: readonly unknown[] }>();
  const client: Halo2ChainClient = {
    async readContract({ functionName, args }) {
      if (opts.rpcDown) throw new Error("HTTP request failed. URL: http://127.0.0.1:9");
      if (functionName === "halo2Verifier") return INNER;
      if (functionName === "verifyQuote") {
        const [q, t, verdict, mask, proof] = args as [Hex, Hex, number, number, Hex];
        if (proof !== GOOD_PROOF) throw new Error('The contract function "verifyQuote" reverted. Error: InvalidProof()');
        return halo2PublicValues({ quoteJson: fromHex(q, "string"), txJson: fromHex(t, "string"), verdict: verdict as 1 | 2 | 3, mask });
      }
      throw new Error(`unexpected ${functionName}`);
    },
    async getBytecode() {
      return opts.codehashOk === false ? ("0x6000" as Hex) : (HALO2_VERIFIER_DEPLOYED_BYTECODE as Hex);
    },
    async getTransactionReceipt({ hash }) {
      const r = recorded.get(hash);
      if (!r) throw new Error("receipt not found");
      const [decisionKey, q, t, verdict, mask] = r.args as [Hex, Hex, Hex, number, number];
      const topics = encodeEventTopics({
        abi: ZGUARD_HALO2_VERIFIER_ABI,
        eventName: "QuoteVerdictVerified",
        args: { decisionId: decisionKey, quoteHash: keccak256(q), txHash: keccak256(t) },
      }) as Hex[];
      const data = encodeAbiParameters([{ type: "uint8" }, { type: "uint32" }, { type: "string" }], [verdict, mask, "halo2-kzg-shplonk"]);
      return { status: "success", gasUsed: 512_345n, logs: [{ address: WRAPPER, topics, data }] };
    },
  };
  const runtime: Halo2Runtime = {
    client,
    send: opts.withSender
      ? async ({ data }) => {
          const { decodeFunctionData } = await import("viem");
          const dec = decodeFunctionData({ abi: ZGUARD_HALO2_VERIFIER_ABI, data });
          const hash = keccak256(data);
          recorded.set(hash, { args: dec.args as readonly unknown[] });
          sent.push(hash);
          return hash;
        }
      : null,
  };
  return { runtime, sent };
}

function halo2Api(env: Record<string, string> = {}, runtime?: Halo2Runtime) {
  const dispatches: Array<{ url: string; body: { event_type: string; client_payload: { decisionId: string } }; auth: string }> = [];
  const dispatchFetch = (async (url: string, init: RequestInit) => {
    dispatches.push({
      url,
      body: JSON.parse(String(init.body)),
      auth: String((init.headers as Record<string, string>).Authorization),
    });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const config = offlineConfig({
    ZGUARD_ZK_ENABLED: "true",
    ZGUARD_ZK_SYSTEM: "halo2-kzg",
    ZGUARD_ZK_HALO2_ENABLED: "true",
    ZGUARD_ZK_HALO2_VERIFIER_ADDRESS: WRAPPER,
    ZGUARD_ZK_WORKER_SECRET: SECRET,
    ZGUARD_ZK_GH_DISPATCH_TOKEN: "ghp_test_token",
    ...env,
  });
  const store = new LocalJsonStore("zg_", join(mkdtempSync(join(tmpdir(), "zguard-halo2-")), "store.json"));
  const created = createZGuardApp({ config, store, halo2Runtime: runtime ?? mockRuntime().runtime, dispatchFetch });
  return { ...created, dispatches };
}

async function verifyFixture(app: ReturnType<typeof halo2Api>["app"], apiKey: string, name: string) {
  const fx = SP1_FIXTURE_REQUESTS.find((f) => f.name === name)!;
  const res = await app.request("/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(fx.request),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as GuardResponse;
}

const worker = (extra: Record<string, string> = {}) => ({ "x-zguard-worker-key": SECRET, "Content-Type": "application/json", ...extra });

async function postResults(app: ReturnType<typeof halo2Api>["app"], results: unknown[]) {
  const res = await app.request("/v1/zk/halo2/results", { method: "POST", headers: worker(), body: JSON.stringify({ results }) });
  return { status: res.status, json: (await res.json()) as { outcomes: Array<{ decisionId: string; status: string; note: string }> } };
}

async function attestation(app: ReturnType<typeof halo2Api>["app"], id: string) {
  return (await (await app.request(`/v1/attestation/${id}`)).json()) as ZkAttestation & { proverJob?: unknown };
}

describe("[H7] Halo2 coverage mirror == circuit coverage", () => {
  it("covered fixtures match the prover's coverage and public values; Q-005 / Q-DECODE are not covered", () => {
    for (const p of proofFixtures) {
      const s = sp1Fixtures.find((f) => f.name === p.name)!;
      assert.equal(halo2Coverage(s.quoteJson, s.txJson).covered, p.covered, p.name);
      if (p.covered) {
        assert.equal(halo2PublicValues({ quoteJson: s.quoteJson, txJson: s.txJson, verdict: p.verdict, mask: p.mask }), p.expectedPublicValues);
      }
    }
  });

  it("buildHalo2Job reproduces the circuit verdict/mask for every fixture request and refuses the rest", () => {
    for (const { name, request } of SP1_FIXTURE_REQUESTS) {
      const q = evaluateQuoteMatch(request);
      const built = buildHalo2Job(request, q.codes, q.decision);
      const p = proofFixtures.find((f) => f.name === name)!;
      if (p.covered) {
        assert.ok("job" in built, `${name}: ${"unsupported" in built ? built.unsupported : ""}`);
        assert.equal(built.job.verdict, p.verdict, name);
        assert.equal(built.job.mask, p.mask, name);
      } else {
        assert.ok("unsupported" in built, name);
      }
    }
    // A verdict the circuit would not produce is never queued (e.g. a policy override).
    const allow = SP1_FIXTURE_REQUESTS[0]!.request;
    assert.ok("unsupported" in buildHalo2Job(allow, [], "deny"));
    assert.ok("unsupported" in buildHalo2Job(allow, ["P-UNAVAIL" as never], "abstain"));
  });
});

describe("[H5] API Halo2 attestation: queue → GitHub Actions → callback → onchain verifier", () => {
  it("queues the job, dispatches repository_dispatch, and never exposes the job on the public lookup", async () => {
    const { app, dispatches } = halo2Api();
    const { apiKey } = await registerTenant(app);
    const r = await verifyFixture(app, apiKey, "allow");
    const att = r.attestation!.zk!;
    assert.equal(att.system, "halo2-kzg");
    assert.equal(att.status, "pending");
    assert.equal(att.programVKey, HALO2_VERIFIER_CODEHASH);
    assert.equal(att.verifierAddress, WRAPPER);
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0]!.url, "https://api.github.com/repos/wealthy-org/ZGuard/dispatches");
    assert.equal(dispatches[0]!.body.event_type, HALO2_DISPATCH_EVENT);
    assert.equal(dispatches[0]!.body.client_payload.decisionId, r.decisionId);
    assert.equal(dispatches[0]!.auth, "Bearer ghp_test_token");
    const pub = await attestation(app, r.decisionId);
    assert.match(pub.note ?? "", /dispatched/);
    assert.equal(pub.proverJob, undefined);
    assert.ok(!JSON.stringify(pub).includes("quoteJson"));
  });

  it("worker endpoints require the shared secret and return the canonical job", async () => {
    const { app } = halo2Api();
    const { apiKey } = await registerTenant(app);
    const r = await verifyFixture(app, apiKey, "deny-q001-recipient");
    assert.equal((await app.request("/v1/zk/halo2/jobs")).status, 401);
    assert.equal((await app.request("/v1/zk/halo2/jobs", { headers: { "x-zguard-worker-key": "wrong-secret-000000" } })).status, 401);
    assert.equal(
      (await app.request("/v1/zk/halo2/results", { method: "POST", body: JSON.stringify({ results: [] }) })).status,
      401
    );
    const jobs = (await (await app.request("/v1/zk/halo2/jobs", { headers: worker() })).json()) as {
      verifierAddress: string;
      jobs: Array<{ decisionId: string; quoteJson: string; txJson: string; verdict: number; mask: number }>;
    };
    assert.equal(jobs.verifierAddress, WRAPPER);
    assert.equal(jobs.jobs.length, 1);
    const sp1 = sp1Fixtures.find((f) => f.name === "deny-q001-recipient")!;
    assert.deepEqual(
      { id: jobs.jobs[0]!.decisionId, q: jobs.jobs[0]!.quoteJson, t: jobs.jobs[0]!.txJson, v: jobs.jobs[0]!.verdict, m: jobs.jobs[0]!.mask },
      { id: r.decisionId, q: sp1.quoteJson, t: sp1.txJson, v: 2, m: 1 }
    );
  });

  it("worker endpoints are 404 when no secret is configured", async () => {
    const { app } = halo2Api({ ZGUARD_ZK_WORKER_SECRET: "" });
    assert.equal((await app.request("/v1/zk/halo2/jobs", { headers: worker() })).status, 404);
  });

  it("valid proof → proven via eth_call (no relayer key); job leaves the queue; resubmission ignored", async () => {
    const { app } = halo2Api();
    const { apiKey } = await registerTenant(app);
    const r = await verifyFixture(app, apiKey, "allow");
    const out = await postResults(app, [{ decisionId: r.decisionId, proof: GOOD_PROOF }]);
    assert.equal(out.status, 200);
    assert.equal(out.json.outcomes[0]!.status, "proven");
    const att = await attestation(app, r.decisionId);
    assert.equal(att.status, "proven");
    assert.equal(att.proof, GOOD_PROOF);
    assert.equal(att.bn254PrecompileVerified, true);
    assert.equal(att.verifyTx, null);
    const jobs = (await (await app.request("/v1/zk/halo2/jobs", { headers: worker() })).json()) as { jobs: unknown[] };
    assert.equal(jobs.jobs.length, 0);
    const again = await postResults(app, [{ decisionId: r.decisionId, proof: GOOD_PROOF }]);
    assert.equal(again.json.outcomes[0]!.status, "ignored");
  });

  it("with a relayer key → verifyAndRecord tx, receipt event checked → verified", async () => {
    const m = mockRuntime({ withSender: true });
    const { app } = halo2Api({}, m.runtime);
    const { apiKey } = await registerTenant(app);
    const r = await verifyFixture(app, apiKey, "deny-q001-recipient");
    const out = await postResults(app, [{ decisionId: r.decisionId, proof: GOOD_PROOF }]);
    assert.equal(out.json.outcomes[0]!.status, "verified");
    const att = await attestation(app, r.decisionId);
    assert.equal(att.status, "verified");
    assert.equal(att.verifyTx, m.sent[0]);
    assert.match(att.note ?? "", /recorded onchain/);
  });

  it("a recordTx for another decision is not accepted (stays proven)", async () => {
    const m = mockRuntime({ withSender: true });
    const { app } = halo2Api({}, m.runtime);
    const { apiKey } = await registerTenant(app);
    const a = await verifyFixture(app, apiKey, "allow");
    const b = await verifyFixture(app, apiKey, "allow");
    await postResults(app, [{ decisionId: a.decisionId, proof: GOOD_PROOF }]);
    const out = await postResults(app, [{ decisionId: b.decisionId, proof: GOOD_PROOF, recordTx: m.sent[0] }]);
    assert.equal(out.json.outcomes[0]!.status, "proven");
    assert.match(out.json.outcomes[0]!.note, /not accepted/);
  });

  it("rejected proof, malformed proof and worker error → failed", async () => {
    const { app } = halo2Api();
    const { apiKey } = await registerTenant(app);
    const a = await verifyFixture(app, apiKey, "allow");
    const b = await verifyFixture(app, apiKey, "allow");
    const c = await verifyFixture(app, apiKey, "allow");
    const out = await postResults(app, [
      { decisionId: a.decisionId, proof: `0x${"cd".repeat(64)}` },
      { decisionId: b.decisionId, proof: "0xnothex" },
      { decisionId: c.decisionId, error: "native verify failed" },
    ]);
    assert.deepEqual(out.json.outcomes.map((o) => o.status), ["failed", "failed", "failed"]);
    assert.match((await attestation(app, a.decisionId)).note ?? "", /rejected/);
    assert.equal((await attestation(app, a.decisionId)).proof, null);
  });

  it("wrong verifier codehash or RPC down → deferred, attestation stays pending and queued", async () => {
    for (const opts of [{ codehashOk: false }, { rpcDown: true }]) {
      const { app } = halo2Api({}, mockRuntime(opts).runtime);
      const { apiKey } = await registerTenant(app);
      const r = await verifyFixture(app, apiKey, "allow");
      const out = await postResults(app, [{ decisionId: r.decisionId, proof: GOOD_PROOF }]);
      assert.equal(out.json.outcomes[0]!.status, "deferred");
      assert.equal((await attestation(app, r.decisionId)).status, "pending");
      const jobs = (await (await app.request("/v1/zk/halo2/jobs", { headers: worker() })).json()) as { jobs: unknown[] };
      assert.equal(jobs.jobs.length, 1);
    }
  });

  it("inputs outside the circuit (Q-005, other rails) and a disabled worker stay pending with a reason, nothing queued", async () => {
    const { app, dispatches } = halo2Api();
    const { apiKey } = await registerTenant(app);
    for (const name of ["deny-q005-no-quote", "abstain-qdecode-evm-tx"]) {
      const r = await verifyFixture(app, apiKey, name);
      assert.equal(r.attestation!.zk!.status, "pending");
      assert.match(r.attestation!.zk!.note ?? "", /Outside the Halo2 circuit/);
    }
    assert.equal(dispatches.length, 0);

    const off = halo2Api({ ZGUARD_ZK_HALO2_ENABLED: "false" });
    const k = await registerTenant(off.app);
    const r = await verifyFixture(off.app, k.apiKey, "allow");
    assert.match(r.attestation!.zk!.note ?? "", /ZGUARD_ZK_HALO2_ENABLED is not true/);
    assert.equal(off.dispatches.length, 0);
  });
});

const ANVIL = process.env.ZGUARD_TEST_ANVIL_RPC;
const HALO2_BIN = process.env.ZGUARD_TEST_HALO2_BIN;
// anvil default account #0 (public, local only)
const ANVIL_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

describe("[H7] real EVM (anvil): generated verifier + API settlement", { skip: !ANVIL && "set ZGUARD_TEST_ANVIL_RPC" }, () => {
  it("deploys, verifies committed proofs, rejects a tampered one, and settles API jobs onchain", { timeout: 300_000 }, async () => {
    const account = privateKeyToAccount(ANVIL_PK);
    const pub = createPublicClient({ transport: http(ANVIL!) });
    const chainId = await pub.getChainId();
    const chain = { id: chainId, name: "anvil", nativeCurrency: { name: "E", symbol: "E", decimals: 18 }, rpcUrls: { default: { http: [ANVIL!] } } };
    const wallet = createWalletClient({ account, chain, transport: http(ANVIL!) });
    const h1 = await wallet.deployContract({ abi: [], bytecode: HALO2_VERIFIER_BYTECODE });
    const inner = (await pub.waitForTransactionReceipt({ hash: h1 })).contractAddress!;
    const h2 = await wallet.deployContract({ abi: ZGUARD_HALO2_VERIFIER_ABI, bytecode: ZGUARD_HALO2_VERIFIER_BYTECODE, args: [inner] });
    const wrapper = (await pub.waitForTransactionReceipt({ hash: h2 })).contractAddress!;
    const client = pub as unknown as Halo2ChainClient;

    const dep = await checkHalo2Deployment(client, wrapper);
    assert.ok(dep.ok, dep.note);
    for (const p of proofFixtures.filter((f) => f.covered)) {
      const v = await verifyHalo2Proof(client, wrapper, p as never, p.proof!);
      assert.ok(v.ok, `${p.name}: ${"note" in v ? v.note : ""}`);
    }
    const p0 = proofFixtures[0]!;
    const tampered = (p0.proof!.slice(0, -2) + (p0.proof!.endsWith("00") ? "01" : "00")) as Hex;
    assert.equal((await verifyHalo2Proof(client, wrapper, p0 as never, tampered)).ok, false);
    // A valid proof bound to a different verdict is rejected.
    assert.equal((await verifyHalo2Proof(client, wrapper, { ...(p0 as never as object), verdict: 2, mask: 1 } as never, p0.proof!)).ok, false);

    if (!HALO2_BIN) return;
    const config = offlineConfig({
      ZGUARD_ZK_ENABLED: "true",
      ZGUARD_ZK_SYSTEM: "halo2-kzg",
      ZGUARD_ZK_HALO2_ENABLED: "true",
      ZGUARD_ZK_HALO2_VERIFIER_ADDRESS: wrapper,
      ZGUARD_ZK_WORKER_SECRET: SECRET,
      ZGUARD_ZK_VERIFIER_PRIVATE_KEY: ANVIL_PK,
    });
    const store = new LocalJsonStore("zg_", join(mkdtempSync(join(tmpdir(), "zguard-halo2-evm-")), "store.json"));
    const { app } = createZGuardApp({ config, store, halo2Runtime: createHalo2Runtime(config, ANVIL!, chainId) });
    const { apiKey } = await registerTenant(app);
    const ids: string[] = [];
    for (const name of ["allow", "deny-q001-recipient", "abstain-q007-domain-unverified"]) {
      ids.push((await verifyFixture(app, apiKey, name)).decisionId);
    }
    const jobs = (await (await app.request("/v1/zk/halo2/jobs", { headers: worker() })).json()) as { jobs: unknown[] };
    assert.equal(jobs.jobs.length, 3);
    const dir = mkdtempSync(join(tmpdir(), "zguard-halo2-jobs-"));
    writeFileSync(join(dir, "jobs.json"), JSON.stringify(jobs.jobs));
    execFileSync(HALO2_BIN, ["prove-jobs", join(dir, "jobs.json"), join(dir, "out.json")], {
      cwd: fileURLToPath(new URL("../../../packages/zk/halo2-quote-circuit/", import.meta.url)),
      stdio: ["ignore", "inherit", "inherit"],
    });
    const results = JSON.parse(readFileSync(join(dir, "out.json"), "utf8")) as unknown[];
    const out = await postResults(app, results);
    assert.deepEqual(out.json.outcomes.map((o) => o.status), ["verified", "verified", "verified"], JSON.stringify(out.json));
    for (const id of ids) {
      const att = await attestation(app, id);
      assert.equal(att.status, "verified");
      const recorded = await pub.readContract({ address: wrapper, abi: ZGUARD_HALO2_VERIFIER_ABI, functionName: "verifiedDecisionIds", args: [halo2DecisionKey(id)] });
      assert.equal(recorded, true);
      const r = await pub.getTransactionReceipt({ hash: att.verifyTx as Hex });
      console.log(`  ${id}: verified, verifyAndRecord gas ${r.gasUsed}`);
    }
  });
});
