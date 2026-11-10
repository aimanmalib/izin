// Tolerant parser for the reader's reply: drops code fences, takes the first balanced JSON object
// and checks only the outer shape. Field values are checked later by the quote checker.
import type { RawClause, ReaderOutput } from "./types.js";

/** Returns the first balanced {...} in `s`, ignoring braces inside JSON strings. */
export function firstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseReaderReply(reply: string): ReaderOutput | null {
  const unfenced = reply.replace(/```[a-z]*\s*/giu, "");
  const raw = firstJsonObject(unfenced);
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.clauses)) return null;
  const clauses: RawClause[] = value.clauses.filter(isRecord).map((c) => ({
    quote: c.quote,
    section: c.section,
    category: c.category,
    stance: c.stance,
  }));
  const addressed = Array.isArray(value.addressed_to_ai) ? value.addressed_to_ai : [];
  const last = typeof value.last_updated === "string" ? value.last_updated : null;
  return { clauses, addressed_to_ai: addressed, last_updated: last };
}
