// The receipt page (/r/:id): verdict, reason, deciding clauses with the exact quote and a link to
// the sentence at the source, then everything else that shows how the verdict was reached.
import { useEffect, useState } from "react";
import { getReceipt, type Receipt as R } from "../api";
import { CopyButton } from "../components/CopyButton";
import { LiveSteps } from "../components/LiveSteps";
import { VerdictBadge } from "../components/Verdict";
import { mergeMissing } from "../../../server/putus/siling";
import { fmt, useT, type Strings } from "../i18n";
import { NotFound } from "./NotFound";

type State = { kind: "loading" } | { kind: "running" } | { kind: "error" } | { kind: "not_found" } | { kind: "done"; receipt: R; costNow: number | null };

/**
 * Who read the documents. A check whose reading came from the saved store has no reader model of its own, so the
 * reader recorded for each document (for example "dolphin:org/Model") names it, marked as a saved reading.
 */
export function readerLine(r: Pick<R, "reader">): { provider: string; model: string; saved: boolean } | null {
  if (r.reader.model) return { provider: r.reader.provider ?? "", model: r.reader.model, saved: false };
  const doc = r.reader.per_doc.find((d) => d.cached && d.reader);
  if (!doc?.reader) return null;
  const at = doc.reader.indexOf(":");
  const provider = at > 0 ? doc.reader.slice(0, at) : "";
  const model = doc.reader.slice(at + 1).split("/").pop() ?? "";
  return model ? { provider, model, saved: true } : null;
}

/** The cost line under a receipt. A check that never called the decider says so, with the reader's cost alone. */
export function costLine(
  r: Pick<R, "reader" | "decider" | "totals">,
  costNow: number | null,
  p: { tokens: string; tokens_no_decider: string },
): string {
  const secs = (r.totals.ms / 1000).toFixed(1);
  const rin = r.reader.tokens_in, rout = r.reader.tokens_out;
  if (!r.decider.model) {
    const cost = r.reader.cost_usd ? r.reader.cost_usd.toFixed(4) : "0";
    return fmt(p.tokens_no_decider, { rin, rout, cost, secs });
  }
  return fmt(p.tokens, { rin, rout, din: r.decider.tokens_in, dout: r.decider.tokens_out, cost: costNow === null ? "·" : costNow.toFixed(4), secs });
}

/** "What is missing or unread": one line per URL, with stored state codes in words. */
export function missingLines(missing: readonly string[], why: Record<string, string>): string[] {
  return mergeMissing(missing, (s) => why[s] ?? s);
}

