// Paid answers over x402, on a test network (ADR 0022). GET <path>?url=&action= answers HTTP 402 with the
// payment terms; a request that carries a valid payment gets the newest saved receipt for that site and
// action in short form. The route reads the store only: no fetch, no model call, no spending.
//
// The x402 hooks live in their own Fastify scope, so no other route passes through them. Settlement
// happens after the handler and only for a 2xx answer: an unknown site (404) or bad input (400) is not charged.
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/fastify";
import { LANG_DIR, type IzinConfig } from "../config.js";
import { shortReceipt } from "../mcp/server.js";
import { InvalidInput, parseCheckRequest } from "./input.js";
import type { CheckService } from "./service.js";

type PaidTexts = Record<"description" | "unpaid" | "no_saved", string>;

export function paidTexts(langDir: string = LANG_DIR): PaidTexts {
  return (JSON.parse(readFileSync(`${langDir}en.json`, "utf8")) as { paid: PaidTexts }).paid;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The receiving address when the paid route is on: enabled in config and a well-formed address in the environment. */
export function paidPayTo(cfg: IzinConfig, env: NodeJS.ProcessEnv = process.env): string | null {
  const addr = env[cfg.x402.pay_to_env]?.trim() ?? "";
  return cfg.x402.enabled && EVM_ADDRESS.test(addr) ? addr : null;
}

export interface PaidDeps {
  cfg: IzinConfig;
  service: CheckService;
  payTo: string;
  texts: PaidTexts;
  /** Tests pass a stand-in; production talks to the facilitator named in config. */
  facilitator?: FacilitatorClient;
}

export function registerPaid(app: FastifyInstance, d: PaidDeps): void {
  const { cfg, service, texts } = d;
  const x = cfg.x402;
  const usd = cfg.web.tiers.agent_usd_per_saved_answer;
  const vars = { usd, network: x.network_name };
  const network = x.network as `${string}:${string}`;

  void app.register(async (scope) => {
    const server = new x402ResourceServer(d.facilitator ?? new HTTPFacilitatorClient({ url: x.facilitator_url })).register(network, new ExactEvmScheme());
    paymentMiddleware(
      scope,
      {
        [`GET ${x.path}`]: {
          accepts: [{ scheme: "exact", price: `$${usd}`, network, payTo: d.payTo, maxTimeoutSeconds: x.max_timeout_s }],
          resource: `${cfg.public_origin}${x.path}`,
          description: fill(texts.description, vars),
          mimeType: "application/json",
          unpaidResponseBody: () => ({
            contentType: "application/json",
            body: { error: "payment_required", message: fill(texts.unpaid, vars), price_usd: usd, network: x.network, testnet: x.testnet },
          }),
        },
      },
      server,
    );

    scope.get<{ Querystring: { url?: string; action?: string } }>(x.path, async (req, reply) => {
      let cr;
      try {
        cr = parseCheckRequest(cfg, { url: req.query.url, action: req.query.action });
      } catch (e) {
        if (e instanceof InvalidInput) return reply.code(400).send({ error: e.code });
        throw e;
      }
      const receipt = service.savedReceipt(cr);
      if (!receipt) return reply.code(404).send({ error: "no_saved_receipt", message: texts.no_saved });
      return { ...shortReceipt(cfg, receipt), checked_at: receipt.created_at, paid: { price_usd: usd, network: x.network, testnet: x.testnet } };
    });
  });
}
