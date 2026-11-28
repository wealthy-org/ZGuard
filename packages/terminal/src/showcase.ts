/**
 * Read-only showcase of everything ZGuard / Perm has live on Robinhood Chain Testnet 46630, for demos and
 * screen recordings. No private key, no signing, no state change: it reads the chain over RPC, calls the
 * public API endpoints (/health, /v1/config) and runs the guard engine locally. The live `/v1/verify`
 * calls happen only when an API key is passed explicitly (each costs 0.003 USDG of credit).
 *
 * Every row is a check against what the deploy evidence says (gap doc, Perm manifest); the command exits
 * non-zero when the chain or the API no longer match, so the showcase cannot quietly show stale claims.
 */
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { guardOffline, ZGuardClient, type GuardRequest, type GuardResponse } from "@zguard/sdk";

export const SHOWCASE_CHAIN_ID = 46630;
export const SHOWCASE_EXPLORER = "https://explorer.testnet.chain.robinhood.com";
export const SHOWCASE_API = "https://zguard-delta.vercel.app";

export const TESTNET_DEPLOYMENT = {
  usdg: getAddress("0x7E955252E15c84f5768B83c41a71F9eba181802F"),
  opsSafe: getAddress("0xad5501954A52792280D868F7e613Efcc4F80fa6c"),
  guardian: getAddress("0x1FBaDaFb2056Af662aa11732e86B28aF550af0d9"),
  deployer: getAddress("0x141DB8c1C42B0fa5b13eE17136e4E037597886a8"),
  payer: getAddress("0x3d2faC269954487a63f51bF059701fbD9647e3Bf"),
  permRouter: getAddress("0x3e350b79D4983a0e86Ad4eE25dB1DBBbfB55114d"),
  v4Adapter: getAddress("0xC4Df49493a828F681160056cb6D46143B56593D0"),
  timelock: getAddress("0x3a9337f46858d246b2865f8ca4b6727666593186"),
  timelockDelaySeconds: 600n,
  txs: [
    { label: "PermRouter deploy", hash: "0x1654e9dc382f6e1e743302d0e2ca19dcddc129ddfb65a2a39a9d051794e94daf", creates: "permRouter" },
    { label: "V4 adapter deploy", hash: "0xd8a418addfb4f9aef8d8271a02d75deb8590d49f810fa81f92a033f649867c80", creates: "v4Adapter" },
    { label: "Router wiring (v4 adapter)", hash: "0x0ded432bd75ce8637b99b6349c7c641db65e3e3c0f1e05a458fe4782305cceeb" },
    { label: "PermTimelock deploy", hash: "0xdf036f406326b8188aadd84ca67a6a55b6fae01862227670b25978f2d7e1a2e1", creates: "timelock" },
    { label: "Safe 2-of-3 → scheduleBatch", hash: "0xcd8e46d152b1ed5c72200b9f8b0cd8c289727c1106a2bae3026065d4cba197f1" },
    { label: "executeBatch after 600 s", hash: "0x15968897d89376778d299d2e844ff5def5e90b6b54c1e5df8e5b6eaf1b6b50f9" },
  ],
} as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ROLE = {
  admin: ("0x" + "00".repeat(32)) as Hex,
  proposer: keccak256(toHex("PROPOSER_ROLE")),
  canceller: keccak256(toHex("CANCELLER_ROLE")),
  executor: keccak256(toHex("EXECUTOR_ROLE")),
};

export const SHOWCASE_ABI = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "getMinDelay", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "VERSION", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

type ShowcaseFn = (typeof SHOWCASE_ABI)[number]["name"];

/** The subset of a viem PublicClient the showcase needs (mockable in tests). */
export interface ShowcaseReader {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: { address: Address; abi: typeof SHOWCASE_ABI; functionName: ShowcaseFn; args?: readonly unknown[] }): Promise<unknown>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    from: Address;
    to: Address | null;
    contractAddress?: Address | null;
    logs: readonly unknown[];
  }>;
}

