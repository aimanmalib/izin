// Izin as an OpenServ agent. One capability, `check`, asks the public Izin API for a verdict on one
// site and one action; one x402 workflow sells it per call on the OpenServ Agent Market at the
// fresh-check price in config/izin.json. The process keeps a tunnel to the platform open and holds
// no Izin keys: it talks to the same public API as any other client.
//
//   node --import tsx agent.ts            register (first run) or reuse the identity, then serve
//   node --import tsx agent.ts --kering   print what would be registered and exit
//
// The platform account is the operator's own: its user API key (platform.openserv.ai, Profile, API keys)
// is read from OPENSERV_USER_API_KEY. provision() keeps what it registered in .openserv.json in the
// working directory, so the process runs inside the folder named by IZIN_OPENSERV_STATE, which also
// holds the .env with that key. That folder is never in the repo.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { provision, triggers } from "@openserv-labs/client";
import { Agent, run } from "@openserv-labs/sdk";
import { z } from "zod";
import { ACTIONS, checkOnIzin, type IzinApi } from "./check.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const cfg = JSON.parse(read("../config/izin.json")) as {
  public_origin: string;
  web: { tiers: { agent_usd_per_fresh_check: number } };
  openserv: { agent_name: string; workflow_timeout_s: number; poll_ms: number; wait_s: number; pay_to_env: string };
};
const t = (JSON.parse(read("../lang/en.json")) as { openserv: Record<string, string> }).openserv;
const systemPrompt = read("../prompts/openserv-agent.v1.md").trim();

const o = cfg.openserv;
const price = String(cfg.web.tiers.agent_usd_per_fresh_check);
const payTo = process.env[o.pay_to_env]?.trim() ?? "";
const payout = /^0x[0-9a-fA-F]{40}$/.test(payTo) ? { walletAddress: payTo } : {};
const api: IzinApi = { origin: cfg.public_origin, fetch, pollMs: o.poll_ms, waitMs: o.wait_s * 1000 };

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

const agent = new Agent({ systemPrompt });

agent.addCapability({
  name: "check",
  description: fill(t.capability_description!, { wait: o.wait_s }),
  inputSchema: z.object({
    url: z.string().describe(t.input_url_description!),
    action: z.enum(ACTIONS).describe(t.input_action_description!),
  }),
  async run({ args }) {
    const r = await checkOnIzin(api, args);
    if (r.ok) return JSON.stringify(r.answer, null, 2);
    const message = fill(t[`err_${r.error}`] ?? t.err_failed!, { retry: r.retry_after_s ?? 60, detail: r.detail ?? "" });
    return JSON.stringify({ error: r.error, message, ...(r.receipt_url ? { receipt_url: r.receipt_url } : {}) }, null, 2);
  },
});

const plan = {
  agent: { instance: agent, name: o.agent_name, description: t.agent_description! },
  workflow: {
    name: t.workflow_name!,
    goal: t.workflow_goal!,
    trigger: triggers.x402({
      name: t.trigger_name!,
      description: t.trigger_description!,
      price,
      timeout: o.workflow_timeout_s,
      ...payout,
      input: {
        url: { type: "string", title: t.input_url_title!, description: t.input_url_description! },
        action: { type: "string", title: t.input_action_title!, description: t.input_action_description! },
      },
    }),
    task: { description: t.task_description! },
  },
};

if (process.argv.includes("--kering")) {
  console.log(JSON.stringify({ agent: { name: plan.agent.name, description: plan.agent.description }, workflow: { name: plan.workflow.name, goal: plan.workflow.goal }, price_usd: price, payout: payout.walletAddress ?? "(the identity wallet)", api: api.origin }, null, 2));
  process.exit(0);
}

const state = process.env.IZIN_OPENSERV_STATE;
if (!state) {
  console.error("IZIN_OPENSERV_STATE is not set: name the folder that keeps the platform identity (never inside the repo tree that is published)");
  process.exit(1);
}
mkdirSync(state, { recursive: true, mode: 0o700 });
process.chdir(state);
// A missing identity file would make provision() sign up a new account. A deployed copy must never do
// that by accident (an unmounted volume, a wrong path), so it asks for the file explicitly.
if (process.env.IZIN_OPENSERV_REQUIRE_STATE === "1" && !existsSync(".openserv.json")) {
  console.error(".openserv.json is missing in the state folder: refusing to register a new identity");
  process.exit(1);
}
if (existsSync(".env")) process.loadEnvFile(".env");
const userApiKey = process.env.OPENSERV_USER_API_KEY?.trim();
if (!userApiKey) {
  console.error("OPENSERV_USER_API_KEY is not set (state folder .env): create a user API key on the platform first");
  process.exit(1);
}
if (!payout.walletAddress) {
  console.error(`${o.pay_to_env} is not a wallet address: the x402 trigger needs a payout address`);
  process.exit(1);
}

// With a user API key the SDK asks for the payout wallet at the top level as well as on the trigger.
const result = await provision({ userApiKey, walletAddress: payout.walletAddress, ...plan });
console.log(`agent ${result.agentId} · workflow ${result.workflowId} · paywall ${result.paywallUrl ?? "(see the platform)"}`);
await run(agent);
