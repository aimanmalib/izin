// Stop at robots.txt: when the file itself forbids the action for automated clients, Izin reads
// nothing else from the site. The decision then rests on robots.txt alone, and the receipt says so.
// Patterns live in config (robots_stop); this module only applies them.
import type { Action, IzinConfig } from "../config.js";
import type { ParsedRobots } from "./robots.js";
import type { RobotsSummary } from "./types.js";

export interface RobotsStop {
  /** "directive": a Disallow rule covers the URL; "comment": a policy comment forbids the action. */
  by: "directive" | "comment";
  /** The sentence that matched (comment stops only), as written in robots.txt. */
  sentence?: string;
}

const anyOf = (sources: readonly string[]) => sources.map((p) => new RegExp(p, "i"));
const hits = (res: RegExp[], text: string) => res.some((r) => r.test(text));

/** Sentences of a comment block; line breaks inside a sentence are joined. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s*\n\s*/g, " ")
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A sentence forbids the action when it names a prohibition, addresses automated clients, and
 * either scopes itself to everything ("without permission") or names this action.
 */
export function forbiddingSentence(text: string, action: Action, cfg: IzinConfig): string | null {
  const rs = cfg.robots_stop;
  const prohibition = anyOf(rs.prohibition);
  const automation = anyOf(rs.automation);
  const scope = [...anyOf(rs.any_action), ...anyOf(rs.action_terms[action] ?? [])];
  for (const s of sentences(text)) {
    if (hits(prohibition, s) && hits(automation, s) && hits(scope, s)) return s;
  }
  return null;
}

export function robotsStop(
  parsed: ParsedRobots,
  summary: RobotsSummary,
  action: Action | undefined,
  cfg: IzinConfig,
): RobotsStop | null {
  if (!action) return null;
  const d = summary.input_disallowed;
  if (cfg.robots_stop.directive_actions.includes(action) && (d.izinbot || d.any || d.agent === true)) return { by: "directive" };
  for (const c of parsed.comments) {
    if (!c.policy) continue;
    const sentence = forbiddingSentence(c.text, action, cfg);
    if (sentence) return { by: "comment", sentence };
  }
  return null;
}
