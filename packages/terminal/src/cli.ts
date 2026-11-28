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
 *   zguard-terminal token-launch-plan  [--network 4663|46630] [--salt-nonce 0] [--out file]
 *   zguard-terminal token-buyback-plan <eth> [--token addr] [--slippage-bps 300] [--out file]   (4663)
 *   zguard-terminal token-status [token]                                                      (4663)
 *   zguard-terminal token-metadata [--write file]                                             (46630)
 *   zguard-terminal showcase-testnet [--live] [--pace ms] [--json]                            (46630)
 *
 * showcase-testnet is read-only: it re-checks every live testnet deployment (API, Perm router/adapter,
 * PermTimelock roles, Ops Safe, deploy/handoff txs) and prints explorer links. --live adds two paid
 * /v1/verify calls with ZGUARD_API_KEY (the key is read from the environment, never printed).
 *
 * The token-* commands never sign: they dry-run against the chain and write a Safe Transaction Builder
 * batch for the ZGuard Ops Safe (launcher, deployer, creator-fee recipient, buyback wallet).
 *
 * Environment:
 *   TERMINAL_PRIVATE_KEY   wallet key (buy/sell; status/quote use it only for the address)
 *   ZGUARD_API_KEY         required to trade (no key = no signature)
 *   ZGUARD_API_URL         default https://zguard-delta.vercel.app
 *   ZGUARD_TERMINAL_CHAIN  46630 (default) or 4663; --network overrides
 *   RHC_RPC_URL            default: the public RPC of the chosen chain
 *   ZGUARD_TERMINAL_MODE   "off" makes the terminal refuse to sign (it never trades unguarded)
 *   ZGUARD_PONS_TOKEN_ADDRESS     $ZGUARD token (token-buyback-plan / token-status)
 *   ZGUARD_BUYBACK_WALLET         Safe that launches and buys back (default: ZGuard Ops Safe)
 *   ZGUARD_TOKEN_CREATOR_TAX_BPS  creator tax at launch (default 0)
 *   ZGUARD_TOKEN_TWITTER / ZGUARD_TOKEN_TELEGRAM   optional socials (https URLs)
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
import { writeFileSync } from "node:fs";
import {
  GuardBlockedError,
  GuardDisabledError,
  PONS_TESTNET_CONTRACTS,
  RHC_PUBLIC_RPC_MAINNET,
  RHC_PUBLIC_RPC_TESTNET,
  ZGuardClient,
  type EvmSignerLike,
  type GuardResponse,
} from "@zguard/sdk";
import { PONS_TOKEN_ABI } from "./pons.js";
import { createPonsTerminal, TerminalGuardUnavailableError, type ChainReader, type TerminalMode } from "./terminal.js";
import {
  buildLaunchMetadata,
  cidV1Raw,
  defaultTokenConfig,
  planBuyback,
  planLaunch,
  TESTNET_CHAIN_ID,
  TokenGuardUnavailableError,
  tokenStatus,
  ZGUARD_LOGO_IMAGE,
  ZGUARD_OPS_SAFE,
  type SafeTxBuilderFile,
  type TokenChainReader,
} from "./token.js";
import { runTestnetShowcase, SHOWCASE_CHAIN_ID, type ShowcaseReader, type ShowcaseSection } from "./showcase.js";

