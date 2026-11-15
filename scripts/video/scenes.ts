// The demo video, the browser part: one Playwright recording per scene against the live site, plus
// three plain local pages (the robots.txt comment, the agent terminal, the end card) drawn from
// data fetched before recording. Third-party pages are never opened in the browser: the robots.txt
// text comes from one IzinBot fetch made by the caller.
import { chromium, type Browser, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fill, type VideoConfig } from "./plan.js";

export type Clip = { key: string; file: string; start: number; end: number };
export type SceneData = {
  origin: string;
  mainReceipt: string;
  robots: { lines: string[]; first: number; last: number; readAt: string; ua: string; probeUrl: string; allowed: boolean };
  mcp: { command: string; call: string; answer: string };
  /** Set by the trap scene: the receipt page the live check opened. */
  trapLive?: string;
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Scroll by `dy` CSS pixels over `ms`, in small steps, so the picture keeps moving. */
async function glide(page: Page, dy: number, ms: number) {
  const steps = Math.max(1, Math.round(ms / 40));
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), dy / steps);
    await pause(ms / steps);
  }
}

/** Scroll so the element sits `offset` px below the top, spread evenly over `ms`. */
async function glideTo(page: Page, selector: string, offset: number, ms: number) {
  const dy = await page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel as string);
      if (!el) return 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const target = Math.min(max, el.getBoundingClientRect().top + window.scrollY - (off as number));
      return target - window.scrollY;
    },
    [selector, offset] as const,
  );
  await glide(page, dy, ms);
}

async function glideX(page: Page, selector: string, dx: number, ms: number) {
  const steps = Math.max(1, Math.round(ms / 40));
  for (let i = 0; i < steps; i++) {
    await page.evaluate(([sel, d]) => document.querySelector(sel as string)?.scrollBy(d as number, 0), [selector, dx / steps] as const);
    await pause(ms / steps);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function shell(tokens: string, body: string, extraCss: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${tokens}
html,body{margin:0;height:100%;background:var(--paper);color:var(--ink);font-family:var(--sans)}
.fade{opacity:0;transition:opacity .6s var(--ease)} .on{opacity:1}
${extraCss}</style></head><body>${body}</body></html>`;
}

function robotsPage(tokens: string, cfg: VideoConfig, d: SceneData): string {
  const r = d.robots;
  const rows = r.lines
    .map((l, i) => `<div class="ln${i >= r.first && i <= r.last ? " blk" : ""}">${esc(l) || "&nbsp;"}</div>`)
    .join("");
  const verdict = r.allowed ? cfg.text.parser_allowed! : cfg.text.parser_disallowed!;
  const body = `<main><p class="cap">${esc(fill(cfg.text.robots_title!, { date: r.readAt, ua: r.ua }))}</p>
<div class="grid"><pre id="txt">${rows}</pre>
<aside id="parser" class="fade"><p class="ph">${esc(fill(cfg.text.parser_head!, { url: r.probeUrl }))}</p><p class="pv">${esc(verdict)}</p></aside></div></main>`;
  const css = `main{padding:36px 44px}.cap{font-family:var(--mono);color:var(--ink-soft);margin:0 0 16px;font-size:15px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:28px;align-items:start}
pre{margin:0;font-family:var(--mono);font-size:13.5px;line-height:1.5;background:var(--paper-raised);border:1px solid var(--rule);border-radius:var(--radius-sm);padding:14px 18px;max-height:560px;overflow:hidden;white-space:pre-wrap}
.ln{padding:0 6px;border-radius:4px;transition:background .8s var(--ease)} .hl .blk{background:var(--ask-soft)}
aside{background:var(--paper-raised);border:1px solid var(--rule-strong);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow)}
.ph{margin:0 0 10px;font-size:15px;color:var(--ink-soft);overflow-wrap:anywhere}.pv{margin:0;font-family:var(--mono);font-size:30px;font-weight:700;color:var(--go)}`;
  return shell(tokens, body, css);
}

function terminalPage(tokens: string, d: SceneData): string {
  const body = `<main><div class="term"><div id="cmd" class="line"><span class="p">$ </span><span id="typed"></span></div>
<div id="call" class="line fade"><span class="p">&gt; </span>${esc(d.mcp.call)}</div><pre id="ans">${d.mcp.answer.split("\n").map((l, i) => `<div class="fade a" id="a${i}">${esc(l) || "&nbsp;"}</div>`).join("")}</pre></div></main>`;
  const css = `main{padding:56px;height:100%;box-sizing:border-box}.term{background:var(--ink);color:var(--paper);border-radius:var(--radius);padding:28px 32px;font-family:var(--mono);font-size:24px;line-height:1.5;height:100%;box-sizing:border-box;overflow:hidden}
.p{color:var(--rule-strong)}.line{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:14px}pre{margin:0;font-family:var(--mono);font-size:21px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--accent-soft)}`;
  return shell(tokens, body, css);
}

function endPage(tokens: string, cfg: VideoConfig, d: SceneData, logo: string): string {
  const [name, line, url] = cfg.text.end_lines.map((l) => esc(fill(l, { origin: d.origin.replace(/^https:\/\//, "") })));
  const body = `<main><div class="logo fade" id="e0">${logo}</div><h1 class="fade" id="e1">${name}</h1><p class="fade" id="e2">${line}</p><p class="url fade" id="e3">${url}</p></main>`;
  const css = `main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:0 80px 140px;box-sizing:border-box}
