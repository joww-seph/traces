import 'dotenv/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./src/test/globalSetup.ts'],
    fileParallelism: false, // all tests share one database
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? '' },
  },
})
