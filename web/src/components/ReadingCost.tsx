// The reading cost line: tokens the reader used on Dolphin, what they cost, and the same tokens at a
// listed SERV price. Shown on /bench and in "What it costs"; every number comes from the API.
import type { BenchView } from "../api";
import { fmt, useT } from "../i18n";
import { usd } from "./Page";

export function ReadingCost({ cost, head }: { cost: BenchView["reading_cost"]; head: boolean }) {
  const { t, lang } = useT();
  const b = t.web.bench;
  const n = (v: number) => v.toLocaleString(lang === "ms" ? "ms-MY" : "en-US");
  const body = cost ? (
    <>
      <p>
        {fmt(cost.readings === 1 ? b.reading_cost_line_one : b.reading_cost_line, {
          tokens: n(cost.tokens),
          readings: cost.readings,
          tokens_in: n(cost.tokens_in),
          tokens_out: n(cost.tokens_out),
          usd: usd(cost.cost_usd),
        })}
      </p>
      <p>{fmt(b.reading_cost_list, { model: cost.list.model, list_usd: usd(cost.list.cost_usd) })}</p>
      <p className="hint">
        {b.reading_cost_prices} <a href={cost.price_sources.serv} rel="noopener">SERV</a>, <a href={cost.price_sources.dolphin} rel="noopener">Dolphin</a>
      </p>
    </>
  ) : (
    <p>{b.reading_cost_none}</p>
  );
  if (!head) return cost ? <div className="reading-cost">{body}</div> : null;
  return (
    <section className="section-tight reading-cost" aria-labelledby="reading-cost-h">
      <h2 id="reading-cost-h">{b.reading_cost_head}</h2>
      {body}
    </section>
  );
}
