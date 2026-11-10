import { useState } from "react";

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (insecure context or permission); the text stays visible to copy by hand.
    }
  };
  return (
    <button type="button" className="btn btn-quiet" onClick={() => void copy()} aria-live="polite">
      {copied ? done : label}
    </button>
  );
}
