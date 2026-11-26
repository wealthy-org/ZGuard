/**
 * $ZGUARD product token (brief §9.9 / §10): launch on pons and buyback-and-burn from the ZGuard Ops Safe.
 *
 * Nothing here signs or broadcasts. Every function builds calldata, checks it against live chain state with
 * `eth_call` (a dry-run from the Safe), and returns a Safe Transaction Builder batch that the Safe owners
 * review and sign. The Safe is the launcher, the token `deployer` and the creator-fee recipient, so no EOA
 * ever owns anything of the token.
 *
 * - Mainnet 4663: pons V2 `PonsV2LaunchFactory.launchToken` (ABI verified on Sourcify). Buyback = curve
 *   `buy(quoteIn, minTokensOut, recipient)` with recipient = 0x…dEaD, so buy and burn are one call and no
 *   token ever sits in the Safe. The buy goes through ZGuard first (local quote-match + hosted guard, an
 *   `allow` bound to the exact bytes); deny / abstain / unreachable / no key = no batch file.
 * - Testnet 46630: the testnet launchpad (`createToken`, metadata JSON + keccak digest) only, as a launch
 *   rehearsal. Its curves have no `recipient` and keep transfers locked until graduation, so a testnet
 *   buyback-and-burn cannot be expressed; `planBuyback` refuses it.
 * - A graduated token trades on Uniswap v4 behind the pons hook; that buyback route is Phase 2 and refused.
 */
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  sha256,
  stringToHex,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  DEAD_BURN_ADDRESS,
  evaluateQuoteMatch,
  GuardDisabledError,
  PONS_TESTNET_CONTRACTS,
  PONS_V2_CONTRACTS,
  verifyReceiptForSigning,
  type GuardRequest,
  type GuardResponse,
} from "@zguard/sdk";
import { minOutWithSlippage, type GuardedCall } from "./pons.js";

export const MAINNET_CHAIN_ID = 4663;
export const TESTNET_CHAIN_ID = 46630;

/** "ZGuard Ops" Safe (2-of-3), same address on 4663 and 46630: payTo, buyback wallet, token launcher. */
export const ZGUARD_OPS_SAFE: Address = getAddress("0xad5501954A52792280D868F7e613Efcc4F80fa6c");
export const BURN_ADDRESS: Address = getAddress(DEAD_BURN_ADDRESS);

export const ZGUARD_TOKEN_DEFAULTS = {
  name: "ZGuard",
  /** Onchain symbol; "$ZGUARD" is the display ticker (ZGUARD_TOKEN_TICKER). */
  symbol: "ZGUARD",
  logo: "https://zguard-delta.vercel.app/logo.jpg",
  description:
    "ZGuard checks agent payments and trades on Robinhood Chain before anything is signed. Net hosted-API revenue is used to buy back and burn ZGUARD.",
  website: "https://zguard-delta.vercel.app",
} as const;

export const ZGUARD_LOGO_IMAGE = { bytes: 109697, height: 1024, width: 1024, mimeType: "image/jpeg" } as const;

// ---------------------------------------------------------------- ABIs

/** pons V2 factory, mainnet 4663 (`PonsV2LaunchFactory`, Sourcify-verified). Only the 3-argument launchToken. */
export const PONS_V2_FACTORY_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct LaunchParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function launchToken(LaunchParams params, uint256 launchConfigId, address pairToken) payable returns (address, address)",
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function canLaunch(address launcher) view returns (bool)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
]);

/** pons V2 curve (selectors read from the deployed bytecode; `buy` semantics checked against mined buys). */
export const PONS_V2_CURVE_ABI = parseAbi([
  "function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256)",
  "function token() view returns (address)",
  "function factory() view returns (address)",
  "function graduated() view returns (bool)",
  "function isNativeQuote() view returns (bool)",
  "function currentSnipeTaxBps(address account) view returns (uint256)",
]);

/** Testnet 46630 launchpad factory (`createToken`; selector 0xbaf2b1ea, as used by KOIP). */
export const TESTNET_LAUNCH_FACTORY_ABI = parseAbi([
  "function createToken(string name_, string symbol_, string metadataURI_, bytes32 metadataDigest_, address creatorFeeRecipient, uint256 minInitialTokensOut) payable",
  "function LAUNCH_FEE() view returns (uint256)",
  "function METADATA_SCHEMA_VERSION() view returns (uint16)",
  "function MAX_METADATA_URI_LENGTH() view returns (uint256)",
]);

