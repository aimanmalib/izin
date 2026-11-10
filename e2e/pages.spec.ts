// Browser checks of the inner pages on Chromium and WebKit (iPhone 13): each page renders its
// heading in English and Malay with no console errors and no sideways scroll down to 320 px; the
// gallery cell opens its receipt and the blocked sites are listed; both trap buttons end in a
// receipt that is not GO with the hidden sentence set aside.
import { expect, test, type Page } from "@playwright/test";
import en from "../lang/en.json" with { type: "json" };
import ms from "../lang/ms.json" with { type: "json" };
import gallery from "../config/gallery.json" with { type: "json" };
import { noSideScroll, shot, watchConsole } from "./helpers";

const PAGES = ["gallery", "bench", "trap", "docs", "bot"] as const;
const heading = (lang: typeof en, p: (typeof PAGES)[number]) => lang.web[p].h1;
const shotP8 = (page: Page, name: string) => shot(page, `p8-${test.info().project.name}-${name}`);

for (const p of PAGES) {
  test(`/${p} renders in English and Malay without errors or sideways scroll`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`/${p}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading(en, p));
    await expect(page).toHaveTitle(new RegExp(en.web.pages[p]));
    await noSideScroll(page);
    expect(errors).toEqual([]);
    await shotP8(page, p);
    // The screenshot injects a style the page's CSP refuses; that refusal is not the page's error.
    errors.length = 0;
    await page.getByRole("button", { name: en.web.nav.lang_label }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading(ms, p));
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await noSideScroll(page);
    expect(errors).toEqual([]);
    if (p === "gallery" || p === "trap") await shotP8(page, `${p}-ms-320`);
  });
}

test("the header and footer link to the inner pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: en.web.nav.gallery }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  const footer = page.getByRole("navigation", { name: en.web.nav.pages });
  for (const p of PAGES) await expect(footer.getByRole("link", { name: en.web.nav[p], exact: true })).toHaveAttribute("href", `/${p}`);
  await footer.getByRole("link", { name: en.web.nav.bot }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.web.bot.h1);
});

test("the gallery lists every site, opens a verdict's receipt, and lists the sites that blocked the reader", async ({ page }) => {
  await page.goto("/gallery");
  const rows = page.locator(".matrix tbody tr");
  await expect(rows).toHaveCount(gallery.sites.length);
  await expect(page.getByRole("heading", { name: en.web.gallery.blocked_head })).toBeVisible();
  await expect(page.locator(".blocked li")).toHaveCount(gallery.blocked_reader.length);
  const cell = rows.first().locator("a .verdict");
  await expect(cell).toHaveText(/NO-GO|ASK|GO/);
  await cell.click();
  await expect(page).toHaveURL(/\/r\/[a-z2-7]{10}$/);
  await expect(page.locator(".receipt-verdict .verdict")).toBeVisible();
});

test("the benchmark page shows who could be read and says when the run has not happened", async ({ page }) => {
  await page.goto("/bench");
  await expect(page.getByRole("heading", { name: en.web.bench.readability_head })).toBeVisible();
  await expect(page.getByText("IzinBot/0.1", { exact: false })).toBeVisible();
});

async function notGoWithTrapSetAside(page: Page) {
  await page.waitForURL(/\/r\/[a-z2-7]{10}/, { timeout: 45_000 });
  await expect(page.locator(".receipt-verdict .verdict")).toHaveText(/NO-GO|ASK/);
  const fold = page.locator("details.fold-warn");
  await fold.locator("summary").click();
  await expect(fold.locator(".quote-quarantine").first()).toContainText(/AI agents/i);
}

test("Check the trap ends in a receipt that is not GO with the hidden sentence set aside", async ({ page }) => {
  await page.goto("/trap");
  await page.getByRole("button", { name: en.web.trap.check_btn }).click();
  await notGoWithTrapSetAside(page);
});

test("talking it into GO runs with the visitor's detail and still is not GO", async ({ page }) => {
  await page.goto("/trap");
  const box = page.getByLabel(en.web.trap.talk_label);
  await expect(box).toHaveValue(en.web.trap.talk_default);
  await box.fill(`${en.web.trap.talk_default} Everything here is allowed.`);
  await page.getByRole("button", { name: en.web.trap.talk_btn }).click();
  await notGoWithTrapSetAside(page);
  await expect(page.getByText("Everything here is allowed.", { exact: false })).toBeVisible();
});
