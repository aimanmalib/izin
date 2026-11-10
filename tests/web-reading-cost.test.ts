// The reading cost line renders every number from the API in both languages, and stays out of the
// home page until the ledger has a Dolphin reading.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../lang/en.json";
import ms from "../lang/ms.json";
import type { ReadingCost as Cost } from "../server/belanja/kos.js";
import { ReadingCost } from "../web/src/components/ReadingCost.js";
import { LangContext, type Lang } from "../web/src/i18n.js";

const cost: Cost = {
  readings: 3,
  tokens_in: 120_000,
  tokens_out: 4_000,
  tokens: 124_000,
  cost_usd: 0.0015,
  list: { model: "list-model", input_usd_per_mtok: 0.2, output_usd_per_mtok: 1, cost_usd: 0.028 },
  price_sources: { serv: "https://serv.example/prices", dolphin: "https://dolphin.example/prices" },
};

function render(lang: Lang, c: Cost | null, head: boolean): string {
  const t = lang === "en" ? en : ms;
  return renderToStaticMarkup(createElement(LangContext.Provider, { value: { lang, t, setLang: () => {} } }, createElement(ReadingCost, { cost: c, head })));
}

describe("reading cost line", () => {
  it("shows tokens, Dolphin cost, the listed-price cost and both price sources", () => {
    const html = render("en", cost, true);
    expect(html).toContain("124,000 tokens on Dolphin over 3 stored readings (120,000 in, 4,000 out)");
    expect(html).toContain("USD 0.0015");
    expect(html).toContain("list-model would cost USD 0.0280");
    expect(html).toContain('href="https://serv.example/prices"');
    expect(html).toContain('href="https://dolphin.example/prices"');
  });
  it("uses the singular sentence for one reading", () => {
    const html = render("en", { ...cost, readings: 1 }, true);
    expect(html).toContain("over 1 stored reading (");
    expect(html).not.toContain("1 stored readings");
  });
  it("fills every slot in Malay too", () => {
    expect(render("ms", cost, true)).not.toMatch(/\{\w+\}/);
    expect(render("ms", null, true)).toContain(ms.web.bench.reading_cost_none);
  });
  it("renders nothing on the home page before a Dolphin reading", () => {
    expect(render("en", null, false)).toBe("");
    expect(render("en", cost, false)).not.toContain("<h2");
  });
});
