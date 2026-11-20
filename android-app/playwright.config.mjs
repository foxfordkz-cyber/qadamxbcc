import { defineConfig } from "@playwright/test";
const preview = "http://127.0.0.1:" + (process.env.QADAM_PREVIEW_PORT ?? 4173);
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: preview,
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 1,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview",
    url: preview,
    reuseExistingServer: !process.env.CI,
  },
});
