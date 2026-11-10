// Starting a check and following it to its receipt, shared by the check form and the trap page:
// submit, show the API's refusals in plain words, poll while it runs, open the receipt when done.
import { useEffect, useState } from "react";
import { getReceipt, submitCheck, type CheckBody } from "../api";
import { fmt, useT } from "../i18n";
import { linkClick, navigate } from "../router";

export type Problem = { text: string; link?: string } | null;

export function receiptPath(id: string, noRefetch?: boolean) {
  return `/r/${id}${noRefetch ? "?nr=1" : ""}`;
}

export function useCheckRun(pollMs: number) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);

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
      setTimeout(() => void tick(), pollMs);
    };
    const first = setTimeout(() => void tick(), pollMs);
    return () => {
      stop = true;
      clearTimeout(first);
    };
  }, [running, pollMs, t]);

  const start = async (body: CheckBody) => {
    setProblem(null);
    setBusy(true);
    const answer = await submitCheck(body);
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

  return { busy, running, failed, problem, setProblem, start };
}

export function ProblemLine({ problem }: { problem: Problem }) {
  const { t } = useT();
  if (!problem) return null;
  return (
    <p className="problem" role="alert">
      {problem.text}
      {problem.link ? <> <a href={problem.link} onClick={linkClick}>{t.web.live.open}</a></> : null}
    </p>
  );
}
