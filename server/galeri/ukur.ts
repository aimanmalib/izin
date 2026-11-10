// Writes generated sections of docs/UKUR.md. Each section sits between two marker comments and is
// replaced whole on every run, so the numbers in the file always come from the latest data.
import type { Action } from "../config.js";
import type { BaselineCounts } from "./baseline.js";
import type { GalleryCell } from "../api/views.js";

export interface GallerySlice {
  sites: { host: string; checks: Partial<Record<Action, GalleryCell>> }[];
  baseline: BaselineCounts;
}

const start = (name: string) => `<!-- izin:${name}:start -->`;
const end = (name: string) => `<!-- izin:${name}:end -->`;

/** Replaces the named section (markers included) or appends it when the file has none yet. */
export function replaceSection(doc: string, name: string, body: string): string {
  const block = `${start(name)}\n${body.trim()}\n${end(name)}`;
  const a = doc.indexOf(start(name));
  const b = doc.indexOf(end(name));
  if (a >= 0 && b > a) return doc.slice(0, a) + block + doc.slice(b + end(name).length);
  return `${doc.trimEnd()}\n\n${block}\n`;
}

/** The "Robots-only baseline" section, from the gallery view. Every number is counted here. */
export function baselineSection(g: GallerySlice, origin: string, at: string): string {
  const b = g.baseline;
  const lines = [
    "## Robots-only baseline",
    "",
    `Generated ${at} from the gallery receipts. Definition: [ADR 0010](decisions/0010-robots-only-baseline.md).`,
    "",
  ];
  if (!b.pairs) return [...lines, "No gallery pair has a receipt yet."].join("\n");
  lines.push(
    `Gallery pairs with a receipt: ${b.pairs}. A robots.txt parser alone (IzinBot, \`*\` and the agent token) answers allowed for ${b.allowed}, disallowed for ${b.disallowed}, and has no robots.txt to read for ${b.no_robots}.`,
    "",
    `Pairs where robots.txt allows the URL but a quoted clause from the site (a robots.txt comment or the terms) restricts or forbids the action, and Izin answered ASK or NO-GO on that clause: **${b.robots_allowed_words_restrict} of ${b.allowed}**.`,
    "",
    "An ASK that comes only from a block, an unreadable page or an unavailable decision step is not counted.",
  );
  const counted = g.sites.flatMap((s) =>
    Object.entries(s.checks)
      .filter(([, c]) => c?.words_restrict)
      .map(([action, c]) => `- ${s.host}, ${action}: ${c!.verdict ?? "?"}, [receipt](${origin.replace(/\/$/, "")}/r/${c!.receipt_id})`),
  );
  if (counted.length) lines.push("", "Counted pairs:", "", ...counted);
  return lines.join("\n");
}
