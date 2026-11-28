#!/usr/bin/env node
/**
 * Testnet-only deploy of the Halo2 quote verifier (gap H7) + evidence transactions.
 *
 *   pnpm --filter @zguard/zk deploy:halo2              deploy Halo2Verifier + ZGuardHalo2QuoteVerifier on 46630
 *   pnpm --filter @zguard/zk record:halo2 <wrapper>    eth_call + verifyAndRecord the committed allow / deny Q-001 proofs
 *   pnpm --filter @zguard/zk check:halo2 <wrapper>     read-only: codehash + both proofs via eth_call (no key needed)
 *
 * Key: ZGUARD_DEPLOYER_PRIVATE_KEY (env or root .env). The script refuses any chain other than 46630, both by
 * configuration and by asking the RPC for its chainId. RPC: ZGUARD_HALO2_DEPLOY_RPC_URL, else
 * ZGUARD_RHC_TESTNET_RPC_URL, else the public testnet RPC. ZGUARD_RHC_RPC_URL is ignored on purpose: in the API it is
 * the active-chain RPC and often points at mainnet.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RHC_EXPLORER_TESTNET, RHC_PUBLIC_RPC_TESTNET, RHC_TESTNET_CHAIN_ID } from "@zguard/sdk";
import {
  HALO2_VERIFIER_BYTECODE,
  HALO2_VERIFIER_CODEHASH,
  ZGUARD_HALO2_VERIFIER_ABI,
  ZGUARD_HALO2_VERIFIER_BYTECODE,
} from "./halo2-artifact.js";
import { checkHalo2Deployment, halo2DecisionKey, verifyHalo2Proof, type Halo2ChainClient } from "./halo2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = ["allow", "deny-q001-recipient"] as const;

function loadRootEnv(): void {
  const rootEnv = path.resolve(__dirname, "../../../.env");
  if (!fs.existsSync(rootEnv)) return;
  for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    const k = t.slice(0, idx).trim();
    let v = t.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

interface ProofFixture {
  name: string;
  covered: boolean;
  quoteJson: string;
  txJson: string;
  verdict: 1 | 2 | 3;
  mask: number;
  proof: Hex;
}

function loadProofFixtures(): ProofFixture[] {
  const file = path.resolve(__dirname, "../fixtures/halo2-quote-proofs.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { fixtures: ProofFixture[] };
  return raw.fixtures.filter((f) => f.covered && (EVIDENCE as readonly string[]).includes(f.name));
}

class Refusal extends Error {}

/** Throws instead of process.exit(): on Windows an exit with open sockets trips a libuv assertion. */
function die(msg: string): never {
  throw new Refusal(`[ZGuard Halo2] ${msg}`);
}

