// HTTP surface: the check API under /api/ and MCP at /mcp. The web pages join later.
import Fastify, { type FastifyInstance } from "fastify";
import type { IzinConfig } from "./config.js";
import { makeClientIp, type ClientIp } from "./api/clientip.js";
import { registerApi } from "./api/routes.js";
import { benchView, dolphinShare, galleryView } from "./api/views.js";
import { mcpTexts, registerMcp } from "./mcp/server.js";
import { createRuntime, type Runtime } from "./runtime.js";

export const VERSION = "0.1.0";

export function buildApp(config: IzinConfig, rt: Runtime = createRuntime(config), opts: { clientIp?: ClientIp } = {}): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" },
    connectionTimeout: config.limits.server_timeout_s * 1000,
    requestTimeout: config.limits.server_timeout_s * 1000,
    bodyLimit: config.limits.terms_text_max_chars * 4 + 16_384,
  });

  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store");
  });

  const clientIp = opts.clientIp ?? makeClientIp(config);
  registerApi(app, {
    service: rt.service,
    clientIp,
    health: {
      version: VERSION,
      reader: () => rt.readerLabel,
      decider: `serv:${config.decider.model}`,
      dolphinShare: () => dolphinShare(rt.db),
      budgetLeftPct: () => rt.guard.leftPct(),
    },
    gallery: () => galleryView(rt.db),
    bench: () => benchView(),
  });
  registerMcp(app, { cfg: config, service: rt.service, texts: mcpTexts(), clientIp, version: VERSION });

  return app;
}
