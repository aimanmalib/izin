// HTTP surface. Only the health route exists at this stage; the check API and MCP come later.
import Fastify, { type FastifyInstance } from "fastify";
import type { IzinConfig } from "./config.js";

export const VERSION = "0.1.0";

export function buildApp(config: IzinConfig): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" },
    connectionTimeout: config.limits.server_timeout_s * 1000,
    requestTimeout: config.limits.server_timeout_s * 1000,
  });

  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store");
  });

  app.get("/api/health", async () => ({ ok: true, version: VERSION }));

  return app;
}
