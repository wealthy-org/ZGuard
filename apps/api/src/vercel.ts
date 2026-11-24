/**
 * Vercel Serverless Function entry for @zguard/api (Hono).
 *
 * Deploy the API as a separate Vercel project with Root Directory = `apps/api`.
 * Vercel auto-detects this as a serverless function. All /v1/* routes and
 * /health are served from this single entry point via Hono's app.fetch.
 *
 * Required env vars (set in Vercel Dashboard → Settings → Environment Variables):
 *   ZGUARD_ACTIVE_CHAIN_ID=46630
 *   DATABASE_URL=...          (or empty for local-json fallback)
 *   ZGUARD_X402_PAY_TO=...
 *   ZGUARD_DEV_FREE_CREDIT_MICRO_USDG=...
 */
import { createZGuardApp } from "./app.js";

const { app } = createZGuardApp();

export default app;
export const config = { api: { bodySizeLimit: "2mb" } };
