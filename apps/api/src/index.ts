import { serve } from "@hono/node-server";
import { getRhcChainProfile } from "@zguard/sdk";
import { createZGuardApp } from "./app.js";

const { app, config, store } = createZGuardApp();
const profile = getRhcChainProfile(config.activeChainId);

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(
      `[ZGuard API] listening on http://${info.address}:${info.port} (chain=${config.activeChainId} [${profile.name}], storage=${store.driver})`
    );
  }
);
