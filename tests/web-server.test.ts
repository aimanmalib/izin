// The web app served by the API process: page routes return index.html with no-transform,
// unknown pages 404 with the same HTML, hashed assets are cached, names cannot leave the folder,
// /r/<id>.json serves the stored receipt, and /api/site carries config and measured cost.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app.js";
import { createRuntime } from "../server/runtime.js";
import { costView, loadExamples } from "../server/web/site.js";
import { page, policyText, startSites, testConfig, type Running } from "./helpers/sites.js";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "izin-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
  writeFileSync(join(dir, "assets", "app-1a2b.js"), "console.log(1)");
  writeFileSync(join(dir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  writeFileSync(join(dir, "examples.json"), JSON.stringify({ examples: [{ key: "a", site: "https://a.example/", action: "purchase", receipt_id: "abcdefghij" }] }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let s: Running | null = null;
let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  await s?.close();
  app = s = null;
});

async function setup() {
  const cfg = testConfig();
  s = await startSites((u) => ({
    "shop.example": {
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
      "/": { body: page("<h1>Shop</h1>", `<a href="${u("shop.example", "/terms")}">Terms of Service</a>`) },
      "/terms": { body: page(`<h1>Terms</h1><p>${policyText("automated access")}</p>`) },
    },
  }));
  const rt = createRuntime(cfg, { env: { IZIN_FAKE: "1" }, policy: s.policy, alert: async () => true });
  rt.pipeline.sleep = async () => {};
  app = buildApp(cfg, rt, { webDir: dir, examplesPath: join(dir, "examples.json") });
  return { app, rt, url: s.url };
}

describe("web pages", () => {
  it("serves index.html for page routes with no-transform and a strict CSP", async () => {
    const { app } = await setup();
    for (const url of ["/", "/r/abcdefghij"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["cache-control"]).toContain("no-transform");
      expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
      expect(res.body).toContain('id=root');
    }
  });

  it("answers unknown pages with the app HTML and 404, unknown API paths with JSON 404", async () => {
    const { app } = await setup();
    const html = await app.inject({ method: "GET", url: "/no-such-page" });
    expect(html.statusCode).toBe(404);
    expect(html.headers["content-type"]).toContain("text/html");
    const api = await app.inject({ method: "GET", url: "/api/nothing" });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: "not_found" });
    expect((await app.inject({ method: "POST", url: "/no-such-page" })).statusCode).toBe(404);
  });

  it("caches hashed assets, serves known root files, refuses names outside the folder", async () => {
    const { app } = await setup();
    const js = await app.inject({ method: "GET", url: "/assets/app-1a2b.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("text/javascript");
    expect(js.headers["cache-control"]).toContain("immutable");
    expect((await app.inject({ method: "GET", url: "/favicon.svg" })).headers["content-type"]).toBe("image/svg+xml");
    for (const url of ["/assets/..%2Findex.html", "/assets/.hidden", "/assets/missing.js", "/assets/x.exe"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(404);
    }
  });

  it("says the web app is not built rather than serving nothing", async () => {
    const cfg = testConfig();
    app = buildApp(cfg, createRuntime(cfg, { env: { IZIN_FAKE: "1" } }), { webDir: join(dir, "missing") });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(503);
  });
});

describe("/r/<id>.json and /api/site", () => {
  it("serves a finished receipt as JSON, no-store, and 404 for unknown ids", async () => {
    const { app, rt, url } = await setup();
    const { id } = (await app.inject({ method: "POST", url: "/api/check", payload: { url: url("shop.example", "/"), action: "crawl" } })).json();
    await rt.service.queue.wait(id, 10_000);
    const res = await app.inject({ method: "GET", url: `/r/${id}.json` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toMatchObject({ id, action: "crawl" });
    expect(res.json().receipt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await app.inject({ method: "GET", url: "/r/zzzzzzzzzz.json" })).statusCode).toBe(404);
  });

  it("returns web settings, examples and the measured cost once a check reached the decider", async () => {
    const { app, rt, url } = await setup();
    const before = (await app.inject({ method: "GET", url: "/api/site" })).json();
    expect(before.cost).toBeNull();
    expect(before.examples).toEqual([{ key: "a", site: "https://a.example/", action: "purchase", receipt_id: "abcdefghij" }]);
    expect(before.action_order).toHaveLength(6);
    expect(before.tiers.free_checks_per_hour).toBe(testConfig().limits.rate_new_checks_per_ip_hour);
    const { id } = (await app.inject({ method: "POST", url: "/api/check", payload: { url: url("shop.example", "/"), action: "crawl" } })).json();
    await rt.service.queue.wait(id, 10_000);
    const cost = costView(rt.db, testConfig());
    expect(cost).toMatchObject({ checks: 1 });
    expect(typeof cost!.reader_usd).toBe("number");
    // The decider side is priced again with the factor in config, not the one stored on the receipt.
    const cfg = testConfig();
    const doubled = costView(rt.db, { ...cfg, budget: { ...cfg.budget, serv_cost_factor: cfg.budget.serv_cost_factor * 2 } });
    expect(cost!.decider_usd).toBeGreaterThan(0);
    expect(doubled!.decider_usd).toBeCloseTo(cost!.decider_usd * 2, 9);
    // A decision that produced no output (refused, empty credit) is left out of the average.
    rt.db.prepare("UPDATE checks SET receipt_json = json_set(receipt_json, '$.decider.tokens_out', 0)").run();
    expect(costView(rt.db, cfg)).toBeNull();
  });

  it("rejects an examples file that does not match its shape", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ examples: [{ key: "a", site: "nope", action: "fly", receipt_id: null }] }));
    expect(() => loadExamples(bad)).toThrow();
    expect(loadExamples(join(dir, "absent.json"))).toEqual([]);
  });

  it("reads the tracked examples file", () => {
    for (const e of loadExamples()) expect(e.site).toMatch(/^https:\/\//);
  });
});
