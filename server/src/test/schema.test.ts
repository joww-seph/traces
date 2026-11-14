import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDb, testPool as pool } from './db.js'

const TABLES = ['users', 'session', 'settings', 'officers', 'officer_designations', 'property_types', 'items', 'documents',
  'lines', 'line_pdf_regions', 'properties', 'qr_tokens', 'movements', 'report_signatories', 'audit_logs']
const GONE_TABLES = ['physical_counts', 'count_items', 'count_signatories']
const VIEWS = ['v_active_properties', 'v_item_card', 'v_custody', 'v_registry']
const GONE_VIEWS = ['v_card_movements', 'v_holdings', 'v_count_rows']
const ENUMS = ['user_role', 'doc_type', 'item_category', 'movement_type', 'item_condition', 'card_row_mode', 'signatory_role']
const INDEXES = ['users_email_lower_uq', 'session_expire_idx', 'officers_short_name_uq', 'documents_issued_date_idx',
  'documents_received_by_idx', 'lines_category_idx', 'lines_item_idx', 'properties_property_no_uq', 'properties_line_idx',
  'qr_tokens_one_active_uq', 'movements_property_date_idx', 'movements_officer_idx', 'items_identity_uq',
  'property_types_code_uq', 'audit_logs_entity_idx', 'audit_logs_at_idx']
const COLUMNS: Record<string, string[]> = {
  properties: ['old_property_no', 'serial_no', 'component_label'],
  settings: ['ppe_registry_title', 'ics_form_code', 'ics_form_revision', 'par_form_code', 'par_form_revision'],
  officers: ['can_receive'],
  lines: ['item_id', 'description'],
}
const CONSTRAINTS = ['documents_type_doc_no_uq', 'documents_pdf_all_or_none', 'lines_document_line_no_uq',
  'movements_custody_needs_officer', 'lines_item_category_fk', 'items_id_category_uq']

const names = async (sql: string) => (await pool.query(sql)).rows.map((r) => Object.values(r)[0] as string)

afterAll(() => pool.end())

