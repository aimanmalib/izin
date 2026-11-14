// /bench: who could be read, then the benchmark run (Set A, Set B, decision step variants, total
// cost) once bench/results.json exists. Every number comes from the API; none is written here.
import type { PricedResults } from "../../../server/belanja/kos";
import { getBench } from "../api";
import { BaselineSummary } from "../components/Baseline";
import { day, PageHead, usd, useView } from "../components/Page";
import { ReadingCost } from "../components/ReadingCost";
import { VerdictBadge } from "../components/Verdict";
import { fmt, useT } from "../i18n";
import { linkClick } from "../router";


export function BenchPage() {
  const { t, lang } = useT();
  const b = t.web.bench;
  const bench = useView(getBench);

  if (bench === "failed") return <p className="wrap problem" role="alert">{t.web.errors.network}</p>;
  if (!bench) return <div className="wrap loading" aria-busy="true" />;
  const { readability: rd, results: rs, baseline, reading_cost, remeasure: re } = bench;
  const reShipped = re?.variants.find((v) => v.id === re.shipped);
  // Present when the server priced the saved run's SERV costs again with the current factor.
  const priced = rs && "serv_cost_factor" in rs ? (rs as PricedResults) : null;

  return (
    <div className="wrap page">
      <PageHead title={b.h1}>
        <p className="lede">{b.intro}</p>
      </PageHead>

      {rd ? (
        <section className="section-tight" aria-labelledby="read-h">
          <h2 id="read-h">{b.readability_head}</h2>
          <p>{fmt(b.readability_line, { date: day(rd.run_at, lang), ...rd.counts })}</p>
          <p className="hint mono break">{fmt(b.readability_ua, { ua: rd.user_agent })}</p>
        </section>
      ) : null}

      <BaselineSummary baseline={baseline} />

      <ReadingCost cost={reading_cost} head />

      {!rs ? (
        <p className="banner" role="status">{b.not_run}</p>
      ) : (
        <>
          <p>{fmt(b.run_at, { date: day(rs.run_at, lang), usd: usd(rs.total_cost_usd) })}</p>
          {priced ? (
            <p className="hint">{fmt(b.cost_factor_note, { now: priced.serv_cost_factor.now, then: priced.serv_cost_factor.at_run, then_usd: usd(priced.total_cost_usd_at_run) })}</p>
          ) : null}

          <section className="section-tight" aria-labelledby="a-h">
            <h2 id="a-h">{b.set_a_head}</h2>
            <div className="scroll-x" tabIndex={0} role="region" aria-labelledby="a-h">
              <table className="data">
                <thead>
                  <tr>
                    {[b.set_a_site, b.set_a_action, b.set_a_human, b.set_a_izin, b.set_a_match, b.set_a_note].map((h) => <th key={h} scope="col">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rs.set_a.map((r) => (
                    <tr key={`${r.site} ${r.action}`}>
                      <th scope="row" className="mono">{r.site}</th>
                      <td>{t.actions[r.action]}</td>
                      <td><VerdictBadge verdict={r.human_verdict} size="sm" /></td>
                      <td>
                        {r.izin_verdict ? (
                          r.receipt_id ? (
                            <a href={`/r/${r.receipt_id}`} onClick={linkClick}><VerdictBadge verdict={r.izin_verdict} size="sm" /></a>
                          ) : (
                            <VerdictBadge verdict={r.izin_verdict} size="sm" />
                          )
                        ) : (
                          <span className="muted">{b.none}</span>
                        )}
                      </td>
                      <td>{r.izin_verdict === r.human_verdict ? b.yes : b.no}</td>
                      <td className="wrap-cell">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section-tight" aria-labelledby="b-h">
            <h2 id="b-h">{b.set_b_head}</h2>
            <p>{fmt(b.set_b_line, { pairs: rs.set_b.pairs, agree: rs.set_b.agree, false_go: rs.set_b.false_go, false_no_go: rs.set_b.false_no_go })}</p>
            <p className="hint">{rs.set_b.owner_review ? b.set_b_review_yes : b.set_b_review_no}</p>
          </section>

          <section className="section-tight" aria-labelledby="v-h">
            <h2 id="v-h">{b.variants_head}</h2>
            <div className="scroll-x" tabIndex={0} role="region" aria-labelledby="v-h">
              <table className="data">
                <thead>
                  <tr>
                    {[b.v_id, b.v_model, b.v_agree, b.v_false_go, b.v_false_no_go, b.v_cost, b.v_ms].map((h) => <th key={h} scope="col">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rs.variants.map((v) => (
                    <tr key={v.id} className={v.shipped ? "is-shipped" : undefined}>
                      <th scope="row">
                        {v.id}
                        {v.shipped ? <span className="tag">{b.v_shipped}</span> : null}
                      </th>
                      <td className="mono">{v.model}</td>
                      <td>{v.agree}/{v.pairs}</td>
                      <td>{v.false_go}</td>
                      <td>{v.false_no_go}</td>
                      <td>{usd(v.cost_usd_per_decision)}</td>
                      <td>{Math.round(v.median_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {re && reShipped ? (
            <section className="section-tight" aria-labelledby="re-h">
              <h2 id="re-h">{b.remeasure_head}</h2>
              <p>
                {fmt(b.remeasure_line, {
                  id: reShipped.id,
                  date: day(re.source_run_at, lang),
                  ceilings: re.ceilings.join(", "),
                  pairs: reShipped.after.pairs,
                  agree: reShipped.after.agree,
                  false_go: reShipped.after.false_go,
                  false_no_go: reShipped.after.false_no_go,
                  agree_before: reShipped.before.agree,
                  false_go_before: reShipped.before.false_go,
                  false_no_go_before: reShipped.before.false_no_go,
                })}
              </p>
              {re.variants
                .filter((v) => v.id !== re.shipped)
                .map((v) => (
                  <p key={v.id}>{fmt(b.remeasure_other, { id: v.id, pairs: v.after.pairs, agree: v.after.agree, false_go: v.after.false_go, false_no_go: v.after.false_no_go })}</p>
                ))}
              <p className="hint">{b.remeasure_note}</p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
