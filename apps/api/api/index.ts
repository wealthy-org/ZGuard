/**
 * Vercel Serverless Function entry point for @zguard/api (Hono).
 *
 * Vercel only treats files inside the `api/` directory (project root) as
 * serverless functions, so this thin re-export wires the Hono app from
 * `src/vercel.ts` into Vercel's routing. All routes (/v1/*, /health)
 * are forwarded here via the catch-all rewrite in vercel.json.
 */
import app from "../src/vercel.js";

export default app;
