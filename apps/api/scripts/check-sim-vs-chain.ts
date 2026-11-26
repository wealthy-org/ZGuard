/**
 * §9.3 check: replays a MINED transaction through ZGuard's simulator against the state of the parent block and
 * compares the predicted balance changes with what actually happened onchain.
 *
 *   ../../node_modules/.bin/tsx scripts/check-sim-vs-chain.ts <txHash> [chainId=46630]
 *
 * Actual changes: ERC-20 `Transfer` logs of the receipt, plus the sender's ETH delta
 * (balance(block) - balance(block-1) + fee). Exit 1 on mismatch.
 */
import { createPublicClient, http, toHex, type Hex, type PublicClient } from "viem";
import { loadConfig } from "../src/config.js";
import { simulateOnRhc } from "../src/services/simulate.js";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

(async () => {
  const txHash = process.argv[2] as Hex | undefined;
  const chainId = Number(process.argv[3] ?? 46630);
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    console.error("usage: check-sim-vs-chain.ts <txHash> [chainId]");
    process.exit(2);
  }
  const config = loadConfig({ ...process.env, ZGUARD_ACTIVE_CHAIN_ID: String(chainId) });
  const rpc =
    chainId === 4663
      ? process.env.ZGUARD_RHC_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
      : process.env.ZGUARD_RHC_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
  const client = createPublicClient({ transport: http(rpc, { timeout: 20_000 }) }) as PublicClient;

  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash }),
    client.getTransactionReceipt({ hash: txHash }),
  ]);
  if (!tx.to) throw new Error("contract creation is not supported");
  const parent = receipt.blockNumber - 1n;
  const sender = tx.from.toLowerCase();

  const sim = await simulateOnRhc(
    config,
    client,
    {
      network: `eip155:${chainId}`,
      payload: {
        type: "evm_tx",
        tx: { from: tx.from, to: tx.to, data: tx.input, value: tx.value.toString() },
      },
    } as never,
    toHex(parent)
  );

  // Actual: ERC-20 Transfer logs, netted per (address, token)
  const actual = new Map<string, bigint>();
  const add = (addr: string, token: string, d: bigint) => {
    const k = `${addr.toLowerCase()}|${token.toLowerCase()}`;
    actual.set(k, (actual.get(k) ?? 0n) + d);
  };
  for (const lg of receipt.logs) {
    if (lg.topics[0]?.toLowerCase() !== TRANSFER || lg.topics.length !== 3) continue; // ERC-721 has 4 topics
    const from = `0x${lg.topics[1]!.slice(-40)}`;
    const to = `0x${lg.topics[2]!.slice(-40)}`;
    const v = BigInt(lg.data === "0x" ? 0 : lg.data);
    add(from, lg.address, -v);
    add(to, lg.address, v);
  }
  const predicted = new Map<string, bigint>();
  for (const bc of sim.balanceChanges ?? []) {
    predicted.set(`${bc.address.toLowerCase()}|${bc.token.toLowerCase()}`, BigInt(bc.delta.replace("+", "")));
  }

  // Actual ETH: state diff (block vs parent) for the sender and every address the simulator expects to move ETH.
  // The sender's fee is added back because the simulator does not charge gas.
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  const ethAddrs = new Set<string>([sender]);
  for (const k of predicted.keys()) if (k.endsWith("|eth")) ethAddrs.add(k.split("|")[0]);
  for (const addr of ethAddrs) {
    const [after, before] = await Promise.all([
      client.getBalance({ address: addr as Hex, blockNumber: receipt.blockNumber }),
      client.getBalance({ address: addr as Hex, blockNumber: parent }),
    ]);
    const d = after - before + (addr === sender ? fee : 0n);
    if (d !== 0n) actual.set(`${addr}|eth`, d);
  }

  console.log(`tx ${txHash}`);
  console.log(`block ${receipt.blockNumber} (index ${receipt.transactionIndex}), simulated on parent ${parent}`);
  console.log(`onchain status: ${receipt.status} · simulated status: ${sim.status} · decision ${sim.decision} codes=${JSON.stringify(sim.codes)}`);
  if (receipt.transactionIndex > 1) {
    console.log("note: earlier txs in the same block can change state; small differences are then expected");
  }

  // Compare everything that touches the sender (the trader's view), plus all ERC-20 rows predicted by the simulator.
  const keys = new Set<string>();
  for (const k of [...actual.keys(), ...predicted.keys()]) {
    if (k.startsWith(`${sender}|`) || predicted.has(k)) keys.add(k);
  }
  let mismatches = 0;
  console.log("\naddress                                    token                                      predicted            actual  ok");
  for (const k of [...keys].sort()) {
    const [addr, token] = k.split("|");
    const p = predicted.get(k) ?? 0n;
    const a = actual.get(k) ?? 0n;
    const ok = p === a;
    if (!ok) mismatches++;
    console.log(
      `${addr} ${token.padEnd(42)} ${p.toString().padStart(18)} ${a.toString().padStart(18)}  ${ok ? "✓" : "✗"}`
    );
  }
  const statusOk =
    (receipt.status === "success" && sim.status === "success") ||
    (receipt.status === "reverted" && /^revert/.test(String(sim.status)) && (sim.codes ?? []).includes("S-REVERT"));
  const verdict = statusOk && mismatches === 0 ? "MATCH" : "MISMATCH";
  console.log(`\n${verdict}: ${keys.size - mismatches}/${keys.size} balance rows equal, status ${statusOk ? "equal" : "different"}`);
  process.exit(verdict === "MATCH" ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
