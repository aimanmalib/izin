// The benchmark run end to end on the synthetic Set B sites with the offline reader and decider
// (IZIN_FAKE=1), plus the scoring rules, the variant settings and the gallery runner.
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { benchResultsSchema } from "../server/api/views.js";
import type { Attempt } from "../server/baca/reader.js";
import { BudgetGuard } from "../server/belanja/guard.js";
import { benchCases, checkFrozen, runBench, type FrozenEvidence } from "../server/bench/run.js";
import { buildReport } from "../server/bench/results.js";
import { median, pickShipped, share, type VariantScore } from "../server/bench/score.js";
import { loadSets, syntheticSite } from "../server/bench/sets.js";
import { serveSynthetic, type SyntheticServer } from "../server/bench/sites.js";
import { estimateRun, readerStats } from "../server/bench/stats.js";
import { loadBenchConfig, variantConfig, variantSpend, type Variant } from "../server/bench/variants.js";
import { runGallery } from "../server/galeri/run.js";
import { defaultPolicy } from "../server/kumpul/ssrf.js";
import { fakeTransport } from "../server/putus/fake.js";
import type { DeciderResult, DeciderTransport } from "../server/putus/serv.js";
import { ReceiptStore } from "../server/resit/store.js";
import { pipelineDeps } from "../server/wiring.js";
import { page, startSites, testConfig, type Running } from "./helpers/sites.js";

const cfg = testConfig();
const bench = loadBenchConfig();
const sets = loadSets();

let synth: SyntheticServer | null = null;
let sites: Running | null = null;
afterEach(async () => {
  await synth?.close();
  await sites?.close();
  synth = sites = null;
});

const score = (id: string, provider: "serv" | "dolphin", false_go: number, agree: number, cost: number): VariantScore => ({
  id, provider, false_go, agree, cost_usd_per_decision: cost, pairs: 10, false_no_go: 0,
});

