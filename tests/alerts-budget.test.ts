// Spending-cap alerts: a passive status read never alerts; a total cap alerts once until the cap
// changes (kept in the database, so a restart does not resend); a daily cap alerts once per UTC day.
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import en from "../lang/en.json" with { type: "json" };
import ms from "../lang/ms.json" with { type: "json" };
import { loadConfig, parseConfig, type IzinConfig } from "../server/config.js";
import { alertText, makeAlert } from "../server/belanja/alerts.js";
import { BudgetGuard } from "../server/belanja/guard.js";
import { ReceiptStore } from "../server/resit/store.js";

const base = loadConfig();
// Frozen caps for these tests only, not the deployed values.
const withCaps = (budget: Partial<IzinConfig["budget"]>, language: "en" | "ms" = "en") =>
  parseConfig({
    ...base,
    budget: { ...base.budget, serv_usd_per_day: 1, serv_usd_total: 4, dolphin_usd_per_day: 0.1, dolphin_usd_total: 0.5, ...budget },
    alerts: { ...base.alerts, language },
  });

function rig(cfg: IzinConfig, db = new Database(":memory:")) {
  new ReceiptStore(db);
  const clock = { t: Date.parse("2026-11-10T21:16:10Z") };
  const now = () => new Date(clock.t);
  const send = vi.fn<(message: string, level: string) => Promise<boolean>>(async () => true);
  const guard = new BudgetGuard(db, cfg, makeAlert(cfg, { send, now, db }), now);
  return { db, clock, send, guard, nextDay: () => void (clock.t += 86_400_000) };
}

/** Spend spread over past days, so only the total cap is reached today. */
function spendTotal(db: Database.Database, serv: number, day = "2026-11-01"): void {
  db.prepare("INSERT INTO budget (day, serv_usd, dolphin_usd, new_checks) VALUES (?, ?, 0, 0)").run(day, serv);
}

describe("spending-cap alerts", () => {
  it("(a) a status read (cap) never alerts, on any day", async () => {
    const r = rig(withCaps({}));
    spendTotal(r.db, 4.2);
    expect(r.guard.cap("web")).toMatchObject({ kind: "total", provider: "serv", cap_usd: 4 });
    r.nextDay();
    expect(r.guard.cap("web").kind).toBe("total");
    expect(r.send).not.toHaveBeenCalled();
  });

  it("(b) a total cap alerts exactly once across UTC days, with the numbers and without 'wait a day'", async () => {
    const r = rig(withCaps({}));
    spendTotal(r.db, 4.2);
    expect(await r.guard.exhausted("web")).toBe(true);
    r.nextDay();
    expect(await r.guard.exhausted("web")).toBe(true);
    expect(r.send).toHaveBeenCalledTimes(1);
    const msg = r.send.mock.calls[0]![0];
    expect(msg).toBe(alertText(withCaps({}), "budget_cap_total", { provider: "serv", spent: "4.20", cap: "4.00" }));
    expect(msg).toContain("4.20");
    expect(msg).toContain("serv_usd_total");
    expect(msg.toLowerCase()).not.toContain("next utc day");
  });

  it("(c) a restart on the same database does not resend; a raised cap reached again alerts once", async () => {
    const db = new Database(":memory:");
    const first = rig(withCaps({}), db);
    spendTotal(db, 4.2);
    await first.guard.exhausted("api");
    const restarted = rig(withCaps({}), db);
    expect(await restarted.guard.exhausted("api")).toBe(true);
    expect(restarted.send).not.toHaveBeenCalled();
    const raised = rig(withCaps({ serv_usd_total: 6 }), db);
    expect(await raised.guard.exhausted("api")).toBe(false);
    spendTotal(db, 2, "2026-11-02");
    expect(await raised.guard.exhausted("api")).toBe(true);
    expect(await raised.guard.exhausted("api")).toBe(true);
    expect(raised.send).toHaveBeenCalledTimes(1);
    expect(raised.send.mock.calls[0]![0]).toContain("6.00");
  });

  it("(d) a daily cap alerts as budget_cap_day once per UTC day", async () => {
    const r = rig(withCaps({}, "ms"));
    r.guard.record({ serv_usd: 1.5, dolphin_usd: 0 });
    expect(r.guard.cap("api")).toMatchObject({ kind: "day", provider: "serv", cap_usd: 1 });
    expect(r.guard.cap("bench").kind).toBe("none");
    await r.guard.exhausted("api");
    await r.guard.exhausted("api");
    expect(r.send).toHaveBeenCalledTimes(1);
    expect(r.send.mock.calls[0]![0]).toBe(alertText(withCaps({}, "ms"), "budget_cap_day", { provider: "serv", spent: "1.50", cap: "1.00" }));
    r.nextDay();
    expect(await r.guard.exhausted("api")).toBe(false);
    r.guard.record({ serv_usd: 1.5, dolphin_usd: 0 });
    await r.guard.exhausted("api");
    expect(r.send).toHaveBeenCalledTimes(2);
  });

  it("(e) alert texts have the same keys in both languages and every placeholder is filled", () => {
    expect(Object.keys(ms.alerts).sort()).toEqual(Object.keys(en.alerts).sort());
    expect(Object.keys(en.alerts)).not.toContain("budget_cap");
    for (const language of ["en", "ms"] as const) {
      for (const kind of ["budget_cap_day", "budget_cap_total"] as const) {
        const text = alertText(withCaps({}, language), kind, { provider: "dolphin", spent: "0.51", cap: "0.50" });
        expect(text).not.toBe(kind);
        expect(text).not.toMatch(/[{}]/);
        expect(text).toContain("0.51");
      }
    }
  });
});
