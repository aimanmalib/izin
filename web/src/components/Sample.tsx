// One saved answer at the top of the front page (the "sample" in config/examples.json): the
// verdict, the action and the site, one deciding clause set as the receipt sets its clauses, where
// the clause was read, and a link to the receipt it comes from.
import type { SiteView } from "../api";
import { fmt, useT } from "../i18n";
import { linkClick } from "../router";
import { receiptPath } from "./useCheckRun";
import { VerdictBadge } from "./Verdict";

export function Sample({ sample }: { sample: NonNullable<SiteView["sample"]> }) {
  const { t } = useT();
  const h = t.web.home;
  return (
    <section className={`sample sample-${sample.verdict.toLowerCase()}`} aria-label={h.sample_label}>
      <p className="sample-head">
        <VerdictBadge verdict={sample.verdict} />
        <span className="sample-for">{fmt(h.sample_for, { action: t.actions[sample.action], site: sample.site })}</span>
      </p>
      <figure className="clause">
        <blockquote className="quote"><p>{sample.quote}</p></blockquote>
        <figcaption>
          <cite className="sample-source mono">{sample.source}</cite>
          <a href={receiptPath(sample.receipt_id)} onClick={linkClick}>{h.sample_open}</a>
        </figcaption>
      </figure>
    </section>
  );
}