export const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

export const SIG_V2_BUY = "buy(uint256,uint256,address)";

// ---------------------------------------------------------------- types

export interface TokenChainReader {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  call(args: {
    account: Address;
    to: Address;
    data: Hex;
    value?: bigint;
    stateOverride?: Array<{ address: Address; balance: bigint }>;
  }): Promise<{ data?: Hex }>;
  getBalance(args: { address: Address }): Promise<bigint>;
}

export interface SafeCall {
  to: Address;
  value: bigint;
  data: Hex;
}

export interface SafeTxBuilderFile {
  version: "1.0";
  chainId: string;
  createdAt: number;
  meta: {
    name: string;
    description: string;
    txBuilderVersion: string;
    createdFromSafeAddress: Address;
    createdFromOwnerAddress: string;
    checksum: string;
  };
  transactions: Array<{ to: Address; value: string; data: Hex; contractMethod: null; contractInputsValues: null }>;
}

export interface TokenConfig {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
  /** 0..maxCreatorTaxBps (factory). Default 0: no creator tax. */
  creatorTaxBps: number;
  /** pons-native buyback routes fees through the pons buyback vault; ZGuard keeps its own (brief §10), so false. */
  buybackEnabled: boolean;
}

// ---------------------------------------------------------------- pure helpers

export function defaultTokenConfig(over: Partial<TokenConfig> = {}): TokenConfig {
  return {
    name: ZGUARD_TOKEN_DEFAULTS.name,
    symbol: ZGUARD_TOKEN_DEFAULTS.symbol,
    logo: ZGUARD_TOKEN_DEFAULTS.logo,
    description: ZGUARD_TOKEN_DEFAULTS.description,
    socials: { twitter: "", telegram: "", discord: "", website: ZGUARD_TOKEN_DEFAULTS.website, farcaster: "" },
    creatorTaxBps: 0,
    buybackEnabled: false,
    ...over,
  };
}

export function validateTokenConfig(cfg: TokenConfig, maxCreatorTaxBps?: bigint): void {
  if (!/^[A-Za-z0-9 ]{1,32}$/.test(cfg.name)) throw new Error("token name: 1-32 letters, digits or spaces");
  if (!/^[A-Z0-9]{2,11}$/.test(cfg.symbol)) throw new Error('token symbol: 2-11 of A-Z0-9 (no "$"; that is display only)');
  if (!/^(https:\/\/|ipfs:\/\/)\S+$/.test(cfg.logo)) throw new Error("logo must be an https:// or ipfs:// URL");
  if (cfg.description.length < 1 || cfg.description.length > 280) throw new Error("description: 1-280 characters");
  for (const [k, v] of Object.entries(cfg.socials)) {
    if (v && !/^https:\/\/\S+$/.test(v)) throw new Error(`socials.${k} must be empty or an https:// URL`);
  }
  if (!Number.isInteger(cfg.creatorTaxBps) || cfg.creatorTaxBps < 0) throw new Error("creatorTaxBps must be an integer >= 0");
  if (maxCreatorTaxBps !== undefined && BigInt(cfg.creatorTaxBps) > maxCreatorTaxBps) {
    throw new Error(`creatorTaxBps ${cfg.creatorTaxBps} is above the factory maximum ${maxCreatorTaxBps}`);
  }
}

/** Deterministic launch salt: one salt per chain and launcher, `nonce` only for a retry after a failed launch. */
export function launchSalt(chainId: number, launcher: string, nonce = 0): Hex {
  return keccak256(stringToHex(`ZGUARD_PONS_LAUNCH_V1:${chainId}:${getAddress(launcher).toLowerCase()}:${nonce}`));
}