.logo svg{width:96px;height:96px}h1{font-family:var(--serif);font-size:64px;margin:0}p{font-size:24px;color:var(--ink-soft);margin:0;max-width:900px}.url{font-family:var(--mono);color:var(--accent);font-size:30px;margin-top:12px}`;
  return shell(tokens, body, css);
}

type Run = (page: Page, mark: () => number) => Promise<{ start: number }>;

/** Record every scene; returns one clip per scene with the part of the recording to keep. Scenes in
 * `reuse` (clips from an earlier run in the same folder) are not recorded again, so a failure after
 * the live trap check never needs a second check. Every clip is listed in clips.json as it lands. */
export async function recordScenes(cfg: VideoConfig, d: SceneData, outDir: string, reuse: Record<string, Clip> = {}): Promise<Clip[]> {
  const tokens = readFileSync("web/src/styles/tokens.css", "utf8");
  const logo = readFileSync("web/public/logo.svg", "utf8");
  const o = d.origin;
  const runs: Record<string, Run> = {
    robots: async (page, mark) => {
      await page.setContent(robotsPage(tokens, cfg, d));
      const start = mark();
      await pause(900);
      await page.evaluate(() => document.getElementById("txt")!.classList.add("hl"));
      const blk = await page.$(".blk");
      await blk?.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await pause(1600);
      await page.evaluate(() => document.getElementById("parser")!.classList.add("on"));
      await pause(3600);
      return { start };
    },
    home: async (page, mark) => {
      await page.goto(`${o}/`, { waitUntil: "networkidle" });
      const start = mark();
      await pause(3000);
      await glide(page, 160, 1500);
      await pause(1500);
      await page.click(`a.example[href^="/r/${d.mainReceipt}"]`);
      await page.waitForSelector(".receipt-verdict");
      await pause(2500);
      return { start };
    },
    verdict: async (page, mark) => {
      await page.goto(`${o}/r/${d.mainReceipt}`, { waitUntil: "networkidle" });
      const start = mark();
      await pause(2500);
      await glideTo(page, "#dec", 60, 3500);
      await pause(3000);
      await glideTo(page, ".prov", 120, 4500);
      await pause(3000);
      return { start };
    },
    trap: async (page, mark) => {
      // The one live check in the video: the second trap button always runs a new check (a detail
      // is never answered from a saved receipt), so the steps on screen are a real run.
      await page.goto(`${o}/trap`, { waitUntil: "networkidle" });
      const start = mark();
      await pause(1500);
      await glideTo(page, "#trap-2", 140, 1500);
      await pause(800);
      await page.click(cfg.trap.button);
      await page.waitForURL(/\/r\/[a-z0-9]+/, { timeout: cfg.trap.timeout_s * 1000 });
      await page.waitForSelector(".receipt-verdict");
      d.trapLive = page.url();
      await pause(1500);
      await glideTo(page, "details.fold-warn", 160, 2000);
      await page.evaluate(() => (document.querySelector("details.fold-warn") as HTMLDetailsElement | null)?.setAttribute("open", ""));
      await pause(2000);
      await glide(page, 60, 2500);
      return { start };
    },
    gallery: async (page, mark) => {
      // The top rows only: the matrix comes into view and moves sideways, never down past them.
      await page.goto(`${o}/gallery`, { waitUntil: "networkidle" });
      const start = mark();
      await pause(2000);
      await glideTo(page, ".matrix-wrap", 20, 3000);
      await pause(2500);
      await glideX(page, ".matrix-wrap", 300, 2500);
      await pause(2000);
      return { start };
    },
    mcp: async (page, mark) => {
      await page.setContent(terminalPage(tokens, d));
      const start = mark();
      await pause(500);
      for (const ch of d.mcp.command) {
        await page.evaluate((c) => (document.getElementById("typed")!.textContent += c), ch);
        await pause(40);
      }
      await pause(800);
      await page.evaluate(() => document.getElementById("call")!.classList.add("on"));
      await pause(1000);
      const n = d.mcp.answer.split("\n").length;
      for (let k = 0; k < n; k++) {
        await page.evaluate((x) => document.getElementById(`a${x}`)!.classList.add("on"), k);
        await pause(250);
      }
      await pause(3500);
      return { start };
    },
    end: async (page, mark) => {
      await page.setContent(endPage(tokens, cfg, d, logo));
      const start = mark();
      for (const id of ["e0", "e1", "e2", "e3"]) {
        await pause(1100);
        await page.evaluate((x) => document.getElementById(x)!.classList.add("on"), id);
      }
      await pause(3600);
      return { start };
    },
  };

  const browser: Browser = await chromium.launch();
  const clips: Clip[] = [];
  try {
    for (const s of cfg.scenes) {
      if (reuse[s.key]) {
        clips.push(reuse[s.key]!);
        console.log(`reused ${s.key}`);
        continue;
      }
      const run = runs[s.key];
      if (!run) throw new Error(`no recording for scene ${s.key}`);
      const ctx = await browser.newContext({
        viewport: { width: cfg.viewport.width, height: cfg.viewport.height },
        recordVideo: { dir: outDir, size: { width: cfg.viewport.width, height: cfg.viewport.height } },
        colorScheme: "light",
        locale: "en-US",
      });
      const page = await ctx.newPage();
      const t0 = Date.now();
      const mark = () => (Date.now() - t0) / 1000;
      const { start } = await run(page, mark);
      const end = mark();
      await ctx.close();
      const file = await page.video()!.path();
      clips.push({ key: s.key, file, start, end });
      writeFileSync(join(outDir, "clips.json"), JSON.stringify({ clips, trap_live: d.trapLive ?? null }, null, 2));
      console.log(`recorded ${s.key}: ${(end - start).toFixed(1)} s`);
    }
  } finally {
    await browser.close();
  }
  return clips;
}
