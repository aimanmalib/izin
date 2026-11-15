// The demo video, the parts that need no browser and no network: the scene list from
// config/video.json, captions filled from the measurements page, the robots.txt comment block to
// show, and the ffmpeg filter for each recorded clip. Kept pure so tests can check them.
import { readFileSync } from "node:fs";

export type Scene = { key: string; seconds: number; caption: string };
export type VideoConfig = {
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  fps: number;
  caption: { font_size: number; wrap_chars: number; bottom_px: number; speed_label_min: number };
  fonts: { sans: string[]; mono: string[] };
  limits: { min_s: number; max_s: number; freeze_s: number; scene_max_s: number };
  robots: { site: string; block_marker: string; probe_path: string; context_lines: number };
  receipts: { main: string };
  trap: { button: string; timeout_s: number };
  mcp: { url: string; action: string };
  ukur_baseline: string;
  scenes: Scene[];
  text: Record<string, string> & { end_lines: string[] };
};

export function loadVideoConfig(path = "config/video.json"): VideoConfig {
  return JSON.parse(readFileSync(path, "utf8")) as VideoConfig;
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
}

/** The headline pair (k of m) from the robots-only section of the measurements page; null when absent. */
export function baselineNumbers(ukur: string, pattern: string): { k: number; m: number } | null {
  const hit = new RegExp(pattern).exec(ukur);
  return hit ? { k: Number(hit[1]), m: Number(hit[2]) } : null;
}

/** Captions with every slot filled; a caption that still has a slot is an error, never shown. */
export function captions(cfg: VideoConfig, vars: Record<string, string | number>): Scene[] {
  return cfg.scenes.map((s) => {
    const caption = fill(s.caption, vars);
    if (/\{\w+\}/.test(caption)) throw new Error(`caption for scene ${s.key} has an unfilled slot: ${caption}`);
    return { ...s, caption };
  });
}

export function totalSeconds(scenes: Scene[]): number {
  return scenes.reduce((n, s) => n + s.seconds, 0);
}

/** Greedy word wrap for burned-in captions (drawtext does not wrap). */
export function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * The part of a robots.txt comment that starts at the marker line and runs to the end of that
 * comment, with a few lines of context around it. Returns the lines and which of them to
 * highlight. Null when absent.
 */
export function robotsBlock(text: string, marker: string, context: number): { lines: string[]; first: number; last: number } | null {
  const all = text.split(/\r?\n/);
  const at = all.findIndex((l) => l.trimStart().startsWith("#") && l.includes(marker));
  if (at < 0) return null;
  const first = at;
  let last = at;
  while (last < all.length - 1 && all[last + 1]!.trimStart().startsWith("#")) last++;
  const from = Math.max(0, first - context);
  const to = Math.min(all.length - 1, last + context);
  return { lines: all.slice(from, to + 1), first: first - from, last: last - from };
}

/** Speed-up for a clip that ran longer than its slot; 1 when it fits. Rounded to one decimal. */
export function speedFactor(clipSeconds: number, slotSeconds: number): number {
  if (clipSeconds <= slotSeconds) return 1;
  return Math.round((clipSeconds / slotSeconds) * 10) / 10;
}

/** Escape a path for an ffmpeg filter argument (textfile=, fontfile=). */
function esc(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export type ClipFilter = { input: number; start: number; end: number; slot: number; captionFile: string; speedFile: string | null };

/**
 * The filter chain for one clip: cut [start, end], speed up when it ran long, hold the last frame
 * when it ran short, fix the length to the slot, then burn the caption and any speed label.
 */
export function clipFilter(cfg: VideoConfig, c: ClipFilter, font: string, label: string): string {
  const { width, height } = cfg.size;
  const factor = speedFactor(c.end - c.start, c.slot);
  const cap = cfg.caption;
  const parts = [
    `trim=start=${c.start.toFixed(3)}:end=${c.end.toFixed(3)}`,
    `setpts=(PTS-STARTPTS)/${factor}`,
    `fps=${cfg.fps}`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    `tpad=stop_mode=clone:stop_duration=${c.slot}`,
    `trim=duration=${c.slot}`,
    `drawtext=fontfile='${esc(font)}':textfile='${esc(c.captionFile)}':fontsize=${cap.font_size}:fontcolor=white:line_spacing=10:box=1:boxcolor=black@0.72:boxborderw=22:x=(w-text_w)/2:y=h-text_h-${cap.bottom_px}`,
  ];
  if (c.speedFile && factor >= cap.speed_label_min) {
    parts.push(`drawtext=fontfile='${esc(font)}':textfile='${esc(c.speedFile)}':fontsize=${Math.round(cap.font_size * 0.8)}:fontcolor=white:box=1:boxcolor=black@0.72:boxborderw=14:x=w-text_w-48:y=48`);
  }
  return `[${c.input}:v]${parts.join(",")}[${label}]`;
}

/** The full ffmpeg filter graph: every clip, then concat. Audio is a silent AAC track added by the caller. */
export function filterGraph(cfg: VideoConfig, clips: ClipFilter[], font: string): string {
  const chains = clips.map((c, i) => clipFilter(cfg, c, font, `v${i}`));
  const inputs = clips.map((_, i) => `[v${i}]`).join("");
  return `${chains.join(";")};${inputs}concat=n=${clips.length}:v=1:a=0,format=yuv420p[vout]`;
}

export function verdictWord(v: string): string {
  return v === "NO_GO" ? "NO-GO" : v;
}
