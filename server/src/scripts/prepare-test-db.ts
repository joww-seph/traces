import 'dotenv/config'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

// Rebuilds the traces_test schema from the migrations (used by the browser tests; vitest has its own copy of this).
const url = process.env.DATABASE_URL
if (!url || !/traces_test/.test(url)) { console.error('Refusing to run: DATABASE_URL must point at traces_test'); process.exit(1) }
const pool = new pg.Pool({ connectionString: url })
await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;')
await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
await pool.end()
console.log('traces_test rebuilt')