const RED = "\x1b[41m\x1b[97m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const FAIL = "\x1b[31m";
const RESET = "\x1b[0m";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (key === "yes" || key === "help" || key === "live" || key === "json") flags[key] = true;
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
  zguard-terminal token-launch-plan  [--network 4663|46630] [--salt-nonce 0] [--out file]
  zguard-terminal token-buyback-plan <eth> [--token addr] [--slippage-bps 300] [--out file]   (4663)
  zguard-terminal token-status [token]                                                      (4663)
  zguard-terminal token-metadata [--write file]                                             (46630)
  zguard-terminal showcase-testnet [--live] [--pace ms] [--json]                            (46630, read-only)

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

  const chainId = cmd === "showcase-testnet" ? SHOWCASE_CHAIN_ID : Number(flags.network ?? process.env.ZGUARD_TERMINAL_CHAIN ?? 46630);
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

  const tokenReader = publicClient as unknown as TokenChainReader;
  const tokenSafe = getAddress(process.env.ZGUARD_BUYBACK_WALLET?.trim() || ZGUARD_OPS_SAFE);
  const tokenCfg = () =>
    defaultTokenConfig({
      creatorTaxBps: Number(process.env.ZGUARD_TOKEN_CREATOR_TAX_BPS ?? 0),
      socials: {
        twitter: process.env.ZGUARD_TOKEN_TWITTER?.trim() ?? "",
        telegram: process.env.ZGUARD_TOKEN_TELEGRAM?.trim() ?? "",
        discord: "",
        website: defaultTokenConfig().socials.website,
        farcaster: "",
      },
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
    case "showcase-testnet": {
      const pace = flags.pace ? Number(flags.pace) : 0;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const apiKey = flags.live ? process.env.ZGUARD_API_KEY?.trim() : undefined;
      if (flags.live && !apiKey) throw new Error("--live needs ZGUARD_API_KEY in the environment");
      const printSection = async (sec: ShowcaseSection) => {
        if (flags.json) return;
        console.log(`\n${BOLD}${sec.title}${RESET}`);
        const width = Math.max(...sec.rows.map((r) => r.label.length));
        for (const r of sec.rows) {
          if (pace) await sleep(pace);
          const mark = r.ok ? `${GREEN}✓${RESET}` : `${FAIL}✗${RESET}`;
          console.log(`  ${mark} ${r.label.padEnd(width)}  ${r.ok ? "" : FAIL}${r.value}${RESET}`);
          if (r.link) console.log(`    ${DIM}${r.link}${RESET}`);
        }
      };
      if (!flags.json) console.log(`${BOLD}ZGuard · testnet showcase${RESET} ${DIM}(read-only, no key, no signing · ${rpc})${RESET}`);
      const report = await runTestnetShowcase({
        reader: publicClient as unknown as ShowcaseReader,
        apiUrl,
        ...(apiKey ? { apiKey } : {}),
        onSection: printSection,
      });
      if (flags.json) console.log(JSON.stringify(report, null, 2));
      else {
        const color = report.failed ? FAIL : GREEN;
        console.log(`\n${color}${BOLD}${report.passed}/${report.passed + report.failed} checks match the deploy evidence${RESET}`);
      }
      if (report.failed) process.exitCode = 1;
      return;
    }
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
    case "token-launch-plan": {
      const plan = await planLaunch({
        chainId,
        reader: tokenReader,
        safe: tokenSafe,
        cfg: tokenCfg(),
        saltNonce: flags["salt-nonce"] ? Number(flags["salt-nonce"]) : 0,
      });
      console.log(`${GREEN}launch dry-run OK${RESET} (eth_call from the Safe, nothing sent)`);
      for (const [k, v] of Object.entries(plan.details)) if (k !== "metadataJson") console.log(`  ${k.padEnd(20)} ${v}`);
      if (plan.details.metadataJson) console.log(`  ${DIM}pin these exact bytes on IPFS (CIDv1, raw leaves) so explorers show the logo: zguard-terminal token-metadata --write zguard-46630.json${RESET}`);
      if (plan.dryRunToken) console.log(`  ${"dry-run token".padEnd(20)} ${plan.dryRunToken}\n  ${"dry-run curve".padEnd(20)} ${plan.dryRunCurve}`);
      console.log(`  ${"launch fee".padEnd(20)} ${formatEther(plan.launchFee)} ETH (Safe holds ${formatEther(plan.safeBalance)} ETH)`);
      if (plan.fundingNeeded > 0n) console.log(`  ${RED} FUND THE SAFE ${RESET} send >= ${formatEther(plan.fundingNeeded)} ETH to ${plan.safe} on ${chainId} before executing`);
      writeSafeFile(plan.safeFile, (flags.out as string) || `zguard-${chainId}-token-launch.safe.json`);
      return;
    }
    case "token-buyback-plan": {
      const [amt] = rest;
      if (!amt) usage();
      const token = (flags.token as string) || process.env.ZGUARD_PONS_TOKEN_ADDRESS?.trim();
      if (!token) throw new Error("set ZGUARD_PONS_TOKEN_ADDRESS or pass --token");
      const apiKey = process.env.ZGUARD_API_KEY?.trim();
      const client = apiKey ? new ZGuardClient({ baseUrl: apiUrl, apiKey, timeoutMs: 20_000 }) : null;
      const plan = await planBuyback({
        chainId,
        reader: tokenReader,
        token,
        safe: tokenSafe,
        quoteIn: parseEther(amt),
        slippageBps,
        mode,
        evaluate: client ? (req) => client.guard(req) : undefined,
      });
      printVerdict(plan.receipt);
      console.log(`curve ${plan.curve}\n${amt} ETH → ~${formatEther(plan.tokensOut)} ZGUARD to 0x…dEaD (min ${formatEther(plan.minTokensOut)})`);
      if (plan.fundingNeeded > 0n) console.log(`${RED} FUND THE SAFE ${RESET} it holds ${formatEther(plan.safeBalance)} ETH; needs ${formatEther(plan.quoteIn)}`);
      writeSafeFile(plan.safeFile, (flags.out as string) || `zguard-${chainId}-buyback-${Date.now()}.safe.json`);
      console.log(`${DIM}The ZGuard allow expires at ${plan.receipt.expires_at}; execute promptly or plan again.${RESET}`);
      return;
    }
    case "token-status": {
      const token = rest[0] || process.env.ZGUARD_PONS_TOKEN_ADDRESS?.trim();
      if (!token) throw new Error("set ZGUARD_PONS_TOKEN_ADDRESS or pass the token address");
      const st = await tokenStatus({ reader: tokenReader, token, safe: tokenSafe });
      console.log(`token    ${st.token}\ncurve    ${st.curve} · graduated ${st.graduated}`);
      console.log(`deployer ${st.deployer} · fee recipient ${st.creatorFeeRecipient} · tax ${st.creatorTaxBps} bps · pons buyback ${st.buybackEnabled}`);
      console.log(`supply   ${formatEther(st.totalSupply)} · burned (0x…dEaD) ${formatEther(st.burned)}`);
      console.log(st.ownedBySafe ? `${GREEN}Safe is deployer and fee recipient${RESET}` : `${RED} NOT OWNED BY THE SAFE ${RESET} expected ${tokenSafe}`);
      return;
    }
    case "token-metadata": {
      const built = buildLaunchMetadata({
        chainId: TESTNET_CHAIN_ID,
        creator: tokenSafe,
        cfg: tokenCfg(),
        image: { ...ZGUARD_LOGO_IMAGE, uri: tokenCfg().logo },
      });
      const cid = cidV1Raw(built.json);
      if (typeof flags.write === "string") {
        writeFileSync(flags.write, built.json);
        console.log(`wrote ${flags.write} · keccak ${built.digest} · ipfs://${cid} (pin with CID v1 / raw leaves to get this CID)`);
      } else console.log(`${built.json}\nkeccak ${built.digest}\nipfs://${cid}`);
      return;
    }
    default:
      usage();
  }
}

function writeSafeFile(file: SafeTxBuilderFile, path: string): void {
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`${GREEN}Safe batch${RESET} ${path} · ${file.transactions.length} tx · Safe ${file.meta.createdFromSafeAddress}`);
  console.log(`${DIM}Import it in Safe → Transaction Builder, check the decoded call, sign with 2 of 3 owners.${RESET}`);
}


main().catch((err: unknown) => {
  if (err instanceof GuardBlockedError) {
    console.error(`${RED} BLOCKED ${RESET} ${err.message}${err.codes?.length ? ` [${err.codes.join(",")}]` : ""}\nNothing was signed.`);
  } else if (err instanceof GuardDisabledError) {
    console.error(`${RED} UNGUARDED ${RESET} ${err.message}\nThe terminal does not sign with ZGuard switched off. Unset ZGUARD_TERMINAL_MODE.`);
  } else if (err instanceof TerminalGuardUnavailableError || err instanceof TokenGuardUnavailableError) {
    console.error(`${RED} ZGUARD UNAVAILABLE ${RESET} ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
