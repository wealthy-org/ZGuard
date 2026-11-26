#!/usr/bin/env node
/**
 * zguard-terminal: local RHC/pons trading terminal. Every approve, buy and sell is checked by ZGuard
 * before the wallet signs; deny, abstain, an unreachable API or a missing key stop the trade.
 *
 *   zguard-terminal status
 *   zguard-terminal quote buy  <token> <eth>
 *   zguard-terminal quote sell <token> <tokens|all>
 *   zguard-terminal buy  <token> <eth>         [--slippage-bps 300] --yes
 *   zguard-terminal sell <token> <tokens|all>  [--slippage-bps 300] --yes
 *   zguard-terminal can-launch [factory]
 *
 * Environment:
 *   TERMINAL_PRIVATE_KEY   wallet key (buy/sell; status/quote use it only for the address)
 *   ZGUARD_API_KEY         required to trade (no key = no signature)
 *   ZGUARD_API_URL         default https://zguard-delta.vercel.app
 *   ZGUARD_TERMINAL_CHAIN  46630 (default) or 4663; --network overrides
 *   RHC_RPC_URL            default: the public RPC of the chosen chain
 *   ZGUARD_TERMINAL_MODE   "off" makes the terminal refuse to sign (it never trades unguarded)
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  GuardBlockedError,
  GuardDisabledError,
  PONS_TESTNET_CONTRACTS,
  RHC_PUBLIC_RPC_MAINNET,
  RHC_PUBLIC_RPC_TESTNET,
  type EvmSignerLike,
  type GuardResponse,
} from "@zguard/sdk";
import { PONS_TOKEN_ABI } from "./pons.js";
import { createPonsTerminal, TerminalGuardUnavailableError, type ChainReader, type TerminalMode } from "./terminal.js";

const RED = "\x1b[41m\x1b[97m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (key === "yes" || key === "help") flags[key] = true;
      else if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function usage(): never {
  console.log(`zguard-terminal: RHC/pons curve trading, guarded by ZGuard before every signature

  zguard-terminal status
  zguard-terminal quote buy  <token> <eth>
  zguard-terminal quote sell <token> <tokens|all>
  zguard-terminal buy  <token> <eth>        [--slippage-bps 300] [--network 46630|4663] --yes
  zguard-terminal sell <token> <tokens|all> [--slippage-bps 300] [--network 46630|4663] --yes
  zguard-terminal can-launch [factory]

Env: TERMINAL_PRIVATE_KEY, ZGUARD_API_KEY, ZGUARD_API_URL, ZGUARD_TERMINAL_CHAIN, RHC_RPC_URL`);
  process.exit(0);
}

function chainFor(chainId: number, rpc: string) {
  const testnet = chainId === 46630;
  return defineChain({
    id: chainId,
    name: testnet ? "Robinhood Chain Testnet" : "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

function explorerTx(chainId: number, hash: string): string {
  return chainId === 46630
    ? `https://explorer.testnet.chain.robinhood.com/tx/${hash}`
    : `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

function printVerdict(r: GuardResponse): void {
  const color = r.decision === "allow" ? GREEN : RED;
  console.log(`  ZGuard ${color}${r.decision}${RESET} ${DIM}${r.decisionId ?? ""} ${(r.codes ?? []).join(",")} ${r.reason}${RESET}`);
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = positional;
  if (!cmd || flags.help) usage();

  const chainId = Number(flags.network ?? process.env.ZGUARD_TERMINAL_CHAIN ?? 46630);
  if (chainId !== 46630 && chainId !== 4663) throw new Error("--network must be 46630 (testnet) or 4663 (mainnet)");
  const rpc = process.env.RHC_RPC_URL?.trim() || (chainId === 46630 ? RHC_PUBLIC_RPC_TESTNET : RHC_PUBLIC_RPC_MAINNET);
  const chain = chainFor(chainId, rpc);
  const transport = http(rpc, { fetchOptions: { headers: { "User-Agent": "zguard-terminal/0.1" } } });
  const publicClient = createPublicClient({ chain, transport });

  const mode: TerminalMode = process.env.ZGUARD_TERMINAL_MODE?.trim().toLowerCase() === "off" ? "off" : "enforce";
  if (mode === "off") {
    console.log(`${RED} UNGUARDED · ZGUARD_TERMINAL_MODE=off · this terminal refuses to sign anything until ZGuard is on ${RESET}`);
  }

  const key = process.env.TERMINAL_PRIVATE_KEY?.trim();
  const account = key ? privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex) : null;
  const addressFlag = typeof flags.account === "string" ? getAddress(flags.account) : null;
  const from: Address | null = account?.address ?? addressFlag;

  const walletClient = account ? createWalletClient({ account, chain, transport }) : null;
  const signer: EvmSignerLike = {
    async signTypedData() {
      throw new Error("zguard-terminal does not sign typed data");
    },
    async sendTransaction(tx) {
      if (!walletClient || !account) throw new Error("TERMINAL_PRIVATE_KEY is not set");
      const t = tx as { from?: string; to: string; data?: string; value?: string; chainId?: number };
      if (!t.from || getAddress(t.from) !== account.address) throw new Error("tx.from is not the terminal wallet");
      if (t.chainId !== undefined && t.chainId !== chainId) throw new Error("tx.chainId is not the terminal chain");
      return walletClient.sendTransaction({
        account,
        chain,
        to: getAddress(t.to),
        data: (t.data ?? "0x") as Hex,
        value: BigInt(t.value ?? "0"),
      });
    },
  };

  const reader = publicClient as unknown as ChainReader;
  const slippageBps = flags["slippage-bps"] ? Number(flags["slippage-bps"]) : 300;
  const apiUrl = process.env.ZGUARD_API_URL?.trim() || "https://zguard-delta.vercel.app";
  const needsGuard = cmd === "buy" || cmd === "sell";

  const terminal = createPonsTerminal({
    chainId,
    account: from ?? "0x0000000000000000000000000000000000000001",
    reader,
    signer,
    mode,
    slippageBps,
    // A dummy evaluator for read-only commands keeps them usable without a key; trades always use ZGuard.
    ...(needsGuard
      ? { zguard: { baseUrl: apiUrl, apiKey: process.env.ZGUARD_API_KEY } }
      : { evaluate: async () => { throw new TerminalGuardUnavailableError("read-only command"); } }),
    onVerdict: printVerdict,
    onStep: (m) => console.log(`→ ${m}`),
  });

  const rpcChain = await publicClient.getChainId();
  if (rpcChain !== chainId) throw new Error(`RPC ${rpc} is chain ${rpcChain}, expected ${chainId}`);

  async function tokenAmount(token: Address, raw: string, owner: Address | null): Promise<{ amount: bigint; decimals: number; symbol: string }> {
    const [decimals, symbol] = await Promise.all([
      publicClient.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: "symbol" }).catch(() => "TOKEN"),
    ]);
    if (raw === "all") {
      if (!owner) throw new Error("'all' needs TERMINAL_PRIVATE_KEY or --account");
      const bal = await publicClient.readContract({ address: token, abi: PONS_TOKEN_ABI, functionName: "balanceOf", args: [owner] });
      return { amount: bal, decimals, symbol };
    }
    return { amount: parseUnits(raw, decimals), decimals, symbol };
  }

  switch (cmd) {
    case "status": {
      console.log(`chain     ${chainId} (${rpc})`);
      console.log(`wallet    ${from ?? "(TERMINAL_PRIVATE_KEY not set)"}`);
      if (from) console.log(`balance   ${formatEther(await publicClient.getBalance({ address: from }))} ETH`);
      console.log(`zguard    ${apiUrl} · mode ${mode} · api key ${process.env.ZGUARD_API_KEY ? "set" : "MISSING (trades blocked)"}`);
      try {
        const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(10_000) });
        console.log(`health    HTTP ${res.status}`);
      } catch (e) {
        console.log(`health    unreachable (${e instanceof Error ? e.message : String(e)}) · trades blocked`);
      }
      return;
    }
    case "quote": {
      const [side, token, amt] = rest;
      if (!token || !amt || (side !== "buy" && side !== "sell")) usage();
      if (side === "buy") {
        const q = await terminal.quoteBuy(token, parseEther(amt));
        const { decimals, symbol } = await tokenAmount(q.token, "0", null);
        console.log(`curve ${q.curve}\n${amt} ETH → ~${formatUnits(q.tokensOut, decimals)} ${symbol} (min ${formatUnits(q.minTokensOut, decimals)} at ${slippageBps} bps)`);
      } else {
        const t = await tokenAmount(getAddress(token), amt, from);
        const q = await terminal.quoteSell(token, t.amount);
        console.log(`curve ${q.curve}\n${formatUnits(t.amount, t.decimals)} ${t.symbol} → ~${formatEther(q.ethOut)} ETH (min ${formatEther(q.minEthOut)})`);
      }
      return;
    }
    case "buy":
    case "sell": {
      const [token, amt] = rest;
      if (!token || !amt) usage();
      if (!account) throw new Error("TERMINAL_PRIVATE_KEY is not set");
      if (!flags.yes) {
        console.log(`Dry run. Add --yes to run the ZGuard check and send (${cmd} costs one guard call per transaction).`);
        if (cmd === "buy") {
          const q = await terminal.quoteBuy(token, parseEther(amt));
          console.log(`curve ${q.curve} · ~${q.tokensOut} raw tokens · min ${q.minTokensOut}`);
        } else {
          const t = await tokenAmount(getAddress(token), amt, from);
          const q = await terminal.quoteSell(token, t.amount).catch((e) => {
            throw new Error(`${e instanceof Error ? e.message : e} (a sell can only be simulated after the exact approval)`);
          });
          console.log(`curve ${q.curve} · ~${formatEther(q.ethOut)} ETH · min ${formatEther(q.minEthOut)}`);
        }
        return;
      }
      const result = cmd === "buy"
        ? await terminal.buy(token, parseEther(amt))
        : await terminal.sell(token, (await tokenAmount(getAddress(token), amt, from)).amount);
      if (result.approval) console.log(`${GREEN}approve${RESET} ${explorerTx(chainId, result.approval.hash)}`);
      console.log(`${GREEN}${cmd}${RESET}     ${explorerTx(chainId, result.hash)}`);
      return;
    }
    case "can-launch": {
      if (!from) throw new Error("can-launch needs TERMINAL_PRIVATE_KEY or --account");
      const factory = rest[0] ?? (chainId === 46630 ? PONS_TESTNET_CONTRACTS.factoryV2 : undefined);
      if (!factory) throw new Error("No known pons factory on 4663; pass the factory address");
      const ok = await terminal.canLaunch(factory);
      console.log(`canLaunch(${from}) on ${factory}: ${ok === null ? "not supported by this factory (no launch offered)" : ok}`);
      return;
    }
    default:
      usage();
  }
}

main().catch((err: unknown) => {
  if (err instanceof GuardBlockedError) {
    console.error(`${RED} BLOCKED ${RESET} ${err.message}${err.codes?.length ? ` [${err.codes.join(",")}]` : ""}\nNothing was signed.`);
  } else if (err instanceof GuardDisabledError) {
    console.error(`${RED} UNGUARDED ${RESET} ${err.message}\nThe terminal does not sign with ZGuard switched off. Unset ZGUARD_TERMINAL_MODE.`);
  } else if (err instanceof TerminalGuardUnavailableError) {
    console.error(`${RED} ZGUARD UNAVAILABLE ${RESET} ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
