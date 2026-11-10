// The three pre-registered benchmark sets (bench/manual.json, bench/labeled.json, bench/spot.json):
// their shapes, and the builder that turns one synthetic case into a small site (robots.txt, a home
// page, a terms page). The files are committed before any benchmark run, so the git history shows
// the expected answers were written first. Nothing here calls a model or the network.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ACTIONS, BENCH_DIR, VERDICTS } from "../config.js";

const verdict = z.enum(VERDICTS);
const action = z.enum(ACTIONS);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const httpsUrl = z.string().url().startsWith("https://");
/** Quotes of third-party text stay short and always carry their URL. */
const quote = z.string().min(1).max(600);

/** Set A: decisions recorded by the 5 Nov source review, mapped to Izin verdicts. */
export const manualSchema = z.object({
  label: z.string().min(1),
  mapping: z.array(z.object({ recorded: z.string().min(1), verdict })).min(1),
  modes: z.record(z.string(), z.string().min(1)),
  pairs: z
    .array(
      z.object({
        site: z.string().min(1),
        url: httpsUrl,
        action,
        human_verdict: verdict,
        human_basis: z.string().min(1),
        decided_on: day,
        /** fetch_once: Izin reads the site once; paste_recorded: the quote below is pasted, nothing fetched; not_fetched: the host is on the do-not-fetch list. */
        mode: z.enum(["fetch_once", "paste_recorded", "not_fetched"]),
        policy_hints: z.array(httpsUrl),
        quote: quote.nullable(),
        quote_url: httpsUrl.nullable(),
        note: z.string(),
      }),
    )
    .min(12),
});

const caseId = z.string().regex(/^B\d{2}$/);

/** Set B: synthetic policies written for this benchmark, one rule under test each. */
export const labeledSchema = z.object({
  label: z.string().min(1),
  owner_review: z.boolean(),
  /** Neutral sections every synthetic terms page carries, so each page is long enough to count as read. */
  common_sections: z.array(z.string().min(1)).min(1),
  cases: z
    .array(
      z.object({
        id: caseId,
        tests: z.array(z.string().min(1)).min(1),
        action,
        detail: z.string().max(280).nullable(),
        robots: z.string(),
        /** Clauses on the terms page; null = the site has no terms page. */
        terms: z.array(z.string().min(1)).nullable(),
        terms_status: z.number().int().min(200).max(599),
        /** Clauses inside a display:none block on the terms page. */
        hidden: z.array(z.string().min(1)),
        expected: verdict,
        /** Other verdicts the rulebook also allows for this case (never wider than the rule says). */
        also_acceptable: z.array(verdict),
        why: z.string().min(1),
      }),
    )
    .length(20),
});

/** Spot checks: real gallery pairs labelled from the text before any run. */
export const spotSchema = z.object({
  label: z.string().min(1),
  read_with: z.string().min(1),
  pairs: z
    .array(
      z.object({
        site: z.string().min(1),
        url: httpsUrl,
        action,
        label: verdict,
        rules: z.array(z.string().regex(/^R\d{1,2}$/)).min(1),
        quote: quote.nullable(),
        quote_url: httpsUrl,
        read_on: day,
        why: z.string().min(1),
      }),
    )
    .min(1)
    .max(10),
});

export type ManualSet = z.infer<typeof manualSchema>;
export type LabeledSet = z.infer<typeof labeledSchema>;
export type LabeledCase = LabeledSet["cases"][number];
export type SpotSet = z.infer<typeof spotSchema>;

const read = (dir: string, name: string): unknown => JSON.parse(readFileSync(`${dir}${name}`, "utf8"));

export function loadSets(dir: string = BENCH_DIR) {
  return {
    manual: manualSchema.parse(read(dir, "manual.json")),
    labeled: labeledSchema.parse(read(dir, "labeled.json")),
    spot: spotSchema.parse(read(dir, "spot.json")),
  };
}

export interface SyntheticSite {
  host: string;
  /** Path to { status, content type, body }. */
  routes: Record<string, { status: number; type: string; body: string }>;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${body}</body></html>`;

/** One synthetic case as a site on its own host (`b01.example` and so on). */
export function syntheticSite(set: LabeledSet, c: LabeledCase): SyntheticSite {
  const host = `${c.id.toLowerCase()}.example`;
  const routes: SyntheticSite["routes"] = {
    "/robots.txt": { status: 200, type: "text/plain", body: c.robots },
    "/": {
      status: 200,
      type: "text/html",
      body: html("Example store", `<main><h1>Example store</h1><p>Synthetic site for benchmark case ${c.id}.</p></main><footer>${c.terms ? '<a href="/terms">Terms of Service</a>' : ""}</footer>`),
    },
  };
  if (c.terms) {
    const shown = [...set.common_sections, ...c.terms].map((p) => `<p>${esc(p)}</p>`).join("");
    const hidden = c.hidden.length ? `<div style="display:none">${c.hidden.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : "";
    routes["/terms"] = { status: c.terms_status, type: "text/html", body: html("Terms of Service", `<main><h1>Terms of Service</h1>${shown}${hidden}</main>`) };
  }
  return { host, routes };
}
