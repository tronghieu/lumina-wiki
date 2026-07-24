import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const runningInCI = Boolean(process.env['CI']);
const planVisualRoot = path.resolve(
  frontendRoot,
  '../../../plans/260711-1407-lumina-desktop-ai-redesign/visual',
);

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  forbidOnly: true,
  retries: runningInCI ? 1 : 0,
  workers: 1,
  reporter: runningInCI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'line',
  outputDir: 'test-results',
  snapshotPathTemplate: path.join(planVisualRoot, '{arg}{ext}'),
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1480, height: 920 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/tests/visual/fixture.html',
    reuseExistingServer: !runningInCI,
    timeout: 30_000,
  },
});
