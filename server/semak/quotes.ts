// Quote checker: a clause survives only if its quote is really in the document (after
// normalisation), is 40 to 600 characters long and uses the fixed vocabulary.
import type { IzinConfig, Stance } from "../config.js";
import type { CheckDoc, ReaderOutput } from "../baca/types.js";
import { codePointLength, normalise, normaliseWithMap, type Normalised } from "./normalize.js";

export interface Span {
  start: number;
  end: number;
}

export interface VerifiedClause extends Span {
  id: string;
  doc_id: string;
  /** The matching text exactly as it appears in the document. */
  quote: string;
  section: string;
  category: string;
  stance: Stance;
  /** Link that scrolls a browser to the quote, or null for pasted text. */
  link: string | null;
}

export interface QuoteCounts {
  dropped_quotes: number;
  dropped_enum: number;
  merged_duplicates: number;
}

const SECTION_MAX = 200;

/** Finds `needle` in the normalised document and returns the span in original offsets. */
export function locate(doc: Normalised, source: string, needle: string): Span | null {
  const n = normalise(needle);
  if (!n) return null;
  const at = doc.text.indexOf(n);
  if (at < 0) return null;
  const start = doc.map[at]!;
  const last = doc.map[at + n.length - 1]!;
  const cp = source.codePointAt(last) ?? 0;
  return { start, end: last + (cp > 0xffff ? 2 : 1) };
}

function encodeFragmentWord(w: string): string {
  return encodeURIComponent(w).replace(/-/g, "%2D");
}

/** Text fragment link (`#:~:text=`) built from the first words of the quote. */
export function fragmentLink(url: string, quote: string, words: number): string | null {
  let base: URL;
  try {
    base = new URL(url);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  base.hash = "";
  const head = quote.split(/\s+/u).filter(Boolean).slice(0, words);
  if (head.length === 0) return null;
  return `${base.toString()}#:~:text=${head.map(encodeFragmentWord).join("%20")}`;
}

export interface DocClauses {
  clauses: Omit<VerifiedClause, "id">[];
  counts: QuoteCounts;
}

/** Checks one document's clauses. Ids are assigned later across all documents. */
export function verifyDocClauses(doc: CheckDoc, out: ReaderOutput, cfg: IzinConfig): DocClauses {
  const counts: QuoteCounts = { dropped_quotes: 0, dropped_enum: 0, merged_duplicates: 0 };
  const norm = normaliseWithMap(doc.text);
  const categories = new Set(cfg.categories);
  const stances = new Set<string>(cfg.stances);
  const { quote_min_chars: min, quote_max_chars: max } = cfg.limits;
  const clauses: Omit<VerifiedClause, "id">[] = [];

  for (const raw of out.clauses.slice(0, cfg.reader.max_clauses)) {
    if (typeof raw.category !== "string" || !categories.has(raw.category) || typeof raw.stance !== "string" || !stances.has(raw.stance)) {
      counts.dropped_enum++;
      continue;
    }
    if (typeof raw.quote !== "string") {
      counts.dropped_quotes++;
      continue;
    }
    const len = codePointLength(raw.quote);
    const span = len >= min && len <= max ? locate(norm, doc.text, raw.quote) : null;
    if (!span) {
      counts.dropped_quotes++;
      continue;
    }
    const quote = doc.text.slice(span.start, span.end);
    clauses.push({
      ...span,
      doc_id: doc.id,
      quote,
      section: typeof raw.section === "string" ? raw.section.trim().slice(0, SECTION_MAX) : "",
      category: raw.category,
      stance: raw.stance as Stance,
      link: doc.kind === "pasted" ? null : fragmentLink(doc.url, quote, cfg.reader.fragment_words),
    });
  }
  return { clauses, counts };
}

/** Merges clauses with the same normalised quote (first one wins) and numbers them c1..cn. */
export function numberClauses(all: Omit<VerifiedClause, "id">[]): { clauses: VerifiedClause[]; merged: number } {
  const seen = new Set<string>();
  const clauses: VerifiedClause[] = [];
  let merged = 0;
  for (const c of all) {
    const key = normalise(c.quote);
    if (seen.has(key)) {
      merged++;
      continue;
    }
    seen.add(key);
    clauses.push({ ...c, id: `c${clauses.length + 1}` });
  }
  return { clauses, merged };
}
