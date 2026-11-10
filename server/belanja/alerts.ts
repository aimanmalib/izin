// Operator alerts (credit used up, spending cap, unhealthy container). The command that delivers
// them is set per host through the environment variable named in config; without it the alert is
// only logged. Each kind is sent at most once per UTC day.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type { IzinConfig } from "../config.js";
import { LANG_DIR } from "../config.js";

export type AlertKind = "reader_no_credit" | "budget_cap" | "unhealthy";

export type AlertSend = (message: string, level: string) => Promise<boolean>;
export type Alert = (kind: AlertKind) => Promise<boolean>;

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

export function alertText(cfg: IzinConfig, kind: AlertKind, langDir: string = LANG_DIR): string {
  const lang = JSON.parse(readFileSync(`${langDir}${cfg.alerts.language}.json`, "utf8")) as { alerts?: Record<string, string> };
  return lang.alerts?.[kind] ?? kind;
}

export function makeAlert(
  cfg: IzinConfig,
  opts: { send?: AlertSend; now?: () => Date; env?: NodeJS.ProcessEnv; langDir?: string } = {},
): Alert {
  const send = opts.send ?? commandSender(cfg, opts.env ?? process.env);
  const now = opts.now ?? (() => new Date());
  const lastDay = new Map<AlertKind, string>();
  return async (kind) => {
    const day = now().toISOString().slice(0, 10);
    if (lastDay.get(kind) === day) return false;
    lastDay.set(kind, day);
    return send(alertText(cfg, kind, opts.langDir), cfg.alerts.level);
  };
}