describe('structure', () => {
  it('has every table and none of the count tables', async () => {
    const got = await names(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
    expect(got).toEqual(expect.arrayContaining(TABLES))
    for (const t of GONE_TABLES) expect(got).not.toContain(t)
  })
  it('has every view and the report function', async () => {
    const got = await names(`SELECT viewname FROM pg_views WHERE schemaname='public'`)
    expect(got).toEqual(expect.arrayContaining(VIEWS))
    for (const v of GONE_VIEWS) expect(got).not.toContain(v)
    expect(await names(`SELECT proname FROM pg_proc WHERE proname='fn_officer_report'`)).toEqual(['fn_officer_report'])
  })
  it('has every enum', async () => {
    const got = await names(`SELECT typname FROM pg_type WHERE typtype='e'`)
    expect(got).toEqual(expect.arrayContaining(ENUMS))
    expect(got).not.toContain('count_status')
  })
  it('has every named index', async () => {
    expect(await names(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).toEqual(expect.arrayContaining(INDEXES))
  })
  it('has the added columns and lines no longer carry article/unit', async () => {
    for (const [table, cols] of Object.entries(COLUMNS)) {
      const got = await names(`SELECT column_name FROM information_schema.columns WHERE table_name='${table}'`)
      expect(got).toEqual(expect.arrayContaining(cols))
    }
    const lineCols = await names(`SELECT column_name FROM information_schema.columns WHERE table_name='lines'`)
    expect(lineCols).not.toContain('article')
    expect(lineCols).not.toContain('unit')
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
async function newItem(category: 'semi' | 'ppe', article = 'Laptop', description = 'Lenovo ThinkPad E14 Gen 5') {
  return (await pool.query(
    `INSERT INTO items (property_type_id, category, article, description, unit) VALUES (1,$1,$2,$3,'unit') RETURNING id`,
    [category, article, description])).rows[0].id as string
}

async function seed() {
  const u = (await pool.query(
    `INSERT INTO users (email, display_name, password_hash, role) VALUES ('a@b.c','A','x','superadmin') RETURNING id`)).rows[0].id
  const o = (await pool.query(
    `INSERT INTO officers (full_name, short_name, position, can_receive) VALUES ('Maria S','MS','Chief', true) RETURNING id`)).rows[0].id
  const item = await newItem('ppe')
  const mkDoc = async (no: string, date: string) => (await pool.query(
    `INSERT INTO documents (type, doc_no, fund_cluster, issued_date, issued_by_officer_id, issued_by_position,
       received_by_officer_id, received_by_position, created_by)
     VALUES ('ICS',$1,'RAF',$2,$3,'Chief',$3,'Chief',$4) RETURNING id`, [no, date, o, u])).rows[0].id as string
  const d = await mkDoc('2026-03-005', '2026-03-01')
  const l = (await pool.query(
    `INSERT INTO lines (document_id, line_no, item_id, qty, unit_cost_centavos, description, category)
     VALUES ($1,1,$2,1,9645000,'Laptop set','ppe') RETURNING id`, [d, item])).rows[0].id as string
  const p = (await pool.query(
    `INSERT INTO properties (property_no, line_id) VALUES ('2026-09ICT-0199',$1) RETURNING id`, [l])).rows[0].id as string
  return { u, o, d, l, p, item, mkDoc }
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
  it('rejects a ppe line on a semi card (23503, lines_item_category_fk)', async () => {
    const { d } = await seed()
    const semi = await newItem('semi', 'Mouse', 'Logitech M170')
    expect(await code(pool.query(
      `INSERT INTO lines (document_id, line_no, item_id, qty, unit_cost_centavos, description, category)
       VALUES ($1,2,$2,1,100,'x','ppe')`, [d, semi]))).toBe('23503')
  })
  it('rejects a second card with the same identity in another letter case (23505)', async () => {
    await newItem('semi')
    expect(await code(newItem('semi', 'LAPTOP', 'LENOVO THINKPAD E14 GEN 5'))).toBe('23505')
  })
  it('allows the same model on a different category card', async () => {
    await newItem('semi')
    expect(await code(newItem('ppe'))).toBeNull()
  })
  it('rejects a property type code that is not 2-8 capital letters (23514)', async () => {
    expect(await code(pool.query(`INSERT INTO property_types (code, name) VALUES ('ict1','x')`))).toBe('23514')
  })
})

describe('views', () => {
  beforeEach(resetDb)

  it('v_registry counts main units only', async () => {
    const { o, d, l, p } = await seed()
    const comp = (await pool.query(
      `INSERT INTO properties (property_no, line_id, component_label) VALUES ('2026-09ICT-0199a',$1,'Mouse') RETURNING id`, [l])).rows[0].id
    for (const id of [p, comp]) {
      await pool.query(`INSERT INTO movements (property_id, type, date) VALUES ($1,'RECEIPT','2026-02-01')`, [id])
      await pool.query(`INSERT INTO movements (property_id, type, date, officer_id, reference_document_id)
                        VALUES ($1,'ISSUE','2026-03-01',$2,$3)`, [id, o, d])
    }
    const reg = (await pool.query(`SELECT issued_qty, amount_centavos, property_nos, property_type_code FROM v_registry`)).rows[0]
    expect(Number(reg.issued_qty)).toBe(1)
    expect(Number(reg.amount_centavos)).toBe(9645000)
    expect(reg.property_nos).toBe('2026-09ICT-0199\n2026-09ICT-0199a')
    expect(reg.property_type_code).toBe('ICT')
  })

  it('v_item_card: 2 + 1 ThinkPads on two ICS give 4 rows, balances 2,3,1,0 and amount 0', async () => {
    const { o, item, mkDoc } = await seed()
    const semi = await newItem('semi', 'Phone', 'Test Phone')
    const addLine = async (docNo: string, date: string, acquired: string, qty: number, base: number, lineNo: number) => {
      const d = await mkDoc(docNo, date)
      const l = (await pool.query(
        `INSERT INTO lines (document_id, line_no, item_id, qty, unit_cost_centavos, description, category)
         VALUES ($1,$2,$3,$4,3709200,'x','semi') RETURNING id`, [d, lineNo, semi, qty])).rows[0].id
      for (let i = 0; i < qty; i++) {
        const pid = (await pool.query(`INSERT INTO properties (property_no, line_id) VALUES ($1,$2) RETURNING id`,
          [`2026-0${base + i}ICT-${String(base * 10 + i).padStart(4, '0')}`, l])).rows[0].id
        await pool.query(`INSERT INTO movements (property_id, type, date) VALUES ($1,'RECEIPT',$2)`, [pid, acquired])
        await pool.query(`INSERT INTO movements (property_id, type, date, officer_id, reference_document_id)
                          VALUES ($1,'ISSUE',$2,$3,$4)`, [pid, date, o, d])
      }
    }
    await addLine('2026-10-001', '2026-10-05', '2026-10-01', 2, 1, 1)
    await addLine('2026-10-002', '2026-10-20', '2026-10-10', 1, 4, 1)
    const rows = (await pool.query(
      `SELECT type, qty, balance_qty, balance_amount_centavos FROM v_item_card WHERE item_id = $1 ORDER BY date, first_movement_id`, [semi])).rows
    expect(rows.map((r) => r.type)).toEqual(['RECEIPT', 'ISSUE', 'RECEIPT', 'ISSUE'])
    expect(rows.map((r) => Number(r.balance_qty))).toEqual([2, 0, 1, 0])
    expect(Number(rows.at(-1).balance_amount_centavos)).toBe(0)
    expect(item).toBeTruthy()
  })

  it('v_item_card: a set is one row listing every item number, qty counts the main unit only', async () => {
    const { o, d, l, p, item } = await seed()
    const comp = (await pool.query(
      `INSERT INTO properties (property_no, line_id, component_label) VALUES ('2026-09ICT-0199a',$1,'Mouse') RETURNING id`, [l])).rows[0].id
    for (const id of [p, comp]) {
      await pool.query(`INSERT INTO movements (property_id, type, date) VALUES ($1,'RECEIPT','2026-02-01')`, [id])
      await pool.query(`INSERT INTO movements (property_id, type, date, officer_id, reference_document_id)
                        VALUES ($1,'ISSUE','2026-03-01',$2,$3)`, [id, o, d])
    }
    const rows = (await pool.query(`SELECT type, qty, item_nos FROM v_item_card WHERE item_id=$1 ORDER BY date`, [item])).rows
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.qty)).toEqual([1, 1])
    expect(rows[0].item_nos).toBe('2026-09ICT-0199\n2026-09ICT-0199a')
  })

  it('fn_officer_report leaves out an ICS dated after the as-at date', async () => {
    const { o, d, p } = await seed()
    await pool.query(`INSERT INTO movements (property_id, type, date) VALUES ($1,'RECEIPT','2026-03-01')`, [p])
    await pool.query(`INSERT INTO movements (property_id, type, date, officer_id, reference_document_id)
                      VALUES ($1,'ISSUE','2026-10-20',$2,$3)`, [p, o, d])
    const at = async (date: string) => (await pool.query(`SELECT * FROM fn_officer_report($1::date)`, [date])).rows
    expect(await at('2026-10-10')).toHaveLength(0)
    const rows = await at('2026-10-20')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ officer_id: o, balance_per_card: 1, article: 'Laptop' })
  })
})