/** Compact JSON with keys sorted at every level: the byte format the testnet launchpad metadata uses. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export interface LaunchMetadata {
  chainId: number;
  creator: string;
  description: string;
  image: { bytes: number; height: number; mimeType: string; uri: string; width: number };
  name: string;
  schemaVersion: number;
  socials: Record<string, string>;
  symbol: string;
}

/** Testnet launch metadata (schema 1). `creator` is lowercase and empty socials are omitted, as onchain launches do. */
export function buildLaunchMetadata(p: {
  chainId: number;
  creator: string;
  cfg: TokenConfig;
  image: { bytes: number; height: number; width: number; mimeType: string; uri: string };
}): { json: string; digest: Hex; metadata: LaunchMetadata } {
  const socials = Object.fromEntries(Object.entries(p.cfg.socials).filter(([, v]) => v));
  const metadata: LaunchMetadata = {
    chainId: p.chainId,
    creator: getAddress(p.creator).toLowerCase(),
    description: p.cfg.description,
    image: { ...p.image },
    name: p.cfg.name,
    schemaVersion: 1,
    socials,
    symbol: p.cfg.symbol,
  };
  const json = canonicalJson(metadata);
  return { json, digest: metadataDigest(json), metadata };
}

export function metadataDigest(bytes: string | Uint8Array): Hex {
  return keccak256(typeof bytes === "string" ? stringToHex(bytes) : bytes);
}

/**
 * IPFS CIDv1 of a single raw block (codec raw 0x55, sha2-256), base32: the `bafkrei…` form that
 * `ipfs add --cid-version 1 --raw-leaves` and pinning services give for a small file. Content-addressed, so
 * the URI can be fixed before anyone pins the file; pinning the same bytes later yields the same CID.
 */
