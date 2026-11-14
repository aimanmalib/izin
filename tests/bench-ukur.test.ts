// The generated UKUR sections for the benchmark, the gallery run, H1 and the reader: numbers come
// from the run files given, and each Set A mismatch gets a one-line reason.
import { describe, expect, it } from "vitest";
import type { BenchResults } from "../server/api/views.js";
import { loadSets } from "../server/bench/sets.js";
import { readerStats } from "../server/bench/stats.js";
import { benchSection, explain, galleryRunSection, readerSection, remeasureSection, type BenchReportFile, type GalleryRunFile, type RemeasureFile } from "../server/bench/ukur.js";
import { mergeRuns } from "../server/bench/merge.js";
import { loadBenchConfig } from "../server/bench/variants.js";
import { reprice } from "../server/belanja/kos.js";
import { replaceSection } from "../server/galeri/ukur.js";

const manual = loadSets().manual;
const reader = readerStats([]);
const share = (pairs: number, agree: number, false_go = 0) => ({ pairs, agree, false_go, false_no_go: 0 });

const results: BenchResults = {
  run_at: "2026-11-10T00:00:00.000Z",
  total_cost_usd: 0.1234,
  set_a: manual.pairs.map((p, i) => ({ site: p.site, action: p.action, human_verdict: p.human_verdict, izin_verdict: i === 0 ? "ASK" : p.human_verdict, receipt_id: "abcdefgh", note: p.note })),
  set_b: { ...share(20, 18), owner_review: false },
  variants: [
    { id: "V0", model: "m0", ...share(43, 30, 2), cost_usd_per_decision: 0.0001, median_ms: 5000, shipped: false },
    { id: "V2", model: "m2", ...share(43, 38), cost_usd_per_decision: 0.002, median_ms: 20000, shipped: true },
  ],
};
const report: BenchReportFile = {
  run_at: results.run_at,
  stopped: false,
  shipped: "V2",
  variants: loadBenchConfig().variants,
  by_set: {
    V0: { A: share(13, 10, 1), B: share(20, 12, 1), spot: share(10, 8) },
    V2: { A: share(13, 12), B: share(20, 18), spot: share(10, 8, 1) },
  },
  failures: { V0: 3, V2: 0 },
  rows: { V2: { A01: { final: "ASK", serv: "NO_GO", failure: null, ceilings: ["S4"] } } },
  reader,
};

