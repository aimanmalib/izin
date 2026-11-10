// The five steps of a running check. The server does not stream progress, so the highlighted step
// follows rough timings from config; the receipt, not this list, says when the check is done.
import { useEffect, useState } from "react";
import { useT } from "../i18n";

export function LiveSteps({ stepMs, failed }: { stepMs: number[]; failed: boolean }) {
  const { t } = useT();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(timer);
  }, []);
  let current = 0;
  let acc = 0;
  for (let i = 0; i < stepMs.length - 1; i++) {
    acc += stepMs[i] ?? 0;
    if (elapsed >= acc) current = i + 1;
  }
  const labels = [t.web.live.s1, t.web.live.s2, t.web.live.s3, t.web.live.s4, t.web.live.s5];
  return (
    <div className="live" role="status" aria-live="polite">
      <p className="live-head">{t.web.live.head}</p>
      <ol className="live-steps">
        {labels.map((label, i) => (
          <li key={label} className={i < current ? "is-done" : i === current && !failed ? "is-now" : ""} aria-current={i === current ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ol>
      <p className="live-note">{t.web.live.note}</p>
    </div>
  );
}
