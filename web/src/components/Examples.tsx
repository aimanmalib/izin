// The one-click examples under the lede: one with a saved receipt opens it at once; one without
// fills the check form.
import type { FocusEvent } from "react";
import type { SiteView } from "../api";
import { useT } from "../i18n";
import { linkClick } from "../router";
import { receiptPath } from "./useCheckRun";

export type Example = SiteView["examples"][number];

// On a phone the row scrolls sideways; keyboard focus on an example the row cuts off brings all of it into view.
const reveal = (e: FocusEvent<HTMLElement>) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });

export function Examples({ examples, disabled, onFill }: { examples: Example[]; disabled: boolean; onFill: (ex: Example) => void }) {
  const { t } = useT();
  const f = t.web.form;
  if (!examples.length) return null;
  const label = (key: string) => (f as Record<string, string>)[`example_${key}`] ?? key;
  return (
    <div className="examples" role="group" aria-labelledby="examples-head">
      <span id="examples-head" className="examples-head">{f.examples}</span>
      {examples.map((ex) =>
        ex.receipt_id ? (
          <a key={ex.key} className="example" href={receiptPath(ex.receipt_id)} onClick={linkClick} onFocus={reveal}>{label(ex.key)}</a>
        ) : (
          <button key={ex.key} type="button" className="example" onClick={() => onFill(ex)} onFocus={reveal} disabled={disabled}>
            {label(ex.key)}
          </button>
        ),
      )}
    </div>
  );
}
