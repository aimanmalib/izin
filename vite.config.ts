import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The page title and description in index.html come from lang/en.json, so no UI text lives in HTML.
function langMeta(): Plugin {
  return {
    name: "izin-lang-meta",
    transformIndexHtml(html) {
      const en = JSON.parse(readFileSync(new URL("./lang/en.json", import.meta.url), "utf8")) as { web: { meta: { title: string; description: string } } };
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      return html.replace("%TITLE%", esc(en.web.meta.title)).replace("%DESCRIPTION%", esc(en.web.meta.description));
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), langMeta()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8080", "/mcp": "http://127.0.0.1:8080" } },
});