export function cidV1Raw(bytes: string | Uint8Array): string {
  const data = typeof bytes === "string" ? toBytes(bytes) : bytes;
  const digest = toBytes(sha256(data));
  const raw = new Uint8Array([0x01, 0x55, 0x12, 0x20, ...digest]);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "b";
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

export function encodeV2Launch(p: {
  cfg: TokenConfig;
  creatorFeeRecipient: string;
  expectedEconomics: Hex;
  salt: Hex;
  launchConfigId?: bigint;
}): Hex {
  return encodeFunctionData({
    abi: PONS_V2_FACTORY_ABI,
    functionName: "launchToken",
    args: [
      {
        name: p.cfg.name,
        symbol: p.cfg.symbol,
        logo: p.cfg.logo,
        description: p.cfg.description,
        socials: p.cfg.socials,
        creatorFeeRecipient: getAddress(p.creatorFeeRecipient),
        creatorTaxBps: p.cfg.creatorTaxBps,
        buybackEnabled: p.cfg.buybackEnabled,
        expectedEconomics: p.expectedEconomics,
        salt: p.salt,
      },
      p.launchConfigId ?? 0n,
      zeroAddress, // pair token: native ETH
    ],
  });
}

export function encodeTestnetLaunch(p: {
  cfg: TokenConfig;
  metadataUri: string;
  digest: Hex;
  creatorFeeRecipient: string;
}): Hex {
  return encodeFunctionData({
    abi: TESTNET_LAUNCH_FACTORY_ABI,
    functionName: "createToken",
    args: [p.cfg.name, p.cfg.symbol, p.metadataUri, p.digest, getAddress(p.creatorFeeRecipient), 0n],
  });
}

/** Buyback-and-burn as one call: ETH in, tokens straight to 0x…dEaD. Intent and tx come from the same values. */
export function buildV2BuybackBurn(p: {
  chainId: number;
  curve: string;
  token: string;
  safe: string;
  quoteIn: bigint;
  minTokensOut: bigint;
}): GuardedCall {
  if (p.quoteIn <= 0n) throw new Error("buyback ETH amount must be greater than zero");
  if (p.minTokensOut <= 0n) throw new Error("minimum tokens out must be greater than zero");
  const curve = getAddress(p.curve);
  const from = getAddress(p.safe);
  const args = [p.quoteIn, p.minTokensOut, BURN_ADDRESS] as const;
  const data = encodeFunctionData({ abi: PONS_V2_CURVE_ABI, functionName: "buy", args });
  return {
    intent: {
      chainId: p.chainId,
      to: curve,
      function: SIG_V2_BUY,
      args: args.map(String),
      value: p.quoteIn.toString(),
      from,
      expectedOut: { token: getAddress(p.token), recipient: BURN_ADDRESS, minAmountOut: p.minTokensOut.toString() },
    },
    tx: { chainId: p.chainId, from, to: curve, data, value: p.quoteIn.toString() },
  };
}

export function buybackGuardRequest(call: GuardedCall, token: string): GuardRequest {
  return {
    network: `eip155:${call.intent.chainId}`,
    payload: { type: "intent", tx: call.tx, intent: call.intent },
    token: getAddress(token),
    checks: ["quote", "simulation", "token_risk"],
  };
}

export function safeTxBuilderJson(p: {
  chainId: number;
  safe: string;
  name: string;
  description: string;
  calls: SafeCall[];
  createdAt?: number;
}): SafeTxBuilderFile {
  return {
    version: "1.0",
    chainId: String(p.chainId),
    createdAt: p.createdAt ?? Date.now(),
    meta: {
      name: p.name,
      description: p.description,
      txBuilderVersion: "1.18.0",
      createdFromSafeAddress: getAddress(p.safe),
      createdFromOwnerAddress: "",
      checksum: "",
    },
    transactions: p.calls.map((c) => ({
      to: getAddress(c.to),
      value: c.value.toString(),
      data: c.data,
      contractMethod: null,
      contractInputsValues: null,
    })),
  };
}

// ---------------------------------------------------------------- planners (read + dry-run, never send)

async function read<T>(reader: TokenChainReader, address: Address, abi: readonly unknown[], functionName: string, args?: readonly unknown[]): Promise<T> {
  return (await reader.readContract({ address, abi, functionName, args })) as T;
}

/** eth_call from the Safe. If the Safe holds less than `value` the dry-run tops up its balance (reported). */
async function dryRun(reader: TokenChainReader, safe: Address, to: Address, data: Hex, value: bigint) {
  const balance = await reader.getBalance({ address: safe });
  const topUp = balance < value;
  let res: { data?: Hex };
  try {
    res = await reader.call({
      account: safe,
      to,
      data,
      value,
      ...(topUp ? { stateOverride: [{ address: safe, balance: value }] } : {}),
    });
  } catch (cause) {
    const why = cause instanceof Error ? (cause as { shortMessage?: string }).shortMessage ?? cause.message : String(cause);
    throw new Error(`Dry-run reverted (${why}). No batch file was written.`);
  }
  return { result: res.data ?? "0x", safeBalance: balance, fundingNeeded: topUp ? value - balance : 0n };
}

export interface LaunchPlan {
  chainId: number;
  factory: Address;
  safe: Address;
  call: SafeCall;
  /** Addresses the dry-run returned (V2). The real ones come from the TokenLaunched event of the mined tx. */
  dryRunToken: Address | null;
  dryRunCurve: Address | null;
  launchFee: bigint;
  safeBalance: bigint;
  fundingNeeded: bigint;
  details: Record<string, string>;
  safeFile: SafeTxBuilderFile;
}

export async function planLaunch(p: {
  chainId: number;
  reader: TokenChainReader;
  safe?: string;
  cfg?: TokenConfig;
  saltNonce?: number;
  launchConfigId?: bigint;
  /** Testnet only: override the metadata URI (default `ipfs://<CIDv1 of the built metadata>`). */
  metadataUri?: string;
  createdAt?: number;
}): Promise<LaunchPlan> {
  const safe = getAddress(p.safe ?? ZGUARD_OPS_SAFE);
  const cfg = p.cfg ?? defaultTokenConfig();
  const r = p.reader;

  if (p.chainId === MAINNET_CHAIN_ID) {
    const factory = getAddress(PONS_V2_CONTRACTS.factory);
    const configId = p.launchConfigId ?? 0n;
    const [enabled, can, fee, maxTax, config, economics] = await Promise.all([
      read<boolean>(r, factory, PONS_V2_FACTORY_ABI, "launchEnabled"),
      read<boolean>(r, factory, PONS_V2_FACTORY_ABI, "canLaunch", [safe]),
      read<bigint>(r, factory, PONS_V2_FACTORY_ABI, "launchFee"),
      read<bigint>(r, factory, PONS_V2_FACTORY_ABI, "maxCreatorTaxBps"),
      read<{ supply: bigint; graduationThreshold: bigint; enabled: boolean }>(r, factory, PONS_V2_FACTORY_ABI, "getLaunchConfig", [configId]),
      read<Hex>(r, factory, PONS_V2_FACTORY_ABI, "previewLaunchEconomics", [configId, zeroAddress]),
    ]);
    if (!enabled) throw new Error("pons V2 launches are disabled (launchEnabled = false)");
    if (!can) throw new Error(`pons V2 canLaunch(${safe}) = false`);
    if (!config.enabled) throw new Error(`pons V2 launch config ${configId} is disabled`);
    validateTokenConfig(cfg, maxTax);
    const salt = launchSalt(p.chainId, safe, p.saltNonce ?? 0);
    const data = encodeV2Launch({ cfg, creatorFeeRecipient: safe, expectedEconomics: economics, salt, launchConfigId: configId });
    const dr = await dryRun(r, safe, factory, data, fee);
    const [token, curve] = decodeFunctionResult({ abi: PONS_V2_FACTORY_ABI, functionName: "launchToken", data: dr.result as Hex }) as readonly [Address, Address];
    const call = { to: factory, value: fee, data };
    return {
      chainId: p.chainId,
      factory,
      safe,
      call,
      dryRunToken: getAddress(token),
      dryRunCurve: getAddress(curve),
      launchFee: fee,
      safeBalance: dr.safeBalance,
      fundingNeeded: dr.fundingNeeded,
      details: {
        factory: `PonsV2LaunchFactory ${factory}`,
        launchConfigId: String(configId),
        supply: config.supply.toString(),
        graduationThreshold: `${config.graduationThreshold} wei ETH`,
        expectedEconomics: economics,
        salt,
        creatorFeeRecipient: safe,
        creatorTaxBps: String(cfg.creatorTaxBps),
        buybackEnabled: String(cfg.buybackEnabled),
      },
      safeFile: safeTxBuilderJson({
        chainId: p.chainId,
        safe,
        name: `Launch ${cfg.name} (${cfg.symbol}) on pons V2`,
        description: `launchToken from the Safe: deployer + creator fee recipient = Safe, tax ${cfg.creatorTaxBps} bps, pons buyback ${cfg.buybackEnabled}, fee ${fee} wei. Dry-run token ${token}.`,
        calls: [call],
        createdAt: p.createdAt,
      }),
    };
  }

  if (p.chainId === TESTNET_CHAIN_ID) {
    validateTokenConfig(cfg);
    const factory = getAddress(PONS_TESTNET_CONTRACTS.factoryV1);
    const built = buildLaunchMetadata({ chainId: p.chainId, creator: safe, cfg, image: { ...ZGUARD_LOGO_IMAGE, uri: cfg.logo } });
    const uri = p.metadataUri ?? `ipfs://${cidV1Raw(built.json)}`;
    // The testnet launchpad reverts on any other scheme (checked with eth_call: https:// reverts, ipfs:// passes).
    if (!uri.startsWith("ipfs://")) throw new Error("testnet launchpad metadata URI must be ipfs://");
    const [fee, schema, maxUri] = await Promise.all([
      read<bigint>(r, factory, TESTNET_LAUNCH_FACTORY_ABI, "LAUNCH_FEE"),
      read<number>(r, factory, TESTNET_LAUNCH_FACTORY_ABI, "METADATA_SCHEMA_VERSION"),
      read<bigint>(r, factory, TESTNET_LAUNCH_FACTORY_ABI, "MAX_METADATA_URI_LENGTH"),
    ]);
    if (Number(schema) !== 1) throw new Error(`testnet launchpad metadata schema is ${schema}, this planner writes schema 1`);
    if (BigInt(uri.length) > maxUri) throw new Error(`metadata URI is ${uri.length} chars, factory max ${maxUri}`);
    const data = encodeTestnetLaunch({ cfg, metadataUri: uri, digest: built.digest, creatorFeeRecipient: safe });
    const dr = await dryRun(r, safe, factory, data, fee);
    const [token, curve] =
      dr.result.length === 2 + 128
        ? [getAddress(`0x${dr.result.slice(26, 66)}`), getAddress(`0x${dr.result.slice(90, 130)}`)]
        : [null, null];
    const call = { to: factory, value: fee, data };
    return {
      chainId: p.chainId,
      factory,
      safe,
      call,
      dryRunToken: token,
      dryRunCurve: curve,
      launchFee: fee,
      safeBalance: dr.safeBalance,
      fundingNeeded: dr.fundingNeeded,
      details: {
        factory: `testnet launchpad ${factory}`,
        metadataURI: uri,
        metadataDigest: built.digest,
        metadataJson: built.json,
        creatorFeeRecipient: safe,
        note: "testnet rehearsal: transfers stay locked until graduation, so no buyback-and-burn here",
      },
      safeFile: safeTxBuilderJson({
        chainId: p.chainId,
        safe,
        name: `Launch ${cfg.name} (${cfg.symbol}) on the testnet launchpad`,
        description: `createToken from the Safe, metadata ${uri} (keccak ${built.digest}), fee ${fee} wei, no initial buy.`,
        calls: [call],
        createdAt: p.createdAt,
      }),
    };
  }

  throw new Error(`chain ${p.chainId} is not supported (4663 or 46630)`);
}

export class TokenGuardUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenGuardUnavailableError";
  }
}

