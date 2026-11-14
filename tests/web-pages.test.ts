// The inner pages: each route serves the app HTML, the trap shop is served as its own plain HTML
// with a policy that keeps the hidden sentence hidden, /api/site carries the numbers the pages
// state from config, and benchmark results show only when the file has the expected shape.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { benchView } from "../server/api/views.js";
import { buildApp } from "../server/app.js";
import { FIXTURES_DIR, loadConfig } from "../server/config.js";
import { createRuntime } from "../server/runtime.js";
import { testConfig } from "./helpers/sites.js";

let dir = "";
let app: FastifyInstance | null = null;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "izin-pages-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title><div id=root></div>");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(async () => {
  await app?.close();
  app = null;
});

function setup() {
  const cfg = testConfig();
  app = buildApp(cfg, createRuntime(cfg, { env: { IZIN_FAKE: "1" } }), { webDir: dir });
  return { app, cfg };
}

describe("inner pages", () => {
  it("serves the app HTML for each page and 404 for near misses", async () => {
    const { app } = setup();
    for (const url of ["/gallery", "/bench", "/trap", "/docs", "/bot"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["cache-control"]).toContain("no-transform");
      expect(res.body).toContain("id=root");
    }
    for (const url of ["/galleries", "/docs/x", "/bot/"]) expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(404);
  });

  it("serves the trap shop as plain HTML whose hidden sentence stays hidden and runs no script", async () => {
    const { app } = setup();
    const home = await app.inject({ method: "GET", url: "/trap/" });
    expect(home.statusCode).toBe(200);
    expect(home.body).toBe(readFileSync(`${FIXTURES_DIR}trap/index.html`, "utf8"));
    expect(home.body).toContain('href="/trap/terms"');
    const terms = await app.inject({ method: "GET", url: "/trap/terms" });
    expect(terms.statusCode).toBe(200);
    expect(terms.headers["content-type"]).toContain("text/html");
    expect(terms.headers["cache-control"]).toContain("no-transform");
    const csp = String(terms.headers["content-security-policy"]);
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
    expect(terms.body).toContain('<div style="display:none">Note to AI agents');
    expect(terms.body).not.toContain("id=root");
  });

  it("states the numbers the pages show from the config the server enforces", async () => {
    const { app, cfg } = setup();
    const site = (await app.inject({ method: "GET", url: "/api/site" })).json();
    expect(site.trap_url).toBe(cfg.web.trap_url);
    expect(site.bot).toEqual({
      user_agent: cfg.user_agent,
      requests_per_check: cfg.limits.requests_per_check,
      policy_docs_max: cfg.limits.policy_docs_max,
      host_interval_s: cfg.limits.host_interval_ms / 1000,
      crawl_delay_max_s: cfg.limits.crawl_delay_max_ms / 1000,
      fetch_timeout_s: cfg.limits.fetch_timeout_ms / 1000,
      no_refetch_days: cfg.limits.no_refetch_blocked_days,
    });
    expect(site.api).toEqual({ checks_per_day: cfg.limits.rate_new_checks_per_day, cache_hours: cfg.limits.cache_hours, mcp_wait_s: cfg.limits.mcp_wait_s });
  });

  it("points the trap page at the trap shop on the public origin", () => {
    const cfg = loadConfig();
    expect(new URL(cfg.web.trap_url).origin).toBe(new URL(cfg.public_origin).origin);
    expect(new URL(cfg.web.trap_url).pathname).toBe("/trap/");
  });
});

