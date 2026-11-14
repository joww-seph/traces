import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDb, testPool as pool } from './db.js'

const TABLES = ['users', 'session', 'settings', 'officers', 'documents', 'lines', 'line_pdf_regions',
  'properties', 'qr_tokens', 'movements', 'physical_counts', 'count_signatories', 'count_items', 'audit_logs']
const VIEWS = ['v_active_properties', 'v_card_movements', 'v_custody', 'v_holdings', 'v_registry', 'v_count_rows']
const ENUMS = ['user_role', 'doc_type', 'item_category', 'movement_type', 'item_condition', 'count_status',
  'card_row_mode', 'signatory_role']
const INDEXES = ['users_email_lower_uq', 'session_expire_idx', 'officers_short_name_uq', 'documents_issued_date_idx',
  'documents_received_by_idx', 'lines_category_idx', 'properties_property_no_uq', 'properties_line_idx',
  'qr_tokens_one_active_uq', 'movements_property_date_idx', 'movements_officer_idx', 'count_items_property_idx',
  'audit_logs_entity_idx', 'audit_logs_at_idx']
const COLUMNS: Record<string, string[]> = {
  properties: ['old_property_no', 'serial_no', 'component_label'],
  settings: ['ppe_registry_title', 'ics_form_code', 'ics_form_revision', 'par_form_code', 'par_form_revision'],
}
const CONSTRAINTS = ['documents_type_doc_no_uq', 'documents_pdf_all_or_none', 'lines_document_line_no_uq',
  'movements_custody_needs_officer', 'physical_counts_unique_session']

const names = async (sql: string) => (await pool.query(sql)).rows.map((r) => Object.values(r)[0] as string)

afterAll(() => pool.end())

