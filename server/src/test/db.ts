import pg from 'pg'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL is not set')
export const testPool = new pg.Pool({ connectionString: url })

const TABLES = [
  'audit_logs', 'count_items', 'count_signatories', 'physical_counts', 'movements', 'qr_tokens',
  'properties', 'line_pdf_regions', 'lines', 'documents', 'officers', 'settings', 'session', 'users',
]

export async function seedSettings() {
  await testPool.query(
    `INSERT INTO settings (entity_name, default_fund_cluster, ppe_threshold_centavos, public_base_url)
     VALUES ('DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1', 'RAF', 5000000, 'http://localhost:5173')`,
  )
}

export async function resetDb() {
  await testPool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`)
  await seedSettings()
}
