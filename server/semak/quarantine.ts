// Text addressed to AI readers. Sentences that match the configured patterns, and items the reader
// put in "addressed_to_ai" that really are in the document, are kept out of the evidence: the
// decider never sees them and the receipt lists them separately.
import type { IzinConfig } from "../config.js";
import type { CheckDoc } from "../baca/types.js";
import { normalise, normaliseWithMap } from "./normalize.js";
import { locate, type Span } from "./quotes.js";

export interface Quarantined extends Span {
  doc_id: string;
  text: string;
  source: "pattern" | "reader";
}

const BOUNDARY = /([.!?]+)(?=\s|$)|\n/gu;

/** Splits text into sentences with their original offsets. */
export function sentences(text: string): Span[] {
  const out: Span[] = [];
  const push = (from: number, to: number) => {
    while (from < to && /\s/u.test(text[from]!)) from++;
    while (to > from && /\s/u.test(text[to - 1]!)) to--;
    if (to > from) out.push({ start: from, end: to });
  };
  let start = 0;
  for (const m of text.matchAll(BOUNDARY)) {
    const end = m.index + (m[1]?.length ?? 0);
    push(start, end);
    start = m.index + m[0].length;
  }
  push(start, text.length);
  return out;
}

export function compilePatterns(cfg: IzinConfig): RegExp[] {
  return cfg.injection_patterns.map((p) => new RegExp(p, "iu"));
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Quarantines matching sentences and verified reader items for one document. */
export function quarantineDoc(doc: CheckDoc, addressed: unknown[], patterns: RegExp[], cfg: IzinConfig): Quarantined[] {
  const cap = cfg.reader.quarantine_max_chars;
  const found: Quarantined[] = [];
  const add = (span: Span, source: Quarantined["source"]) => {
    if (found.some((q) => overlaps(q, span))) return;
    found.push({ ...span, doc_id: doc.id, text: doc.text.slice(span.start, span.end).slice(0, cap), source });
  };
  for (const s of sentences(doc.text)) {
    const n = normalise(doc.text.slice(s.start, s.end));
    if (patterns.some((re) => re.test(n))) add(s, "pattern");
  }
  if (addressed.length > 0) {
    const norm = normaliseWithMap(doc.text);
    for (const item of addressed) {
      if (typeof item !== "string" || item.trim().length === 0) continue;
      const span = locate(norm, doc.text, item);
      if (span) add(span, "reader");
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** True when a clause overlaps quarantined text in the same document. */
export function isQuarantined(clause: Span & { doc_id: string }, q: Quarantined[]): boolean {
  return q.some((x) => x.doc_id === clause.doc_id && overlaps(x, clause));
}
