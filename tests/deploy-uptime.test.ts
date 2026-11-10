// deploy/uptime.sh with stub curl, docker and notifier on PATH: no network, no Docker.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "..", "deploy", "uptime.sh");
const DAY1 = 1_800_000_000; // a fixed UTC instant
let dir: string;

function stub(name: string, body: string) {
  const p = join(dir, "bin", name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}

function setup(opts: { code: string; logs?: string; ctr?: string }) {
  stub("curl", `echo -n ${opts.code}`);
  writeFileSync(join(dir, "logs.txt"), opts.logs ?? "");
  stub("docker", `case "$1" in inspect) echo -n ${opts.ctr ?? "running/healthy"};; logs) cat "${dir}/logs.txt";; esac`);
}

function run(now: number) {
  // GIT_* and other host variables do not matter here; only PATH and the overrides do.
  execFileSync("bash", [SCRIPT], {
    env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      HOME: dir,
      UPTIME_URL: "https://example.test",
      UPTIME_STATE: join(dir, "state"),
      UPTIME_NOTIFY: join(dir, "bin", "notify"),
      UPTIME_NOW: String(now),
    },
  });
}

const sent = () => (existsSync(join(dir, "sent.txt")) ? readFileSync(join(dir, "sent.txt"), "utf8").trim().split("\n").filter(Boolean) : []);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "izin-uptime-"));
  execFileSync("mkdir", ["-p", join(dir, "bin")]);
  stub("notify", `echo "$2|$1" >> "${dir}/sent.txt"; [ "$NOTIFY_KOD_KELUAR" = 1 ]`);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("deploy/uptime.sh", () => {
  it("stays quiet while the site answers 200", () => {
    setup({ code: "200" });
    run(DAY1);
    run(DAY1 + 300);
    expect(sent()).toEqual([]);
    expect(readFileSync(join(dir, "state"), "utf8").split("\n")[0]).toBe(`up 0 ${DAY1 + 300}`);
  });

  it("sends the unhealthy text once, only after two failures in a row, then one recovery line", () => {
    setup({ code: "502", ctr: "running/unhealthy" });
    run(DAY1);
    expect(sent()).toEqual([]);
    run(DAY1 + 300);
    run(DAY1 + 600);
    const lang = JSON.parse(readFileSync(join(__dirname, "..", "lang", "ms.json"), "utf8")) as { alerts: { unhealthy: string } };
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain(`warn|${lang.alerts.unhealthy}`);
    expect(sent()[0]).toContain("/api/health=502");
    setup({ code: "200" });
    run(DAY1 + 900);
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toMatch(/^info\|/);
  });

  it("relays alerts the server logged, each text once per UTC day", () => {
    const line = JSON.stringify({ alert: "Kredit habis.", delivered: false });
    setup({ code: "200", logs: `{"level":30,"msg":"listening"}\n${line}\nnot json\n${JSON.stringify({ alert: "x", delivered: true })}\n` });
    run(DAY1);
    run(DAY1 + 300); // the stub prints the same lines again: same day, not sent twice
    expect(sent()).toEqual(["warn|Izin: Kredit habis."]);
    run(DAY1 + 86_400); // next UTC day
    expect(sent()).toHaveLength(2);
  });
});
