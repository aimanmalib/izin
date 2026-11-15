import { describe, expect, it } from "vitest";
import { baselineNumbers, captions, filterGraph, loadVideoConfig, robotsBlock, speedFactor, totalSeconds, verdictWord, wrap } from "../scripts/video/plan";

const cfg = loadVideoConfig();

const ROBOTS = [
  "# Example robots file",
  "# general notice line",
  "#",
  "# Agent Rules",
  "#",
  "# Checkouts are for people.",
  "# * No buying bots.",
  "User-agent: *",
  "Disallow: /cart",
  "",
].join("\n");

describe("video plan", () => {
  it("takes the headline pair from the measurements text", () => {
    expect(baselineNumbers("intro\nSome pairs: **7 of 41**.\n", cfg.ukur_baseline)).toEqual({ k: 7, m: 41 });
    expect(baselineNumbers("no numbers here", cfg.ukur_baseline)).toBeNull();
  });

  it("fills every caption slot and refuses a caption with a slot left", () => {
    const plan = captions(cfg, { k: 7, m: 41, verdict: "NO-GO" });
    expect(plan.every((s) => !/\{\w+\}/.test(s.caption))).toBe(true);
    expect(plan.some((s) => s.caption.includes("7 of 41"))).toBe(true);
    expect(() => captions(cfg, { k: 7, m: 41 })).toThrow(/unfilled slot/);
  });

  it("keeps the configured scenes inside the length limits", () => {
    const total = totalSeconds(cfg.scenes);
    expect(total).toBeGreaterThanOrEqual(cfg.limits.min_s);
    expect(total).toBeLessThanOrEqual(cfg.limits.max_s);
    expect(cfg.scenes.every((s) => s.seconds > 0 && s.seconds <= cfg.limits.scene_max_s)).toBe(true);
    expect(cfg.limits.scene_max_s).toBeLessThanOrEqual(20);
  });

  it("cuts the robots.txt comment from the marker to the end of that comment", () => {
    const b = robotsBlock(ROBOTS, "Agent Rules", 1)!;
    expect(b.lines[b.first]).toBe("# Agent Rules");
    expect(b.lines[b.last]).toBe("# * No buying bots.");
    expect(b.lines[0]).toBe("#");
    expect(b.lines.at(-1)).toBe("User-agent: *");
    expect(robotsBlock(ROBOTS, "Missing Marker", 1)).toBeNull();
    expect(robotsBlock("User-agent: *\nAllow: /\n# Agent Rules in a directive comment? no", "Agent Rules", 0)?.first).toBe(0);
  });

  it("speeds up only clips that ran past their slot", () => {
    expect(speedFactor(9, 10)).toBe(1);
    expect(speedFactor(24, 10)).toBe(2.4);
  });

  it("wraps captions on word boundaries", () => {
    expect(wrap("one two three four", 9)).toBe("one two\nthree\nfour");
    expect(wrap("short", 40)).toBe("short");
  });

  it("builds one chain per clip, a speed label only when sped up, then a concat", () => {
    const clips = [
      { input: 0, start: 0.5, end: 6.5, slot: 6, captionFile: "/w/c0.txt", speedFile: "/w/s0.txt" },
      { input: 1, start: 1, end: 31, slot: 10, captionFile: "/w/c1.txt", speedFile: "/w/s1.txt" },
    ];
    const g = filterGraph(cfg, clips, "/f/font.ttf");
    expect(g).toContain("[0:v]trim=start=0.500:end=6.500");
    expect(g).toContain("setpts=(PTS-STARTPTS)/3");
    expect(g.match(/s1\.txt/g)?.length).toBe(1);
    expect(g).not.toContain("s0.txt");
    expect(g).toContain(`scale=${cfg.size.width}:${cfg.size.height}`);
    expect(g.endsWith("concat=n=2:v=1:a=0,format=yuv420p[vout]")).toBe(true);
  });

  it("writes the verdict the way the site shows it", () => {
    expect(verdictWord("NO_GO")).toBe("NO-GO");
    expect(verdictWord("ASK")).toBe("ASK");
  });
});
