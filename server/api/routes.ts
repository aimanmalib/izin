import { createHash, timingSafeEqual } from "node:crypto";
// HTTP API. Every /api/ answer carries Cache-Control: no-store (set in app.ts).
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ClientIp } from "./clientip.js";
import type { Receipt } from "../resit/receipt.js";
import type { CheckService, SubmitResult } from "./service.js";

export interface HealthInfo {
  version: string;
  reader: () => string;
  decider: string;
  dolphinShare: () => number | null;
  budgetLeftPct: () => number;
}

export interface ApiDeps {
  service: CheckService;
  clientIp: ClientIp;
  /** The market agent's key and its hourly allowance; absent when no key is set in the environment. */
  market?: { key: string; perHour: number };
  health: HealthInfo;
  gallery: () => unknown;
  bench: () => unknown;
  /** The receipt's cost worked out now (see receiptCostNow); the stored receipt is sent unchanged beside it. */
  costNow: (r: Receipt) => number | null;
}

export const MARKET_KEY_HEADER = "x-izin-market-key";

function sameKey(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function sendSubmit(reply: FastifyReply, r: SubmitResult) {
  switch (r.kind) {
    case "accepted":
      return reply.code(202).send({ id: r.id, status: r.status, cached: r.cached, ...(r.no_refetch ? { no_refetch: true } : {}) });
    case "invalid":
      return reply.code(400).send({ error: r.code });
    case "rate_limited":
      return reply.code(429).header("retry-after", String(r.retry_after_s)).send({ error: "rate_limited", scope: r.scope, retry_after_s: r.retry_after_s });
    case "budget_exhausted":
      return reply.code(503).send({ error: "budget_exhausted", ...(r.cached_id ? { cached_id: r.cached_id } : {}) });
  }
}

export function registerApi(app: FastifyInstance, d: ApiDeps): void {
  app.post("/api/check", async (req, reply) => {
    // The agent behind the market listing calls from one address for every buyer, so it has its own allowance.
    const sent = req.headers[MARKET_KEY_HEADER];
    if (d.market && typeof sent === "string" && sameKey(sent, d.market.key)) {
      return sendSubmit(reply, await d.service.submit(req.body, "api", "market", d.market.perHour));
    }
    const r = await d.service.submit(req.body, "api", d.clientIp(req.socket.remoteAddress, req.headers));
    return sendSubmit(reply, r);
  });

  app.get<{ Params: { id: string } }>("/api/receipt/:id", async (req, reply) => {
    const r = d.service.result(req.params.id);
    if (!r) return reply.code(404).send({ error: "not_found" });
    return r.receipt ? { ...r, cost_usd_now: d.costNow(r.receipt) } : r;
  });

  app.get("/api/gallery", async () => d.gallery());
  app.get("/api/bench", async () => d.bench());

  app.get("/api/health", async () => ({
    ok: true,
    version: d.health.version,
    reader: d.health.reader(),
    decider: d.health.decider,
    dolphin_share: d.health.dolphinShare(),
    budget_left_pct: d.health.budgetLeftPct(),
    cache_only: await d.service.cacheOnly(),
  }));
}
