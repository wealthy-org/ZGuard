import { serve } from "@hono/node-server";
import { createZGuardApp } from "./app.js";

const { app, config, store } = createZGuardApp();

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(
      `[ZGuard API] listening on http://${info.address}:${info.port} (chain=4663, storage=${store.driver})`
    );
  }
);
