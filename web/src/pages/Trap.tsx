// /trap: what the trap shop is, a button that checks it, and a second check with a detail that
// tries to talk the decision into GO. The page promises no particular guard result; it says why the
// verdict cannot become GO and links the receipt.
import { useState } from "react";
import { getHealth, type SiteView } from "../api";
import { LiveSteps } from "../components/LiveSteps";
import { PageHead, useView } from "../components/Page";
import { ProblemLine, useCheckRun } from "../components/useCheckRun";
import { useT } from "../i18n";

const termsUrl = (trap: string) => new URL("terms", trap).toString();

export function TrapPage({ site }: { site: SiteView }) {
  const { t } = useT();
  const p = t.web.trap;
  const [detail, setDetail] = useState(p.talk_default);
  const [edited, setEdited] = useState(false);
  const { busy, running, failed, problem, start } = useCheckRun(site.poll_ms);
  const health = useView(getHealth);
  const paused = !!health && health !== "failed" && health.cache_only;
  const locked = busy || !!running || paused;
  // The prefilled detail follows the language toggle until the visitor edits it.
  const value = edited ? detail : p.talk_default;

  return (
    <div className="wrap page narrow">
      <PageHead title={p.h1}>
        <p className="lede">{p.intro}</p>
      </PageHead>
      <p>{p.expect}</p>
      <p>
        <a href={termsUrl(site.trap_url)} rel="noopener">{p.view_terms}</a>
      </p>
      {paused ? <p className="banner" role="status">{t.web.home.cache_only}</p> : null}

      <div className="trap-grid">
        <section className="panel" aria-labelledby="trap-1">
          <h2 id="trap-1">{p.check_head}</h2>
          <button type="button" className="btn btn-primary" disabled={locked} onClick={() => void start({ url: site.trap_url, action: "crawl" })}>
            {busy ? p.busy : p.check_btn}
          </button>
        </section>

        <section className="panel" aria-labelledby="trap-2">
          <h2 id="trap-2">{p.talk_head}</h2>
          <p>{p.talk_body}</p>
          <div className="field">
            <label htmlFor="trap-detail">{p.talk_label}</label>
            <textarea
              id="trap-detail" rows={2} maxLength={site.detail_max_chars} value={value} disabled={!!running}
              onChange={(e) => (setEdited(true), setDetail(e.target.value))}
            />
          </div>
          <button
            type="button" className="btn btn-quiet" disabled={locked || !value.trim()}
            onClick={() => void start({ url: site.trap_url, action: "crawl", detail: value.trim() })}
          >
            {p.talk_btn}
          </button>
        </section>
      </div>

      <ProblemLine problem={problem} />
      {running ? <LiveSteps stepMs={site.step_ms} failed={failed} /> : null}

      <section className="section-tight" aria-labelledby="why-h">
        <h2 id="why-h">{p.why_head}</h2>
        <ul>
          <li>{p.why_s8}</li>
          <li>{p.why_s6}</li>
        </ul>
        <p className="hint">{p.why_receipt}</p>
      </section>
    </div>
  );
}
