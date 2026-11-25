/**
 * Vercel Serverless Function entry for @zguard/api (Hono).
 *
 * Deploy the API as a separate Vercel project with Root Directory = `apps/api`.
 * All /v1/* routes and /health are served from this single entry point via Hono's app.fetch.
 *
 * Required env vars (Vercel Dashboard → Settings → Environment Variables):
 *   ZGUARD_ACTIVE_CHAIN_ID=46630          (testnet; mainnet is deferred — gap doc Bagian L)
 *   DATABASE_URL=postgresql://…neon.tech  (REQUIRED in production; no local JSON fallback)
 *   ZGUARD_X402_PAY_TO=0x…                (treasury that receives USDG)
 * Recommended:
 *   ZGUARD_X402_SETTLEMENT_MODE=deposit   (no relayer needed) or onchain + ZGUARD_X402_RELAYER_PRIVATE_KEY
 *   ZGUARD_ADMIN_API_KEY=<random ≥16 chars> (global ledger view)
 *   ZGUARD_CORS_ORIGINS=https://your-web.vercel.app (only if browsers call the API cross-origin)
 */
import { Hono } from "hono";
import { createZGuardApp } from "./app.js";

function buildApp(): Hono {
  try {
    return createZGuardApp().app;
  } catch (err) {
    // Misconfiguration (e.g. NODE_ENV=production without DATABASE_URL) must fail CLOSED and LOUD:
    // every route answers 503 with the reason instead of silently running on an ephemeral store.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ZGuard API] startup refused:", message);
    const failed = new Hono();
    failed.all("*", (c) =>
      c.json(
        {
          status: "misconfigured",
          decision: "abstain",
          codes: ["P-UNAVAIL"],
          error: message,
        },
        503
      )
    );
    return failed;
  }
}

const app = buildApp();

export default app;
export const config = { api: { bodySizeLimit: "2mb" } };
