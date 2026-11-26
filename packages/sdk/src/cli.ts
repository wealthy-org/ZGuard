#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ZGuardClient, guardOffline } from "./client.js";
import { NETWORK_RHC_TESTNET } from "./constants.js";
import { scanContent } from "./content-scan.js";
import type { GuardRequest } from "./types.js";

function printHelp(): void {
  console.log(`ZGuard CLI — Scanner & Guard Layer for Robinhood Chain (Testnet 46630 / Mainnet 4663)

Usage:
  zguard verify <request.json>                  Run offline quote-match locally (no API key, no RPC)
  zguard check-text "<text>"                    Scan untrusted text/metadata with shape & Unicode rules
  zguard guard <request.json>                   Call POST /v1/guard on ZGUARD_API_URL
  zguard token-risk <0xAddress> [network]       Call POST /v1/token-risk (default: eip155:46630)
  zguard register                               Create tenant API key via POST /v1/register
  zguard balance                                Check remaining USDG micro-credit via GET /v1/balance
`);
}

function parseJsonArg(arg: string): GuardRequest {
  const trimmed = arg.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as GuardRequest;
  }
  const raw = trimmed === "-" ? readFileSync(0, "utf8") : readFileSync(trimmed, "utf8");
  return JSON.parse(raw) as GuardRequest;
}

async function main(): Promise<void> {
  const [, , cmd, arg, extra] = process.argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    process.exit(0);
  }

  if (cmd === "verify") {
    if (!arg) throw new Error("Missing <request.json> path or inline JSON");
    const req = parseJsonArg(arg);
    const out = guardOffline({ ...req, checks: ["quote"] });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.decision === "allow" ? 0 : 1);
  }

  if (cmd === "check-text") {
    if (!arg) throw new Error("Missing text argument");
    const out = scanContent({ text: arg });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.decision === "allow" ? 0 : 1);
  }

  const client = new ZGuardClient();

  if (cmd === "register") {
    const out = await client.register();
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === "balance") {
    const out = await client.balance();
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === "guard") {
    if (!arg) throw new Error("Missing <request.json> path or inline JSON");
    const req = parseJsonArg(arg);
    const out = await client.guard(req);
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.decision === "allow" ? 0 : 1);
  }

  if (cmd === "token-risk") {
    if (!arg) throw new Error("Missing <0xAddress>");
    const network = extra || process.env.ZGUARD_NETWORK || NETWORK_RHC_TESTNET;
    const out = await client.tokenRisk(arg, network);
    console.log(JSON.stringify(out, null, 2));
    // CLI-1: exit status follows the verdict like `verify`/`guard`, so `zguard token-risk X && buy` can
    // never proceed on deny/abstain.
    process.exit(out.decision === "allow" ? 0 : 1);
  }

  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(`[zguard] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
