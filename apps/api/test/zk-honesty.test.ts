/**
 * Gap C1 / C9 / D2: ZK attestations are never marked proven/verified without a real proof that a verifier
 * accepted. Offline (local stub prover on 127.0.0.1, dead RPC for the verifier).
 *   tsx --test test/zk-honesty.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ZGUARD_VERIFIER_ABI,
  buildInitialZkAttestation,
  encodeQuotePublicValues,
  SP1_QUOTE_PROGRAM_VKEY,
  HALO2_VERIFIER_CODEHASH,
  getProgramVKey,
  isPlaceholderProgramVKey,
  proveQuoteAttestationAsync,
} from "@zguard/zk";

const DEAD_RPC = "http://127.0.0.1:9";
const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const PAYEE = "0x000000000000000000000000000000000000aaaa";

function fixture() {
  return buildInitialZkAttestation({
    decisionId: "dec_zk_test",
    system: "groth16-sp1",
    request: {
      network: "eip155:46630",
      quote: { asset: USDG, payTo: PAYEE, amount: "1000", chainId: 46630 },
      payload: { type: "eip3009", authorization: { from: PAYEE, to: PAYEE, value: "1000" } },
    },
    quoteVerdict: "allow",
    quoteCodes: [],
  });
}

let server: Server;
let base = "";
let mode: "ok" | "tampered" | "claims-verified" = "ok";

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const reqJson = JSON.parse(body) as { publicValues: string };
      const publicValues =
        mode === "tampered"
          ? reqJson.publicValues.slice(0, -1) + (reqJson.publicValues.endsWith("0") ? "1" : "0") // flip last nibble
          : reqJson.publicValues;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          proof: "0xdeadbeef",
          publicValues,
          ...(mode === "claims-verified" ? { status: "verified", verifyTx: "0x" + "11".repeat(32) } : {}),
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

describe("[ZK] honest attestation status (gaps C1, C9, D2)", () => {
  it("Path B is gone: ABI has no verifyAndRecordCommitmentProof / recordVerifiedBatchRoot", () => {
    const names = (ZGUARD_VERIFIER_ABI as readonly { name?: string }[]).map((x) => x.name);
    assert.ok(!names.includes("verifyAndRecordCommitmentProof"));
    assert.ok(!names.includes("recordVerifiedBatchRoot"));
    assert.ok(!names.includes("verifyBn254PairingEquation"));
    assert.ok(names.includes("verifySp1QuoteProof"));
  });

  it("groth16-sp1 carries the real SP1 programVKey, halo2-kzg the generated verifier codehash; risc0 stays placeholder", () => {
    assert.equal(fixture().programVKey, SP1_QUOTE_PROGRAM_VKEY);
    assert.equal(isPlaceholderProgramVKey("groth16-sp1", fixture().programVKey), false);
    assert.equal(getProgramVKey("halo2-kzg"), HALO2_VERIFIER_CODEHASH);
    assert.equal(isPlaceholderProgramVKey("halo2-kzg", getProgramVKey("halo2-kzg")), false);
    assert.equal(isPlaceholderProgramVKey("groth16-risc0", getProgramVKey("groth16-risc0")), true);
    // A real vkey alone proves nothing: without a prover + verifier the attestation stays pending.
    assert.equal(fixture().status, "pending");
    assert.equal(fixture().proof, null);
  });

  it("no prover configured => stays pending with a note, nothing claimed", async () => {
    const att = await proveQuoteAttestationAsync(fixture(), { rpcUrl: DEAD_RPC });
    assert.equal(att.status, "pending");
    assert.equal(att.proof, null);
    assert.equal(att.bn254PrecompileVerified, false);
    assert.match(att.note ?? "", /not configured/);
  });

  it("prover returns tampered publicValues => failed", async () => {
    mode = "tampered";
    const att = await proveQuoteAttestationAsync(fixture(), { rpcUrl: DEAD_RPC, sp1ProverUrl: base });
    assert.equal(att.status, "failed");
    assert.match(att.note ?? "", /do not match/);
  });

  it("proof received but no verifier address => pending (unverified), even if prover claims verified", async () => {
    mode = "claims-verified";
    const att = await proveQuoteAttestationAsync(fixture(), { rpcUrl: DEAD_RPC, sp1ProverUrl: base });
    assert.equal(att.status, "pending");
    assert.equal(att.verifyTx, null);
    assert.equal(att.proof, "0xdeadbeef");
  });

  it("verifier unreachable / rejecting => failed, never proven", async () => {
    mode = "ok";
    const att = await proveQuoteAttestationAsync(fixture(), {
      rpcUrl: DEAD_RPC,
      sp1ProverUrl: base,
      verifierAddress: "0x0000000000000000000000000000000000466301",
    });
    assert.equal(att.status, "failed");
    assert.notEqual(att.bn254PrecompileVerified, true);
  });

  it("publicValues layout matches the Solidity decoder (scope, quoteHash, txHash, uint8, uint32)", () => {
    const pv = encodeQuotePublicValues(fixture());
    assert.equal((pv.length - 2) / 2, 32 * 5);
  });
});
