import 'dotenv/config'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

// Rebuild traces_test from the migrations once per run.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set')
  const pool = new pg.Pool({ connectionString: url })
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;')
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  await pool.end()
}
