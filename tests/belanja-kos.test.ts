import { describe, expect, it } from "vitest";
import { readingCost, type ReadingCost } from "../server/belanja/kos.js";
import { loadConfig, type IzinConfig } from "../server/config.js";
import { readingCostSection, replaceSection } from "../server/galeri/ukur.js";
import { openDb, ReceiptStore } from "../server/resit/store.js";

const base = loadConfig();
// Fixed prices for the test, so a price change in config/izin.json does not change these numbers.
const cfg: IzinConfig = {
  ...base,
  prices_usd_per_mtok: {
    serv: { "list-model": { input: 0.2, output: 1.0 }, other: { input: 9, output: 9 } },
    dolphin: { "dolphin-a": { input: 0.01, output: 0.1 }, "dolphin-b": { input: 0.02, output: 0.3 } },
  },
  reading_cost: { compare_model: "list-model", price_sources: { serv: "https://serv.example/prices", dolphin: "https://dolphin.example/prices" } },
};

type Row = [doc: string, provider: string, model: string, tokensIn: number | null, tokensOut: number | null, cost: number | null];

function ledger(rows: Row[]) {
  const db = new ReceiptStore(openDb(":memory:")).db;
  const stmt = db.prepare(
    "INSERT INTO extractions (doc_sha256, provider, model, prompt_version, result_json, tokens_in, tokens_out, cost_usd, ms) VALUES (?, ?, ?, 'v1', '{}', ?, ?, ?, 10)",
  );
  for (const r of rows) stmt.run(...r);
  return db;
}

describe("readingCost", () => {
  it("is null before any reading on Dolphin", () => {
    expect(readingCost(ledger([]), cfg)).toBeNull();
    expect(readingCost(ledger([["d1", "serv", "list-model", 1000, 100, 0.5]]), cfg)).toBeNull();
  });

  it("sums Dolphin tokens and stored cost, and prices the same tokens at the listed model", () => {
    const c = readingCost(
      ledger([
        ["d1", "dolphin", "dolphin-a", 300_000, 20_000, 0.005],
        ["d2", "dolphin", "dolphin-a", 700_000, 30_000, 0.009],
        ["d3", "serv", "other", 5_000_000, 5_000_000, 3],
      ]),
      cfg,
    )!;
    expect(c).toMatchObject({ readings: 2, tokens_in: 1_000_000, tokens_out: 50_000, tokens: 1_050_000, price_sources: cfg.reading_cost.price_sources });
    expect(c.cost_usd).toBeCloseTo(0.014, 10);
    expect(c.list).toMatchObject({ model: "list-model", input_usd_per_mtok: 0.2, output_usd_per_mtok: 1.0 });
    // 1,000,000 in at 0.2 + 50,000 out at 1.0 per million.
    expect(c.list.cost_usd).toBeCloseTo(0.25, 10);
  });

  it("prices a reading with no stored cost at its model, or at the highest Dolphin price when the model is unlisted", () => {
    const known = readingCost(ledger([["d1", "dolphin", "dolphin-a", 1_000_000, 1_000_000, null]]), cfg)!;
    expect(known.cost_usd).toBeCloseTo(0.11, 10);
    const unknown = readingCost(ledger([["d1", "dolphin", "unlisted", 1_000_000, 1_000_000, null]]), cfg)!;
    expect(unknown.cost_usd).toBeCloseTo(0.32, 10);
    const noTokens = readingCost(ledger([["d1", "dolphin", "dolphin-a", null, null, null]]), cfg)!;
    expect(noTokens).toMatchObject({ readings: 1, tokens: 0, cost_usd: 0 });
  });
});

describe("readingCostSection", () => {
  const cost: ReadingCost = {
    readings: 2,
    tokens_in: 1_000_000,
    tokens_out: 50_000,
    tokens: 1_050_000,
    cost_usd: 0.014,
    list: { model: "list-model", input_usd_per_mtok: 0.2, output_usd_per_mtok: 1, cost_usd: 0.25 },
    price_sources: { serv: "https://serv.example/prices", dolphin: "https://dolphin.example/prices" },
  };

  it("writes every number from the cost it is given, with the price sources", () => {
    const s = readingCostSection(cost, "2026-11-10");
    expect(s).toContain("## Reading cost");
    expect(s).toContain("Tokens read on Dolphin: 1,050,000 (1,000,000 in, 50,000 out) over 2 stored readings.");
    expect(s).toContain("Cost of those readings on Dolphin: USD 0.0140.");
    expect(s).toContain("`list-model`");
    expect(s).toContain("USD 0.2500");
    expect(s).toContain("(https://serv.example/prices)");
    expect(s).toContain("(https://dolphin.example/prices)");
  });

  it("uses the singular for one reading", () => {
    expect(readingCostSection({ ...cost, readings: 1 }, "2026-11-10")).toContain("over 1 stored reading.");
  });

  it("says so when the ledger has no Dolphin reading", () => {
    expect(readingCostSection(null, "2026-11-10")).toContain("No reading on Dolphin is in the ledger yet.");
  });

  it("sits beside the baseline section and is replaced whole on the next run", () => {
    let doc = replaceSection("# What we measured\n", "robots-only-baseline", "## Robots-only baseline\n\nx");
    doc = replaceSection(doc, "reading-cost", readingCostSection(null, "2026-11-10"));
    doc = replaceSection(doc, "reading-cost", readingCostSection(cost, "2026-11-11"));
    expect(doc).toContain("## Robots-only baseline");
    expect(doc.match(/## Reading cost/g)).toHaveLength(1);
    expect(doc).not.toContain("No reading on Dolphin");
  });
});
