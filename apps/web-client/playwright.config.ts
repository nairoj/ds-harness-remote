import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 240_000,
  workers: 1,
  use: {
    baseURL: process.env.WEB_TEST_BASE_URL ?? "http://127.0.0.1:4174",
    ignoreHTTPSErrors: true,
    headless: true,
    channel: "chrome",
    trace: "off",
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
