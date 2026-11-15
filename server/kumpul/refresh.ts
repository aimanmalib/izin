// A page whose <meta http-equiv="refresh"> sends its visitors on is a redirect written in HTML.
// This module finds the target and applies the rules. It fetches nothing: the collector reads
// the target through the same robots.txt, address, budget and spacing checks as any other page.
import { isIP } from "node:net";
import { load } from "cheerio";
import type { IzinConfig } from "../config.js";
import { registrableDomain, sameSite } from "./discover.js";

export interface MetaRefresh {
  seconds: number;
  /** Absolute target, without a fragment. */
  url: string;
}

// Cheap test before the page is parsed: most pages carry no refresh at all.
const HINT = /http-equiv\s*=\s*["']?\s*refresh/i;
// "<seconds>", then optionally ";" or ",", an optional "url=", and the target.
const CONTENT = /^\s*(\d+)[\d.]*\s*[;,]?\s*(?:url\s*=\s*)?(.*)$/is;

function unquote(raw: string): string {
  const quote = raw[0];
  if (quote !== '"' && quote !== "'") return raw.trim();
  const rest = raw.slice(1);
  const end = rest.indexOf(quote);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/**
 * The meta refresh of a page: the earliest one in the document that names a target. A refresh
 * without a target reloads the same page and is not reported. The page is parsed the way a client
 * without scripting sees it, so a refresh inside <noscript> counts: IzinBot runs no scripts.
 */
export function metaRefresh(html: string, baseUrl: string): MetaRefresh | null {
  if (!HINT.test(html)) return null;
  const $ = load(html, { scriptingEnabled: false });
  for (const el of $("meta[http-equiv][content]").toArray()) {
    if (($(el).attr("http-equiv") ?? "").trim().toLowerCase() !== "refresh") continue;
    const m = CONTENT.exec($(el).attr("content") ?? "");
    const target = unquote(m?.[2] ?? "");
    if (!m || !target) continue;
    try {
      const url = new URL(target, baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      return { seconds: Number(m[1]), url: url.href };
    } catch {
      /* not a URL */
    }
  }
  return null;
}

/**
 * Where a page sends its visitors, when Izin may follow: the wait is no longer than
 * `limits.meta_refresh_max_seconds`, the target is on the page's own registrable domain, and it
 * is not the page itself. Null otherwise.
 */
export function refreshTarget(html: string, pageUrl: string, cfg: IzinConfig): string | null {
  const refresh = metaRefresh(html, pageUrl);
  if (!refresh || refresh.seconds > cfg.limits.meta_refresh_max_seconds) return null;
  const page = new URL(pageUrl);
  page.hash = "";
  if (refresh.url === page.href) return null;
  const host = new URL(refresh.url).hostname;
  // An address has no registrable domain: it matches itself and nothing else.
  const same = isIP(page.hostname) ? host === page.hostname : sameSite(host, registrableDomain(page.hostname, cfg));
  return same ? refresh.url : null;
}
