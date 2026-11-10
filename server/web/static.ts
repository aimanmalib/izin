// Serves the built web app (web/dist) from the same process as the API: hashed assets with a long
// cache, a few root files, and index.html for every page route. HTML carries no-transform so a
// proxy does not rewrite it; compression is the reverse proxy's job.
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

// Page routes the app renders. Anything else gets the same HTML with status 404 (the app shows "not found").
const PAGES: RegExp[] = [/^\/$/, /^\/r\/[a-z2-7]{8,32}$/, /^\/(gallery|bench|trap|docs|bot)$/];

// The test shop at /trap/ is plain HTML written for Izin, not part of the app. Its terms page hides one
// sentence with an inline style, so its policy allows inline styles and nothing else.
const TRAP_PAGES: Record<string, string> = { "/trap/": "index.html", "/trap/terms": "terms.html" };
export const TRAP_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function sendFile(reply: FastifyReply, path: string, cache: string) {
  const type = TYPES[extname(path)];
  if (!type || !existsSync(path)) return reply.code(404).send({ error: "not_found" });
  return reply.header("content-type", type).header("cache-control", cache).header("x-content-type-options", "nosniff").send(readFileSync(path));
}

export function isPage(pathname: string): boolean {
  return PAGES.some((p) => p.test(pathname));
}

export interface StaticOpts {
  /** Stored receipt for the JSON link /r/<id>.json; null when unknown or not finished. */
  receipt: (id: string) => unknown;
  /** Folder with the trap shop pages (index.html, terms.html). */
  trapDir: string;
}

export function registerStatic(app: FastifyInstance, dir: string, opts: StaticOpts): void {
  let html: Buffer | null = null;
  const index = (): Buffer | null => {
    if (html) return html;
    const p = join(dir, "index.html");
    if (!existsSync(p)) return null;
    html = readFileSync(p);
    return html;
  };
  const page = (reply: FastifyReply, status: number) => {
    const body = index();
    if (!body) return reply.code(503).header("cache-control", "no-store").send({ error: "web_not_built" });
    return reply.code(status).headers(HTML_HEADERS).send(body);
  };

  app.get<{ Params: { name: string } }>("/assets/:name", async (req, reply) => {
    if (!SAFE_NAME.test(req.params.name)) return reply.code(404).send({ error: "not_found" });
    return sendFile(reply, join(dir, "assets", req.params.name), "public, max-age=31536000, immutable");
  });

  for (const name of ["favicon.svg", "logo.svg", "logo-512.png", "robots.txt"]) {
    app.get(`/${name}`, async (_req, reply) => sendFile(reply, join(dir, name), "public, max-age=3600"));
  }

  app.get("/", async (_req, reply) => page(reply, 200));

  for (const [route, file] of Object.entries(TRAP_PAGES)) {
    const path = join(opts.trapDir, file);
    app.get(route, async (_req, reply) =>
      existsSync(path) ? reply.headers(TRAP_HEADERS).send(readFileSync(path)) : reply.code(404).send({ error: "not_found" }),
    );
  }

  app.get<{ Params: { id: string } }>("/r/:id", async (req, reply) => {
    const json = /^([a-z2-7]{8,32})\.json$/.exec(req.params.id);
    if (!json) return page(reply, isPage(`/r/${req.params.id}`) ? 200 : 404);
    const r = opts.receipt(json[1]!);
    reply.header("cache-control", "no-store");
    return r ? reply.send(r) : reply.code(404).send({ error: "not_found" });
  });

  app.setNotFoundHandler(async (req, reply) => {
    const path = req.url.split("?")[0] ?? "/";
    if (req.method !== "GET" && req.method !== "HEAD") return reply.code(404).send({ error: "not_found" });
    if (path.startsWith("/api/") || path === "/mcp") return reply.code(404).send({ error: "not_found" });
    return page(reply, isPage(path) ? 200 : 404);
  });
}
