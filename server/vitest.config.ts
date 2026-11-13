import 'dotenv/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./src/test/globalSetup.ts'],
    fileParallelism: false, // all tests share one database
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      APP_ORIGIN: 'http://localhost:5173',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-0000',
      LOGIN_RATE_LIMIT: '1000', // the one 429 test builds its own app with 10
      STORAGE_DIR: './storage-test',
    },
  },
})
