import { defineConfig, devices } from '@playwright/test';

// A factory sobe o app numa porta própria e passa a URL em BASE_URL.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on',
    screenshot: 'on',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
