import { misconfiguredResponse } from "../../../lib/misconfigured";

// Only reached when next.config.mjs installed no /v1 rewrite (missing/self-referencing API URL).
export const dynamic = "force-dynamic";

const handler = () => misconfiguredResponse();
export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as OPTIONS };
