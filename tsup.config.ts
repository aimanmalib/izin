import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "server/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
});
