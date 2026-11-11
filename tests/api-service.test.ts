// The HTTP API end to end against local synthetic sites with the offline reader and decider:
// 202 then a stored receipt, the 24-hour cache, rate limits, spending caps (H7 with a fake
// clock), no re-fetch of a site that forbade all automation, and health.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app.js";
import { parseConfig, type IzinConfig } from "../server/config.js";
import type { AlertKind } from "../server/belanja/alerts.js";
import { createRuntime, type Runtime, type RuntimeOpts } from "../server/runtime.js";
import { page, policyText, startSites, testConfig, type Running } from "./helpers/sites.js";

let s: Running | null = null;
let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  await s?.close();
  app = s = null;
});

const strict =
  "# NOTICE: The use of robots, spiders or other automated means to access this site without express written permission\n" +
  "# is strictly prohibited. Requests from unidentified clients may be refused. Contact the site team to ask for permission\n" +
  "# before you run any tool against these pages.";

async function setup(opts: { cfg?: IzinConfig; clock?: { t: number }; run?: RuntimeOpts["run"] } = {}) {
  const cfg = opts.cfg ?? testConfig();
  s = await startSites((u) => ({
    "shop.example": {
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
      "/": { body: page("<h1>Shop</h1>", `<a href="${u("shop.example", "/terms")}">Terms of Service</a>`) },
      "/terms": { body: page(`<h1>Terms</h1><p>${policyText("automated access")}</p>`) },
    },
    "other.example": {
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
      "/": { body: page("<h1>Other</h1>") },
    },
    "strict.example": {
      "/robots.txt": { type: "text/plain", body: `${strict}\nUser-agent: *\nAllow: /\n` },
      "/": { body: page("<h1>Strict</h1>") },
    },
  }));
  const alerts: AlertKind[] = [];
  const clock = opts.clock;
  const rt: Runtime = createRuntime(cfg, {
    env: { IZIN_FAKE: "1" },
    policy: s.policy,
    alert: async (k) => (alerts.push(k), true),
    ...(clock ? { now: () => new Date(clock.t) } : {}),
    ...(opts.run ? { run: opts.run } : {}),
  });
  rt.pipeline.sleep = async () => {};
  app = buildApp(cfg, rt);
  const post = (body: Record<string, unknown>, ip = "198.51.100.1") =>
    app!.inject({ method: "POST", url: "/api/check", payload: body, headers: { "x-forwarded-for": ip } });
  const done = async (id: string) => {
    await rt.service.queue.wait(id, 10_000);
    return (await app!.inject({ method: "GET", url: `/api/receipt/${id}` })).json();
  };
  return { cfg, rt, alerts, post, done, url: s.url };
}

