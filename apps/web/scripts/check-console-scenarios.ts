/**
 * Runs every Console scenario against a running ZGuard stack and compares the live decision with the
 * expected one shown in the UI (gap I9 rows 4–9).
 *
 *   ZGUARD_BASE_URL=http://127.0.0.1:3000 ../../node_modules/.bin/tsx scripts/check-console-scenarios.ts
 *
 * Registers a throwaway tenant (needs free dev credit) unless ZGUARD_API_KEY is set. Exits 1 on mismatch.
 */
import { buildScenarios } from "../src/views/ConsolePage";

const base = (process.env.ZGUARD_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const chainId = Number(process.env.ZGUARD_ACTIVE_CHAIN_ID ?? 46630) === 4663 ? 4663 : 46630;

(async () => {
  let apiKey = process.env.ZGUARD_API_KEY ?? "";
  if (!apiKey) {
    const r = await fetch(`${base}/v1/register`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const d = (await r.json()) as { apiKey?: string };
    if (!d.apiKey) throw new Error(`register failed: HTTP ${r.status}`);
    apiKey = d.apiKey;
  }
  let failed = 0;
  for (const s of buildScenarios(chainId)) {
    const t0 = Date.now();
    const r = await fetch(`${base}/v1/guard`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(s.liveRequest),
    });
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
