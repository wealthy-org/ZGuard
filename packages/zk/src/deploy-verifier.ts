#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  RHC_EXPLORER_MAINNET,
  RHC_EXPLORER_TESTNET,
  RHC_PUBLIC_RPC_MAINNET,
  RHC_PUBLIC_RPC_TESTNET,
  RHC_TESTNET_ASSETS,
  RHC_TESTNET_CHAIN_ID,
} from "@zguard/sdk";
import {
  ZGUARD_VERIFIER_ABI,
  ZGUARD_VERIFIER_BYTECODE,
  getProgramVKey,
  isPlaceholderProgramVKey,
} from "./index.js";

function loadRootEnv(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rootEnv = path.resolve(__dirname, "../../../.env");
  if (fs.existsSync(rootEnv)) {
    for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx <= 0) continue;
      const k = t.slice(0, idx).trim();
      let v = t.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
  return rootEnv;
}

async function main() {
  const rootEnvPath = loadRootEnv();
  const chainId = Number(process.env.ZGUARD_ACTIVE_CHAIN_ID || RHC_TESTNET_CHAIN_ID);
  const isMainnet = chainId === 4663;
  if (isMainnet) {
    // Gap C7 / Bagian L: this project stays on Testnet 46630 until an audit + multisig owner exist.
    console.error("[ZGuard ZK Deploy] Mainnet 4663 deploys are disabled (testnet-only decision, gap L).");
    process.exit(1);
  }
  const rpcUrl = isMainnet
    ? process.env.ZGUARD_RHC_MAINNET_RPC_URL || RHC_PUBLIC_RPC_MAINNET
    : process.env.ZGUARD_RHC_RPC_URL || RHC_PUBLIC_RPC_TESTNET;
  const explorer = isMainnet ? RHC_EXPLORER_MAINNET : RHC_EXPLORER_TESTNET;

  const pk = (process.env.ZGUARD_DEPLOYER_PRIVATE_KEY || process.env.ZGUARD_ZK_VERIFIER_PRIVATE_KEY || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error(
      `\n[ZGuard ZK Deploy] ZGUARD_DEPLOYER_PRIVATE_KEY belum diatur di .env!\n` +
        `1. Klaim ETH Testnet gratis untuk wallet Anda di https://faucet.testnet.chain.robinhood.com (Chain ID 46630)\n` +
        `2. Tambahkan ZGUARD_DEPLOYER_PRIVATE_KEY="0x..." ke file .env\n` +
        `3. Jalankan ulang: pnpm deploy:verifier\n`
    );
    process.exit(1);
  }

  const chain: Chain = defineChain({
    id: chainId,
    name: isMainnet ? "Robinhood Chain" : "Robinhood Chain Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: explorer } },
  });

  const account = privateKeyToAccount(pk as Hex);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`[ZGuard ZK Deploy] Chain: ${chain.name} (${chainId})`);
  console.log(`[ZGuard ZK Deploy] Deployer: ${account.address} (Balance: ${balance.toString()} wei)`);
  if (balance === 0n) {
    console.error(
      `[ZGuard ZK Deploy] Saldo ETH 0. Silakan klaim ETH Testnet gratis di https://faucet.testnet.chain.robinhood.com untuk alamat ${account.address}`
    );
    process.exit(1);
  }

  const gateway = (process.env.ZGUARD_ZK_SP1_GATEWAY || "0x0000000000000000000000000000000000000000").trim() as Hex;
  const vkeyEnv = (process.env.ZGUARD_ZK_SP1_PROGRAM_VKEY || "").trim();
  const vkey = getProgramVKey("groth16-sp1", vkeyEnv || null);
  if (!/^0x[0-9a-fA-F]{40}$/.test(gateway) || /^0x0{40}$/.test(gateway) || isPlaceholderProgramVKey("groth16-sp1", vkey)) {
    console.warn(
      "[ZGuard ZK Deploy] WARNING: ZGUARD_ZK_SP1_GATEWAY and/or ZGUARD_ZK_SP1_PROGRAM_VKEY not set.\n" +
        "  The verifier will deploy but every proof will revert (NotConfigured / invalid) until the owner\n" +
        "  calls proposeGatewayAndVKey(...) and, after the 2-day timelock, applyGatewayAndVKey()."
    );
  }
  const deployHash = await walletClient.deployContract({
    abi: ZGUARD_VERIFIER_ABI,
    bytecode: ZGUARD_VERIFIER_BYTECODE,
    args: [gateway, vkey],
  });
  console.log(`[ZGuard ZK Deploy] Deploying ZGuardQuoteVerifier... tx: ${explorer}/tx/${deployHash}`);
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const verifierAddress = deployReceipt.contractAddress!;
  console.log(
    `[ZGuard ZK Deploy] Deployed ZGuardQuoteVerifier at ${verifierAddress} (gasUsed=${deployReceipt.gasUsed.toString()})`
  );
  console.log(
    "[ZGuard ZK Deploy] No fixture is marked verified here: an attestation only becomes verified when a real SP1\n" +
      "  proof from ZGUARD_ZK_SP1_PROVER_URL passes verifySp1QuoteProof. Transfer ownership to a multisig next."
  );

  // Persist ZGUARD_ZK_VERIFIER_ADDRESS to root .env if file exists
  if (fs.existsSync(rootEnvPath)) {
    let raw = fs.readFileSync(rootEnvPath, "utf8");
    if (/^ZGUARD_ZK_VERIFIER_ADDRESS=/m.test(raw)) {
      raw = raw.replace(/^ZGUARD_ZK_VERIFIER_ADDRESS=.*$/m, `ZGUARD_ZK_VERIFIER_ADDRESS="${verifierAddress}"`);
    } else {
      raw += `\nZGUARD_ZK_VERIFIER_ADDRESS="${verifierAddress}"\n`;
    }
    fs.writeFileSync(rootEnvPath, raw, "utf8");
    console.log(`[ZGuard ZK Deploy] Updated ZGUARD_ZK_VERIFIER_ADDRESS in .env`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
