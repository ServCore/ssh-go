import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./performance",
  workers: 1,
  reporter: "list",
  outputDir: "../.test-artifacts/memory-runs",
  use: {
    baseURL: "http://127.0.0.1:1422",
    viewport: { width: 1280, height: 820 },
    launchOptions: process.env.SSH_TOOLS_CHROMIUM
      ? { executablePath: process.env.SSH_TOOLS_CHROMIUM }
      : {},
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: "npm run preview -- --port 1422 --strictPort",
    url: "http://127.0.0.1:1422",
    reuseExistingServer: false,
  },
});
