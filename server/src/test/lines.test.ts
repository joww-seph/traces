import { rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { withTokenRetry } from '../services/lines.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const count = async (table: string, where = '') =>
  Number((await testPool.query(`SELECT count(*) FROM ${table} ${where}`)).rows[0].count)
const counts = async () => ({
  lines: await count('lines'), regions: await count('line_pdf_regions'), properties: await count('properties'),
  tokens: await count('qr_tokens'), movements: await count('movements'), audit: await count('audit_logs'),
})

const laptop = (over: object = {}) => ({
  line: { qty: 1, unit: 'set', unitCostCentavos: 9645000, article: 'Laptop', description: 'Laptop set', estUsefulLifeYears: 5, ...over },
  region: { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.05 },
  properties: [
    { propertyNo: '2026-09ICT-0199' },
    { propertyNo: '2026-09ICT-0199a', componentLabel: 'Mouse' },
    { propertyNo: '2026-09ICT-0199b', componentLabel: 'Headset' },
  ],
})

async function setup(docOver: Parameters<typeof makeDocument>[1] = {}) {
  const { agent } = await loginAs('supply_admin')
  const { doc, receiver } = await makeDocument(agent, docOver)
  return { agent, doc, receiver, post: (body: object, id = doc.id) => agent.post(`/api/documents/${id}/lines`).send(body) }
}

describe('create line (BR-04)', () => {
  it('1 main + 2 components -> 1 line, 1 region, 3 properties, 3 tokens, 6 movements, 1 audit row; registry issued 1', async () => {
    const { post, receiver } = await setup()
    const before = await counts()
    const res = await post(laptop())
    expect(res.status).toBe(201)
    expect(res.body.category).toBe('ppe')
    const after = await counts()
    expect(after.lines - before.lines).toBe(1)
    expect(after.regions - before.regions).toBe(1)
    expect(after.properties - before.properties).toBe(3)
    expect(after.tokens - before.tokens).toBe(3)
    expect(after.movements - before.movements).toBe(6)
    expect(await count('audit_logs', `WHERE action='line.create'`)).toBe(1)

    const reg = (await testPool.query('SELECT * FROM v_registry')).rows
    expect(reg).toHaveLength(1)
    expect(Number(reg[0].issued_qty)).toBe(1)
    expect(Number(reg[0].amount_centavos)).toBe(9645000)
    expect(reg[0].property_nos).toBe('2026-09ICT-0199\n2026-09ICT-0199a\n2026-09ICT-0199b')

    // receipt on the document date, issue to the receiving officer
    const mv = (await testPool.query(`SELECT type, date::text, officer_id FROM movements ORDER BY id LIMIT 2`)).rows
    expect(mv.map((m) => m.type)).toEqual(['RECEIPT', 'ISSUE'])
    expect(mv[0].date).toBe('2026-03-01')
    expect(mv[1].officer_id).toBe(receiver.id)
  })

  it('receipt movement uses iar_date and iar_no when given', async () => {
    const { post } = await setup()
    await post(laptop({ iarNo: 'IAR-77', iarDate: '2026-02-10' }))
    const r = (await testPool.query(`SELECT date::text, reference_text, reference_document_id FROM movements WHERE type='RECEIPT' LIMIT 1`)).rows[0]
    expect(r).toEqual({ date: '2026-02-10', reference_text: 'IAR-77', reference_document_id: null })
  })

  it('line_no defaults to max+1 per document', async () => {
    const { post, agent, doc } = await setup()
    await post({ line: laptop().line, properties: [{ propertyNo: 'A-1' }] })
    await post({ line: laptop().line, properties: [{ propertyNo: 'A-2' }] })
    const got = await agent.get(`/api/documents/${doc.id}`)
    expect(got.body.lines.map((l: { lineNo: number }) => l.lineNo)).toEqual([1, 2])
    expect(got.body.lines[0].properties).toHaveLength(1)
  })

  it('category by cost: 96,450 -> ppe with a warning on an ICS; 48,700 -> semi, no warning', async () => {
    const { post } = await setup()
    const big = await post(laptop())
    expect(big.body.category).toBe('ppe')
    expect(big.body.warning.code).toBe('CATEGORY_MISMATCH')
    const small = await post({ line: laptop({ unitCostCentavos: 4870000 }).line, properties: [{ propertyNo: 'S-1' }] })
    expect(small.body.category).toBe('semi')
    expect(small.body.warning).toBeUndefined()
  })

  it('a PAR line below the threshold warns too', async () => {
    const { post } = await setup({ type: 'PAR', docNo: '2025-RO-68' })
    const res = await post({ line: laptop({ unitCostCentavos: 100000 }).line, properties: [{ propertyNo: 'P-1' }] })
    expect(res.body.category).toBe('semi')
    expect(res.body.warning.code).toBe('CATEGORY_MISMATCH')
  })

  it('duplicate property number in another letter case -> 409 naming it, and nothing is written (rollback)', async () => {
    const { post } = await setup()
    await post(laptop())
    const before = await counts()
    const res = await post({ line: laptop().line, properties: [{ propertyNo: 'NEW-1' }, { propertyNo: '2026-09ict-0199' }] })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DUPLICATE_PROPERTY_NO')
    expect(res.body.error.details.propertyNo).toBe('2026-09ict-0199')
    expect(await counts()).toEqual(before)
  })

  it('unknown document -> 404; soft-deleted document -> 404; malformed id -> 400', async () => {
    const { post, agent, doc } = await setup()
    expect((await post(laptop(), '00000000-0000-4000-8000-000000000000')).status).toBe(404)
    await agent.delete(`/api/documents/${doc.id}`)
    expect((await post(laptop())).status).toBe(404)
    expect((await post(laptop(), 'nope')).status).toBe(400)
  })

  it('invalid body -> 400 (qty 0, no properties, region off the page); anonymous -> 401', async () => {
    const { post, doc } = await setup()
    expect((await post(laptop({ qty: 0 }))).status).toBe(400)
    expect((await post({ ...laptop(), properties: [] })).status).toBe(400)
    expect((await post({ ...laptop(), region: { page: 1, x: 0.9, y: 0, w: 0.5, h: 0.1 } })).status).toBe(400)
    expect((await agentFor().post(`/api/documents/${doc.id}/lines`).send(laptop())).status).toBe(401)
  })
})

describe('update line (BR-05)', () => {
  it('PATCH adds a property: +1 property, +1 token, +2 movements', async () => {
    const { post, agent } = await setup()
    const { lineId } = (await post(laptop())).body
    const before = await counts()
    const res = await agent.patch(`/api/lines/${lineId}`).send({ addProperties: [{ propertyNo: '2026-09ICT-0199c', componentLabel: 'Bag' }] })
    expect(res.status).toBe(200)
    const after = await counts()
    expect(after.properties - before.properties).toBe(1)
    expect(after.tokens - before.tokens).toBe(1)
    expect(after.movements - before.movements).toBe(2)
    expect(await count('audit_logs', `WHERE action='line.update'`)).toBe(1)
  })

  it('PATCH removes a property: voided, token revoked, registry no longer lists it, number stays reserved', async () => {
    const { post, agent } = await setup()
    const { lineId } = (await post(laptop())).body
    const res = await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['2026-09ict-0199b'] })
    expect(res.status).toBe(200)
    const p = (await testPool.query(`SELECT voided_at FROM properties WHERE property_no='2026-09ICT-0199b'`)).rows[0]
    expect(p.voided_at).not.toBeNull()
    expect(await count('qr_tokens', `WHERE revoked_at IS NOT NULL`)).toBe(1)
    expect((await testPool.query('SELECT property_nos FROM v_registry')).rows[0].property_nos).toBe('2026-09ICT-0199\n2026-09ICT-0199a')
    const again = await post({ line: laptop().line, properties: [{ propertyNo: '2026-09ICT-0199b' }] })
    expect(again.status).toBe(409)
    expect((await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['NOPE-1'] })).status).toBe(404)
  })

  it('cost change across the threshold keeps the category and returns a warning', async () => {
    const { post, agent } = await setup()
    const { lineId } = (await post({ line: laptop({ unitCostCentavos: 4870000 }).line, properties: [{ propertyNo: 'S-1' }] })).body
    const same = await agent.patch(`/api/lines/${lineId}`).send({ line: { unitCostCentavos: 4900000 } })
    expect(same.body.warning).toBeUndefined()
    const res = await agent.patch(`/api/lines/${lineId}`).send({ line: { unitCostCentavos: 6000000 } })
    expect(res.status).toBe(200)
    expect(res.body.category).toBe('semi')
    expect(res.body.warning.code).toBe('CATEGORY_UNCHANGED')
    expect((await testPool.query('SELECT category, unit_cost_centavos FROM lines')).rows[0]).toMatchObject({ category: 'semi', unit_cost_centavos: '6000000' })
  })

  it('text edits, region replace and region clear', async () => {
    const { post, agent } = await setup()
    const { lineId } = (await post(laptop())).body
    await agent.patch(`/api/lines/${lineId}`).send({ line: { description: 'Edited' }, region: { page: 2, x: 0, y: 0, w: 0.5, h: 0.5 } })
    expect((await testPool.query('SELECT description FROM lines')).rows[0].description).toBe('Edited')
    expect((await testPool.query('SELECT page FROM line_pdf_regions')).rows[0].page).toBe(2)
    await agent.patch(`/api/lines/${lineId}`).send({ region: null })
    expect(await count('line_pdf_regions')).toBe(0)
  })

  it('re-orders line_no inside one transaction', async () => {
    const { post, agent, doc } = await setup()
    const ids: string[] = []
    for (const n of ['R-1', 'R-2', 'R-3']) ids.push((await post({ line: laptop().line, properties: [{ propertyNo: n }] })).body.lineId)
    const res = await agent.patch(`/api/lines/${ids[2]}`).send({ line: { lineNo: 1 } })
    expect(res.status).toBe(200)
    const got = await agent.get(`/api/documents/${doc.id}`)
    expect(got.body.lines.map((l: { id: string }) => l.id)).toEqual([ids[2], ids[0], ids[1]])
    expect(got.body.lines.map((l: { lineNo: number }) => l.lineNo)).toEqual([1, 2, 3])
  })

  it('unknown line -> 404, malformed -> 400', async () => {
    const { agent } = await setup()
    expect((await agent.patch('/api/lines/00000000-0000-4000-8000-000000000000').send({})).status).toBe(404)
    expect((await agent.patch('/api/lines/nope').send({})).status).toBe(400)
  })
})