describe('structure', () => {
  it('has every table', async () => {
    const got = await names(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
    expect(got).toEqual(expect.arrayContaining(TABLES))
  })
  it('has every view', async () => {
    expect(await names(`SELECT viewname FROM pg_views WHERE schemaname='public'`)).toEqual(expect.arrayContaining(VIEWS))
  })
  it('has every enum', async () => {
    expect(await names(`SELECT typname FROM pg_type WHERE typtype='e'`)).toEqual(expect.arrayContaining(ENUMS))
  })
  it('has every named index', async () => {
    expect(await names(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).toEqual(expect.arrayContaining(INDEXES))
  })
  it('has the added columns (old property no., form codes)', async () => {
    for (const [table, cols] of Object.entries(COLUMNS)) {
      const got = await names(`SELECT column_name FROM information_schema.columns WHERE table_name='${table}'`)
      expect(got).toEqual(expect.arrayContaining(cols))
    }
  })
  it('new settings default to the PPE registry title and the ICS/PAR form codes', async () => {
    await resetDb()
    const s = (await pool.query('SELECT * FROM settings')).rows[0]
    expect(s).toMatchObject({
      ppe_registry_title: 'REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED',
      ics_form_code: 'FM-FAS-SUPPLY-07-10', par_form_code: 'FM-FAS-SUPPLY-07-09', ics_form_revision: 'Rev. 1/07-25-22',
    })
  })
  it('has every named constraint', async () => {
    expect(await names(`SELECT conname FROM pg_constraint`)).toEqual(expect.arrayContaining(CONSTRAINTS))
  })
})

// Minimal valid rows
async function seed() {
  const u = (await pool.query(
    `INSERT INTO users (email, display_name, password_hash, role) VALUES ('a@b.c','A','x','superadmin') RETURNING id`)).rows[0].id
  const o = (await pool.query(
    `INSERT INTO officers (full_name, short_name, position) VALUES ('Maria S','MS','Chief') RETURNING id`)).rows[0].id
  const d = (await pool.query(
    `INSERT INTO documents (type, doc_no, fund_cluster, issued_date, issued_by_officer_id, issued_by_position,
       received_by_officer_id, received_by_position, created_by)
     VALUES ('ICS','2026-03-005','RAF','2026-03-01',$1,'Chief',$1,'Chief',$2) RETURNING id`, [o, u])).rows[0].id
  const l = (await pool.query(
    `INSERT INTO lines (document_id, line_no, qty, unit, unit_cost_centavos, article, description, category)
     VALUES ($1,1,1,'unit',9645000,'Laptop','Laptop set','ppe') RETURNING id`, [d])).rows[0].id
  const p = (await pool.query(
    `INSERT INTO properties (property_no, line_id) VALUES ('2026-09ICT-0199',$1) RETURNING id`, [l])).rows[0].id
  return { u, o, d, l, p }
}

const code = async (q: Promise<unknown>) => {
  try { await q; return null } catch (e) { return (e as { code: string }).code }
}

describe('constraints', () => {
  beforeEach(resetDb)

  it('rejects duplicate property_no regardless of case (23505)', async () => {
    const { l } = await seed()
    expect(await code(pool.query(`INSERT INTO properties (property_no, line_id) VALUES ('2026-09ict-0199',$1)`, [l]))).toBe('23505')
  })
  it('rejects a second active qr token (23505)', async () => {
    const { p } = await seed()
    await pool.query(`INSERT INTO qr_tokens (token, property_id) VALUES ('AAAAAAAAAA',$1)`, [p])
    expect(await code(pool.query(`INSERT INTO qr_tokens (token, property_id) VALUES ('BBBBBBBBBB',$1)`, [p]))).toBe('23505')
  })
  it('allows a new token after revoking the old one', async () => {
    const { p } = await seed()
    await pool.query(`INSERT INTO qr_tokens (token, property_id, revoked_at) VALUES ('AAAAAAAAAA',$1, now())`, [p])
    expect(await code(pool.query(`INSERT INTO qr_tokens (token, property_id) VALUES ('BBBBBBBBBB',$1)`, [p]))).toBeNull()
  })
  it('rejects an ISSUE movement without an officer (23514)', async () => {
    const { p } = await seed()
    expect(await code(pool.query(`INSERT INTO movements (property_id, type, date) VALUES ($1,'ISSUE','2026-03-01')`, [p]))).toBe('23514')
  })
  it('rejects partial PDF columns (23514)', async () => {
    const { d } = await seed()
    expect(await code(pool.query(`UPDATE documents SET pdf_stored_name='x.pdf' WHERE id=$1`, [d]))).toBe('23514')
  })
  it('rejects a property_no with invalid characters (23514)', async () => {
    const { l } = await seed()
    expect(await code(pool.query(`INSERT INTO properties (property_no, line_id) VALUES ('bad no/1',$1)`, [l]))).toBe('23514')
  })
  it('rejects a second settings row (23514)', async () => {
    expect(await code(pool.query(
      `INSERT INTO settings (id, entity_name, default_fund_cluster, ppe_threshold_centavos, public_base_url)
       VALUES (2,'x','x',1,'x')`))).toBe('23514')
  })
})

describe('views', () => {
  beforeEach(resetDb)

  it('v_registry counts main units only and v_card_movements runs the balance', async () => {
    const { o, d, l, p } = await seed()
    const comp = (await pool.query(
      `INSERT INTO properties (property_no, line_id, component_label) VALUES ('2026-09ICT-0199a',$1,'Mouse') RETURNING id`, [l])).rows[0].id
    for (const id of [p, comp]) {
      await pool.query(`INSERT INTO movements (property_id, type, date) VALUES ($1,'RECEIPT','2026-02-01')`, [id])
      await pool.query(`INSERT INTO movements (property_id, type, date, officer_id, reference_document_id)
                        VALUES ($1,'ISSUE','2026-03-01',$2,$3)`, [id, o, d])
    }
    const reg = (await pool.query(`SELECT issued_qty, amount_centavos, property_nos FROM v_registry`)).rows[0]
    expect(Number(reg.issued_qty)).toBe(1)
    expect(Number(reg.amount_centavos)).toBe(9645000)
    expect(reg.property_nos).toBe('2026-09ICT-0199\n2026-09ICT-0199a')

    await pool.query(`INSERT INTO movements (property_id, type, date) VALUES ($1,'DISPOSE','2026-06-01')`, [p])
    const bal = (await pool.query(`SELECT type, balance_qty FROM v_card_movements WHERE property_id=$1 ORDER BY date, movement_id`, [p])).rows
    expect(bal.map((r) => Number(r.balance_qty))).toEqual([1, 1, 0])
  })
})
