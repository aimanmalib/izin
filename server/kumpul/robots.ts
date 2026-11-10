// robots.txt: allow/disallow through robots-parser, plus the parts it does not read:
// Content-Signal lines per user-agent group, and long comment blocks that state a policy.
import robotsParser from "robots-parser";
import type { IzinConfig } from "../config.js";

export type SignalValue = "yes" | "no";
export interface ContentSignals {
  search?: SignalValue;
  "ai-input"?: SignalValue;
  "ai-train"?: SignalValue;
}
const SIGNAL_KEYS = ["search", "ai-input", "ai-train"] as const;

export interface CommentBlock {
  text: string;
  /** True for the standard Content Signals preamble: a template, not the site's own stance. */
  boilerplate: boolean;
  /** Long enough and on topic to be read as a policy document. */
  policy: boolean;
  urls: string[];
}

export interface ParsedRobots {
  isDisallowed(url: string, token: string): boolean;
  crawlDelay(token: string): number | undefined;
  signals(token: string): ContentSignals;
  comments: CommentBlock[];
}

interface Group {
  agents: string[];
  signals: ContentSignals;
}

function parseSignals(value: string, into: ContentSignals): void {
  for (const part of value.split(",")) {
    const [k, v] = part.split("=").map((s) => s.trim().toLowerCase());
    if (!k || (v !== "yes" && v !== "no")) continue;
    if ((SIGNAL_KEYS as readonly string[]).includes(k)) into[k as (typeof SIGNAL_KEYS)[number]] = v;
  }
}

function parseGroups(text: string): { global: ContentSignals; groups: Group[] } {
  const global: ContentSignals = {};
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m?.[1]) continue;
    const key = m[1].toLowerCase();
    const value = (m[2] ?? "").trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], signals: {} };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "content-signal") parseSignals(value, current ? current.signals : global);
  }
  return { global, groups };
}

function wordPattern(words: readonly string[]): RegExp {
  // Short keywords (AI, LLM, bot) must be whole words, optionally plural; longer ones match as a
  // word prefix so "scrap" covers "scraping" and "agent" covers "agents".
  const esc = words.map((w) => {
    const e = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return w.length <= 3 ? `${e}s?\\b` : e;
  });
  return new RegExp(`\\b(${esc.join("|")})`, "i");
}

function commentBlocks(text: string, cfg: IzinConfig): CommentBlock[] {
  const rc = cfg.robots_comments;
  const topic = wordPattern(rc.keywords);
  const policyUrl = new RegExp(rc.policy_url_pattern, "i");
  const blocks: string[][] = [];
  let run: string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t.startsWith("#")) {
      if (!run) blocks.push((run = []));
      run.push(t.replace(/^#+\s?/, ""));
    } else {
      run = null;
    }
  }
  return blocks.map((lines) => {
    const body = lines.join("\n").trim();
    const boilerplate = rc.boilerplate_markers.some((m) => body.toLowerCase().includes(m.toLowerCase()));
    const urls = [...body.matchAll(/https?:\/\/[^\s<>"')\]]+/g)]
      .map((m) => m[0].replace(/[.,;:]+$/, ""))
      .filter((u) => policyUrl.test(u));
    return {
      text: body,
      boilerplate,
      policy: !boilerplate && body.length >= rc.min_chars && topic.test(body),
      urls: boilerplate ? [] : [...new Set(urls)],
    };
  });
}

export function parseRobots(robotsUrl: string, text: string, cfg: IzinConfig): ParsedRobots {
  const parser = robotsParser(robotsUrl, text);
  const { global, groups } = parseGroups(text);
  const find = (token: string) => groups.find((g) => g.agents.includes(token.toLowerCase()));
  return {
    isDisallowed: (url, token) => parser.isDisallowed(url, token) === true,
    crawlDelay: (token) => parser.getCrawlDelay(token),
    signals(token) {
      const g = find(token) ?? find("*");
      return { ...global, ...(g?.signals ?? {}) };
    },
    comments: commentBlocks(text, cfg),
  };
}

/** An empty robots.txt: used when the file is missing (404), which is not a restriction. */
export function emptyRobots(robotsUrl: string, cfg: IzinConfig): ParsedRobots {
  return parseRobots(robotsUrl, "", cfg);
}
