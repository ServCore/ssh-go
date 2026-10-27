import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './ui',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: '../.test-artifacts/playwright',
  use: {
    baseURL: 'http://127.0.0.1:1421',
    viewport: { width: 1280, height: 820 },
    launchOptions: process.env.SSH_TOOLS_CHROMIUM ? { executablePath: process.env.SSH_TOOLS_CHROMIUM } : {},
  },
  webServer: { command: 'npm run dev', cwd: fileURLToPath(new URL('..', import.meta.url)), url: 'http://127.0.0.1:1421', reuseExistingServer: !process.env.CI },
});
