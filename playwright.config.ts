import { defineConfig } from '@playwright/test'

// Browser tests run the real API and the real client on their own ports against the traces_test database,
// so they never touch development data (traces_dev) or the dev servers (3000 / 5173).
export const E2E = {
  apiPort: 3100,
  webPort: 5273,
  db: process.env.TEST_DATABASE_URL ?? 'postgres://traces:traces@127.0.0.1:5432/traces_test',
  superadmin: { email: 'e2e-super@traces.test', password: 'E2e-Super-Pass-1' },
  supply: { email: 'e2e-supply@traces.test', password: 'E2e-Supply-Pass-1' },
}
const origin = `http://localhost:${E2E.webPort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one shared database
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: origin, channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'npm -w server exec tsx src/index.ts',
      url: `http://localhost:${E2E.apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(E2E.apiPort), NODE_ENV: 'development', DATABASE_URL: E2E.db, APP_ORIGIN: origin,
        SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000', STORAGE_DIR: './storage-e2e', LOGIN_RATE_LIMIT: '1000',
      },
    },
    {
      command: 'npm -w client exec vite',
      url: origin,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { CLIENT_PORT: String(E2E.webPort), API_TARGET: `http://localhost:${E2E.apiPort}` },
    },
  ],
})
