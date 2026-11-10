// The collector: robots.txt, the input page, the home page and up to N policy pages, all within
// one request budget, recorded in a ledger. It never decides; it reports what it could read.
import type { Action, IzinConfig } from "../config.js";
import { isPolicyPath, registrableDomain, scoreAnchors } from "./discover.js";
import { decodeBody, type FetchResult } from "./fetch.js";
import { extractAnchors, extractText, type Anchor } from "./extract.js";
import { FETCHER_TOKEN, Session } from "./session.js";
import { defaultPolicy, type NetPolicy } from "./ssrf.js";
import { robotsStop, type RobotsStop } from "./stop.js";
import type { Collected, LedgerEntry, LedgerState, PolicyDoc, RobotsSummary } from "./types.js";

export interface CollectInput {
  url: string;
  /** Paste mode: the requester's copy of the terms replaces discovery. */
  terms_text?: string;
  /** Optional user-agent token of the caller's agent, evaluated against robots.txt. */
  agent?: string;
  /** Known policy URLs for a gallery entry; they replace anchor scoring and common paths. */
  policy_hints?: string[];
  /** The action being checked; robots.txt rules against it end collection at robots.txt. */
  action?: Action;
}

export interface CollectDeps {
  cfg: IzinConfig;
  policy?: NetPolicy;
  sleep?: (ms: number) => Promise<void>;
}

const UNREADABLE: ReadonlySet<LedgerState> = new Set([
  "blocked", "robots_disallow", "needs_browser", "timeout", "too_large", "truncated", "error", "refused", "not_fetched",
]);

function isHtml(res: FetchResult): boolean {
  return /html|xml/i.test(res.content_type) || (!res.content_type && /^\s*</.test(res.body.toString("utf8", 0, 64)));
}

function pageText(res: FetchResult): string {
  const body = decodeBody(res.body, res.content_type);
  return isHtml(res) ? extractText(body) : body.replace(/[ \t]+/g, " ").trim();
}

function anchorsOf(res: FetchResult): Anchor[] {
  return res.state === "ok" && isHtml(res) ? extractAnchors(decodeBody(res.body, res.content_type), res.final_url) : [];
}

/** Turns a fetched policy page into a document, applying the length rules from config. */
function toDoc(res: FetchResult, entry: LedgerEntry, cfg: IzinConfig, toModel: boolean): PolicyDoc | null {
  if (res.state !== "ok") return null;
  const l = cfg.limits;
  let text = pageText(res);
  let state: PolicyDoc["state"] = "ok";
  if (text.length < l.doc_text_min_chars) state = "needs_browser";
  else if (text.length > l.doc_text_max_chars) {
    text = text.slice(0, l.doc_text_max_chars);
    state = "truncated";
  }
  entry.state = state;
  return { kind: "policy", url: res.final_url, text, state, to_model: toModel, origin_verified: true };
}

function summarize(load: Awaited<ReturnType<Session["robotsFor"]>>, input: CollectInput): RobotsSummary {
  const p = load.parsed;
  const agent = input.agent;
  const delay = p?.crawlDelay(FETCHER_TOKEN);
  return {
    url: load.url,
    state: load.state,
    ...(delay !== undefined ? { crawl_delay_s: delay } : {}),
    input_disallowed: {
      izinbot: p ? p.isDisallowed(input.url, FETCHER_TOKEN) : false,
      any: p ? p.isDisallowed(input.url, "*") : false,
      ...(agent ? { agent: p ? p.isDisallowed(input.url, agent) : false } : {}),
    },
    content_signal: {
      izinbot: p?.signals(FETCHER_TOKEN) ?? {},
      any: p?.signals("*") ?? {},
      ...(agent ? { agent: p?.signals(agent) ?? {} } : {}),
    },
    boilerplate_found: p?.comments.some((c) => c.boilerplate) ?? false,
  };
}