async function main() {
  loadRootEnv();
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || !["deploy", "record", "check"].includes(cmd)) die("usage: deploy | record <wrapper> | check <wrapper>");

  const chainId = Number(process.env.ZGUARD_ACTIVE_CHAIN_ID || RHC_TESTNET_CHAIN_ID);
  if (chainId !== RHC_TESTNET_CHAIN_ID) die(`testnet-only script: ZGUARD_ACTIVE_CHAIN_ID=${chainId}, expected ${RHC_TESTNET_CHAIN_ID}`);
  const rpcUrl = process.env.ZGUARD_HALO2_DEPLOY_RPC_URL || process.env.ZGUARD_RHC_TESTNET_RPC_URL || RHC_PUBLIC_RPC_TESTNET;
  const chain = defineChain({
    id: RHC_TESTNET_CHAIN_ID,
    name: "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const pub = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });
  const rpcChain = await pub.getChainId();
  if (rpcChain !== RHC_TESTNET_CHAIN_ID) die(`RPC ${rpcUrl} reports chainId ${rpcChain}; refusing (testnet 46630 only)`);
  const explorer = RHC_EXPLORER_TESTNET;
  const client = pub as unknown as Halo2ChainClient;

  if (cmd === "check") {
    if (!arg || !/^0x[0-9a-fA-F]{40}$/.test(arg)) die("usage: check <ZGuardHalo2QuoteVerifier address>");
    const dep = await checkHalo2Deployment(client, arg as Address);
    console.log(`[ZGuard Halo2] deployment: ${dep.ok ? "OK" : "FAIL"} — ${dep.note} (halo2Verifier=${dep.halo2Verifier ?? "?"})`);
    let ok = dep.ok;
    for (const f of loadProofFixtures()) {
      const v = await verifyHalo2Proof(client, arg as Address, f, f.proof);
      console.log(`[ZGuard Halo2] verifyQuote(${f.name}) eth_call: ${v.ok ? "OK, public values match" : v.note}`);
      ok &&= v.ok;
      const done = (await pub.readContract({
        address: arg as Address,
        abi: ZGUARD_HALO2_VERIFIER_ABI,
        functionName: "verifiedDecisionIds",
        args: [halo2DecisionKey(`zguard-halo2-evidence-${f.name}`)],
      })) as boolean;
      console.log(`[ZGuard Halo2]   recorded onchain as zguard-halo2-evidence-${f.name}: ${done}`);
    }
    if (!ok) process.exitCode = 1;
    return;
  }

  const pk = (process.env.ZGUARD_DEPLOYER_PRIVATE_KEY || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) die("ZGUARD_DEPLOYER_PRIVATE_KEY is not set (0x + 64 hex) in env or root .env");
  const account = privateKeyToAccount(pk as Hex);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 30_000 }) });
  const balance = await pub.getBalance({ address: account.address });
  console.log(`[ZGuard Halo2] chain ${chainId} · sender ${account.address} · balance ${balance} wei`);
  if (balance === 0n) die("sender has 0 ETH on testnet (faucet: https://faucet.testnet.chain.robinhood.com)");

  if (cmd === "deploy") {
    const h1 = await wallet.deployContract({ abi: [], bytecode: HALO2_VERIFIER_BYTECODE });
    console.log(`[ZGuard Halo2] Halo2Verifier tx ${explorer}/tx/${h1}`);
    const r1 = await pub.waitForTransactionReceipt({ hash: h1, timeout: 120_000 });
    if (r1.status !== "success" || !r1.contractAddress) die("Halo2Verifier deploy reverted");
    const inner = r1.contractAddress;
    const code = await pub.getBytecode({ address: inner });
    const { keccak256 } = await import("viem");
    if (!code || keccak256(code).toLowerCase() !== HALO2_VERIFIER_CODEHASH.toLowerCase()) die("deployed Halo2Verifier codehash mismatch");
    console.log(`[ZGuard Halo2] Halo2Verifier ${inner} (gas ${r1.gasUsed}, codehash ${HALO2_VERIFIER_CODEHASH})`);

    const h2 = await wallet.deployContract({ abi: ZGUARD_HALO2_VERIFIER_ABI, bytecode: ZGUARD_HALO2_VERIFIER_BYTECODE, args: [inner] });
    console.log(`[ZGuard Halo2] ZGuardHalo2QuoteVerifier tx ${explorer}/tx/${h2}`);
    const r2 = await pub.waitForTransactionReceipt({ hash: h2, timeout: 120_000 });
    if (r2.status !== "success" || !r2.contractAddress) die("wrapper deploy reverted");
    console.log(`[ZGuard Halo2] ZGuardHalo2QuoteVerifier ${r2.contractAddress} (gas ${r2.gasUsed})`);
    console.log(`\nNext: pnpm --filter @zguard/zk record:halo2 ${r2.contractAddress}`);
    console.log(`API env: ZGUARD_ZK_HALO2_VERIFIER_ADDRESS=${r2.contractAddress}`);
    return;
  }

  // record
  if (!arg || !/^0x[0-9a-fA-F]{40}$/.test(arg)) die("usage: record <ZGuardHalo2QuoteVerifier address>");
  const wrapper = arg as Address;
  const dep = await checkHalo2Deployment(client, wrapper);
  if (!dep.ok) die(`wrapper check failed: ${dep.note}`);
  for (const f of loadProofFixtures()) {
    const decisionId = `zguard-halo2-evidence-${f.name}`;
    const v = await verifyHalo2Proof(client, wrapper, f, f.proof);
    if (!v.ok) die(`${f.name}: ${v.note}`);
    const already = (await pub.readContract({
      address: wrapper,
      abi: ZGUARD_HALO2_VERIFIER_ABI,
      functionName: "verifiedDecisionIds",
      args: [halo2DecisionKey(decisionId)],
    })) as boolean;
    if (already) {
      console.log(`[ZGuard Halo2] ${decisionId} already recorded, skipping`);
      continue;
    }
    const hash = await wallet.writeContract({
      address: wrapper,
      abi: ZGUARD_HALO2_VERIFIER_ABI,
      functionName: "verifyAndRecord",
      args: [halo2DecisionKey(decisionId), toHex(f.quoteJson), toHex(f.txJson), f.verdict, f.mask, f.proof],
    });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    console.log(`[ZGuard Halo2] ${f.name} verdict=${f.verdict} mask=${f.mask} → ${r.status} gas ${r.gasUsed} ${explorer}/tx/${hash}`);
    if (r.status !== "success") die(`${f.name}: verifyAndRecord reverted`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