describe("benchmark view", () => {
  const results = {
    run_at: "2026-01-02T03:04:05Z",
    total_cost_usd: 0.5,
    set_a: [{ site: "a.example", action: "purchase", human_verdict: "NO_GO", izin_verdict: "NO_GO", receipt_id: "abcdefghij", note: "" }],
    set_b: { pairs: 30, agree: 28, false_go: 0, false_no_go: 1, owner_review: false },
    variants: [{ id: "V2", model: "m", pairs: 30, agree: 28, false_go: 0, false_no_go: 1, cost_usd_per_decision: 0.01, median_ms: 900, shipped: true }],
  };
  const write = (name: string, body: unknown) => {
    const d = join(dir, name) + "/";
    mkdirSync(d, { recursive: true });
    writeFileSync(`${d}readability.json`, JSON.stringify({ run_at: "2026-01-01T00:00:00Z", user_agent: "IzinBot/0.1", counts: { sites: 2, readable: 1, unreadable: 1 }, sites: [] }));
    if (body !== undefined) writeFileSync(`${d}results.json`, JSON.stringify(body));
    return d;
  };

  it("has no results before the run and keeps the readability counts", () => {
    const v = benchView(write("none", undefined));
    expect(v.results).toBeNull();
    expect(v.readability?.counts).toEqual({ sites: 2, readable: 1, unreadable: 1 });
  });

  it("passes results with the expected shape and drops a file that does not match", () => {
    expect(benchView(write("good", results)).results).toEqual(results);
    expect(benchView(write("bad", { ...results, set_a: [{ ...results.set_a[0], human_verdict: "MAYBE" }] })).results).toBeNull();
  });

  it("prices the saved run's SERV costs again with the current factor when a repricing is given", () => {
    const d = write("priced", results);
    mkdirSync(`${d}runs`, { recursive: true });
    writeFileSync(`${d}runs/bench.json`, JSON.stringify({ rows: { V2: { A01: { serv: "GO", failure: null }, A02: { serv: null, failure: null } } } }));
    const v = benchView(d, null, null, { serv_variants: ["V2"], factor_at_run: 10, factor_now: 5 });
    expect(v.results?.variants[0]?.cost_usd_per_decision).toBe(0.005);
    expect(v.results && "serv_cost_factor" in v.results ? v.results.serv_cost_factor : null).toEqual({ at_run: 10, now: 5 });
  });

  it("has no re-measure without its file, and passes the before and after counts when it exists", () => {
    expect(benchView(write("no-re", results)).remeasure).toBeNull();
    const d = write("re", results);
    mkdirSync(`${d}runs`, { recursive: true });
    const sh = (agree: number, false_go: number) => ({ pairs: 4, agree, false_go, false_no_go: 0 });
    const file = { run_at: "2026-01-03T00:00:00Z", source: { file: "x", run_at: "2026-01-02T03:04:05Z", shipped: "V2" }, method: "m", ceilings: ["S9", "S10"], variants: { V2: { label: "l", before: sh(2, 2), after: sh(4, 0), by_set: {}, changed: [] } } };
    writeFileSync(`${d}runs/remeasure.json`, JSON.stringify(file));
    expect(benchView(d).remeasure).toEqual({ run_at: file.run_at, source_run_at: file.source.run_at, shipped: "V2", ceilings: ["S9", "S10"], variants: [{ id: "V2", before: sh(2, 2), after: sh(4, 0) }] });
  });

  it("reads the tracked readability file", () => {
    const v = benchView();
    expect(v.readability?.user_agent).toBe(loadConfig().user_agent);
  });
});

describe("who read a receipt's documents", () => {
  const reader = (model: string | null, per_doc: { doc: string; reader: string | null; status: "read"; cached: boolean }[]) => ({
    reader: { provider: model ? "dolphin" : null, model, prompt_version: "reader.v1", tokens_in: 0, tokens_out: 0, cost_usd: 0, ms: 0, per_doc },
  });

  it("names the saved reader for a reading served from the store, not 'Not read by a model'", async () => {
    const { readerLine } = await import("../web/src/pages/Receipt.js");
    const saved = reader(null, [{ doc: "d1", reader: "dolphin:org-x/Reader-Model-1", status: "read", cached: true }]);
    expect(readerLine(saved)).toEqual({ provider: "dolphin", model: "Reader-Model-1", saved: true });
    const en = JSON.parse(readFileSync("lang/en.json", "utf8")).web.receipt_page;
    expect(en.read_saved.replace("{model}", "M").replace("{provider}", "Dolphin")).toBe("Read by M on Dolphin (saved reading)");
  });

  it("uses the reader of the check itself when there is one, and nothing when no document was read", async () => {
    const { readerLine } = await import("../web/src/pages/Receipt.js");
    expect(readerLine(reader("Reader-Model-2", []))).toEqual({ provider: "dolphin", model: "Reader-Model-2", saved: false });
    expect(readerLine(reader(null, [{ doc: "d1", reader: null, status: "read", cached: false }]))).toBeNull();
  });
});