describe("scoring", () => {
  it("counts agreement, false GO and false NO_GO, with the label's other allowed verdicts", () => {
    expect(
      share([
        { expected: "NO_GO", acceptable: [], got: "NO_GO" },
        { expected: "ASK", acceptable: [], got: "GO" },
        { expected: "GO", acceptable: ["ASK"], got: "ASK" },
        { expected: "ASK", acceptable: [], got: "NO_GO" },
      ]),
    ).toEqual({ pairs: 4, agree: 2, false_go: 1, false_no_go: 1 });
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("ships the SERV variant with the fewest false GO, then most agreement, then lowest cost; ties go to the tie variant", () => {
    expect(pickShipped([score("V0", "dolphin", 0, 10, 0), score("V1", "serv", 1, 9, 0.001), score("V2", "serv", 0, 7, 0.002)], "V2")).toBe("V2");
    expect(pickShipped([score("V1", "serv", 0, 9, 0.002), score("V2", "serv", 0, 8, 0.001)], "V2")).toBe("V1");
    expect(pickShipped([score("V1", "serv", 0, 8, 0.001), score("V2", "serv", 0, 8, 0.002)], "V2")).toBe("V1");
    expect(pickShipped([score("V1", "serv", 0, 8, 0.001), score("V2", "serv", 0, 8, 0.001)], "V2")).toBe("V2");
    expect(() => pickShipped([score("V0", "dolphin", 0, 10, 0)], "V2")).toThrow(/no SERV/);
  });
});

describe("variants", () => {
  const v = (id: string) => bench.variants.find((x) => x.id === id)!;

  it("points the Dolphin-only variant at the reader's endpoint and key, and SERV variants at the decider's", () => {
    const d = variantConfig(cfg, v("V0")).decider;
    expect(d.base_url).toBe(cfg.reader.primary.base_url);
    expect(d.key_env).toBe(cfg.reader.primary.key_env);
    expect(v("V0").guard).toBe(false);
    const s = variantConfig(cfg, v("V3")).decider;
    expect(s.base_url).toBe(cfg.decider.base_url);
    expect(s.model.endsWith(s.suffix)).toBe(true);
    expect(bench.variants.some((x) => x.id === bench.tie_variant)).toBe(true);
  });

  it("prices a Dolphin decision at Dolphin's listed price and a SERV decision from the decider's estimate", () => {
    const r = { tokens_in: 1_000_000, tokens_out: 0, cost_usd_estimated: 0.5 } as DeciderResult;
    const price = cfg.prices_usd_per_mtok.dolphin[v("V0").model]!.input;
    expect(variantSpend(cfg, v("V0"), r)).toEqual({ serv_usd: 0, dolphin_usd: price });
    expect(variantSpend(cfg, v("V2"), r)).toEqual({ serv_usd: 0.5, dolphin_usd: 0 });
    expect(variantSpend(cfg, v("V2"), null)).toEqual({ serv_usd: 0, dolphin_usd: 0 });
  });

  it("estimates an upper bound that grows with the number of decisions", () => {
    const a = estimateRun(cfg, bench, { reads: 1, serv_decisions: 1, dolphin_decisions: 0 });
    const b = estimateRun(cfg, bench, { reads: 1, serv_decisions: 10, dolphin_decisions: 0 });
    expect(b.serv_usd).toBeGreaterThan(a.serv_usd);
    expect(a.dolphin_usd).toBeGreaterThan(0);
  });
});

describe("benchmark run", () => {
  it("reads each Set B case once, decides it with every variant and scores the verdict after the ceilings", async () => {
    synth = await serveSynthetic(sets.labeled.cases.map((c) => syntheticSite(sets.labeled, c)), defaultPolicy(cfg.limits.fetch_ports));
    const cases = benchCases({ ...sets, manual: { ...sets.manual, pairs: [] }, spot: { ...sets.spot, pairs: [] } }, (h) => synth!.url(h));
    expect(cases).toHaveLength(20);
    const store = new ReceiptStore(new Database(":memory:"));
    const calls: string[] = [];
    const transportFor = (v: Variant): DeciderTransport => {
      const t = fakeTransport();
      return async (body) => (calls.push(`${v.id}:${body.model}`), t(body));
    };
    const spent: number[] = [];
    const variants = bench.variants.filter((v) => v.id === "V0" || v.id === "V2");
    const run = await runBench(cases, variants, {
      pipeline: { ...pipelineDeps(cfg, { env: { IZIN_FAKE: "1" } }), policy: synth.policy, store, source: "bench", sleep: async () => {} },
      transportFor,
      concurrency: 4,
      onSpend: (s) => spent.push(s.serv_usd + s.dolphin_usd),
    });
    expect(run.evidence).toHaveLength(20);
    expect(run.answers).toHaveLength(40);
    expect(run.stopped).toBe(false);
    // Each variant got the same message for a case: the frozen evidence.
    expect(calls.some((c) => c.startsWith("V0:deepseek"))).toBe(true);
    expect(calls.some((c) => c.startsWith("V2:gpt-6-luna-serv-multipath"))).toBe(true);
    // The hidden-text case reaches the decider with the hidden sentence quarantined, not as a clause.
    for (const e of run.evidence) expect(JSON.stringify(e.message)).not.toMatch(/ignore (all|the) (previous|above)/i);
    // Only Set A pairs keep receipts.
    expect(run.answers.every((a) => a.receipt_id === null)).toBe(true);
    const report = buildReport(run, cases, variants, { ...sets.manual, pairs: [] }, bench.tie_variant, "2026-11-10T00:00:00.000Z");
    expect(benchResultsSchema.safeParse(report.results).success).toBe(true);
    expect(report.shipped).toBe("V2");
    expect(report.results.variants.map((v) => v.id)).toEqual(["V0", "V2"]);
    expect(report.results.set_b.pairs).toBe(20);
    expect(report.by_set.V2!.B.pairs).toBe(20);
    expect(Object.keys(report.rows.V0!)).toHaveLength(20);
  });

  it("decides a later run on the frozen evidence alone: nothing fetched or read, same verdicts, no receipts", async () => {
    const two = sets.labeled.cases.slice(0, 2);
    synth = await serveSynthetic(two.map((c) => syntheticSite(sets.labeled, c)), defaultPolicy(cfg.limits.fetch_ports));
    const only = { ...sets, manual: { ...sets.manual, pairs: [] }, labeled: { ...sets.labeled, cases: two } as typeof sets.labeled, spot: { ...sets.spot, pairs: [] } };
    const cases = benchCases(only, (h) => synth!.url(h));
    const pipeline = { ...pipelineDeps(cfg, { env: { IZIN_FAKE: "1" } }), policy: synth.policy, sleep: async () => {} };
    const v2 = bench.variants.filter((v) => v.id === "V2");
    const first = await runBench(cases, v2, { pipeline, transportFor: () => fakeTransport(), concurrency: 1, onSpend: () => {} });
    await synth.close();
    synth = null;
    // Round-trip through JSON, as the files on disk are read.
    const frozen = new Map(first.evidence.map((e) => [e.id, JSON.parse(JSON.stringify(e)) as FrozenEvidence]));
    const seen: string[] = [];
    const looked: string[] = [];
    const second = await runBench(cases, v2, {
      pipeline: { ...pipeline, policy: { ...pipeline.policy, lookup: async (h: string) => (looked.push(h), []) } },
      transportFor: () => { const t = fakeTransport(); return async (body) => (seen.push(body.messages.at(-1)!.content as string), t(body)); },
      concurrency: 1,
      onSpend: () => {},
      frozen,
    });
    expect(looked).toEqual([]);
    expect(second.reader_attempts).toHaveLength(0);
    expect(second.evidence).toEqual([...frozen.values()]);
    const verdicts = (r: typeof first) => Object.fromEntries(r.answers.map((a) => [a.case_id, a.final]));
    expect(verdicts(second)).toEqual(verdicts(first));
    expect(second.answers.every((a) => a.receipt_id === null)).toBe(true);
    for (const e of frozen.values()) if (!e.skip) expect(seen.some((m) => m.includes(JSON.stringify(e.message)))).toBe(true);
    expect(() => checkFrozen(cases[0]!, { ...frozen.get(cases[0]!.id)!, action: cases[0]!.action === "crawl" ? "purchase" : "crawl" })).toThrow(/does not match/);
  });

  it("stops before a paid step once the budget says so", async () => {
    synth = await serveSynthetic(sets.labeled.cases.slice(0, 2).map((c) => syntheticSite(sets.labeled, c)), defaultPolicy(cfg.limits.fetch_ports));
    const cases = benchCases({ ...sets, manual: { ...sets.manual, pairs: [] }, labeled: { ...sets.labeled, cases: sets.labeled.cases.slice(0, 2) } as typeof sets.labeled, spot: { ...sets.spot, pairs: [] } }, (h) => synth!.url(h));
    const run = await runBench(cases, bench.variants.slice(0, 1), {
      pipeline: { ...pipelineDeps(cfg, { env: { IZIN_FAKE: "1" } }), policy: synth.policy, sleep: async () => {} },
      transportFor: () => fakeTransport(),
      concurrency: 1,
      onSpend: () => {},
      stop: async () => true,
    });
    expect(run.stopped).toBe(true);
    expect(run.evidence).toHaveLength(0);
  });
});

describe("reader stats", () => {
  const at = (provider: string, ms: number, ttft: number | null, i: number, o: number): Attempt => ({
    provider, model: "m", outcome: "ok", ms, ttft_ms: ttft, input_tokens: i, output_tokens: o, reasoning_tokens: 0, reasoning_deltas: 0, cost_usd: 0, response_model: null, fallback_suspected: false,
  });

  it("counts the token share served by Dolphin and its latency, first token and output speed", () => {
    const s = readerStats([at("dolphin", 3000, 1000, 700, 200), at("dolphin", 5000, 1000, 100, 0), at("serv", 4000, null, 150, 50), { ...at("dolphin", 1, 1, 999, 999), outcome: "timeout" }]);
    expect(s.tokens).toEqual({ dolphin: 1000, other: 200 });
    expect(s.dolphin_share).toBe(0.833);
    expect(s.dolphin).toEqual({ ok_calls: 2, median_ms: 4000, median_ttft_ms: 1000, median_tokens_per_s: 100 });
    expect(readerStats([]).dolphin_share).toBeNull();
  });
});

describe("gallery run", () => {
  const body = "This paragraph describes the shop, its delivery times and its opening hours for people who visit. ".repeat(10);
  const terms = (rule: string) => page(`<h1>Terms of Service</h1><p>${body}</p><p>${rule}</p>`);

  it("checks every action of a site, points each gallery cell at its receipt and marks a changed verdict", async () => {
    const termsRoute = { body: terms("You may not use robots, spiders, scrapers or other automated means to access this site for any purpose.") };
    sites = await startSites((url) => ({
      "shop.example": {
        "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
        "/": { body: page(`<a href="${url("shop.example", "/terms")}">Terms of Service</a>`) },
        "/terms": termsRoute,
      },
    }));
    const db = new Database(":memory:");
    const store = new ReceiptStore(db);
    const guard = new BudgetGuard(db, cfg, async () => false);
    const pipeline = { ...pipelineDeps(cfg, { env: { IZIN_FAKE: "1" } }), policy: sites.policy, sleep: async () => {} };
    const host = "shop.example";
    const urlFor = (h: string) => sites!.url(h);
    const first = await runGallery([{ host, policy_hints: [sites.url("shop.example", "/terms")] }], { pipeline, store, guard, concurrency: 2, urlFor, actions: ["crawl", "read_page"] });
    expect(first.checks.map((c) => [c.action, c.error])).toEqual([["crawl", null], ["read_page", null]]);
    expect(first.checks[0]!.verdict).toBe("NO_GO");
    const rows = db.prepare("SELECT site, action, check_id, changed FROM gallery ORDER BY action").all() as { site: string; check_id: string; changed: number }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.site === host && r.changed === 0 && store.getReceipt(r.check_id))).toBe(true);
    expect((db.prepare("SELECT source FROM checks").all() as { source: string }[]).every((r) => r.source === "gallery")).toBe(true);

    termsRoute.body = terms("Automated agents and crawlers are welcome to read and crawl the public pages of this site.");
    const second = await runGallery([{ host, policy_hints: [sites.url("shop.example", "/terms")] }], { pipeline, store, guard, concurrency: 1, urlFor, actions: ["crawl"] });
    expect(second.checks[0]!.verdict).not.toBe("NO_GO");
    expect(second.checks[0]!.changed).toBe(true);
  });

  it("starts no check once the budget guard is exhausted", async () => {
    const db = new Database(":memory:");
    const capped = testConfig();
    const store = new ReceiptStore(db);
    const guard = new BudgetGuard(db, capped, async () => false);
    guard.record({ serv_usd: capped.budget.serv_usd_total, dolphin_usd: 0 });
    const run = await runGallery([{ host: "never.example" }], { pipeline: pipelineDeps(capped, { env: { IZIN_FAKE: "1" } }), store, guard, concurrency: 1 });
    expect(run.stopped).toBe(true);
    expect(run.checks).toHaveLength(0);
  });
});
