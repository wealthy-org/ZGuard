// Vercel serverless entry for the Perm remote quote signer. Deploy services/quote-signer as its OWN
// Vercel project (Root Directory = services/quote-signer), separate from the web app, so the signing
// key never shares a runtime or env scope with the site. URL to configure in the web app:
//   PERM_QUOTE_SIGNER_URL=https://<signer-project>.vercel.app/api/sign
import { MAX_BODY_BYTES, handleSignRequest, loadConfig } from "../signer-core.mjs";

let config;

export default async function handler(request, response) {
  try {
    config ??= loadConfig();
  } catch (cause) {
    console.error(JSON.stringify({ event: "config-error", message: cause instanceof Error ? cause.message : String(cause) }));
    return response.status(503).json({ error: "signer not configured" });
  }
  response.setHeader("cache-control", "no-store");
  if (request.method === "GET") return response.status(200).json({ ok: true, address: config.account.address, chainId: config.chainId, router: config.router });
  if (request.method !== "POST") return response.status(405).json({ error: "method not allowed" });

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return response.status(413).json({ error: "body too large" });
    chunks.push(chunk);
  }
  const result = await handleSignRequest({
    authorization: request.headers.authorization,
    contentType: request.headers["content-type"],
    bodyText: Buffer.concat(chunks).toString("utf8"),
    config,
  });
  if (result.audit) console.log(JSON.stringify({ event: "signed", ...result.audit }));
  else console.warn(JSON.stringify({ event: "rejected", status: result.status, error: result.body.error }));
  return response.status(result.status).json(result.body);
}
// Note: the raw body is streamed and bounded above. Vercel's Node helpers parse `request.body`
// lazily on access only, so they never touch the stream here.
