import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
process.env.DK_ADMIN_BROWSER_RUN_ID ||= randomUUID();
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "/tmp/dk-admin-playwright-results",
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chrome",
    headless: true,
    trace: "off",
    screenshot: "only-on-failure",
  },
});