export interface BuybackPlan {
  token: Address;
  curve: Address;
  quoteIn: bigint;
  tokensOut: bigint;
  minTokensOut: bigint;
  call: GuardedCall;
  receipt: GuardResponse;
  safeBalance: bigint;
  fundingNeeded: bigint;
  safeFile: SafeTxBuilderFile;
}

/**
 * Buyback-and-burn batch for the Safe. Fail-closed: mode `off`, a missing evaluator, an unreachable API,
 * deny, abstain, an expired allow or an allow for other bytes all end without a batch file.
 */
export async function planBuyback(p: {
  chainId: number;
  reader: TokenChainReader;
  token: string;
  quoteIn: bigint;
  safe?: string;
  slippageBps?: number;
  mode?: "enforce" | "off";
  evaluate?: (req: GuardRequest) => Promise<GuardResponse>;
  nowMs?: number;
  createdAt?: number;
}): Promise<BuybackPlan> {
  if (p.mode === "off") throw new GuardDisabledError("ZGuard buyback planner");
  if (p.chainId !== MAINNET_CHAIN_ID) {
    throw new Error("buyback-and-burn exists only on pons V2 (4663): testnet curves have no recipient and lock transfers");
  }
  if (!p.evaluate) throw new TokenGuardUnavailableError("ZGUARD_API_KEY is not set. No buyback batch without a ZGuard allow.");
  const r = p.reader;
  const safe = getAddress(p.safe ?? ZGUARD_OPS_SAFE);
  const token = getAddress(p.token);
  const factory = getAddress(PONS_V2_CONTRACTS.factory);

  const launched = await read<{ token: Address; curve: Address; pairToken: Address; exists: boolean }>(
    r, factory, PONS_V2_FACTORY_ABI, "getLaunchedToken", [token]
  );
  if (!launched.exists) throw new Error(`${token} is not a pons V2 launch`);
  if (getAddress(launched.pairToken) !== zeroAddress) throw new Error(`${token} is not paired with native ETH`);
  const curve = getAddress(launched.curve);
  const [curveToken, curveFactory, graduated, native, snipe] = await Promise.all([
    read<Address>(r, curve, PONS_V2_CURVE_ABI, "token"),
    read<Address>(r, curve, PONS_V2_CURVE_ABI, "factory"),
    read<boolean>(r, curve, PONS_V2_CURVE_ABI, "graduated"),
    read<boolean>(r, curve, PONS_V2_CURVE_ABI, "isNativeQuote"),
    read<bigint>(r, curve, PONS_V2_CURVE_ABI, "currentSnipeTaxBps", [safe]),
  ]);
  if (getAddress(curveToken) !== token) throw new Error(`curve ${curve} belongs to ${curveToken}, not ${token}`);
  if (getAddress(curveFactory) !== factory) throw new Error(`curve ${curve} was not created by the pons V2 factory`);
  if (graduated) throw new Error(`${token} has graduated: the Uniswap v4 buyback route is Phase 2, not built`);
  if (!native) throw new Error(`curve ${curve} does not take native ETH`);
  if (snipe > 0n) throw new Error(`snipe tax is still ${snipe} bps for the Safe; wait and plan again`);

  const probe = encodeFunctionData({ abi: PONS_V2_CURVE_ABI, functionName: "buy", args: [p.quoteIn, 0n, BURN_ADDRESS] });
  const dr = await dryRun(r, safe, curve, probe, p.quoteIn);
  const tokensOut = decodeFunctionResult({ abi: PONS_V2_CURVE_ABI, functionName: "buy", data: dr.result as Hex }) as bigint;
  if (tokensOut <= 0n) throw new Error("dry-run bought 0 tokens");
  const minTokensOut = minOutWithSlippage(tokensOut, p.slippageBps ?? 300);
  const call = buildV2BuybackBurn({ chainId: p.chainId, curve, token, safe, quoteIn: p.quoteIn, minTokensOut });

  const req = buybackGuardRequest(call, token);
  const local = evaluateQuoteMatch({ network: req.network, payload: req.payload });
  if (local.decision !== "allow") {
    throw new Error(`local quote-match ${local.decision} [${local.codes.join(",")}]: the batch bytes do not match the intent`);
  }
  let receipt: GuardResponse;
  try {
    receipt = await p.evaluate(req);
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    throw new TokenGuardUnavailableError(`ZGuard could not be reached (${why}). No batch file was written.`);
  }
  // Same rule as the signer: allow, unexpired, bound to these exact bytes. Throws GuardBlockedError otherwise.
  verifyReceiptForSigning({ network: req.network, payload: req.payload, token: req.token }, receipt, { nowMs: p.nowMs });

  return {
    token,
    curve,
    quoteIn: p.quoteIn,
    tokensOut,
    minTokensOut,
    call,
    receipt,
    safeBalance: dr.safeBalance,
    fundingNeeded: dr.fundingNeeded,
    safeFile: safeTxBuilderJson({
      chainId: p.chainId,
      safe,
      name: `ZGUARD buyback-and-burn ${p.quoteIn} wei`,
      description: `curve.buy(${p.quoteIn}, ${minTokensOut}, ${BURN_ADDRESS}) on ${curve}. ZGuard ${receipt.decision} ${receipt.decisionId ?? ""} payload ${receipt.payload_hash}.`,
      calls: [{ to: curve, value: p.quoteIn, data: call.tx.data as Hex }],
      createdAt: p.createdAt,
    }),
  };
}

