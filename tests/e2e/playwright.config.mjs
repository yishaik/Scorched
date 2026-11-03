// Playwright config: Chromium only, Pixel 7 portrait + landscape, plus a two-client online project that runs the
// Worker locally (wrangler dev, never production). See docs/TESTING.md.
import { defineConfig, devices } from "@playwright/test";

const PORT = +(process.env.ST_PORT || 4173);
const WORKER_PORT = +(process.env.ST_WORKER_PORT || 8787);
// a system Chromium (e.g. /usr/bin/chromium on arm64 Linux, where Playwright has no download) can be used instead
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const pixel7 = devices["Pixel 7"];
// Safety net under the per-test routing: the production hosts resolve nowhere, so even an unrouted request or
// WebSocket can never reach the live service. No system proxy is used (tests only talk to 127.0.0.1).
const args = ["--no-proxy-server", "--host-resolver-rules=MAP scorched-tanks.yishai-k.workers.dev ~NOTFOUND, MAP tanks.yishaik.com ~NOTFOUND"];
const launchOptions = executablePath ? { executablePath, args } : { args };
const online = !!process.env.ST_ONLINE && process.env.ST_ONLINE !== "0";

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    launchOptions,
  },
  projects: [
    { name: "pixel7-portrait", testIgnore: /online\.spec/, use: { ...pixel7, browserName: "chromium", launchOptions } },
    {
      name: "pixel7-landscape", testIgnore: /online\.spec/,
      use: { ...pixel7, browserName: "chromium", launchOptions, viewport: { width: pixel7.viewport.height, height: pixel7.viewport.width } },
    },
    ...(online ? [{ name: "online", testMatch: /online\.spec/, use: { ...pixel7, browserName: "chromium", launchOptions } }] : []),
  ],
  webServer: [
    { command: `node support/serve.mjs ${PORT}`, url: `http://127.0.0.1:${PORT}/index.html`, reuseExistingServer: !process.env.CI, timeout: 20_000 },
    ...(online ? [{
      command: `node support/worker-dev.mjs ${WORKER_PORT}`,
      url: `http://127.0.0.1:${WORKER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
    }] : []),
  ],
});
