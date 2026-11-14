import { defineConfig } from "tsup";

export default defineConfig({
  // The gallery, benchmark and prime runs ship in the image so they can run next to the data volume.
  entry: { main: "server/main.ts", gallery: "scripts/gallery.ts", bench: "scripts/bench.ts", prime: "scripts/prime.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
});