describe("POST /api/check and GET /api/receipt/:id", () => {
  it("queues a check, then serves the stored receipt; every API answer is no-store", async () => {
    const { post, done, url } = await setup();
    const res = await post({ url: url("shop.example", "/"), action: "crawl" });
    expect(res.statusCode).toBe(202);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { id, status, cached } = res.json();
    expect({ status, cached }).toEqual({ status: "queued", cached: false });
    const out = await done(id);
    expect(out.status).toBe("done");
    expect(out.receipt).toMatchObject({ id, action: "crawl", verdict: "NO_GO" });
    expect(out.receipt.receipt_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers 400 for bad input and private addresses, 404 for an unknown id", async () => {
    const { post } = await setup();
    expect((await post({ url: "http://169.254.169.254/", action: "crawl" })).json()).toEqual({ error: "url_not_allowed" });
    expect((await post({ url: "https://shop.example/", action: "steal" })).statusCode).toBe(400);
    const nf = await app!.inject({ method: "GET", url: "/api/receipt/zzzzzzzzzz" });
    expect(nf.statusCode).toBe(404);
    expect(nf.headers["cache-control"]).toBe("no-store");
  });

  it("stores the detail with email and phone removed", async () => {
    const { post, done, url } = await setup();
    const { id } = (await post({ url: url("shop.example", "/"), action: "purchase", detail: "Buy one mug for me@example.org" })).json();
    expect((await done(id)).receipt.detail).toBe("Buy one mug for [email]");
  });
});

describe("cache", () => {
  it("returns the same id within 24 hours for the same origin and action, not after (H7)", async () => {
    const clock = { t: Date.parse("2026-11-11T01:00:00Z") };
    const { post, done, url } = await setup({ clock });
    const first = (await post({ url: url("shop.example", "/"), action: "crawl" })).json();
    await done(first.id);
    const again = (await post({ url: url("shop.example", "/other-page"), action: "crawl" })).json();
    expect(again).toMatchObject({ id: first.id, cached: true, status: "done" });
    expect((await post({ url: url("shop.example", "/"), action: "read_page" })).json().cached).toBe(false);
    expect((await post({ url: url("shop.example", "/"), action: "crawl", detail: "only the price list" })).json().cached).toBe(false);
    clock.t += 24 * 3_600_000 + 1000;
    const later = (await post({ url: url("shop.example", "/"), action: "crawl" }, "198.51.100.2")).json();
    expect(later.cached).toBe(false);
    expect(later.id).not.toBe(first.id);
  });
});

describe("rate limits", () => {
  it("allows 6 new checks an hour per address, then 429 with Retry-After; cache hits are not limited", async () => {
    const { cfg, post, url } = await setup();
    const n = cfg.limits.rate_new_checks_per_ip_hour;
    for (let i = 0; i < n; i++) expect((await post({ url: url("shop.example", "/"), action: "crawl", detail: `run ${i}` })).statusCode).toBe(202);
    const blocked = await post({ url: url("shop.example", "/"), action: "crawl", detail: "one more" });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(blocked.json()).toMatchObject({ error: "rate_limited", scope: "ip" });
    expect((await post({ url: url("shop.example", "/"), action: "crawl", detail: "other client" }, "198.51.100.9")).statusCode).toBe(202);
  });

  it("stops new checks at the daily global limit until the next UTC day (H7)", async () => {
    const clock = { t: Date.parse("2026-11-11T22:00:00Z") };
    const { post, url } = await setup({ cfg: testConfig({ rate_new_checks_per_day: 2 }), clock });
    expect((await post({ url: url("shop.example", "/"), action: "crawl" }, "198.51.100.1")).statusCode).toBe(202);
    expect((await post({ url: url("shop.example", "/"), action: "post" }, "198.51.100.2")).statusCode).toBe(202);
    const third = await post({ url: url("shop.example", "/"), action: "train" }, "198.51.100.3");
    expect(third.statusCode).toBe(429);
    expect(third.headers["retry-after"]).toBe(String(2 * 3600));
    clock.t += 2 * 3_600_000;
    expect((await post({ url: url("shop.example", "/"), action: "train" }, "198.51.100.3")).statusCode).toBe(202);
  });
});

describe("spending caps", () => {
  const capped = () => {
    const base = testConfig();
    return parseConfig({ ...base, budget: { ...base.budget, serv_usd_per_day: 0.01, dolphin_usd_per_day: 0.01 } });
  };

  it("past the daily cap: 503 with a recent receipt id, one alert a day, open again the next UTC day (H7)", async () => {
    const clock = { t: Date.parse("2026-11-11T10:00:00Z") };
    const { rt, post, done, alerts, url } = await setup({ cfg: capped(), clock });
    const first = (await post({ url: url("shop.example", "/"), action: "crawl" })).json();
    await done(first.id);
    rt.guard.record({ serv_usd: 0.02, dolphin_usd: 0 });
    const res = await post({ url: url("shop.example", "/"), action: "crawl", detail: "again" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "budget_exhausted", cached_id: first.id });
    expect((await post({ url: url("other.example", "/"), action: "crawl" })).json()).toEqual({ error: "budget_exhausted" });
    expect(alerts).toEqual(["budget_cap_day", "budget_cap_day"]); // the alert itself sends once a day (alerts.ts)
    expect((await app!.inject({ method: "GET", url: "/api/health" })).json().cache_only).toBe(true);
    clock.t += 86_400_000;
    expect((await post({ url: url("shop.example", "/"), action: "crawl", detail: "next day" })).statusCode).toBe(202);
  });

  it("the total cap holds across days and build scripts skip only the daily cap", async () => {
    const { rt } = await setup({ cfg: capped() });
    rt.guard.record({ serv_usd: 0.02, dolphin_usd: 0 });
    expect(await rt.guard.exhausted("api")).toBe(true);
    expect(await rt.guard.exhausted("bench")).toBe(false);
    rt.guard.record({ serv_usd: 5, dolphin_usd: 0 });
    expect(await rt.guard.exhausted("bench")).toBe(true);
    expect(rt.guard.leftPct()).toBe(0);
  });

  it("records what each check cost", async () => {
    const { rt, post, done, url } = await setup();
    const before = rt.guard.state().day.new_checks;
    await done((await post({ url: url("shop.example", "/"), action: "crawl" })).json().id);
    expect(rt.guard.state().day.new_checks).toBe(before + 1);
  });
});

describe("no re-fetch of a site that forbade all automation", () => {
  it("reuses the stop receipt for any action for N days, then checks again (H7)", async () => {
    const clock = { t: Date.parse("2026-11-11T01:00:00Z") };
    const { cfg, post, done, url, alerts } = await setup({ clock });
    const first = (await post({ url: url("strict.example", "/"), action: "read_page" })).json();
    const r = (await done(first.id)).receipt;
    expect(r.signals.robots_stop.by).toBe("comment");
    const hits = s!.hits.length;
    const other = (await post({ url: url("strict.example", "/"), action: "post", detail: "a review" })).json();
    expect(other).toEqual({ id: first.id, status: "done", cached: true, no_refetch: true });
    expect(s!.hits.length).toBe(hits);
    clock.t += cfg.limits.no_refetch_blocked_days * 86_400_000 + 1000;
    expect((await post({ url: url("strict.example", "/"), action: "post" })).json().cached).toBe(false);
    expect(alerts).toEqual([]);
  });
});

describe("GET /api/health, /api/gallery, /api/bench", () => {
  it("reports reader, decider, budget left and the Dolphin share", async () => {
    const { cfg } = await setup();
    const h = (await app!.inject({ method: "GET", url: "/api/health" })).json();
    expect(h).toMatchObject({ ok: true, decider: `serv:${cfg.decider.model}`, reader: `dolphin:${cfg.reader.primary.model}`, budget_left_pct: 100, cache_only: false });
    expect(h.dolphin_share).toBeNull();
  });

  it("lists the gallery sites and the sites that blocked the reader", async () => {
    await setup();
    const g = await app!.inject({ method: "GET", url: "/api/gallery" });
    expect(g.headers["cache-control"]).toBe("no-store");
    const body = g.json();
    expect(body.sites.length).toBeGreaterThan(0);
    expect(body.sites[0]).toMatchObject({ host: expect.any(String), checks: {} });
    expect(body.blocked_reader[0]).toMatchObject({ host: expect.any(String), reason: expect.any(String) });
    const b = (await app!.inject({ method: "GET", url: "/api/bench" })).json();
    expect(b.readability.user_agent).toMatch(/^IzinBot\//);
    expect(b).toHaveProperty("reading_cost", null);
  });
});
