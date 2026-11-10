// Operator alerts: one per kind per UTC day; no command configured means logged, not sent.
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../server/config.js";
import { alertText, makeAlert } from "../server/belanja/alerts.js";

const cfg = loadConfig();

describe("alerts", () => {
  it("sends each kind once per day with the configured level and language", async () => {
    let now = new Date("2026-11-11T01:00:00Z");
    const send = vi.fn(async () => true);
    const alert = makeAlert(cfg, { send, now: () => now });
    expect(await alert("reader_no_credit")).toBe(true);
    expect(await alert("reader_no_credit")).toBe(false);
    now = new Date("2026-11-12T00:00:01Z");
    expect(await alert("reader_no_credit")).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(alertText(cfg, "reader_no_credit"), cfg.alerts.level);
  });

  it("has alert text in both languages", () => {
    for (const language of ["en", "ms"] as const) {
      const text = alertText({ ...cfg, alerts: { ...cfg.alerts, language } }, "reader_no_credit");
      expect(text).not.toBe("reader_no_credit");
    }
  });

  it("logs instead of sending when no command is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const alert = makeAlert(cfg, { env: {} });
    expect(await alert("reader_no_credit")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
