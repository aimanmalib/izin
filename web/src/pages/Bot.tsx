// /bot: who IzinBot is, what it fetches and how often, what happens when terms forbid automation,
// how to keep it out, where the text goes, and how to get in touch.
import type { SiteView } from "../api";
import { PageHead } from "../components/Page";
import { fmt, useT } from "../i18n";

export function BotPage({ site }: { site: SiteView }) {
  const { t } = useT();
  const b = t.web.bot;
  const n = site.bot;

  return (
    <div className="wrap page narrow">
      <PageHead title={b.h1}>
        <p className="lede">{b.intro}</p>
      </PageHead>

      <section className="section-tight" aria-labelledby="ua-h">
        <h2 id="ua-h">{b.ua_head}</h2>
        <pre className="code"><code>{n.user_agent}</code></pre>
      </section>

      <section className="section-tight" aria-labelledby="fetch-h">
        <h2 id="fetch-h">{b.fetch_head}</h2>
        <ul className="defs">
          <li>{b.fetch_robots}</li>
          <li>{b.fetch_home}</li>
          <li>{fmt(b.fetch_docs, { n: n.policy_docs_max })}</li>
        </ul>
        <p>{fmt(b.fetch_total, { n: n.requests_per_check, s: n.fetch_timeout_s })}</p>
      </section>

      <section className="section-tight" aria-labelledby="rate-h">
        <h2 id="rate-h">{b.rate_head}</h2>
        <p>{fmt(b.rate_body, { s: n.host_interval_s, max: n.crawl_delay_max_s, h: site.api.cache_hours })}</p>
        <p>{fmt(b.stop_body, { days: n.no_refetch_days })}</p>
      </section>

      <section className="section-tight" aria-labelledby="refuse-h">
        <h2 id="refuse-h">{b.refuse_head}</h2>
        <p>{b.refuse_body}</p>
        <pre className="code"><code>{"User-agent: IzinBot\nDisallow: /"}</code></pre>
        <p>{b.refuse_after}</p>
      </section>

      <section className="section-tight" aria-labelledby="models-h">
        <h2 id="models-h">{b.models_head}</h2>
        <p>{b.models_body}</p>
      </section>

      <section className="section-tight" aria-labelledby="contact-h">
        <h2 id="contact-h">{b.contact_head}</h2>
        <p>
          {b.contact_body}{" "}
          <a href={`${site.repo_url}/issues`} rel="noopener" className="break">{site.repo_url.replace(/^https:\/\//, "")}</a>
        </p>
      </section>
    </div>
  );
}