export interface TokenStatus {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  graduated: boolean;
  totalSupply: bigint;
  burned: bigint;
  ownedBySafe: boolean;
}

/** Post-launch check: the token is a pons V2 launch whose deployer and fee recipient are the Safe. */
export async function tokenStatus(p: { reader: TokenChainReader; token: string; safe?: string }): Promise<TokenStatus> {
  const r = p.reader;
  const safe = getAddress(p.safe ?? ZGUARD_OPS_SAFE);
  const token = getAddress(p.token);
  const factory = getAddress(PONS_V2_CONTRACTS.factory);
  const l = await read<{
    curve: Address; deployer: Address; creatorFeeRecipient: Address; creatorTaxBps: number; buybackEnabled: boolean; exists: boolean;
  }>(r, factory, PONS_V2_FACTORY_ABI, "getLaunchedToken", [token]);
  if (!l.exists) throw new Error(`${token} is not a pons V2 launch`);
  const curve = getAddress(l.curve);
  const [graduated, totalSupply, burned] = await Promise.all([
    read<boolean>(r, curve, PONS_V2_CURVE_ABI, "graduated"),
    read<bigint>(r, token, ERC20_BALANCE_ABI, "totalSupply"),
    read<bigint>(r, token, ERC20_BALANCE_ABI, "balanceOf", [BURN_ADDRESS]),
  ]);
  return {
    token,
    curve,
    deployer: getAddress(l.deployer),
    creatorFeeRecipient: getAddress(l.creatorFeeRecipient),
    creatorTaxBps: Number(l.creatorTaxBps),
    buybackEnabled: l.buybackEnabled,
    graduated,
    totalSupply,
    burned,
    ownedBySafe: getAddress(l.deployer) === safe && getAddress(l.creatorFeeRecipient) === safe,
  };
}
