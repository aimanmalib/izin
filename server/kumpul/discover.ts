// Finding a site's policy pages: path check, anchor scoring, same-site rule.
import type { IzinConfig } from "../config.js";
import type { Anchor } from "./extract.js";

/**
 * Registrable domain without a public-suffix download: the last two labels, or three when the
 * last two form a known multi-part suffix (config `discovery.multi_part_suffixes`).
 */
export function registrableDomain(host: string, cfg: IzinConfig): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  const take = cfg.discovery.multi_part_suffixes.includes(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function sameSite(host: string, site: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === site || h.endsWith(`.${site}`);
}

export function hostListed(host: string, list: readonly string[]): boolean {
  return list.some((entry) => sameSite(host, entry));
}

export function isPolicyPath(url: URL, cfg: IzinConfig): boolean {
  return new RegExp(cfg.discovery.input_path_pattern, "i").test(url.pathname);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface Candidate {
  url: string;
  score: number;
  from: "input" | "home";
}

/**
 * Scores links from the input page and the home page. Privacy and cookie links score zero and
 * are dropped. Highest score first; on a tie, links from the input page come first, then
 * document order. Only the site's own registrable domain (or a subdomain) is kept.
 */
export function scoreAnchors(
  sources: { from: "input" | "home"; anchors: Anchor[] }[],
  site: string,
  cfg: IzinConfig,
): Candidate[] {
  const exclude = new RegExp(cfg.discovery.anchor_exclude_pattern, "i");
  const rules = cfg.discovery.anchor_scores.map((r) => ({ re: new RegExp(r.pattern, "i"), score: r.score }));
  const seen = new Map<string, Candidate & { order: number }>();
  let order = 0;
  for (const { from, anchors } of sources) {
    for (const a of anchors) {
      order++;
      let url: URL;
      try {
        url = new URL(a.href);
      } catch {
        continue;
      }
      if (!sameSite(url.hostname, site)) continue;
      const hay = `${a.text} ${safeDecode(url.pathname)}`;
      if (exclude.test(hay)) continue;
      const score = rules.reduce((sum, r) => (r.re.test(hay) ? sum + r.score : sum), 0);
      if (score === 0 || seen.has(url.href)) continue;
      seen.set(url.href, { url: url.href, score, from, order });
    }
  }
  const rank = (c: { from: string }) => (c.from === "input" ? 0 : 1);
  return [...seen.values()]
    .sort((a, b) => b.score - a.score || rank(a) - rank(b) || a.order - b.order)
    .map(({ url, score, from }) => ({ url, score, from }));
}
