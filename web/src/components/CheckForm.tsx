// The check box: URL, one of six actions, optional detail, optional agent token, optional pasted
// terms. A new check shows the live steps and opens its receipt when done; a cached one opens at once.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getReceipt, submitCheck, type Action, type SiteView } from "../api";
import { fmt, useT } from "../i18n";
import { linkClick, navigate } from "../router";
import { LiveSteps } from "./LiveSteps";

type Problem = { text: string; link?: string } | null;

function receiptPath(id: string, noRefetch?: boolean) {
  return `/r/${id}${noRefetch ? "?nr=1" : ""}`;
}

export function CheckForm({ site, paused }: { site: SiteView; paused: boolean }) {
  const { t } = useT();
  const f = t.web.form;
  const [url, setUrl] = useState("");
  const [action, setAction] = useState<Action>(site.action_order[0] ?? "purchase");
  const [detail, setDetail] = useState("");
  const [agent, setAgent] = useState("");
  const [paste, setPaste] = useState(false);
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [filled, setFilled] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!running) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const r = await getReceipt(running);
      if (stop) return;
      if (r && r !== "not_found" && r.status === "done") return navigate(receiptPath(running));
      if (r === "not_found" || (r && r.status === "error")) {
        setFailed(true);
        setProblem({ text: t.web.errors.failed });
        return;
      }
      setTimeout(() => void tick(), site.poll_ms);
    };
    const first = setTimeout(() => void tick(), site.poll_ms);
    return () => {
      stop = true;
      clearTimeout(first);
    };
  }, [running, site.poll_ms, t]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    setFilled(false);
    const target = url.trim();
    if (!/^https?:\/\/\S+$/i.test(target)) {
      setProblem({ text: t.web.errors.invalid_url });
      urlRef.current?.focus();
      return;
    }
    setBusy(true);
    const answer = await submitCheck({
      url: target,
      action,
      ...(detail.trim() ? { detail: detail.trim() } : {}),
      ...(agent.trim() ? { agent: agent.trim() } : {}),
      ...(paste && terms.trim() ? { terms_text: terms } : {}),
    });
    setBusy(false);
    switch (answer.kind) {
      case "accepted":
        if (answer.status === "done") return navigate(receiptPath(answer.id, answer.no_refetch));
        setFailed(false);
        setRunning(answer.id);
        return;
      case "invalid": {
        const known = t.web.errors as Record<string, string>;
        setProblem({ text: known[answer.code] ?? t.web.errors.invalid_url });
        return;
      }
      case "rate_limited":
        setProblem({
          text: answer.scope === "day" ? t.web.errors.rate_limited_day : fmt(t.web.errors.rate_limited, { min: Math.max(1, Math.ceil(answer.retry_after_s / 60)) }),
        });
        return;
      case "budget":
        setProblem(answer.cached_id ? { text: t.web.errors.budget_cached, link: receiptPath(answer.cached_id) } : { text: t.web.errors.budget });
        return;
      case "network":
        setProblem({ text: t.web.errors.network });
    }
  };

  const fillExample = (ex: SiteView["examples"][number]) => {
    setUrl(ex.site);
    setAction(ex.action);
    setFilled(true);
    setProblem(null);
    urlRef.current?.focus();
  };
  const exampleLabel = (key: string) => (f as Record<string, string>)[`example_${key}`] ?? key;

  return (
    <div className="check">
      <form className="check-form" onSubmit={(e) => void onSubmit(e)} noValidate aria-label={f.label}>
        <div className="field">
          <label htmlFor="f-url">{f.url}</label>
          <input
            id="f-url" ref={urlRef} name="url" type="url" inputMode="url" autoComplete="url" spellCheck={false}
            placeholder={f.url_placeholder} value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!running}
          />
        </div>

        <fieldset className="field chips" disabled={!!running}>
          <legend>{f.action}</legend>
          <div className="chip-row">
            {site.action_order.map((a) => (
              <label key={a} className="chip">
                <input type="radio" name="action" value={a} checked={action === a} onChange={() => setAction(a)} />
                <span>{t.actions[a]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="f-detail">{f.detail}</label>
          <textarea
            id="f-detail" name="detail" rows={2} maxLength={site.detail_max_chars} value={detail}
            onChange={(e) => setDetail(e.target.value)} aria-describedby="f-detail-hint" disabled={!!running}
          />
          <p id="f-detail-hint" className="hint">{fmt(f.detail_hint, { max: site.detail_max_chars })}</p>
        </div>

        {paste ? (
          <div className="field">
            <label htmlFor="f-terms">{f.terms}</label>
            <textarea
              id="f-terms" name="terms_text" rows={6} maxLength={site.terms_text_max_chars} value={terms}
              onChange={(e) => setTerms(e.target.value)} aria-describedby="f-terms-hint" disabled={!!running}
            />
            <p id="f-terms-hint" className="hint">{f.terms_hint}</p>
          </div>
        ) : null}

        <details className="more">
          <summary>{f.more}</summary>
          <div className="field">
            <label htmlFor="f-agent">{f.agent}</label>
            <input id="f-agent" name="agent" autoComplete="off" spellCheck={false} value={agent} onChange={(e) => setAgent(e.target.value)} aria-describedby="f-agent-hint" disabled={!!running} />
            <p id="f-agent-hint" className="hint">{f.agent_hint}</p>
          </div>
        </details>

        <div className="check-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !!running || paused}>
            {busy ? f.submitting : f.submit}
          </button>
          <button type="button" className="btn-link" onClick={() => setPaste(!paste)} disabled={!!running}>
            {paste ? f.paste_hide : f.paste}
          </button>
        </div>

        {problem ? (
          <p className="problem" role="alert">
            {problem.text}
            {problem.link ? <> <a href={problem.link} onClick={linkClick}>{t.web.live.open}</a></> : null}
          </p>
        ) : null}
        {filled ? <p className="hint" role="status">{f.example_filled}</p> : null}
      </form>

      {running ? <LiveSteps stepMs={site.step_ms} failed={failed} /> : null}

      {site.examples.length ? (
        <div className="examples">
          <span className="examples-head">{f.examples}</span>
          {site.examples.map((ex) =>
            ex.receipt_id ? (
              <a key={ex.key} className="example" href={receiptPath(ex.receipt_id)} onClick={linkClick}>{exampleLabel(ex.key)}</a>
            ) : (
              <button key={ex.key} type="button" className="example" onClick={() => fillExample(ex)} disabled={!!running}>
                {exampleLabel(ex.key)}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
