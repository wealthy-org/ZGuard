import { misconfiguredResponse } from "../../lib/misconfigured";

// Only reached when next.config.mjs installed no /health rewrite (missing/self-referencing API URL).
export const dynamic = "force-dynamic";

export function GET() {
  return misconfiguredResponse();
}
