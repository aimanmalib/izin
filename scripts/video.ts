// Records the 60 to 90 second demo video from the live site: silent, captions burned in, a silent
// AAC track (social players expect one). Scenes and captions live in config/video.json; the
// gallery numbers come from docs/UKUR.md, the verdict from the stored receipt.
//   npm run video -- --kering                 print the scene plan, no network
//   npm run video -- --out <file.mp4> [--base https://izin.sasateguh.com]
// Network use: the stored receipts on the site, one MCP call (answered from a saved receipt), and
// one robots.txt fetch with the IzinBot user agent. No model is called by this script.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../server/config.js";
import { parseRobots } from "../server/kumpul/robots.js";
import { FETCHER_TOKEN } from "../server/kumpul/session.js";
import { loadExamples } from "../server/web/site.js";
import { baselineNumbers, captions, filterGraph, loadVideoConfig, robotsBlock, speedFactor, totalSeconds, verdictWord, wrap, type ClipFilter } from "./video/plan.js";
import { recordScenes, type SceneData } from "./video/scenes.js";

const cfg = loadConfig();
const vc = loadVideoConfig();
const { values } = parseArgs({
  options: {
    kering: { type: "boolean", default: false },
    out: { type: "string", default: "data/video/izin-demo.mp4" },
    base: { type: "string", default: cfg.public_origin },
    work: { type: "string", default: "data/video/work" },
  },
});

const nums = baselineNumbers(readFileSync("docs/UKUR.md", "utf8"), vc.ukur_baseline);
if (!nums) throw new Error("docs/UKUR.md has no robots-only headline numbers");
const examples = loadExamples();
const idFor = (key: string) => {
  const id = examples.find((e) => e.key === key)?.receipt_id;
  if (!id) throw new Error(`config/examples.json: example ${key} has no receipt_id`);
  return id;
};
const mainReceipt = idFor(vc.receipts.main);
const trapReceipt = idFor(vc.receipts.trap);

if (values.kering) {
  const plan = captions(vc, { ...nums, verdict: "(verdict from the receipt)" });
  for (const s of plan) console.log(`${String(s.seconds).padStart(3)} s  ${s.key.padEnd(8)} ${s.caption}`);
  console.log(`total ${totalSeconds(plan)} s; receipts ${mainReceipt}, ${trapReceipt}; robots ${vc.robots.site}robots.txt`);
  process.exit(0);
}

const base = values.base!.replace(/\/$/, "");
const font = vc.fonts.sans.find((f) => existsSync(f));
if (!font) throw new Error("no caption font found (config/video.json fonts.sans)");

// The stored receipt gives the verdict word for the caption.
const rec = (await (await fetch(`${base}/api/receipt/${mainReceipt}`)).json()) as { receipt?: { verdict: string } };
if (!rec.receipt) throw new Error(`receipt ${mainReceipt} not found on ${base}`);
const plan = captions(vc, { ...nums, verdict: verdictWord(rec.receipt.verdict) });

// One robots.txt fetch with the product user agent.
const robotsUrl = new URL("/robots.txt", vc.robots.site).toString();
const host = new URL(robotsUrl).hostname.replace(/^www\./, "");
if (cfg.do_not_fetch_hosts.some((h) => host === h || host.endsWith(`.${h}`))) throw new Error(`${host} is not fetched`);
const res = await fetch(robotsUrl, { headers: { "user-agent": cfg.user_agent }, redirect: "follow" });
if (!res.ok) throw new Error(`robots.txt answered ${res.status}: the opening scene needs the file`);
const robotsText = await res.text();
const readAt = new Date().toISOString().slice(0, 16).replace("T", " ");
const block = robotsBlock(robotsText, vc.robots.block_marker, vc.robots.context_lines);
if (!block) throw new Error(`robots.txt no longer has the "${vc.robots.block_marker}" block`);
const probeUrl = new URL(vc.robots.probe_path, vc.robots.site).toString();
const allowed = !parseRobots(robotsUrl, robotsText, cfg).isDisallowed(probeUrl, FETCHER_TOKEN);

// One MCP call, as an agent would make it.
const client = new Client({ name: "izin-video", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
const call = (await client.callTool({ name: "izin_check", arguments: { url: vc.mcp.url, action: vc.mcp.action } })) as {
  structuredContent?: Record<string, unknown>;
};
await client.close();
const sc = call.structuredContent ?? {};
const answer = JSON.stringify(
  Object.fromEntries(["verdict", "reason", "receipt_id", "receipt_url"].filter((k) => k in sc).map((k) => [k, sc[k]])),
  null,
  2,
);

const data: SceneData = {
  origin: base,
  mainReceipt,
  trapReceipt,
  robots: { ...block, readAt, ua: cfg.user_agent, probeUrl, allowed },
  mcp: {
    command: `claude mcp add --transport http izin ${base}/mcp`,
    call: `izin_check ${JSON.stringify({ url: vc.mcp.url, action: vc.mcp.action })}`,
    answer,
  },
};

const work = resolve(values.work!);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const clips = await recordScenes(vc, data, work);

const filters: ClipFilter[] = clips.map((c, i) => {
  const slot = plan[i]!;
  const captionFile = join(work, `caption-${i}.txt`);
  writeFileSync(captionFile, wrap(slot.caption, vc.caption.wrap_chars));
  const factor = speedFactor(c.end - c.start, slot.seconds);
  let speedFile: string | null = null;
  if (factor >= vc.caption.speed_label_min) {
    speedFile = join(work, `speed-${i}.txt`);
    writeFileSync(speedFile, `×${factor}`);
  }
  return { input: i, start: c.start, end: c.end, slot: slot.seconds, captionFile, speedFile };
});

const out = resolve(values.out!);
mkdirSync(resolve(out, ".."), { recursive: true });
const total = totalSeconds(plan);
const args = ["-y", "-hide_banner", "-loglevel", "error"];
for (const c of clips) args.push("-i", c.file);
args.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo");
args.push("-filter_complex", filterGraph(vc, filters, font), "-map", "[vout]", "-map", `${clips.length}:a`);
args.push("-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", String(vc.fps), "-c:a", "aac", "-b:a", "64k");
args.push("-t", String(total), "-movflags", "+faststart", out);
execFileSync("ffmpeg", args, { stdio: "inherit" });

// Checks before anyone sees it: length, size, codecs, and no picture held still too long.
const probe = JSON.parse(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", out], {
    encoding: "utf8",
  }),
) as { format: { duration: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number }[] };
const freezeLog = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "$1" -vf freezedetect=n=0.001:d=${vc.limits.freeze_s} -map 0:v -f null - 2>&1 | grep -c freeze_start || true`, "sh", out], { encoding: "utf8" });
const duration = Number(probe.format.duration);
const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");
const report = {
  out,
  duration_s: Math.round(duration * 10) / 10,
  size: v ? `${v.width}x${v.height}` : null,
  video: v?.codec_name ?? null,
  audio: a?.codec_name ?? null,
  freezes_over_limit: Number(freezeLog.trim()),
  robots_read_at: `${readAt} UTC`,
  speed: filters.map((f, i) => `${plan[i]!.key}:${speedFactor(f.end - f.start, f.slot)}`).join(" "),
};
console.log(JSON.stringify(report));
const ok =
  duration >= vc.limits.min_s && duration <= vc.limits.max_s && v?.height === vc.size.height && v?.codec_name === "h264" && a?.codec_name === "aac" && report.freezes_over_limit === 0;
process.exit(ok ? 0 : 1);
