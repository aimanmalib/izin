// Browser checks of the front page and the receipt page on Chromium and WebKit (iPhone 13):
// the check flow to a receipt, the trap sentence set aside, the language toggle, the one-click
// examples, no horizontal scroll down to 320 px, and no console errors.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import en from "../lang/en.json" with { type: "json" };
import ms from "../lang/ms.json" with { type: "json" };
import examples from "../config/examples.json" with { type: "json" };
import { SITES_PORT } from "./ports";

const site = (host: string, path = "/") => `http://${host}:${SITES_PORT}${path}`;

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function noSideScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, "page scrolls sideways").toBeLessThanOrEqual(cw);
}

async function shot(page: Page, name: string) {
  const dir = process.env.AUTOPILOT_BUKTI_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `izin-p7-${test.info().project.name}-${name}.png`), fullPage: true });
}

async function runCheck(page: Page, url: string, action: keyof typeof en.actions) {
  await page.goto("/");
  await page.getByLabel(en.web.form.url).fill(url);
  await page.getByRole("radio", { name: en.actions[action], exact: true }).check();
  await page.getByRole("button", { name: en.web.form.submit, exact: true }).click();
  await page.waitForURL(/\/r\/[a-z2-7]{10}/, { timeout: 45_000 });
}

test("front page reads well and has no console errors", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.web.home.h1);
  await expect(page.getByText(en.web.home.position)).toBeVisible();
  await expect(page.getByText(`claude mcp add --transport http izin`, { exact: false })).toBeVisible();
  await noSideScroll(page);
  // Checked before the screenshot: Playwright injects a caret-hiding style the page's CSP refuses.
  expect(errors).toEqual([]);
  await shot(page, "home");
});

test("a check runs to a receipt with the deciding clause quoted in a monospace font", async ({ page }) => {
  const errors = watchConsole(page);
  await runCheck(page, site("shop.example"), "crawl");
  const badge = page.locator(".receipt-verdict .verdict");
  await expect(badge).toHaveText(/NO-GO|ASK|GO/);
  await expect(page.getByRole("heading", { name: en.web.receipt_page.decisive })).toBeVisible();
  const quote = page.locator(".clause .quote p").first();
  await expect(quote).toBeVisible();
  expect(await quote.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono|Menlo|Consolas/i);
  await expect(page.getByRole("link", { name: en.web.receipt_page.open_source }).first()).toHaveAttribute("href", /shop\.example/);
  await expect(page.getByRole("link", { name: en.web.receipt_page.json })).toHaveAttribute("href", /\.json$/);
  await noSideScroll(page);
  expect(errors).toEqual([]);
  await shot(page, "receipt");
});

test("the trap page's hidden sentence is set aside and shown on the receipt", async ({ page }) => {
  await runCheck(page, site("trap.example", "/trap/"), "crawl");
  await expect(page.locator(".receipt-verdict .verdict")).not.toHaveText("GO");
  const fold = page.locator("details.fold-warn");
  await fold.locator("summary").click();
  await expect(fold.locator(".quote-quarantine").first()).toContainText(/AI agents/i);
  await noSideScroll(page);
});

test("the language toggle switches to Bahasa Melayu and stays after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: en.web.nav.lang_label }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ms.web.home.h1);
  await expect(page.locator("html")).toHaveAttribute("lang", "ms");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ms.web.home.h1);
  await expect(page.getByText(ms.actions.purchase, { exact: true })).toBeVisible();
  await noSideScroll(page);
});

test("a one-click example without a saved receipt fills the form", async ({ page }) => {
  const first = examples.examples.find((e) => !e.receipt_id);
  test.skip(!first, "every example has a saved receipt");
  await page.goto("/");
  const label = (en.web.form as Record<string, string>)[`example_${first!.key}`]!;
  await page.getByRole("button", { name: label }).click();
  await expect(page.getByLabel(en.web.form.url)).toHaveValue(first!.site);
  await expect(page.getByRole("radio", { name: en.actions[first!.action as keyof typeof en.actions] })).toBeChecked();
});

test("no page scrolls sideways at 320 px, with folds open", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.getByText(en.web.form.more).click();
  await page.getByRole("button", { name: en.web.form.paste }).click();
  await noSideScroll(page);
  await runCheck(page, site("trap.example", "/trap/"), "crawl");
  for (const s of await page.locator("details summary").all()) await s.click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await noSideScroll(page);
  await shot(page, "receipt-320");
});

test("an unknown receipt shows not found", async ({ page }) => {
  const res = await page.goto("/r/zzzzzzzzzz");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: en.web.errors.not_found_head })).toBeVisible();
  const missing = await page.goto("/no-such-page");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: en.web.errors.not_found_head })).toBeVisible();
});
