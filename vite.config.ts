import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The page title and description in index.html come from lang/en.json, so no UI text lives in HTML.
// The link preview image needs an absolute address: the public origin comes from config/izin.json.
function langMeta(): Plugin {
  return {
    name: "izin-lang-meta",
    transformIndexHtml(html) {
      const en = JSON.parse(readFileSync(new URL("./lang/en.json", import.meta.url), "utf8")) as { web: { meta: { title: string; description: string } } };
      const cfg = JSON.parse(readFileSync(new URL("./config/izin.json", import.meta.url), "utf8")) as { public_origin: string };
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      return html
        .replaceAll("%TITLE%", esc(en.web.meta.title))
        .replaceAll("%DESCRIPTION%", esc(en.web.meta.description))
        .replaceAll("%ORIGIN%", esc(cfg.public_origin));
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), langMeta()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8080", "/mcp": "http://127.0.0.1:8080" } },
});
