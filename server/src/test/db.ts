import pg from 'pg'
import { clearSettingsCache } from '../services/settings.js'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL is not set')
export const testPool = new pg.Pool({ connectionString: url })

const TABLES = [
  'audit_logs', 'movements', 'qr_tokens', 'properties', 'line_pdf_regions', 'lines', 'documents', 'items',
  'property_types', 'officer_designations', 'report_signatories', 'officers', 'settings', 'session', 'users',
]

export async function seedSettings() {
  await testPool.query(
    `INSERT INTO settings (entity_name, default_fund_cluster, ppe_threshold_centavos, public_base_url)
     VALUES ('DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1', 'RAF', 5000000, 'http://localhost:5173')`,
  )
}

// the three types the migration seeds: ids 1, 2, 3
export async function seedPropertyTypes() {
  await testPool.query(
    `INSERT INTO property_types (code, name) VALUES
       ('ICT', 'Information and Communications Technology Equipment'), ('FF', 'Furniture and Fixtures'), ('OE', 'Office Equipment')`,
  )
}

// fixed ids, mirrored by DEFAULT_ITEM in helpers.ts
export async function seedDefaultItems() {
  await testPool.query(
    `INSERT INTO items (id, property_type_id, category, article, description, unit) VALUES
       ('00000000-0000-4000-8000-0000000000a1', 1, 'semi', 'Article', 'Default model', 'unit'),
       ('00000000-0000-4000-8000-0000000000a2', 1, 'ppe', 'Article', 'Default model', 'unit')`,
  )
}

export async function resetDb() {
  await testPool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`)
  await seedSettings()
  await seedPropertyTypes()
  await seedDefaultItems()
  clearSettingsCache()
}
