// Registers the listing's on-chain identity (ERC-8004 on Base) through the platform client, once.
// The identity wallet's key lives in the state folder (.identity.key) and needs a little ETH on Base for gas.
//   node --import tsx identity.ts            register (or update) and print the agent id
//   node --import tsx identity.ts --address  print the identity wallet's address, creating the key if missing
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PlatformClient } from "@openserv-labs/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const state = process.env.IZIN_OPENSERV_STATE;
if (!state) throw new Error("IZIN_OPENSERV_STATE is not set");
const keyFile = join(state, ".identity.key");
if (!existsSync(keyFile)) writeFileSync(keyFile, generatePrivateKey(), { mode: 0o600 });
const privateKey = readFileSync(keyFile, "utf8").trim() as `0x${string}`;
const address = privateKeyToAccount(privateKey).address;
if (process.argv.includes("--address")) {
  console.log(address);
  process.exit(0);
}
process.chdir(state);
process.loadEnvFile(".env");
const saved = JSON.parse(readFileSync(".openserv.json", "utf8")) as { workflows: Record<string, Record<string, { workspaceId?: number }>> };
const workflowId = Object.values(saved.workflows).flatMap((w) => Object.values(w)).find((w) => w.workspaceId)?.workspaceId;
if (!workflowId) throw new Error("no registered workflow in .openserv.json");
const t = (JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8")) as { openserv: Record<string, string> }).openserv;
const client = new PlatformClient({ apiKey: process.env.OPENSERV_USER_API_KEY! });
const r = await client.erc8004.registerOnChain({ workflowId, privateKey, name: t.workflow_name!, description: t.agent_description! });
console.log(JSON.stringify({ agentId: r.agentId, txHash: r.txHash, scanUrl: r.scanUrl, wallet: address }));
