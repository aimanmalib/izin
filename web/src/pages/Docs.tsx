// /docs: the MCP line, the HTTP endpoints, errors and limits, and the action ids. Numbers come from
// /api/site, which reads the same config the server enforces.
import type { SiteView } from "../api";
import { CopyButton } from "../components/CopyButton";
import { PageHead } from "../components/Page";
import { fmt, useT } from "../i18n";

export function DocsPage({ site }: { site: SiteView }) {
  const { t } = useT();
  const d = t.web.docs;
  const mcp = `claude mcp add --transport http izin ${site.origin}/mcp`;
  const curl = `curl -s ${site.origin}/api/check -H 'content-type: application/json' -d '{"url":"https://www.example.com/","action":"purchase"}'`;
  const endpoints: [string, string][] = [
    ["POST /api/check", fmt(d.check, { n: site.detail_max_chars })],
    ["GET /api/receipt/{id}", d.receipt],
    ["GET /r/{id}.json", d.receipt_json],
    ["GET /api/gallery", d.gallery],
    ["GET /api/bench", d.bench],
    ["GET /api/health", d.health],
    ...(site.paid.live
      ? ([[`GET ${site.paid.path}?url=…&action=…`, fmt(d.paid, { network: site.paid.network_name, usd: site.paid.price_usd })]] as [string, string][])
      : []),
  ];

  return (
    <div className="wrap page narrow">
      <PageHead title={d.h1}>
        <p className="lede">{d.intro}</p>
      </PageHead>

      <section className="section-tight" aria-labelledby="mcp-h">
        <h2 id="mcp-h">{d.mcp_head}</h2>
        <p>{d.mcp_line}</p>
        <div className="code-row">
          <pre className="code"><code>{mcp}</code></pre>
          <CopyButton text={mcp} label={t.web.home.copy} done={t.web.home.copied} />
        </div>
        <ul className="defs">
          <li>{fmt(d.mcp_check, { s: site.api.mcp_wait_s })}</li>
          <li>{d.mcp_receipt}</li>
        </ul>
      </section>

      <section className="section-tight" aria-labelledby="api-h">
        <h2 id="api-h">{d.api_head}</h2>
        <dl className="endpoints">
          {endpoints.map(([route, text]) => (
            <div key={route}>
              <dt><code>{route}</code></dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p>{d.example}</p>
        <pre className="code"><code>{curl}</code></pre>
      </section>

      <section className="section-tight" aria-labelledby="err-h">
        <h2 id="err-h">{d.errors_head}</h2>
        <ul className="defs">
          <li>{d.e400}</li>
          {site.paid.live ? <li>{d.e402}</li> : null}
          <li>{d.e429}</li>
          <li>{d.e503}</li>
        </ul>
        <p>{fmt(d.limits, { hour: site.tiers.free_checks_per_hour, day: site.api.checks_per_day, h: site.api.cache_hours })}</p>
      </section>

      <section className="section-tight" aria-labelledby="act-h">
        <h2 id="act-h">{d.actions_head}</h2>
        <dl className="endpoints">
          {site.action_order.map((a) => (
            <div key={a}>
              <dt><code>{a}</code></dt>
              <dd>{t.actions[a]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
