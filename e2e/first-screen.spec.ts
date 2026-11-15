// The first screen of the front page on WebKit (iPhone 13) and Chromium (1440 x 900): a visitor who
// does not scroll sees one saved answer (the verdict, the site and action, one clause quoted in a
// monospace font, where it was read, a link to its receipt) and a one-click example. The sample
// comes from config/examples.json; without one the page shows the examples and the form only.
import { expect, test, type Locator, type Page } from "@playwright/test";
import en from "../lang/en.json" with { type: "json" };
import ms from "../lang/ms.json" with { type: "json" };
import examples from "../config/examples.json" with { type: "json" };
import { shot, watchConsole } from "./helpers";

const sample = examples.sample;
const phone = () => test.info().project.name === "webkit-iphone13";
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
const sampleFor = (lang: typeof en) => fill(lang.web.home.sample_for, { action: lang.actions[sample.action as keyof typeof en.actions], site: sample.site });

/** The element's box with the page at the top: it must sit wholly inside the first screen. */
async function inFirstScreen(page: Page, el: Locator, what: string) {
  const height = page.viewportSize()!.height;
  expect(await page.evaluate(() => window.scrollY), "page is at the top").toBe(0);
  const box = await el.boundingBox();
  expect(box, `${what} is laid out`).not.toBeNull();
  expect(box!.y, `${what} starts in the first screen`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${what} ends inside the first ${height} px`).toBeLessThanOrEqual(height);
  expect(box!.x, `${what} starts inside the screen`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what} ends inside the screen`).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function noSideOverflow(page: Page, where: string) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(sw, `sideways overflow ${where}`).toBeLessThanOrEqual(iw);
}

/** Answers /api/site with the server's own view, changed by `edit`. */
async function withSite(page: Page, edit: (view: Record<string, unknown>) => void) {
  await page.route("**/api/site", async (route) => {
    const res = await route.fetch();
    const view = (await res.json()) as Record<string, unknown>;
    edit(view);
    await route.fulfill({ response: res, json: view });
  });
}

test("the first screen shows a saved answer and a one-click example", async ({ page }) => {
  const errors = watchConsole(page);
  if (phone()) expect(page.viewportSize()).toEqual({ width: 390, height: 664 });
  else await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const box = page.getByRole("region", { name: en.web.home.sample_label });
  const pill = box.locator(".verdict");
  await expect(pill).toHaveText(en.verdicts[sample.verdict as keyof typeof en.verdicts].label);
  await expect(box.getByText(sampleFor(en), { exact: true })).toBeVisible();
  const quote = box.locator(".quote p");
  await expect(quote).toHaveText(sample.quote);
  expect(await quote.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono|Menlo|Consolas/i);
  await expect(box.locator("cite")).toHaveText(sample.source);
  const link = box.getByRole("link", { name: en.web.home.sample_open });
  await expect(link).toHaveAttribute("href", `/r/${sample.receipt_id}`);

  const chip = page.locator(".examples .example").first();
  await expect(chip).toHaveText((en.web.form as Record<string, string>)[`example_${examples.examples[0]!.key}`]!);
  if (phone()) {
    // On a phone: an example and the verdict, above the form.
    await inFirstScreen(page, chip, "the first example");
    await inFirstScreen(page, pill, "the sample's verdict");
    const top = async (el: Locator) => (await el.boundingBox())!.y;
    expect(await top(chip)).toBeLessThan(await top(page.locator(".check-form")));
    expect(await top(page.locator(".lede"))).toBeLessThan(await top(chip));
  } else {
    await inFirstScreen(page, box, "the sample");
    await inFirstScreen(page, chip, "the first example");
  }
  await noSideOverflow(page, "in English");
  // Checked before the screenshot: Playwright injects a caret-hiding style the page's CSP refuses.
  expect(errors).toEqual([]);
  await shot(page, `first-screen-${test.info().project.name}`);
});

test("the sample reads in Bahasa Melayu and no width scrolls sideways", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Baca dalam Bahasa Melayu" }).click();
  const box = page.getByRole("region", { name: ms.web.home.sample_label });
  await expect(box.locator(".verdict")).toHaveText(ms.verdicts[sample.verdict as keyof typeof ms.verdicts].label);
  await expect(box.getByText(sampleFor(ms), { exact: true })).toBeVisible();
  // The clause stays in the site's own words in either language.
  await expect(box.locator(".quote p")).toHaveText(sample.quote);
  await expect(box.getByRole("link", { name: ms.web.home.sample_open })).toHaveAttribute("href", `/r/${sample.receipt_id}`);
  for (const lang of ["ms", "en"] as const) {
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    for (const [width, height] of [[320, 640], [390, 664], [1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      await noSideOverflow(page, `at ${width} px in ${lang}`);
    }
    if (lang === "ms") await page.getByRole("button", { name: ms.web.nav.lang_label }).click();
  }
  expect(errors).toEqual([]);
});

test("the sample's link opens its receipt", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: en.web.home.sample_label }).getByRole("link", { name: en.web.home.sample_open }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${sample.receipt_id}$`));
});

test("without a sample the page shows the examples and the form as before", async ({ page }) => {
  const errors = watchConsole(page);
  await withSite(page, (view) => {
    view.sample = null;
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.web.home.h1);
  await expect(page.locator(".sample")).toHaveCount(0);
  await expect(page.locator(".examples .example")).toHaveCount(examples.examples.length);
  await expect(page.getByRole("button", { name: en.web.form.submit, exact: true })).toBeVisible();
  await noSideOverflow(page, "without a sample");
  expect(errors).toEqual([]);
});

test("an example without a saved receipt fills the form from above it", async ({ page }) => {
  const first = examples.examples[0]!;
  await withSite(page, (view) => {
    (view.examples as { receipt_id: string | null }[])[0]!.receipt_id = null;
  });
  await page.goto("/");
  await page.getByRole("button", { name: (en.web.form as Record<string, string>)[`example_${first.key}`]! }).click();
  await expect(page.getByLabel(en.web.form.url)).toHaveValue(first.site);
  await expect(page.getByLabel(en.web.form.url)).toBeFocused();
  await expect(page.getByRole("radio", { name: en.actions[first.action as keyof typeof en.actions], exact: true })).toBeChecked();
  await expect(page.getByText(en.web.form.example_filled)).toBeVisible();
});
