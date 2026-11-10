// Shared pieces of the inner pages: a heading block, dates in the reader's language, and a loader
// for one API view.
import { useEffect, useState, type ReactNode } from "react";
import type { Lang } from "../i18n";

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function day(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "ms" ? "ms-MY" : "en-GB", { dateStyle: "medium", timeZone: "UTC" });
}

/** Loads one view once; null while loading, "failed" when the API did not answer. */
export function useView<T>(load: () => Promise<T | null>): T | null | "failed" {
  const [view, setView] = useState<T | null | "failed">(null);
  useEffect(() => {
    void load()
      .then((v) => setView(v ?? "failed"))
      .catch(() => setView("failed"));
    // The loader is a module-level function, so the view is loaded once per page visit.
  }, []);
  return view;
}

/** US dollars with enough places for fractions of a cent. */
export const usd = (n: number) => (n === 0 ? "0" : n < 0.001 ? n.toFixed(5) : n.toFixed(4));
