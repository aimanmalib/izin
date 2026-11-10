// Shared checks for the browser tests: console errors, sideways scroll, and evidence screenshots
// (written only when the runner gives a folder for them).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

export async function noSideScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "page scrolls sideways").toBeLessThanOrEqual(cw);
}

export async function shot(page: Page, name: string) {
  const dir = process.env.AUTOPILOT_BUKTI_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `izin-${name}.png`), fullPage: true });
}