export interface ShowcaseRow {
  label: string;
  value: string;
  ok: boolean;
  link?: string;
}

export interface ShowcaseSection {
  title: string;
  rows: ShowcaseRow[];
}

export interface ShowcaseOptions {
  reader: ShowcaseReader;
  fetchImpl?: typeof fetch;
  apiUrl?: string;
  /** When set, two live /v1/verify calls are made (allow + deny Q-001), 0.003 USDG each. */
  apiKey?: string;
  /** Called as soon as a section is complete (lets the CLI print progressively while recording). */
  onSection?: (s: ShowcaseSection) => void | Promise<void>;
}

export interface ShowcaseReport {
  sections: ShowcaseSection[];
  passed: number;
  failed: number;
}

export const addressUrl = (a: string) => `${SHOWCASE_EXPLORER}/address/${a}`;
export const txUrl = (h: string) => `${SHOWCASE_EXPLORER}/tx/${h}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const errText = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0]! : String(e)).slice(0, 120);

/** The demo payment: 0.015 USDG (one /v1/guard call) from the payer to the ZGuard Ops Safe on 46630. */
export function demoPayment(kind: "allow" | "deny-q001"): GuardRequest {
  const d = TESTNET_DEPLOYMENT;
  const network = `eip155:${SHOWCASE_CHAIN_ID}`;
  return {
    network,
    quote: { asset: d.usdg, payTo: d.opsSafe, amount: "15000", chainId: SHOWCASE_CHAIN_ID },
    payload: {
      type: "eip3009",
      authorization: {
        kind: "TransferWithAuthorization",
        from: d.payer,
        // deny-q001: the signed authorization pays someone other than the quoted payTo (swapped recipient).
        to: kind === "allow" ? d.opsSafe : getAddress("0x000000000000000000000000000000000000bEEF"),
        value: "15000",
        validAfter: "0",
        validBefore: "4102444800",
        nonce: `0x${"11".repeat(32)}`,
        // The signed EIP-712 domain (USDG on 46630); without it the engine abstains with Q-007.
        domain: { chainId: SHOWCASE_CHAIN_ID, verifyingContract: d.usdg },
      },
    },
    checks: ["quote"],
  };
}

function verdictRow(label: string, r: GuardResponse, expect: "allow" | "deny", expectCode?: string): ShowcaseRow {
  const codes = r.codes ?? [];
  const ok = r.decision === expect && (!expectCode || codes.includes(expectCode as never));
  return { label, value: `${r.decision.toUpperCase()}${codes.length ? ` · ${codes.join(",")}` : ""}`, ok };
}

export async function runTestnetShowcase(opts: ShowcaseOptions): Promise<ShowcaseReport> {
  const { reader } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiUrl = (opts.apiUrl ?? SHOWCASE_API).replace(/\/+$/, "");
  const d = TESTNET_DEPLOYMENT;
  const sections: ShowcaseSection[] = [];
  const emit = async (s: ShowcaseSection) => {
    sections.push(s);
    await opts.onSection?.(s);
  };
  const read = async (address: Address, functionName: ShowcaseFn, args?: readonly unknown[]) =>
    reader.readContract({ address, abi: SHOWCASE_ABI, functionName, ...(args ? { args } : {}) });
  const safeRow = async (label: string, f: () => Promise<Omit<ShowcaseRow, "label">>): Promise<ShowcaseRow> => {
    try {
      return { label, ...(await f()) };
    } catch (e) {
      return { label, value: `error: ${errText(e)}`, ok: false };
    }
  };

  // 1. Network
  await emit({
    title: "Robinhood Chain Testnet",
    rows: [
      await safeRow("chainId", async () => {
        const id = await reader.getChainId();
        return { value: String(id), ok: id === SHOWCASE_CHAIN_ID };
      }),
      await safeRow("latest block", async () => ({ value: (await reader.getBlockNumber()).toString(), ok: true, link: SHOWCASE_EXPLORER })),
    ],
  });

  // 2. ZGuard API (Vercel)
  const getJson = async (path: string) => {
    const res = await fetchImpl(`${apiUrl}${path}`, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, any>;
  };
  const health = await getJson("/health").catch((e) => ({ __error: errText(e) }) as Record<string, any>);
  const config = await getJson("/v1/config").catch((e) => ({ __error: errText(e) }) as Record<string, any>);
  const h = (label: string, f: () => Omit<ShowcaseRow, "label">): ShowcaseRow =>
    health.__error ? { label, value: `error: ${health.__error}`, ok: false } : { label, ...f() };
  const c = (label: string, f: () => Omit<ShowcaseRow, "label">): ShowcaseRow =>
    config.__error ? { label, value: `error: ${config.__error}`, ok: false } : { label, ...f() };
  await emit({
    title: `ZGuard API · ${apiUrl}`,
    rows: [
      h("/health", () => ({ value: `${health.status} · ${health.network}`, ok: health.status === "ok" && health.chainId === SHOWCASE_CHAIN_ID })),
      h("storage", () => ({ value: String(health.storageDriver), ok: health.storageDriver === "neon-postgres" })),
      h("sequencer", () => ({
        value: `${health.sequencer?.up ? "up" : "DOWN"} · block age ${health.sequencer?.latestBlockAgeSeconds}s`,
        ok: health.sequencer?.up === true,
      })),
      c("payTo (x402)", () => ({
        value: short(String(config.paymentRails?.payTo)),
        ok: same(config.paymentRails?.payTo, d.opsSafe),
        link: addressUrl(d.opsSafe),
      })),
      c("billing asset", () => ({
        value: `USDG ${short(String(config.paymentRails?.usdgAddress))} · ${config.paymentRails?.effectiveSettlementMode}`,
        ok: same(config.paymentRails?.usdgAddress, d.usdg),
        link: addressUrl(d.usdg),
      })),
      c("prices µUSDG", () => {
        const p = config.pricesMicroUsdg ?? {};
        return { value: `verify ${p.verify} · guard ${p.guard} · tokenRisk ${p.tokenRisk}`, ok: Boolean(p.guard) };
      }),
      c("quote check mode", () => ({ value: String(config.policy?.checkModes?.quote), ok: config.policy?.checkModes?.quote === "required" })),
    ],
  });

  // 3. Guard verdicts on a real 46630 payment shape
  const rows: ShowcaseRow[] = [
    verdictRow("local engine · correct payTo", guardOffline(demoPayment("allow")), "allow"),
    verdictRow("local engine · swapped recipient", guardOffline(demoPayment("deny-q001")), "deny", "Q-001"),
  ];
  if (opts.apiKey) {
    const client = new ZGuardClient({ baseUrl: apiUrl, apiKey: opts.apiKey, fetchImpl, timeoutMs: 20_000 });
    for (const [kind, expect, code] of [["allow", "allow", undefined], ["deny-q001", "deny", "Q-001"]] as const) {
      rows.push(
        await safeRow(`live /v1/verify · ${kind}`, async () => {
          const r = await client.verify(demoPayment(kind));
          const row = verdictRow("", r, expect, code);
          return { value: `${row.value} · ${r.decisionId}`, ok: row.ok };
        })
      );
    }
  } else {
    rows.push({ label: "live /v1/verify", value: "skipped (add --live with ZGUARD_API_KEY: 2 × 0.003 USDG)", ok: true });
  }
  await emit({ title: "Guard verdicts · 0.015 USDG to the Ops Safe", rows });

  // 4. Perm contracts → owned by the timelock
  const ownedRows = async (name: string, address: Address) => [
    await safeRow(`${name} code`, async () => {
      const code = await reader.getBytecode({ address });
      return { value: `${short(address)} · ${code ? (code.length - 2) / 2 : 0} bytes`, ok: Boolean(code && code.length > 2), link: addressUrl(address) };
    }),
    await safeRow(`${name} owner`, async () => {
      const o = await read(address, "owner");
      return { value: same(o, d.timelock) ? `PermTimelock ${short(d.timelock)}` : String(o), ok: same(o, d.timelock), link: addressUrl(d.timelock) };
    }),
    await safeRow(`${name} pendingOwner`, async () => {
      const p = await read(address, "pendingOwner");
      return { value: same(p, ZERO) ? "none" : String(p), ok: same(p, ZERO) };
    }),
  ];
  await emit({
    title: "Perm on 46630 · ownership handed to the timelock",
    rows: [
      ...(await ownedRows("PermRouter", d.permRouter)),
      await safeRow("PermRouter paused", async () => {
        const p = await read(d.permRouter, "paused");
        return { value: String(p), ok: p === false };
      }),
      ...(await ownedRows("V4 adapter", d.v4Adapter)),
    ],
  });

  // 5. Timelock roles
  const role = (label: string, r: Hex, who: Address, expect: boolean) =>
    safeRow(label, async () => {
      const has = (await read(d.timelock, "hasRole", [r, who])) === true;
      return { value: has ? "yes" : "no", ok: has === expect };
    });
  await emit({
    title: `PermTimelock ${short(d.timelock)}`,
    rows: [
      await safeRow("min delay", async () => {
        const delay = (await read(d.timelock, "getMinDelay")) as bigint;
        return { value: `${delay} s (testnet rehearsal; mainnet 172800 s)`, ok: delay === d.timelockDelaySeconds, link: addressUrl(d.timelock) };
      }),
      await role("proposer = Ops Safe", ROLE.proposer, d.opsSafe, true),
      await role("canceller = Ops Safe", ROLE.canceller, d.opsSafe, true),
      await role("canceller = guardian 0x1FBa", ROLE.canceller, d.guardian, true),
      await role("executor = anyone", ROLE.executor, ZERO, true),
      await role("admin = timelock itself", ROLE.admin, d.timelock, true),
      await role("deployer keeps no proposer role", ROLE.proposer, d.deployer, false),
    ],
  });

  // 6. Ops Safe
  await emit({
    title: `Safe "ZGuard Ops" ${short(d.opsSafe)}`,
    rows: [
      await safeRow("threshold", async () => {
        const [t, owners] = await Promise.all([read(d.opsSafe, "getThreshold"), read(d.opsSafe, "getOwners")]);
        const n = (owners as Address[]).length;
        return { value: `${t}-of-${n}`, ok: t === 2n && n === 3, link: addressUrl(d.opsSafe) };
      }),
      await safeRow("version · nonce", async () => {
        const [v, n] = await Promise.all([read(d.opsSafe, "VERSION"), read(d.opsSafe, "nonce")]);
        return { value: `${v} · nonce ${n}`, ok: (n as bigint) >= 1n };
      }),
    ],
  });

  // 7. Transactions
  const txRows: ShowcaseRow[] = [];
  for (const t of d.txs) {
    txRows.push(
      await safeRow(t.label, async () => {
        const r = await reader.getTransactionReceipt({ hash: t.hash as Hex });
        const block = await reader.getBlock({ blockNumber: r.blockNumber });
        const when = new Date(Number(block.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 19);
        const created = "creates" in t ? (d[t.creates] as Address) : null;
        const ok = r.status === "success" && (!created || same(r.contractAddress, created));
        return { value: `${r.status} · block ${r.blockNumber} · ${when} UTC · ${r.logs.length} events`, ok, link: txUrl(t.hash) };
      })
    );
  }
  await emit({ title: "Deploy & handoff transactions", rows: txRows });

  const all = sections.flatMap((s) => s.rows);
  return { sections, passed: all.filter((r) => r.ok).length, failed: all.filter((r) => !r.ok).length };
}