function age(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 172_800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} d`;
}

export function ReceiptPage({ id, pollMs, stepMs }: { id: string; pollMs: number; stepMs: number[] }) {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const r = await getReceipt(id);
      if (stop) return;
      if (r === "not_found") return setState({ kind: "not_found" });
      if (r?.status === "done" && r.receipt) return setState({ kind: "done", receipt: r.receipt, costNow: r.cost_usd_now ?? null });
      if (r?.status === "error") return setState({ kind: "error" });
      setState({ kind: "running" });
      timer = setTimeout(() => void tick(), pollMs);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, pollMs]);

  useEffect(() => {
    document.title = `${fmt(t.web.receipt_page.title, { id })} · ${t.app.name}`;
  }, [id, t]);

  if (state.kind === "not_found") return <NotFound />;
  if (state.kind !== "done") {
    return (
      <section className="section">
        <div className="wrap narrow">
          {state.kind === "error" ? <p className="problem" role="alert">{t.web.errors.failed}</p> : <LiveSteps stepMs={stepMs} failed={false} />}
        </div>
      </section>
    );
  }
  return <ReceiptView r={state.receipt} costNow={state.costNow} t={t} />;
}

function ReceiptView({ r, costNow, t }: { r: R; costNow: number | null; t: Strings }) {
  const { lang } = useT();
  const p = t.web.receipt_page;
  const decisive = r.clauses.filter((c) => c.decisive);
  const others = r.clauses.filter((c) => !c.decisive);
  const noRefetch = new URLSearchParams(location.search).has("nr");
  const when = new Date(r.created_at).toLocaleString(lang === "ms" ? "ms-MY" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  const link = `${location.origin}/r/${r.id}`;
  const read = readerLine(r);
  const providerName = read?.provider === "dolphin" ? p.provider_dolphin : p.provider_serv;
  const stop = r.signals.robots_stop;

  return (
    <article className="receipt">
      <header className={`receipt-head tone-${r.verdict.toLowerCase()}`}>
        <div className="wrap narrow">
          <p className="receipt-for">{fmt(p.for, { action: t.actions[r.action], site: r.site })}</p>
          <div className="receipt-verdict">
            <VerdictBadge verdict={r.verdict} size="lg" />
            <p className="receipt-def">{t.verdicts[r.verdict].definition}</p>
          </div>
          <p className="receipt-meta">
            <span>{fmt(p.checked, { date: when })}</span>
            <span className="mono">{r.id}</span>
          </p>
        </div>
      </header>

      <div className="wrap narrow receipt-body">
        {noRefetch ? <p className="banner">{p.no_refetch}</p> : null}
        {r.cached.hit ? <p className="hint">{fmt(p.cached, { age: age(r.cached.age_s) })}</p> : null}

        <section aria-labelledby="why">
          <h2 id="why">{p.reason}</h2>
          <p className="reason">{r.reason}</p>
          {r.detail ? <p className="hint">{p.detail}: <span className="mono">{r.detail}</span></p> : null}
        </section>

        {r.conditions.length ? (
          <section aria-labelledby="cond">
            <h2 id="cond">{p.conditions}</h2>
            <ul>{r.conditions.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        ) : null}

        {r.missing.length ? (
          <section aria-labelledby="miss">
            <h2 id="miss">{p.missing}</h2>
            <ul>{missingLines(r.missing, t.receipt.unreadable_why).map((m) => <li key={m}>{m}</li>)}</ul>
          </section>
        ) : null}

        <section aria-labelledby="dec">
          <h2 id="dec">{p.decisive}</h2>
          {decisive.length ? decisive.map((c) => <Clause key={c.id} c={c} t={t} />) : <p className="hint">{p.decisive_none}</p>}
        </section>

        {others.length ? (
          <details className="fold">
            <summary>{fmt(p.other, { n: others.length })}</summary>
            {others.map((c) => <Clause key={c.id} c={c} t={t} />)}
          </details>
        ) : null}

        {r.quarantined.length ? (
          <details className="fold fold-warn">
            <summary>{fmt(p.quarantined, { n: r.quarantined.length })}</summary>
            <p className="hint">{p.quarantined_note}</p>
            {r.quarantined.map((q, i) => (
              <blockquote key={i} className="quote quote-quarantine"><p>{q.text}</p><cite className="mono">{q.doc}</cite></blockquote>
            ))}
          </details>
        ) : null}

        <section aria-labelledby="led">
          <h2 id="led">{p.ledger}</h2>
          <p>{fmt(p.fetched, { what: t.receipt.fetched[r.fetched.scope] })}</p>
          {r.signals.docs.some((d) => d.kind === "pasted") ? <p><strong>{p.pasted_note}</strong></p> : null}
          {stop?.sentence ? (
            <blockquote className="quote"><p>{stop.sentence}</p><cite>{p.robots_stop}</cite></blockquote>
          ) : null}
          <div className="scroll-x">
            <table className="ledger">
              <thead>
                <tr><th scope="col">{p.ledger_url}</th><th scope="col">{p.ledger_status}</th><th scope="col">{p.ledger_sha}</th><th scope="col">{p.ledger_time}</th></tr>
              </thead>
              <tbody>
                {r.fetch_ledger.map((f, i) => (
                  <tr key={`${f.url}-${i}`}>
                    <td className="mono break">{f.url}</td>
                    <td className="mono">{f.status || f.state}</td>
                    <td className="mono">{f.sha256 ? f.sha256.slice(0, 12) : "·"}</td>
                    <td className="mono">{f.fetched_at.slice(11, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="prov">
          <p>
            {read ? fmt(read.saved ? p.read_saved : p.read_by, { model: read.model, provider: providerName }) : p.read_none}
            {" · "}
            {r.decider.model ? fmt(r.decider.fallback ? p.decided_by_fallback : p.decided_by, { model: r.decider.model }) : p.decided_none}
            {" · "}
            {r.decided_by.ceilings.length ? fmt(p.ceilings, { codes: r.decided_by.ceilings.join(", ") }) : p.ceilings_none}
          </p>
          <p className="hint">{costLine(r, costNow, p)}</p>
          <p className="hash"><span>{p.hash}</span> <code className="mono break">{r.receipt_sha256}</code></p>
          <p className="receipt-links">
            <CopyButton text={link} label={p.copy} done={p.copied} />
            <a href={`/r/${r.id}.json`}>{p.json}</a>
          </p>
        </section>

        <p className="disclaimer">{t.receipt.disclaimer}</p>
      </div>
    </article>
  );
}

function Clause({ c, t }: { c: R["clauses"][number]; t: Strings }) {
  const p = t.web.receipt_page;
  const cats = t.categories as Record<string, string>;
  const stances = t.stances as Record<string, string>;
  return (
    <figure className={`clause stance-${c.stance}`}>
      <blockquote className="quote"><p>{c.quote}</p></blockquote>
      <figcaption>
        <span className="tag">{stances[c.stance] ?? c.stance}</span>
        <span className="tag tag-quiet">{cats[c.category] ?? c.category}</span>
        {c.section ? <span className="hint">{fmt(p.section, { s: c.section })}</span> : null}
        <a href={c.fragment_url ?? c.source_url} target="_blank" rel="noopener noreferrer">{p.open_source}</a>
      </figcaption>
    </figure>
  );
}
