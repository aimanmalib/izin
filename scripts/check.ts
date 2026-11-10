// Development CLI: runs one check and prints the receipt JSON.
//   npm run check -- <url> <action> [--detail "..."] [--agent Token] [--terms-file path] [--hint url]...
// With IZIN_FAKE=1 the reader and decider are offline fakes; without it the configured providers
// are called and cost credit.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ACTIONS, loadConfig, type Action } from "../server/config.js";
import { runCheck } from "../server/pipeline.js";
import { pipelineDeps } from "../server/wiring.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    detail: { type: "string" },
    agent: { type: "string" },
    "terms-file": { type: "string" },
    hint: { type: "string", multiple: true },
  },
});
const [url, action] = positionals;
if (!url || !action || !(ACTIONS as readonly string[]).includes(action)) {
  console.error(`usage: npm run check -- <url> <${ACTIONS.join("|")}> [--detail text] [--agent token] [--terms-file path] [--hint url]`);
  process.exit(2);
}

const cfg = loadConfig();
const receipt = await runCheck(
  {
    url,
    action: action as Action,
    ...(values.detail ? { detail: values.detail } : {}),
    ...(values.agent ? { agent: values.agent } : {}),
    ...(values["terms-file"] ? { terms_text: readFileSync(values["terms-file"], "utf8") } : {}),
    ...(values.hint?.length ? { policy_hints: values.hint } : {}),
  },
  { ...pipelineDeps(cfg), source: "cli" },
);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
