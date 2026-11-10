import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT } from "./e2e/ports";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? "dot" : "list",
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-iphone13", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "npm run --silent build:web && npx tsx e2e/server.ts",
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { IZIN_FAKE: "1", NODE_ENV: "test" },
  },
});
