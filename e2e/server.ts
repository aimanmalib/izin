// Local server for browser tests: the real app with the offline reader and decider (IZIN_FAKE=1),
// and synthetic sites on loopback that only this process can resolve. No outside network is used.
import { readFileSync } from "node:fs";
import { buildApp } from "../server/app.js";
import { FIXTURES_DIR, loadConfig, parseConfig } from "../server/config.js";
import { createRuntime } from "../server/runtime.js";
import { page, policyText, startSites } from "../tests/helpers/sites.js";
import { E2E_PORT, SITES_PORT } from "./ports.js";

process.env.IZIN_FAKE = "1";
const base = loadConfig();
// Browser runs make more new checks from one address than the public limit allows.
const cfg = parseConfig({ ...base, limits: { ...base.limits, host_interval_ms: 1, rate_new_checks_per_ip_hour: 500 } });
const trap = (f: string) => readFileSync(`${FIXTURES_DIR}trap/${f}`, "utf8");

const sites = await startSites(
  (u) => ({
    "shop.example": {
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
      "/": { body: page("<h1>Shop</h1>", `<a href="${u("shop.example", "/terms")}">Terms of Service</a>`) },
      "/terms": { body: page(`<h1>Terms</h1><p>${policyText("automated access")}</p>`) },
    },
    "trap.example": {
      "/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
      "/trap/": { body: trap("index.html") },
      "/trap/terms": { body: trap("terms.html") },
    },
  }),
  {},
  SITES_PORT,
);

const rt = createRuntime(cfg, { env: { IZIN_FAKE: "1" }, policy: sites.policy, alert: async () => true });
const app = buildApp(cfg, rt);
await app.listen({ port: E2E_PORT, host: "127.0.0.1" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close().then(() => sites.close()).then(() => process.exit(0)));
}
