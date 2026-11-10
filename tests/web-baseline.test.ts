// The baseline summary picks the singular sentence when a count is one, in both languages.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../lang/en.json";
import ms from "../lang/ms.json";
import { BaselineSummary } from "../web/src/components/Baseline.js";
import { LangContext, type Lang } from "../web/src/i18n.js";

const counts = (pairs: number, allowed: number, hit: number) => ({
  pairs,
  allowed,
  disallowed: pairs - allowed,
  no_robots: 0,
  robots_allowed_words_restrict: hit,
});

function render(lang: Lang, b: ReturnType<typeof counts>): string {
  const t = lang === "en" ? en : ms;
  return renderToStaticMarkup(
    createElement(LangContext.Provider, { value: { lang, t, setLang: () => {} } }, createElement(BaselineSummary, { baseline: b, marked: true })),
  );
}

describe("baseline summary wording", () => {
  it("uses the singular sentences for one pair", () => {
    const html = render("en", counts(1, 1, 1));
    expect(html).not.toMatch(/\b1 pairs\b|of 1 pairs/);
    expect(html).toContain("in 1 pair.");
    expect(html).toContain("for 1 pair:");
  });
  it("uses the plural sentences otherwise", () => {
    const html = render("en", counts(3, 2, 1));
    expect(html).toContain("In 1 of 2 pairs");
    expect(html).toContain("over 3 pairs");
  });
  it("fills every slot in Malay too", () => {
    for (const b of [counts(1, 1, 0), counts(4, 3, 2)]) expect(render("ms", b)).not.toMatch(/\{\w+\}/);
  });
});
