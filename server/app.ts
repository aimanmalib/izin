// HTTP surface: the check API under /api/, MCP at /mcp and the web app (web/dist) for every page.
import Fastify, { type FastifyInstance } from "fastify";
import type { FacilitatorClient } from "@x402/core/server";
import { BENCH_DIR, FIXTURES_DIR, WEB_DIST, type IzinConfig } from "./config.js";
import { makeClientIp, type ClientIp } from "./api/clientip.js";
import { paidPayTo, paidTexts, registerPaid } from "./api/paid.js";
import { registerApi } from "./api/routes.js";
import { benchView, dolphinShare, galleryView } from "./api/views.js";
import { readingCost, receiptCostNow, repricingOf } from "./belanja/kos.js";
import { loadBenchConfig } from "./bench/variants.js";
import { mcpTexts, registerMcp } from "./mcp/server.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { loadExamples, siteView } from "./web/site.js";
import { registerStatic } from "./web/static.js";

export const VERSION = "0.1.0";

export interface AppOpts {
  clientIp?: ClientIp;
  /** Folder of the built web app; defaults to web/dist. */
  webDir?: string;
  examplesPath?: string;
  /** Environment the paid route reads its receiving address from; defaults to the process environment. */
  env?: NodeJS.ProcessEnv;
  /** Stand-in for the x402 facilitator in tests. */
  facilitator?: FacilitatorClient;
}

export function buildApp(config: IzinConfig, rt: Runtime = createRuntime(config), opts: AppOpts = {}): FastifyInstance {
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
  // The paid route exists only when config enables it and the environment names a receiving address.
  const payTo = paidPayTo(config, opts.env);
  if (payTo) {
    registerPaid(app, { cfg: config, service: rt.service, payTo, texts: paidTexts(), ...(opts.facilitator ? { facilitator: opts.facilitator } : {}) });
  }
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
    gallery: () => galleryView(rt.db, config.baseline.restricting_stances),
    bench: () => benchView(BENCH_DIR, galleryView(rt.db, config.baseline.restricting_stances).baseline, readingCost(rt.db, config), repricingOf(config, loadBenchConfig())),
    costNow: (r) => receiptCostNow(config, r),
  });
  // Read on each request so a new receipt id in config/examples.json needs no code change.
  app.get("/api/site", async () => siteView(config, rt.db, loadExamples(opts.examplesPath), payTo !== null));
  registerStatic(app, opts.webDir ?? WEB_DIST, {
    receipt: (id) => {
      const r = rt.service.result(id);
      return r?.status === "done" ? r.receipt : null;
    },
    trapDir: `${FIXTURES_DIR}trap/`,
  });
  registerMcp(app, { cfg: config, service: rt.service, texts: mcpTexts(), clientIp, version: VERSION });

  return app;
}