describe("UKUR sections", () => {
  it("states false GO per set for the shipped variant and lists every Set A pair with a reason for each mismatch", () => {
    const s = benchSection(results, report, manual, "https://izin.example");
    expect(s).toContain("**0 of 20 designed cases** (Set B), **1 of 10 spot checks**, 0 of 13 Set A pairs");
    expect(s).toContain("| V2 (shipped) | `m2` | 43 | 38 (88%) | 0 | 0 | 0 |");
    expect(s).toContain(`| ${manual.pairs[0]!.site} | crawl | ${manual.pairs[0]!.human_verdict} |`);
    expect(s).toContain("S4 (a page blocked the reader) set ASK");
    expect(s.split("\n").filter((l) => l.startsWith("| ") && l.includes("](https://izin.example/r/abcdefgh)"))).toHaveLength(manual.pairs.length);
  });

  it("prints the SERV cost calibration note with the run-time figures labelled when the run is priced again", () => {
    const priced = reprice(results, { V2: { A01: { serv: "NO_GO", failure: null } } }, { serv_variants: ["V2"], factor_at_run: 200, factor_now: 50 });
    const s = benchSection(priced, report, manual, "https://izin.example");
    expect(s).toContain("| V2 (shipped) | `m2` | 43 | 38 (88%) | 0 | 0 | 0 | 0.000500 |");
    expect(s).toContain("cost factor now in config (50), calibrated against the SERV console balance ([ADR 0019]");
    expect(s).toContain("priced with the earlier factor 200");
    expect(s).toContain("V2 USD 0.002000 a decision, USD 0.1234 in total, estimates with the 10 Nov factor");
    expect(s).toContain("Estimated total at the current factor (reading and every variant): USD 0.1219.");
    // Without a repricing the older note stays.
    expect(benchSection(results, report, manual, "https://izin.example")).toContain("SERV times the measured factor of [ADR 0016]");
  });

  it("explains a do-not-fetch pair and a missing decision", () => {
    expect(explain({ final: "ASK", serv: null, failure: null, ceilings: ["S5"] }, "not_fetched")).toMatch(/do-not-fetch/);
    expect(explain({ final: "ASK", serv: null, failure: "timeout", ceilings: ["S8"] }, "fetch_once")).toMatch(/no valid answer \(timeout\)/);
  });

  it("counts the gallery run and the H1 rows from the files", () => {
    const g: GalleryRunFile = {
      run_at: "2026-11-10T00:00:00.000Z", user_agent: "IzinBot/0.1", sites: 2, stopped: false, reader, spend: { serv_usd: 0.01, dolphin_usd: 0.001 },
      checks: [
        { site: "a.example", action: "crawl", receipt_id: "x", verdict: "NO_GO", ms_total: 1000, error: null },
        { site: "a.example", action: "post", receipt_id: "y", verdict: "ASK", ms_total: 3000, error: null },
        { site: "b.example", action: "crawl", receipt_id: null, verdict: null, ms_total: 10, error: "boom" },
      ],
    };
    const h1 = { run_at: g.run_at, action: "read_page", max_ms: 90000, pass: true, reader, rows: [{ site: "a.example", receipt_id: "x", verdict: "GO", docs_read: 1, ms: 4000, error: null }] };
    const s = galleryRunSection(g, h1);
    expect(s).toContain("2 sites, 3 checks, 2 with a receipt");
    expect(s).toContain("GO 0, ASK 1, NO-GO 1. Median time per check 2.0 s, longest 3.0 s");
    expect(s).toContain("b.example crawl");
    expect(s).toContain("**pass** (1 of 1");
    expect(s).not.toContain("valid answer");
    expect(galleryRunSection(g, null, { with_receipt: 2, serv_answered: 1 })).toContain("decision step gave a valid answer: **1 of 2**");
  });

  it("names the decider model on the gallery receipts and says when it differs from the decider in config", () => {
    const g: GalleryRunFile = {
      run_at: "2026-11-10T00:00:00.000Z", user_agent: "IzinBot/0.1", sites: 1, stopped: false, reader, spend: { serv_usd: 0, dolphin_usd: 0 },
      checks: [{ site: "a.example", action: "crawl", receipt_id: "x", verdict: "NO_GO", ms_total: 1000, error: null }],
    };
    const other = galleryRunSection(g, null, { with_receipt: 1, serv_answered: 1, models: { "model-x-multi": 1 }, shipped_model: "model-x" });
    expect(other).toContain("Decider model named on those receipts: `model-x-multi` (1).");
    expect(other).toContain("New checks use the decider in config now, `model-x`");
    const same = galleryRunSection(g, null, { with_receipt: 1, serv_answered: 1, models: { "model-x": 1 }, shipped_model: "model-x" });
    expect(same).toContain("`model-x` (1).");
    expect(same).not.toContain("New checks use");
  });

  it("joins a frozen-evidence rerun to the earlier run: kept variants, the rerun's variants, K6 picked again", () => {
    const later: BenchResults = {
      ...results,
      run_at: "2026-11-14T00:00:00.000Z",
      total_cost_usd: 1,
      set_a: results.set_a.map((r) => ({ ...r, receipt_id: null })),
      variants: [{ id: "V1", model: "m1", ...share(43, 31, 3), cost_usd_per_decision: 0.05, median_ms: 13000, shipped: true }],
    };
    const laterReport: BenchReportFile = {
      ...report, run_at: later.run_at, shipped: "V1", by_set: { V1: { A: share(13, 8, 1), B: share(20, 17, 2), spot: share(10, 6) } },
      failures: { V1: 1 }, rows: { V1: { A01: { final: "ASK", serv: "ASK", failure: null, ceilings: [] } } }, reader: { ...reader, calls: 0 },
    };
    const base = { results, report: { ...report, reader: { ...reader, calls: 25 } } };
    const m = mergeRuns(base, ["V0"], { results: later, report: laterReport }, "V2");
    expect(m.report.shipped).toBe("V1");
    expect(m.results.variants.map((v) => [v.id, v.shipped])).toEqual([["V0", false], ["V1", true]]);
    expect(Object.keys(m.report.by_set)).toEqual(["V0", "V1"]);
    expect(m.report.rows.V2).toBeUndefined();
    expect(m.report.reader.calls).toBe(25);
    expect(m.report.runs).toEqual({ V0: results.run_at, V1: later.run_at });
    expect(m.results.total_cost_usd).toBeCloseTo(1.1234, 6);
    expect(m.results.set_a.every((r) => r.receipt_id === null)).toBe(true);
    const s = benchSection(m.results, m.report, manual, "https://izin.example");
    expect(s).toContain(`Runs: V0 ${results.run_at}, V1 ${later.run_at}`);
    expect(s).toContain("bench --from-evidence");
    expect(s).toContain("\n### Set A\n");
    expect(() => mergeRuns(base, ["V1"], { results: later, report: laterReport }, "V2")).toThrow(/both runs/);
    expect(() => mergeRuns(base, ["V3"], { results: later, report: laterReport }, "V2")).toThrow(/not in the earlier run/);
  });

  it("adds Dolphin and other reader tokens over all runs for H10", () => {
    const r = (d: number, o: number) => ({ ...reader, tokens: { dolphin: d, other: o }, dolphin_share: d / (d + o) });
    expect(readerSection([{ name: "Gallery", reader: r(90, 10) }, { name: "Benchmark", reader: r(70, 30) }], "2026-11-10T00:00:00.000Z")).toContain("**80%** (160 of 200)");
  });

  it("writes the re-measure as N of M for every variant, names each changed pair, and links the ADR", () => {
    const sh = (agree: number, false_go: number, false_no_go = 0) => ({ pairs: 5, agree, false_go, false_no_go });
    const file: RemeasureFile = {
      run_at: "2026-11-14T18:00:00.000Z",
      source: { file: "bench/runs/bench.json", run_at: "2026-11-14T11:57:16.553Z", shipped: "V1" },
      method: "synthetic",
      ceilings: ["S9", "S10"],
      variants: {
        V0: { label: "x", before: sh(3, 1, 1), after: sh(4, 0, 1), by_set: { A: sh(4, 0), B: sh(0, 0), spot: sh(0, 0) }, changed: [{ id: "A09", before: "GO", after: "ASK", ceilings: ["S10"], expected: ["ASK"] }] },
        V1: { label: "y", before: sh(2, 2), after: sh(4, 0), by_set: { A: sh(4, 0), B: sh(0, 0), spot: sh(0, 0) }, changed: [{ id: "B09", before: "GO", after: "ASK", ceilings: ["S9"], expected: ["ASK"] }] },
      },
    };
    const s = remeasureSection(file);
    expect(s).toContain("| V1 (shipped) | 2 of 5 | 4 of 5 | 2 of 5 | 0 of 5 | 0 of 5 | 0 of 5 |");
    expect(s).toContain("| V0 | 3 of 5 | 4 of 5 | 1 of 5 | 0 of 5 | 1 of 5 | 1 of 5 |");
    expect(s).toContain("- V1 B09: GO to ASK (S9, text addressed to AI agents was found and set aside); expected ASK");
    expect(s).toContain("decisions/0020-two-signal-ceilings-and-remeasure.md");
    expect(explain({ final: "ASK", serv: "GO", failure: null, ceilings: ["S6"] }, "fetch_once")).toContain("conflicted with a prohibiting clause");
  });

  it("places a new section after the one named, and replaces it in place later", () => {
    const doc = "# T\n\n<!-- izin:benchmark:start -->\nB\n<!-- izin:benchmark:end -->\n\n## Notes\n";
    const once = replaceSection(doc, "remeasure", "R1", "benchmark");
    expect(once.indexOf("izin:remeasure:start")).toBeGreaterThan(once.indexOf("izin:benchmark:end"));
    expect(once.indexOf("izin:remeasure:end")).toBeLessThan(once.indexOf("## Notes"));
    expect(replaceSection(once, "remeasure", "R2", "benchmark")).toBe(once.replace("R1", "R2"));
  });
});
