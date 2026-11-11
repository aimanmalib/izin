// Operator alerts (credit used up, spending cap, unhealthy container). The command that delivers
// them is set per host through the environment variable named in config; without it the alert is
// only logged. An alert without a key is sent at most once per kind per UTC day. An alert with a
// key (a lasting state, such as a total cap that never resets) is sent once per key: with a
// database the sent keys are kept in alerts_sent, so a restart does not send it again.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import type { IzinConfig } from "../config.js";
import { LANG_DIR } from "../config.js";

export type AlertKind = "reader_no_credit" | "decider_no_credit" | "budget_cap_day" | "budget_cap_total" | "unhealthy";

export interface AlertDetail {
  /** Values for the {placeholders} in the alert text. */
  vars?: Record<string, string>;
  /** Sends once per key instead of once per UTC day. */
  key?: string;
}

export type AlertSend = (message: string, level: string) => Promise<boolean>;
export type Alert = (kind: AlertKind, detail?: AlertDetail) => Promise<boolean>;

function commandSender(cfg: IzinConfig, env: NodeJS.ProcessEnv): AlertSend {
  return (message, level) =>
    new Promise((resolve) => {
      const cmd = env[cfg.alerts.command_env];
      if (!cmd) {
        console.warn(JSON.stringify({ alert: message, delivered: false }));
        resolve(false);
        return;
      }
      execFile(cmd, [message, level], { env: { ...env, NOTIFY_KOD_KELUAR: "1" }, timeout: 30_000 }, (err) => resolve(!err));
    });
}

export function alertText(cfg: IzinConfig, kind: AlertKind, vars: Record<string, string> = {}, langDir: string = LANG_DIR): string {
  const lang = JSON.parse(readFileSync(`${langDir}${cfg.alerts.language}.json`, "utf8")) as { alerts?: Record<string, string> };
  const text = lang.alerts?.[kind] ?? kind;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? m);
}

/** Marks (kind, key) as sent; false when it was already sent. */
function firstForKey(db: Database.Database | undefined, seen: Set<string>, kind: AlertKind, key: string, at: Date): boolean {
  if (!db) {
    const k = `${kind}\n${key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }
  return db.prepare("INSERT OR IGNORE INTO alerts_sent (kind, key, sent_at) VALUES (?, ?, ?)").run(kind, key, at.toISOString()).changes === 1;
}

export function makeAlert(
  cfg: IzinConfig,
  opts: { send?: AlertSend; now?: () => Date; env?: NodeJS.ProcessEnv; langDir?: string; db?: Database.Database } = {},
): Alert {
  const send = opts.send ?? commandSender(cfg, opts.env ?? process.env);
  const now = opts.now ?? (() => new Date());
  const lastDay = new Map<AlertKind, string>();
  const seen = new Set<string>();
  return async (kind, detail = {}) => {
    const at = now();
    if (detail.key !== undefined) {
      if (!firstForKey(opts.db, seen, kind, detail.key, at)) return false;
    } else {
      const day = at.toISOString().slice(0, 10);
      if (lastDay.get(kind) === day) return false;
      lastDay.set(kind, day);
    }
    return send(alertText(cfg, kind, detail.vars, opts.langDir), cfg.alerts.level);
  };
}
