import { app } from "./app";
import { env } from "./env";

// Bun picks up the default export and serves it.
export default {
  port: env.port,
  fetch: app.fetch,
  idleTimeout: 60,
};

console.log(
  JSON.stringify({
    level: "info",
    message: "kochen_started",
    port: env.port,
    production: env.production,
    devAuth: env.devAuth,
  }),
);
