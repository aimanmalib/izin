// Readability of a candidate site for the reader, and the gallery picked from it. Pure functions:
// the network pass lives in scripts/readability.ts. A site that blocks IzinBot is reported as
// blocked; nothing here tries another route.
import type { Collected } from "../kumpul/types.js";

export type ReadabilityReason =
  | "read"
  | "robots_comments"
  | "do_not_fetch"
  | "blocked"
  | "robots_disallow"
  | "ai_input_no"
  | "needs_browser"
  | "no_policy_found"
  | "fetch_failed";

const READABLE: ReadonlySet<ReadabilityReason> = new Set(["read", "robots_comments"]);

export interface ReadabilitySite {
  host: string;
  group?: string;
  readable: boolean;
  reason: ReadabilityReason;
  /** robots.txt outcome: "ok", "none" (404) or the ledger state, with the HTTP status. */
  robots_status: string;
  robots_http: number;
  docs_read: number;
  requests: number;
  /** URLs of the policy pages read in full (no text is kept); robots.txt comments are not listed. */
  read_urls: string[];
  blocked_status?: number;
}

export interface Candidate {
  host: string;
  group?: string;
}

export interface GallerySite {
  host: string;
  group?: string;
  policy_hints: string[];
}

export interface Gallery {
  sites: GallerySite[];
  blocked_reader: { host: string; reason: ReadabilityReason; status?: number }[];
}

/**
 * Classifies one collector result. Readable = at least one text written by the site that may reach
 * the reader: a policy page read in full ("read"), or only the policy comments in robots.txt
 * ("robots_comments", for example when the terms pages answer with a block).
 */
export function classify(c: Candidate, out: Collected): ReadabilitySite {
  const robotsEntry = out.ledger.find((e) => e.kind === "robots");
  const readDocs = out.docs.filter((d) => d.state === "ok" && d.to_model && d.kind !== "pasted");
  const blocked = out.signals.blocked[0];
  const base = {
    host: c.host,
    ...(c.group ? { group: c.group } : {}),
    robots_status: out.robots?.state ?? (out.mode === "do_not_fetch" ? "not_fetched" : "none"),
    robots_http: robotsEntry?.status ?? 0,
    docs_read: readDocs.length,
    requests: out.requests_used,
    read_urls: [...new Set(readDocs.filter((d) => d.kind === "policy").map((d) => d.url))],
    ...(blocked ? { blocked_status: blocked.status } : {}),
  };
  const pages = readDocs.filter((d) => d.kind === "policy").length;
  const reason = reasonOf(out, pages, readDocs.length - pages);
  return { ...base, readable: READABLE.has(reason), reason };
}

function reasonOf(out: Collected, pages: number, commentDocs: number): ReadabilityReason {
  if (out.signals.do_not_fetch) return "do_not_fetch";
  if (out.signals.ai_input_no) return "ai_input_no";
  if (pages > 0) return "read";
  if (commentDocs > 0) return "robots_comments";
  if (out.signals.blocked.length) return "blocked";
  const states = out.ledger.map((e) => e.state);
  if (states.includes("robots_disallow")) return "robots_disallow";
  if (states.includes("needs_browser") || out.docs.some((d) => d.state === "needs_browser")) return "needs_browser";
  const home = out.ledger.find((e) => e.kind === "home");
  if (!home || home.state !== "ok") return "fetch_failed";
  return "no_policy_found";
}

/**
 * Picks the gallery: readable sites in candidate order (the order is the priority), up to `size`.
 * Every unreadable site goes to `blocked_reader` with its reason, so the page can list it.
 */
export function pickGallery(candidates: Candidate[], results: ReadabilitySite[], size: number): Gallery {
  const byHost = new Map(results.map((r) => [r.host, r]));
  const sites: GallerySite[] = [];
  const blocked: Gallery["blocked_reader"] = [];
  for (const c of candidates) {
    const r = byHost.get(c.host);
    if (!r || r.reason === "do_not_fetch") continue;
    if (!r.readable) {
      blocked.push({ host: r.host, reason: r.reason, ...(r.blocked_status ? { status: r.blocked_status } : {}) });
    } else if (sites.length < size) {
      sites.push({ host: r.host, ...(c.group ? { group: c.group } : {}), policy_hints: r.read_urls });
    }
  }
  return { sites, blocked_reader: blocked };
}
