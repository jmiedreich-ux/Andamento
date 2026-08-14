import path from 'node:path';
import { defineConfig } from '@playwright/test';

const host = '127.0.0.1';
const port = 47841;
const baseURL = `http://${host}:${port}`;
const databasePath = path.resolve('var', 'e2e-planning-loop.db');

export default defineConfig({
  testDir: './app/test/e2e',
  testMatch: '**/*.spec.mjs',
  outputDir: 'artifacts/playwright',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  reporter: [['line']],
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'msedge',
    viewport: { width: 1440, height: 960 },
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node app/test/e2e/test-server.mjs',
    url: `${baseURL}/api/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      ANDAMENTO_HOST: host,
      ANDAMENTO_PORT: String(port),
      ANDAMENTO_TEST_MODE: '1',
      ANDAMENTO_CODEX_URL: 'ws://127.0.0.1:1',
      ANDAMENTO_E2E_DATABASE_PATH: databasePath,
      ANDAMENTO_E2E_RESET: '1',
      ANDAMENTO_E2E_REPOSITORY_ROOT: process.cwd(),
    },
  },
});
