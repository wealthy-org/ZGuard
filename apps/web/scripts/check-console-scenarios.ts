/**
 * Runs every Console scenario against a running ZGuard stack and compares the live decision with the
 * expected one shown in the UI (gap I9 rows 4–9).
 *
 *   ZGUARD_BASE_URL=http://127.0.0.1:3000 ../../node_modules/.bin/tsx scripts/check-console-scenarios.ts
 *
 * Registers a throwaway tenant (needs free dev credit) unless ZGUARD_API_KEY is set, and re-registers on
 * 402 like the Console does. Exits 1 on mismatch.
 */
import { buildScenarios } from "../src/views/ConsolePage";

const base = (process.env.ZGUARD_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const chainId = Number(process.env.ZGUARD_ACTIVE_CHAIN_ID ?? 46630) === 4663 ? 4663 : 46630;

(async () => {
  const register = async (): Promise<string> => {
    const r = await fetch(`${base}/v1/register`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const d = (await r.json()) as { apiKey?: string };
    if (!d.apiKey) throw new Error(`register failed: HTTP ${r.status}`);
    return d.apiKey;
  };
  let apiKey = process.env.ZGUARD_API_KEY ?? "";
  if (!apiKey) apiKey = await register();
  let failed = 0;
  for (const s of buildScenarios(chainId)) {
    const t0 = Date.now();
    const call = () =>
      fetch(`${base}/v1/guard`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(s.liveRequest),
      });
    let r = await call();
    if (r.status === 402) {
      // Free dev credit exhausted: re-register like the Console does (ensureTenantApiKey), retry once.
      apiKey = await register();
      r = await call();
    }
    const d = (await r.json()) as { decision?: string; codes?: string[]; checks?: { token_risk?: { kind?: string } } };
    const ok = r.status === 200 && d.decision === s.d;
    if (!ok) failed++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${s.id.padEnd(15)} expect=${s.d.padEnd(7)} got=${String(d.decision).padEnd(7)} ` +
        `http=${r.status} ${Date.now() - t0}ms codes=${JSON.stringify(d.codes ?? [])} kind=${d.checks?.token_risk?.kind ?? "-"}`
    );
  }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
