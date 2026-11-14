import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { pool } from '../db/client.js'
import { seedOfficers } from '../services/officerSeed.js'

// npm run seed:officers -- <officers.csv>   (see services/officerSeed.ts for the columns)
const file = process.argv[2]
if (!file) {
  console.error('Usage: npm run seed:officers -- <officers.csv>')
  process.exit(1)
}
try {
  const { count, notes } = await seedOfficers(readFileSync(file, 'utf8'))
  console.log(`${count} officers seeded.`)
  for (const n of notes) console.log(`  check ${n.shortName}: ${n.note}`)
} finally {
  await pool.end()
}
