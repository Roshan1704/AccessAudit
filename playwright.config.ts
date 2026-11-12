import { defineConfig } from '@playwright/test';

// The e2e database URL must be supplied through the environment; there is no built-in credential.
const dbUrl = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
if (!dbUrl) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL to run the e2e tests.');

// Uses the locally installed Google Chrome (channel "chrome"), so no browser download is needed.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    channel: 'chrome',
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx apps/api/src/main.ts',
      url: 'http://localhost:4000/healthz',
      stdout: 'pipe',
      stderr: 'pipe',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        DATABASE_URL: dbUrl,
        SESSION_COOKIE_SECRET:
          process.env['SESSION_COOKIE_SECRET'] ?? 'e2e-only-secret-not-for-production-0123456789',
        WEB_ORIGIN: 'http://localhost:3000',
        API_PORT: '4000',
      },
    },
    {
      command: 'npm run dev -w @accessaudit/web -- --host localhost',
      url: 'http://localhost:3000/login',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
