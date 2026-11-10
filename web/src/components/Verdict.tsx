// A verdict is always a colour and a word, never colour alone.
import type { Receipt } from "../api";
import { useT } from "../i18n";

export function VerdictBadge({ verdict, size = "md" }: { verdict: Receipt["verdict"]; size?: "sm" | "md" | "lg" }) {
  const { t } = useT();
  return (
    <span className={`verdict verdict-${verdict.toLowerCase()} verdict-${size}`}>
      <span className="verdict-mark" aria-hidden="true" />
      {t.verdicts[verdict].label}
    </span>
  );
}
