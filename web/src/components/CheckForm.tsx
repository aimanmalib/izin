// The check box: URL, one of six actions, optional detail, optional agent token, optional pasted
// terms. A new check shows the live steps and opens its receipt when done; a cached one opens at once.
import { useRef, useState, type FormEvent } from "react";
import type { Action, SiteView } from "../api";
import { fmt, useT } from "../i18n";
import { linkClick } from "../router";
import { LiveSteps } from "./LiveSteps";
import { ProblemLine, receiptPath, useCheckRun } from "./useCheckRun";

export function CheckForm({ site, paused }: { site: SiteView; paused: boolean }) {
  const { t } = useT();
  const f = t.web.form;
  const [url, setUrl] = useState("");
  const [action, setAction] = useState<Action>(site.action_order[0] ?? "purchase");
  const [detail, setDetail] = useState("");
  const [agent, setAgent] = useState("");
  const [paste, setPaste] = useState(false);
  const [terms, setTerms] = useState("");
  const { busy, running, failed, problem, setProblem, start } = useCheckRun(site.poll_ms);
  const [filled, setFilled] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    setFilled(false);
    // A bare domain such as "ebay.com" is taken as https.
    const typed = url.trim();
    const target = /^[a-z][a-z0-9+.-]*:/i.test(typed) || !/^[^\s/]+\.[^\s/]+/.test(typed) ? typed : `https://${typed}`;
    if (target !== typed) setUrl(target);
    if (!/^https?:\/\/\S+$/i.test(target)) {
      setProblem({ text: t.web.errors.invalid_url });
      urlRef.current?.focus();
      return;
    }
    await start({
      url: target,
      action,
      ...(detail.trim() ? { detail: detail.trim() } : {}),
      ...(agent.trim() ? { agent: agent.trim() } : {}),
      ...(paste && terms.trim() ? { terms_text: terms } : {}),
    });
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

        <ProblemLine problem={problem} />
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
