// The generated UKUR sections for the benchmark, the gallery run, H1 and the reader: numbers come
// from the run files given, and each Set A mismatch gets a one-line reason.
import { describe, expect, it } from "vitest";
import type { BenchResults } from "../server/api/views.js";
import { loadSets } from "../server/bench/sets.js";
import { readerStats } from "../server/bench/stats.js";
import { benchSection, explain, galleryRunSection, readerSection, type BenchReportFile, type GalleryRunFile } from "../server/bench/ukur.js";
import { loadBenchConfig } from "../server/bench/variants.js";

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
  });

  it("adds Dolphin and other reader tokens over all runs for H10", () => {
    const r = (d: number, o: number) => ({ ...reader, tokens: { dolphin: d, other: o }, dolphin_share: d / (d + o) });
    expect(readerSection([{ name: "Gallery", reader: r(90, 10) }, { name: "Benchmark", reader: r(70, 30) }], "2026-11-10T00:00:00.000Z")).toContain("**80%** (160 of 200)");
  });
});
