// The front page: the question, the one-click examples and one saved answer beside the check box,
// then how it works, the gallery excerpt, agent access, costs, a note for site owners and the limits.
import { useEffect, useRef, useState } from "react";
import { getGallery, getHealth, type Action, type SiteView } from "../api";
import { CheckForm, type CheckFormHandle } from "../components/CheckForm";
import { CopyButton } from "../components/CopyButton";
import { Examples } from "../components/Examples";
import { usd } from "../components/Page";
import { ReadingCost } from "../components/ReadingCost";
import { Sample } from "../components/Sample";
import { useCheckRun } from "../components/useCheckRun";
import { VerdictBadge } from "../components/Verdict";
import { fmt, useT } from "../i18n";
import { linkClick } from "../router";

type GalleryRows = NonNullable<Awaited<ReturnType<typeof getGallery>>>["sites"];


export function Home({ site }: { site: SiteView }) {
  const { t } = useT();
  const h = t.web.home;
  const [paused, setPaused] = useState(false);
  const [gallery, setGallery] = useState<GalleryRows>([]);
  const run = useCheckRun(site.poll_ms);
  const form = useRef<CheckFormHandle>(null);

  useEffect(() => {
    void getHealth().then((r) => setPaused(!!r?.cache_only)).catch(() => {});
    void getGallery()
      .then((g) => setGallery((g?.sites ?? []).filter((s) => Object.keys(s.checks).length > 0).slice(0, site.gallery_excerpt.rows)))
      .catch(() => {});
  }, [site.gallery_excerpt.rows]);

  const mcp = `claude mcp add --transport http izin ${site.origin}/mcp`;
  const curl = `curl -s ${site.origin}/api/check -H 'content-type: application/json' -d '{"url":"https://www.example.com/","action":"purchase"}'`;
  const excerptActions: Action[] = site.gallery_excerpt.actions;

  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <h1>{h.h1}</h1>
            <p className="lede">{h.sub}</p>
            <Examples examples={site.examples} disabled={!!run.running} onFill={(ex) => form.current?.fill(ex)} />
            {site.sample ? <Sample sample={site.sample} /> : null}
          </div>
          <div className="hero-check">
            {paused ? <p className="banner" role="status">{h.cache_only}</p> : null}
            <CheckForm site={site} paused={paused} run={run} ref={form} />
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="how">
        <div className="wrap">
          <h2 id="how" className="eyebrow">{h.steps_head}</h2>
          <ol className="three">
            {[
              [h.step1, h.step1_note],
              [h.step2, h.step2_note],
              [h.step3, h.step3_note],
            ].map(([head, note], i) => (
              <li key={head}>
                <span className="three-n" aria-hidden="true">{i + 1}</span>
                <h3>{head}</h3>
                <p>{note}</p>
              </li>
            ))}
          </ol>
          <p className="position">{h.position}</p>
        </div>
      </section>

      {gallery.length ? (
        <section className="section" aria-labelledby="gal">
          <div className="wrap">
            <h2 id="gal">{h.gallery_head}</h2>
            <div className="scroll-x">
              <table className="excerpt">
                <thead>
                  <tr>
                    <th scope="col">{h.gallery_site}</th>
                    {excerptActions.map((a) => <th key={a} scope="col">{t.actions[a]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {gallery.map((row) => (
                    <tr key={row.host}>
                      <th scope="row" className="mono">{row.host}</th>
                      {excerptActions.map((a) => {
                        const c = row.checks[a];
                        return (
                          <td key={a}>
                            {c?.verdict ? <a href={`/r/${c.receipt_id}`} onClick={linkClick}><VerdictBadge verdict={c.verdict} size="sm" /></a> : <span className="muted">·</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p><a href="/gallery" onClick={linkClick}>{h.gallery_link}</a></p>
          </div>
        </section>
      ) : null}

      <section className="section" id="agents" aria-labelledby="agents-h">
        <div className="wrap split">
          <h2 id="agents-h">{h.agents_head}</h2>
          <div>
            <p>{h.agents_mcp}</p>
            <div className="code-row">
              <pre className="code"><code>{mcp}</code></pre>
              <CopyButton text={mcp} label={h.copy} done={h.copied} />
            </div>
            <p>{h.agents_curl}</p>
            <pre className="code"><code>{curl}</code></pre>
            <p className="hint">{h.agents_note}</p>
          </div>
        </div>
      </section>

      <section className="section" id="costs" aria-labelledby="costs-h">
        <div className="wrap split">
          <h2 id="costs-h">{h.costs_head}</h2>
          <div>
            <p>
              {site.cost
                ? fmt(h.costs_measured, { n: site.cost.checks, reader: usd(site.cost.reader_usd), decider: usd(site.cost.decider_usd) })
                : h.costs_none}
            </p>
            <ReadingCost cost={site.reading_cost} head={false} />
            <ul className="tiers">
              <li>{fmt(h.tier_free, { n: site.tiers.free_checks_per_hour })}</li>
              <li>
                {site.paid.live && site.market.paywall_url ? (
                  <>
                    {fmt(h.tier_agent_live_market, { network: site.paid.network_name, saved: site.paid.price_usd, path: site.paid.path, fresh: site.tiers.agent_usd_per_fresh_check })}{" "}
                    <a href={site.market.paywall_url} rel="noopener">{h.tier_market_link}</a>.
                  </>
                ) : site.paid.live ? (
                  fmt(h.tier_agent_live, { network: site.paid.network_name, saved: site.paid.price_usd, path: site.paid.path, fresh: site.tiers.agent_usd_per_fresh_check })
                ) : (
                  fmt(h.tier_agent, { saved: site.tiers.agent_usd_per_saved_answer, fresh: site.tiers.agent_usd_per_fresh_check })
                )}{" "}
                {fmt(h.tier_reuse, { h: site.api.cache_hours })}
              </li>
              <li>{fmt(h.tier_watch, { usd: site.tiers.watch_usd_per_month, sites: site.tiers.watch_sites })}</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section" id="owners" aria-labelledby="owners-h">
        <div className="wrap split">
          <h2 id="owners-h">{h.owners_head}</h2>
          <div>
            <p>{h.owners_body}</p>
            <p>{h.owners_refuse}</p>
            <pre className="code"><code>{"User-agent: IzinBot\nDisallow: /"}</code></pre>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="limits-h">
        <div className="wrap split">
          <h2 id="limits-h">{h.limits_head}</h2>
          <ul className="limits">
            {[h.limit_js, h.limit_robots, h.limit_lang, h.limit_go, h.limit_change].map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      </section>
    </>
  );
}