export async function collect(input: CollectInput, deps: CollectDeps): Promise<Collected> {
  const { cfg } = deps;
  const url = new URL(input.url);
  url.hash = "";
  const site = registrableDomain(url.hostname, cfg);
  const session = new Session(
    cfg,
    deps.policy ?? defaultPolicy(cfg.limits.fetch_ports),
    deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  );
  const docs: PolicyDoc[] = [];
  const blocked: Collected["signals"]["blocked"] = [];
  const policyEntries: LedgerEntry[] = [];
  const doNotFetch = session.refused(url.hostname);
  let robots: RobotsSummary | null = null;
  let aiInputNo = false;
  let stop: RobotsStop | null = null;

  const pasted = input.terms_text?.slice(0, cfg.limits.terms_text_max_chars);
  if (pasted) docs.push({ kind: "pasted", url: url.href, text: pasted, state: "ok", to_model: true, origin_verified: false });

  if (!doNotFetch) {
    const load = await session.robotsFor(url.origin);
    robots = summarize(load, { ...input, url: url.href });
    if (load.state === "blocked") {
      const status = session.ledger.find((e) => e.kind === "robots")?.status ?? 0;
      blocked.push({ url: load.url, kind: "robots", status });
    }
    aiInputNo = robots.content_signal.izinbot["ai-input"] === "no" || robots.content_signal.any["ai-input"] === "no";
    for (const c of load.parsed?.comments ?? []) {
      if (c.policy) {
        docs.push({ kind: "robots_comments", url: load.url, text: c.text, state: "ok", to_model: !aiInputNo, origin_verified: true });
      }
    }
    // Paste mode reads robots.txt only; ai-input=no means no page text is gathered for a model;
    // a robots.txt that forbids the action itself is the whole answer.
    if (!pasted && load.parsed) stop = robotsStop(load.parsed, robots, input.action, cfg);
    if (!pasted && !aiInputNo && !stop && load.parsed) {
      await discoverAndFetch(session, url, input, load.parsed.comments.flatMap((c) => c.urls), site, docs, blocked, policyEntries);
    }
  }

  const unreadable = policyEntries
    .filter((e) => UNREADABLE.has(e.state))
    .map((e) => ({ url: e.url, state: e.state }));
  return {
    input_url: url.href,
    site,
    mode: doNotFetch ? "do_not_fetch" : pasted ? "paste" : "fetch",
    ...(input.agent ? { agent: input.agent } : {}),
    robots,
    docs,
    ledger: session.ledger,
    requests_used: session.used,
    signals: {
      docs_read: docs.filter((d) => d.state === "ok").length,
      unreadable,
      blocked,
      ai_input_no: aiInputNo,
      do_not_fetch: doNotFetch,
      robots_stop: stop,
    },
  };
}

async function discoverAndFetch(
  session: Session,
  url: URL,
  input: CollectInput,
  robotsUrls: string[],
  site: string,
  docs: PolicyDoc[],
  blocked: Collected["signals"]["blocked"],
  policyEntries: LedgerEntry[],
): Promise<void> {
  const cfg = session.cfg;
  const max = cfg.limits.policy_docs_max;
  const fetched = new Set<string>();
  const sources: { from: "input" | "home"; anchors: Anchor[] }[] = [];
  let policyCount = 0;

  const takePolicy = (got: Awaited<ReturnType<Session["page"]>>) => {
    policyCount++;
    policyEntries.push(got.entry);
    if (!("res" in got)) return;
    if (got.res.state === "blocked") blocked.push({ url: got.entry.url, kind: "policy", status: got.res.status });
    const doc = toDoc(got.res, got.entry, cfg, true);
    if (doc) docs.push(doc);
  };

  const hasPath = url.pathname !== "/" || url.search !== "";
  if (hasPath) {
    const policyInput = isPolicyPath(url, cfg);
    const got = await session.page(url.href, policyInput ? "policy" : "input");
    fetched.add(url.href);
    if (policyInput) takePolicy(got);
    if ("res" in got) sources.push({ from: "input", anchors: anchorsOf(got.res) });
  }

  const home = `${url.origin}/`;
  if (!fetched.has(home)) {
    const got = await session.page(home, "home");
    fetched.add(home);
    if ("res" in got) {
      if (got.res.state === "blocked") blocked.push({ url: home, kind: "home", status: got.res.status });
      sources.push({ from: "home", anchors: anchorsOf(got.res) });
    }
  }

  // The site's own pointers first (gallery hints, then URLs named in its robots.txt comments,
  // even on another domain), then scored same-site links.
  const hinted = input.policy_hints ?? [];
  const candidates = [
    ...hinted,
    ...robotsUrls,
    ...(hinted.length ? [] : scoreAnchors(sources, site, cfg).map((c) => c.url)),
  ].filter((u, i, all) => all.indexOf(u) === i && !fetched.has(u));

  for (const candidate of candidates) {
    if (policyCount >= max) break;
    fetched.add(candidate);
    takePolicy(await session.page(candidate, "policy"));
  }

  if (policyCount === 0 && !hinted.length) await tryCommonPaths(session, url, docs, policyEntries);
}

/** Last resort: a few common terms paths; stop at the first readable one. Misses are not "unreadable". */
async function tryCommonPaths(session: Session, url: URL, docs: PolicyDoc[], policyEntries: LedgerEntry[]): Promise<void> {
  const cfg = session.cfg;
  let attempts = 0;
  for (const path of cfg.discovery.common_paths) {
    if (attempts >= cfg.limits.common_path_attempts_max || session.left() <= 0) return;
    attempts++;
    const got = await session.page(`${url.origin}${path}`, "policy");
    if (!("res" in got) || got.res.state !== "ok") continue;
    const doc = toDoc(got.res, got.entry, cfg, true);
    if (doc?.state === "ok") {
      docs.push(doc);
      policyEntries.push(got.entry);
      return;
    }
  }
}
