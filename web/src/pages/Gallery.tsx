// /gallery: the site by action matrix (verdict colour and word, each opening its receipt), the date
// each site was read, the method, and the separate list of sites IzinBot could not read.
import { getBench, getGallery, type Action, type SiteView } from "../api";
import { BaselineSummary } from "../components/Baseline";
import { day, PageHead, useView } from "../components/Page";
import { VerdictBadge } from "../components/Verdict";
import { fmt, useT } from "../i18n";
import { linkClick } from "../router";

const VERDICTS = ["GO", "ASK", "NO_GO"] as const;

export function GalleryPage({ site }: { site: SiteView }) {
  const { t, lang } = useT();
  const g = t.web.gallery;
  const gallery = useView(getGallery);
  const bench = useView(getBench);
  const actions: Action[] = site.action_order;
  const readOn = bench && bench !== "failed" && bench.readability ? day(bench.readability.run_at, lang) : null;

  if (gallery === "failed") return <p className="wrap problem" role="alert">{t.web.errors.network}</p>;
  if (!gallery) return <div className="wrap loading" aria-busy="true" />;
  const anyRun = gallery.sites.some((s) => Object.keys(s.checks).length > 0);
  const anyUndecided = gallery.sites.some((s) => Object.values(s.checks).some((c) => c?.verdict && c.decided === "none"));
  const reasons = g.reasons as Record<string, string>;
  const groups = g.groups as Record<string, string>;

  return (
    <div className="wrap page">
      <PageHead title={g.h1}>
        <p className="lede">{g.intro}</p>
        {readOn ? <p className="hint">{fmt(g.method, { date: readOn })}</p> : null}
      </PageHead>

      <dl className="legend" aria-label={g.legend}>
        {VERDICTS.map((v) => (
          <div key={v}>
            <dt><VerdictBadge verdict={v} size="sm" /></dt>
            <dd>{t.verdicts[v].definition}</dd>
          </div>
        ))}
        {anyUndecided ? (
          <div>
            <dt><span className="not-decided">{g.not_decided}</span></dt>
            <dd>{g.not_decided_title}</dd>
          </div>
        ) : null}
      </dl>

      {anyRun ? null : <p className="banner" role="status">{g.none_yet}</p>}
      <BaselineSummary baseline={gallery.baseline} marked />

      <div className="scroll-x matrix-wrap" tabIndex={0} role="region" aria-label={g.h1}>
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col">{g.site}</th>
              {actions.map((a) => <th key={a} scope="col">{t.actions[a]}</th>)}
              <th scope="col">{g.read}</th>
            </tr>
          </thead>
          <tbody>
            {gallery.sites.map((row) => {
              const dates = Object.values(row.checks).map((c) => c.updated_at).sort();
              const last = dates[dates.length - 1];
              return (
                <tr key={row.host}>
                  <th scope="row">
                    <span className="mono">{row.host}</span>
                    <span className="matrix-group">{groups[row.group] ?? row.group}</span>
                  </th>
                  {actions.map((a) => {
                    const c = row.checks[a];
                    return (
                      <td key={a} className={c?.words_restrict ? "is-words" : undefined}>
                        {c?.verdict && c.decided === "none" ? (
                          <a
                            href={`/r/${c.receipt_id}`}
                            onClick={linkClick}
                            className="not-decided"
                            title={g.not_decided_title}
                            aria-label={`${row.host}, ${t.actions[a]}: ${g.not_decided}`}
                          >
                            {g.not_decided}
                          </a>
                        ) : c?.verdict ? (
                          <>
                            <a href={`/r/${c.receipt_id}`} onClick={linkClick} aria-label={`${row.host}, ${t.actions[a]}: ${t.verdicts[c.verdict].label}`}>
                              <VerdictBadge verdict={c.verdict} size="sm" />
                            </a>
                            {c.robots_only ? <span className="robots-only">{g.robots_short[c.robots_only]}</span> : null}
                            {c.words_restrict ? <span className="sr">{g.words_restrict}</span> : null}
                          </>
                        ) : (
                          <span className="muted" title={g.not_run}>
                            <span aria-hidden="true">·</span>
                            <span className="sr">{g.not_run}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="matrix-date">{last ? day(last, lang) : <span className="muted">·</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {gallery.blocked_reader.length ? (
        <section className="section" aria-labelledby="blocked-h">
          <h2 id="blocked-h">{g.blocked_head}</h2>
          <p>{g.blocked_intro}</p>
          <ul className="blocked">
            {gallery.blocked_reader.map((b) => (
              <li key={b.host}>
                <span className="mono">{b.host}</span>
                <span className="blocked-why">{reasons[b.reason] ?? b.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