describe('delete line (BR-06)', () => {
  it('soft delete: hidden from the document and the registry, property numbers stay reserved', async () => {
    const { post, agent, doc } = await setup()
    const { lineId } = (await post(laptop())).body
    expect((await agent.delete(`/api/lines/${lineId}`)).status).toBe(200)
    expect((await agent.get(`/api/documents/${doc.id}`)).body.lines).toEqual([])
    expect((await testPool.query('SELECT 1 FROM v_registry')).rowCount).toBe(0)
    expect(await count('lines')).toBe(1) // row kept
    expect((await agent.delete(`/api/lines/${lineId}`)).status).toBe(404)
    expect(await count('audit_logs', `WHERE action='line.delete'`)).toBe(1)
    expect((await post(laptop())).status).toBe(409)
  })
})

describe('withTokenRetry', () => {
  const collision = () => Object.assign(new Error('dup'), { code: '23505', constraint: 'qr_tokens_pkey' })
  it('retries a token collision up to 3 attempts', async () => {
    let calls = 0
    expect(await withTokenRetry(async () => { if (++calls < 3) throw collision(); return 'ok' })).toBe('ok')
    expect(calls).toBe(3)
    calls = 0
    await expect(withTokenRetry(async () => { calls++; throw collision() })).rejects.toThrow('dup')
    expect(calls).toBe(3)
  })
  it('does not retry other errors', async () => {
    let calls = 0
    await expect(withTokenRetry(async () => { calls++; throw new Error('boom') })).rejects.toThrow('boom')
    expect(calls).toBe(1)
  })
})
