// The robots-only baseline in words: how often robots.txt alone allows a pair while the site's own
// quoted clause restricts it. Shown on /gallery and /bench; the numbers come from the API.
import type { GalleryView } from "../api";
import { fmt, useT } from "../i18n";

export function BaselineSummary({ baseline, marked }: { baseline: GalleryView["baseline"] | null; marked?: boolean }) {
  const { t } = useT();
  const g = t.web.gallery;
  if (!baseline || baseline.pairs === 0) return null;
  return (
    <section className="section-tight baseline" aria-labelledby="baseline-h">
      <h2 id="baseline-h">{g.baseline_head}</h2>
      <p className="baseline-figure">
        <span className="baseline-num">{baseline.robots_allowed_words_restrict}</span>
        <span className="baseline-of">/ {baseline.allowed}</span>
      </p>
      <p>{fmt(baseline.allowed === 1 ? g.baseline_line_one : g.baseline_line, { count: baseline.robots_allowed_words_restrict, allowed: baseline.allowed })}</p>
      <p className="hint">{fmt(baseline.pairs === 1 ? g.baseline_split_one : g.baseline_split, { ...baseline })}</p>
      {marked ? <p className="hint">{g.baseline_note}</p> : null}
    </section>
  );
}
