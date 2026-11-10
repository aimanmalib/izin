import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { IZIN_FAKE: "1", NODE_ENV: "test" },
  },
});
