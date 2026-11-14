import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { createIssuance } from '../services/issuances.js'
import { testPool, resetDb } from './db.js'
import { agentFor, itemFor, loginAs } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
const PDF_DIR = path.join(STORAGE, 'pdfs')
const files = () => (existsSync(PDF_DIR) ? readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf')) : [])
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

type Agent = Awaited<ReturnType<typeof loginAs>>['agent']

async function setup() {
  const { agent, user } = await loginAs('supply_admin')
  const mk = async (shortName: string, canReceive: boolean) =>
    (await agent.post('/api/officers').send({ fullName: `${shortName} Full`, shortName, position: `${shortName} Position`, canReceive })).body
  return { agent, user, issuer: await mk('JDelaCruz', false), receiver: await mk('MSantos', true), staff: await mk('Staffer', false) }
}

const row = (n: number, cost = 4870000, over: object = {}) => ({
  line: { qty: 1, unitCostCentavos: cost, description: `Item ${n}`, dateAcquired: '2026-02-20', estUsefulLifeYears: 5, ...over },
  item: itemFor(cost), properties: [{ propertyNo: `2026-02ICT-${String(n).padStart(4, '0')}` }],
})
const header = (s: Awaited<ReturnType<typeof setup>>, over: object = {}) => ({
  receivedByOfficerId: s.receiver.id, issuedByOfficerId: s.issuer.id, issuedDate: '2026-03-01', fundCluster: 'RAF',
  purpose: 'Project use', icsNo: '2026-09TEST-003', parNo: '2026-RO-68', ...over,
})
const post = (agent: Agent, body: object) => agent.post('/api/issuances').send(body)
const count = async (table: string, where = '') => Number((await testPool.query(`SELECT count(*) FROM ${table} ${where}`)).rows[0].count)

describe('POST /api/issuances (update 02 W3)', () => {
  it('6 rows under the threshold + 1 above: one ICS and one PAR in one save, in form order, registry/card/report right away', async () => {
    const s = await setup()
    const rows = [...[1, 2, 3, 4, 5, 6].map((n) => row(n)), row(7, 9645000)]
    const res = await post(s.agent, { header: header(s), rows, generate: false })
    expect(res.status).toBe(201)
    expect(res.body.warnings ?? []).toEqual([])
    const docs = res.body.documents as { id: string; type: string; docNo: string; lineIds: string[] }[]
    expect(docs.map((d) => [d.type, d.docNo, d.lineIds.length])).toEqual([['ICS', '2026-09TEST-003', 6], ['PAR', '2026-RO-68', 1]])

    const lineNos = (type: string) => testPool.query(
      `SELECT l.line_no, l.description FROM lines l JOIN documents d ON d.id=l.document_id WHERE d.type=$1 ORDER BY l.line_no`, [type]).then((r) => r.rows)
    expect((await lineNos('ICS')).map((r) => r.line_no)).toEqual([1, 2, 3, 4, 5, 6])
    expect((await lineNos('ICS')).map((r) => r.description)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Item ${n}`))
    expect((await lineNos('PAR')).map((r) => r.line_no)).toEqual([1])

    // both documents share the receiver, date, fund cluster and purpose
    const d = (await testPool.query(`SELECT DISTINCT received_by_officer_id, issued_date::text, fund_cluster, purpose FROM documents`)).rows
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ issued_date: '2026-03-01', fund_cluster: 'RAF', purpose: 'Project use' })

    // registry has 7 rows; every property has its RECEIPT (date acquired) and ISSUE (date issued)
    expect(await count('v_registry')).toBe(7)
    const mv = (await testPool.query(`SELECT type, date::text, count(*) FROM movements GROUP BY type, date ORDER BY type`)).rows
    expect(mv).toEqual([{ type: 'RECEIPT', date: '2026-02-20', count: '7' }, { type: 'ISSUE', date: '2026-03-01', count: '7' }]) // enum order
    expect(await count('qr_tokens')).toBe(7)
    expect((await testPool.query(`SELECT action FROM audit_logs WHERE action='issuance.create'`)).rowCount).toBe(1)
    expect(await count('audit_logs', `WHERE action='line.create'`)).toBe(7)
    // the report of the receiver lists them straight away
    const rep = await s.agent.get(`/api/reports/rpc?officerId=${s.receiver.id}&category=semi&asAt=2026-12-31`)
    expect(rep.body.rows).toHaveLength(6)
  })

  it('only semi rows -> only an ICS; the PAR number is not needed', async () => {
    const s = await setup()
    const res = await post(s.agent, { header: header(s, { parNo: undefined }), rows: [row(1), row(2)], generate: false })
    expect(res.status).toBe(201)
    expect(res.body.documents.map((d: { type: string }) => d.type)).toEqual(['ICS'])
    expect(await count('documents')).toBe(1)
  })

  it('a missing number for a type that has rows -> 400 DOC_NO_REQUIRED naming it, nothing written', async () => {
    const s = await setup()
    const res = await post(s.agent, { header: header(s, { parNo: undefined }), rows: [row(1), row(2, 9645000)], generate: false })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ code: 'DOC_NO_REQUIRED', details: { type: 'PAR' } })
    expect(await count('documents')).toBe(0)
    expect(await count('lines')).toBe(0)
    expect(await count('items', `WHERE description <> 'Default model'`)).toBe(0)
  })

  it('a duplicate property number in rows 2 and 6 -> 409 flagging every one, zero documents written', async () => {
    const s = await setup()
    await post(s.agent, { header: header(s, { icsNo: 'FIRST', parNo: 'FIRST-P' }), rows: [row(50)], generate: false })
    const before = { d: await count('documents'), l: await count('lines'), p: await count('properties') }
    const rows = [row(1), row(2), row(3), row(4), row(5), row(6), row(7, 9645000)]
    rows[5].properties = rows[1].properties // row index 5 repeats row index 1
    rows[3].properties = [{ propertyNo: '2026-02ICT-0050' }] // row index 3 already exists in the database
    const res = await post(s.agent, { header: header(s), rows, generate: true })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DUPLICATE_PROPERTY_NO')
    expect(res.body.error.details.duplicates.map((x: { rowIndex: number }) => x.rowIndex).sort()).toEqual([1, 3, 5])
    expect({ d: await count('documents'), l: await count('lines'), p: await count('properties') }).toEqual(before)
    expect(files()).toHaveLength(0)
  })

  it('a duplicate ICS number -> 409 DUPLICATE_DOCUMENT_NO and nothing else is written', async () => {
    const s = await setup()
    await post(s.agent, { header: header(s), rows: [row(1)], generate: false })
    const res = await post(s.agent, { header: header(s, { parNo: 'OTHER-P' }), rows: [row(2), row(3, 9645000)], generate: false })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DUPLICATE_DOCUMENT_NO')
    expect(await count('documents')).toBe(1)
    expect(await count('lines')).toBe(1)
  })

  it('generate: true -> one generated PDF per document, with a box for every line', async () => {
    const s = await setup()
    const res = await post(s.agent, { header: header(s), rows: [row(1), row(2), row(3, 9645000)], generate: true })
    expect(res.status).toBe(201)
    expect(res.body.warnings ?? []).toEqual([])
    expect(files()).toHaveLength(2)
    expect(await count('document_files', `WHERE kind='generated'`)).toBe(2)
    expect(await count('line_pdf_regions', `WHERE kind='generated'`)).toBe(3)
    expect(await count('document_files', `WHERE kind='uploaded'`)).toBe(0)
  })

  it('a generation failure keeps the data and reports GENERATION_FAILED; /generate retries it', async () => {
    const s = await setup()
    const out = await createIssuance(
      { header: header(s), rows: [row(1)], generate: true },
      { actorId: s.user.id, ip: null },
      async () => { throw new Error('render exploded') },
    )
    expect(out.warnings).toEqual(['GENERATION_FAILED'])
    expect(out.documents).toHaveLength(1)
    expect(await count('lines')).toBe(1)
    expect(await count('document_files')).toBe(0)
    expect((await s.agent.post(`/api/documents/${out.documents[0].id}/generate`)).status).toBe(200)
  })

  it('an officer who may not receive -> 400 OFFICER_CANNOT_RECEIVE, nothing written', async () => {
    const s = await setup()
    const res = await post(s.agent, { header: header(s, { receivedByOfficerId: s.staff.id }), rows: [row(1)], generate: false })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('OFFICER_CANNOT_RECEIVE')
    expect(await count('documents')).toBe(0)
  })

  it('positions as printed are kept; omitted ones come from the officers', async () => {
    const s = await setup()
    await post(s.agent, { header: header(s, { receivedByPosition: 'Acting Chief' }), rows: [row(1)], generate: false })
    const d = (await testPool.query(`SELECT received_by_position, issued_by_position FROM documents`)).rows[0]
    expect(d).toEqual({ received_by_position: 'Acting Chief', issued_by_position: 'JDelaCruz Position' })
  })

  it('a card is created once for new identical rows; a wrong card category rolls everything back', async () => {
    const s = await setup()
    const nc = { new: { propertyTypeId: 1, article: 'Laptop', description: 'Lenovo ThinkPad E14', unit: 'unit' } }
    const ok = await post(s.agent, { header: header(s), rows: [{ ...row(1), item: nc }, { ...row(2), item: nc }], generate: false })
    expect(ok.status).toBe(201)
    expect(await count('items', `WHERE description='Lenovo ThinkPad E14'`)).toBe(1)
    const bad = await post(s.agent, { header: header(s, { icsNo: 'B', parNo: 'B-P' }), rows: [row(3), { ...row(4, 9645000), item: itemFor(100) }], generate: false })
    expect(bad.status).toBe(409)
    expect(bad.body.error).toMatchObject({ code: 'CATEGORY_MISMATCH', details: { rowIndex: 1 } })
    expect(await count('documents')).toBe(1)
  })

  it('validation: empty rows, unknown keys, anonymous', async () => {
    const s = await setup()
    expect((await post(s.agent, { header: header(s), rows: [], generate: false })).status).toBe(400)
    expect((await post(s.agent, { header: header(s), rows: [row(1)], generate: false, extra: 1 })).status).toBe(400)
    expect((await post(s.agent, { header: header(s), rows: [row(1)] })).status).toBe(400) // generate is required: no silent default
    expect((await agentFor().post('/api/issuances').send({})).status).toBe(401)
  })
})
