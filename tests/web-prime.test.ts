// Pre-computed receipts for the examples and named sites: the plan has one entry per site and
// action, a saved receipt from the last days is reused without a new check, a missing one is
// checked and saved, and a reached budget cap leaves the entry without a receipt.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntime } from "../server/runtime.js";
import { primePlan, primeToRun, runPrime } from "../server/web/prime.js";
import { loadExamplesFile } from "../server/web/site.js";
import { page, policyText, startSites, testConfig, type Running } from "./helpers/sites.js";

let s: Running | null = null;
afterEach(async () => {
  await s?.close();
  s = null;
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
  const pipeline = { ...rt.pipeline, store: rt.store, source: "cli" as const };
  return { cfg, rt, pipeline, url: s.url("shop.example", "/") };
}

describe("prime", () => {
  it("plans one entry per site and action, examples first", () => {
    const cfg = testConfig();
    const plan = primePlan(cfg, {
      examples: [{ key: "buy", site: "https://www.shop.example/", action: "purchase", receipt_id: null }],
      prime: [
        { site: "https://shop.example/", action: "purchase" },
        { site: "https://other.example/", action: "read_page" },
      ],
    });
    expect(plan.map((e) => [e.key, e.site, e.action])).toEqual([
      ["buy", "shop.example", "purchase"],
      [null, "other.example", "read_page"],
    ]);
  });

  it("checks and saves a missing receipt, then reuses it", async () => {
    const { cfg, rt, pipeline, url } = await setup();
    const plan = primePlan(cfg, { examples: [], prime: [{ site: url, action: "purchase" }] });
    expect(primeToRun(cfg, rt.jobs, plan, new Date())).toHaveLength(1);
    const first = await runPrime(plan, { cfg, jobs: rt.jobs, pipeline, stop: async () => false });
    expect(first[0]).toMatchObject({ reused: false, error: null });
    expect(first[0]!.receipt_id).toMatch(/^[a-z2-7]{8,32}$/);
    expect(rt.store.getReceipt(first[0]!.receipt_id!)).not.toBeNull();
    expect(primeToRun(cfg, rt.jobs, plan, new Date())).toHaveLength(0);
    const again = await runPrime(plan, { cfg, jobs: rt.jobs, pipeline, stop: async () => true });
    expect(again[0]).toMatchObject({ reused: true, receipt_id: first[0]!.receipt_id, verdict: first[0]!.verdict });
    const later = new Date(Date.now() + (cfg.limits.cached_receipt_days + 1) * 86_400_000);
    expect(primeToRun(cfg, rt.jobs, plan, later)).toHaveLength(1);
  });

  it("with fresh, checks a named site again and keeps the example's saved receipt", async () => {
    const { cfg, rt, pipeline, url } = await setup();
    const file = { examples: [{ key: "buy", site: url, action: "purchase" as const, receipt_id: null }], prime: [{ site: url, action: "account" as const }] };
    const plan = primePlan(cfg, file);
    let t = Date.parse("2026-01-01T00:00:00.000Z");
    const now = () => new Date(t);
    const clocked = { ...pipeline, now };
    const first = await runPrime(plan, { cfg, jobs: rt.jobs, pipeline: clocked, stop: async () => false, now });
    expect(primeToRun(cfg, rt.jobs, plan, now())).toHaveLength(0);
    expect(primeToRun(cfg, rt.jobs, plan, now(), true).map((e) => e.action)).toEqual(["account"]);
    t += 60_000;
    const again = await runPrime(plan, { cfg, jobs: rt.jobs, pipeline: clocked, stop: async () => false, now, fresh: true });
    expect(again[0]).toMatchObject({ reused: true, receipt_id: first[0]!.receipt_id });
    expect(again[1]).toMatchObject({ reused: false, error: null });
    expect(again[1]!.receipt_id).not.toBe(first[1]!.receipt_id);
    expect(rt.store.getReceipt(first[1]!.receipt_id!)).not.toBeNull();
    const site = plan[1]!.site;
    expect(rt.jobs.findRecentDone(site, "account", new Date(0))?.id).toBe(again[1]!.receipt_id);
    expect(rt.jobs.findCached(new URL(url).origin, "account", new Date(0))?.id).toBe(again[1]!.receipt_id);
  });

  it("leaves an entry without a receipt when the budget cap is reached", async () => {
    const { cfg, rt, pipeline, url } = await setup();
    const plan = primePlan(cfg, { examples: [], prime: [{ site: url, action: "crawl" }] });
    const rows = await runPrime(plan, { cfg, jobs: rt.jobs, pipeline, stop: async () => true });
    expect(rows[0]).toMatchObject({ receipt_id: null, error: "budget cap reached" });
  });

  it("reads the prime list and rejects a bad one", () => {
    const dir = mkdtempSync(join(tmpdir(), "izin-prime-"));
    try {
      const ok = join(dir, "ok.json");
      writeFileSync(ok, JSON.stringify({ examples: [], prime: [{ site: "https://a.example/", action: "post" }] }));
      expect(loadExamplesFile(ok).prime).toEqual([{ site: "https://a.example/", action: "post" }]);
      const bad = join(dir, "bad.json");
      writeFileSync(bad, JSON.stringify({ examples: [], prime: [{ site: "https://a.example/", action: "fly" }] }));
      expect(() => loadExamplesFile(bad)).toThrow();
      expect(loadExamplesFile(join(dir, "absent.json"))).toEqual({ examples: [], prime: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    for (const p of loadExamplesFile().prime) expect(p.site).toMatch(/^https:\/\//);
  });
});
