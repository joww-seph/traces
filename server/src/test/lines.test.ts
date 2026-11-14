import { rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { withTokenRetry } from '../services/lines.js'
import { testPool, resetDb } from './db.js'
import { agentFor, DEFAULT_ITEM, itemFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const count = async (table: string, where = '') =>
  Number((await testPool.query(`SELECT count(*) FROM ${table} ${where}`)).rows[0].count)
const counts = async () => ({
  lines: await count('lines'), regions: await count('line_pdf_regions'), properties: await count('properties'),
  tokens: await count('qr_tokens'), movements: await count('movements'), audit: await count('audit_logs'),
})

const laptop = (over: object = {}) => {
  const line = { qty: 1, unitCostCentavos: 9645000, description: 'Laptop set', estUsefulLifeYears: 5, dateAcquired: '2026-02-15', ...over }
  return {
    line, item: itemFor(line.unitCostCentavos),
    region: { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.05 },
    properties: [
      { propertyNo: '2026-09ICT-0199' },
      { propertyNo: '2026-09ICT-0199a', componentLabel: 'Mouse' },
      { propertyNo: '2026-09ICT-0199b', componentLabel: 'Headset' },
    ],
  }
}

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

    // receipt on the date acquired, issue on the document date to the receiving officer
    const mv = (await testPool.query(`SELECT type, date::text, officer_id FROM movements ORDER BY id LIMIT 2`)).rows
    expect(mv.map((m) => m.type)).toEqual(['RECEIPT', 'ISSUE'])
    expect(mv[0].date).toBe('2026-02-15')
    expect(mv[1].date).toBe('2026-03-01')
    expect(mv[1].officer_id).toBe(receiver.id)
  })

  it('receipt movement is dated by the date acquired and carries the iar_no when given', async () => {
    const { post } = await setup()
    await post(laptop({ iarNo: 'IAR-77', iarDate: '2026-02-12', dateAcquired: '2026-02-10' }))
    const r = (await testPool.query(`SELECT date::text, reference_text, reference_document_id FROM movements WHERE type='RECEIPT' LIMIT 1`)).rows[0]
    expect(r).toEqual({ date: '2026-02-10', reference_text: 'IAR-77', reference_document_id: null })
  })

  it('line_no defaults to max+1 per document', async () => {
    const { post, agent, doc } = await setup()
    await post({ ...laptop(), region: undefined, properties: [{ propertyNo: 'A-1' }] })
    await post({ ...laptop(), region: undefined, properties: [{ propertyNo: 'A-2' }] })
    const got = await agent.get(`/api/documents/${doc.id}`)
    expect(got.body.lines.map((l: { lineNo: number }) => l.lineNo)).toEqual([1, 2])
    expect(got.body.lines[0].properties).toHaveLength(1)
  })

  it('category by cost: 96,450 -> ppe with a warning on an ICS; 48,700 -> semi, no warning', async () => {
    const { post } = await setup()
    const big = await post(laptop())
    expect(big.body.category).toBe('ppe')
    expect(big.body.warning.code).toBe('DOC_TYPE_MISMATCH')
    const small = await post({ ...laptop({ unitCostCentavos: 4870000 }), region: undefined, properties: [{ propertyNo: 'S-1' }] })
    expect(small.body.category).toBe('semi')
    expect(small.body.warning).toBeUndefined()
  })

  it('a PAR line below the threshold warns too', async () => {
    const { post } = await setup({ type: 'PAR', docNo: '2025-RO-68' })
    const res = await post({ ...laptop({ unitCostCentavos: 100000 }), region: undefined, properties: [{ propertyNo: 'P-1' }] })
    expect(res.body.category).toBe('semi')
    expect(res.body.warning.code).toBe('DOC_TYPE_MISMATCH')
  })

  it('duplicate property number in another letter case -> 409 naming it, and nothing is written (rollback)', async () => {
    const { post } = await setup()
    await post(laptop())
    const before = await counts()
    const res = await post({ ...laptop(), region: undefined, properties: [{ propertyNo: 'NEW-1' }, { propertyNo: '2026-09ict-0199' }] })
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

describe('cards on a line (update 01 U4)', () => {
  const newCard = { new: { propertyTypeId: 1, article: 'Laptop', description: 'Lenovo ThinkPad E14 Gen 5', unit: 'unit' } }

  it('a ₱96,450 line on a semi card -> 409 CATEGORY_MISMATCH and nothing is written', async () => {
    const { post } = await setup()
    const before = await counts()
    const res = await post({ ...laptop(), item: { itemId: DEFAULT_ITEM.semi } })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'CATEGORY_MISMATCH', details: { lineCategory: 'ppe', itemCategory: 'semi' } })
    expect(await counts()).toEqual(before)
  })

  it('an inline new card is created with the computed category and reused by id afterwards', async () => {
    const { post, agent } = await setup()
    const first = await post({ ...laptop({ unitCostCentavos: 3709200 }), item: newCard, region: undefined, properties: [{ propertyNo: 'T-1' }] })
    expect(first.status).toBe(201)
    const card = (await testPool.query(`SELECT id, category, article, unit FROM items WHERE description = 'Lenovo ThinkPad E14 Gen 5'`)).rows[0]
    expect(card).toMatchObject({ category: 'semi', article: 'Laptop', unit: 'unit' })
    const second = await post({ ...laptop({ unitCostCentavos: 3709200 }), item: { itemId: card.id }, region: undefined, properties: [{ propertyNo: 'T-2' }] })
    expect(second.status).toBe(201)
    expect((await testPool.query(`SELECT count(*) FROM lines WHERE item_id = $1`, [card.id])).rows[0].count).toBe('2')
    expect((await agent.get(`/api/lines/${first.body.lineId}`)).body).toMatchObject({ article: 'Laptop', unit: 'unit' })
  })

  it('an inline card that already exists -> 409 ITEM_EXISTS carrying its id, nothing written', async () => {
    const { post } = await setup()
    await post({ ...laptop({ unitCostCentavos: 3709200 }), item: newCard, region: undefined, properties: [{ propertyNo: 'T-1' }] })
    const id = (await testPool.query(`SELECT id FROM items WHERE description = 'Lenovo ThinkPad E14 Gen 5'`)).rows[0].id
    const before = await counts()
    const res = await post({ ...laptop({ unitCostCentavos: 3709200 }), item: { new: { ...newCard.new, article: 'LAPTOP' } }, region: undefined, properties: [{ propertyNo: 'T-2' }] })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'ITEM_EXISTS', details: { itemId: id } })
    expect(await counts()).toEqual(before)
  })

  it('an unknown card -> 404 ITEM_NOT_FOUND; an inactive card -> 409 ITEM_INACTIVE', async () => {
    const { post } = await setup()
    expect((await post({ ...laptop(), item: { itemId: '00000000-0000-4000-8000-0000000000ff' } })).status).toBe(404)
    await testPool.query(`UPDATE items SET active = false WHERE id = $1`, [DEFAULT_ITEM.ppe])
    const res = await post(laptop())
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ITEM_INACTIVE')
  })
})

describe('batch save (BR-14)', () => {
  const row = (nos: string[], over: object = {}) => ({
    ...laptop({ unitCostCentavos: 3709200, ...over }), region: undefined,
    item: { new: { propertyTypeId: 1, article: 'Laptop', description: 'Lenovo ThinkPad E14 Gen 5', unit: 'unit' } },
    properties: nos.map((propertyNo) => ({ propertyNo })),
  })
  const batch = (agent: Awaited<ReturnType<typeof setup>>['agent'], id: string, rows: object[]) =>
    agent.post(`/api/documents/${id}/lines/batch`).send({ rows })

  it('two rows of the same new card create one card and two lines, numbered in order', async () => {
    const { agent, doc } = await setup()
    const res = await batch(agent, doc.id, [row(['B-1']), row(['B-2', 'B-3'], { qty: 2 })])
    expect(res.status).toBe(201)
    expect(res.body.lines.map((l: { category: string }) => l.category)).toEqual(['semi', 'semi'])
    expect(await count('items', `WHERE description = 'Lenovo ThinkPad E14 Gen 5'`)).toBe(1)
    const got = await agent.get(`/api/documents/${doc.id}`)
    expect(got.body.lines.map((l: { lineNo: number }) => l.lineNo)).toEqual([1, 2])
    expect(await count('audit_logs', `WHERE action='line.create'`)).toBe(2)
  })

  it('duplicate numbers anywhere in the batch -> 409 listing every one with its row, and nothing is written', async () => {
    const { agent, doc, post } = await setup()
    await post(laptop())
    const before = await counts()
    const res = await batch(agent, doc.id, [row(['D-1']), row(['D-1', 'D-2']), row(['2026-09ict-0199'])])
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DUPLICATE_PROPERTY_NO')
    expect(res.body.error.details.duplicates).toEqual(expect.arrayContaining([
      { rowIndex: 1, propertyNo: 'D-1' }, { rowIndex: 2, propertyNo: '2026-09ict-0199' },
    ]))
    expect(await counts()).toEqual(before)
    expect(await count('items', `WHERE description = 'Lenovo ThinkPad E14 Gen 5'`)).toBe(0)
  })

  it('a category mismatch in one row rolls the whole batch back', async () => {
    const { agent, doc } = await setup()
    const before = await counts()
    const res = await batch(agent, doc.id, [row(['M-1']), { ...laptop(), item: { itemId: DEFAULT_ITEM.semi } }])
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CATEGORY_MISMATCH')
    expect(res.body.error.details.rowIndex).toBe(1)
    expect(await counts()).toEqual(before)
  })

  it('an empty batch -> 400', async () => {
    const { agent, doc } = await setup()
    expect((await batch(agent, doc.id, [])).status).toBe(400)
  })
})

describe('read line', () => {
  it('GET /api/lines/:id returns the line, numeric region and live properties; 404 once deleted', async () => {
    const { post, agent, doc } = await setup()
    const { lineId } = (await post(laptop())).body
    const got = await agent.get(`/api/lines/${lineId}`)
    expect(got.status).toBe(200)
    expect(got.body).toMatchObject({ id: lineId, documentId: doc.id, region: { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.05 } })
    expect(got.body.properties.map((p: { propertyNo: string }) => p.propertyNo)).toEqual(['2026-09ICT-0199', '2026-09ICT-0199a', '2026-09ICT-0199b'])
    await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['2026-09ICT-0199b'] })
    expect((await agent.get(`/api/lines/${lineId}`)).body.properties).toHaveLength(2)
    await agent.delete(`/api/lines/${lineId}`)
    expect((await agent.get(`/api/lines/${lineId}`)).status).toBe(404)
    expect((await agent.get('/api/lines/nope')).status).toBe(400)
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
    const again = await post({ ...laptop(), region: undefined, properties: [{ propertyNo: '2026-09ICT-0199b' }] })
    expect(again.status).toBe(409)
    expect((await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['NOPE-1'] })).status).toBe(404)
  })

  it('cost change across the threshold keeps the category and returns a warning', async () => {
    const { post, agent } = await setup()
    const { lineId } = (await post({ ...laptop({ unitCostCentavos: 4870000 }), region: undefined, properties: [{ propertyNo: 'S-1' }] })).body
    const same = await agent.patch(`/api/lines/${lineId}`).send({ line: { unitCostCentavos: 4900000 } })
    expect(same.body.warning).toBeUndefined()
    const res = await agent.patch(`/api/lines/${lineId}`).send({ line: { unitCostCentavos: 6000000 } })
    expect(res.status).toBe(200)
    expect(res.body.category).toBe('semi')
    expect(res.body.warning.code).toBe('CATEGORY_UNCHANGED')
    expect((await testPool.query('SELECT i.category, l.unit_cost_centavos FROM lines l JOIN items i ON i.id = l.item_id')).rows[0]).toMatchObject({ category: 'semi', unit_cost_centavos: '6000000' })
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
    for (const n of ['R-1', 'R-2', 'R-3']) ids.push((await post({ ...laptop(), region: undefined, properties: [{ propertyNo: n }] })).body.lineId)
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

describe('corrections reach the ledger (card, registry, report)', () => {
  const holder = async (no: string) => (await testPool.query(
    `SELECT c.holder_officer_id FROM v_custody c JOIN properties p ON p.id=c.property_id WHERE p.property_no=$1`, [no])).rows[0]?.holder_officer_id
  const dates = async (no: string) => (await testPool.query(
    `SELECT m.type, m.date::text FROM movements m JOIN properties p ON p.id=m.property_id WHERE p.property_no=$1 ORDER BY m.id`, [no])).rows

  it('a corrected receiver and date of issue move the ISSUE movements with them', async () => {
    const { post, agent, doc, receiver } = await setup()
    await post(laptop())
    expect(await holder('2026-09ICT-0199')).toBe(receiver.id)
    const other = (await agent.post('/api/officers').send({ fullName: 'Otto Person', position: 'Clerk', canReceive: true })).body
    expect((await agent.patch(`/api/documents/${doc.id}`).send({ receivedByOfficerId: other.id, issuedDate: '2026-03-05' })).status).toBe(200)
    expect(await holder('2026-09ICT-0199')).toBe(other.id)
    expect(await holder('2026-09ICT-0199a')).toBe(other.id)
    expect(await dates('2026-09ICT-0199')).toEqual([{ type: 'RECEIPT', date: '2026-02-15' }, { type: 'ISSUE', date: '2026-03-05' }])
  })

  it('a corrected date acquired and IAR number move the RECEIPT movements', async () => {
    const { post, agent } = await setup()
    const { lineId } = (await post(laptop())).body
    expect((await agent.patch(`/api/lines/${lineId}`).send({ line: { dateAcquired: '2026-01-20', iarNo: 'IAR-9' } })).status).toBe(200)
    expect(await dates('2026-09ICT-0199')).toEqual([{ type: 'RECEIPT', date: '2026-01-20' }, { type: 'ISSUE', date: '2026-03-01' }])
    const r = (await testPool.query(`SELECT reference_text, reference_document_id FROM movements WHERE type='RECEIPT' LIMIT 1`)).rows[0]
    expect(r).toEqual({ reference_text: 'IAR-9', reference_document_id: null })
  })
})

describe('moving a line to another card', () => {
  it('a wrong card can be corrected to one of the same category; another category is 409', async () => {
    const { post, agent } = await setup()
    const { lineId } = (await post(laptop())).body
    const other = (await agent.post('/api/items').send({ propertyTypeId: 1, category: 'ppe', article: 'Laptop', description: 'Dell Latitude', unit: 'unit' })).body
    const res = await agent.patch(`/api/lines/${lineId}`).send({ item: { itemId: other.id } })
    expect(res.status).toBe(200)
    expect((await testPool.query('SELECT item_id FROM lines WHERE id=$1', [lineId])).rows[0].item_id).toBe(other.id)
    const wrong = await agent.patch(`/api/lines/${lineId}`).send({ item: { itemId: DEFAULT_ITEM.semi } })
    expect(wrong.status).toBe(409)
    expect(wrong.body.error.code).toBe('CATEGORY_MISMATCH')
    const created = await agent.patch(`/api/lines/${lineId}`).send({ item: { new: { propertyTypeId: 1, article: 'Laptop', description: 'HP ProBook', unit: 'unit' } } })
    expect(created.status).toBe(200)
    expect((await testPool.query(`SELECT category FROM items WHERE description='HP ProBook'`)).rows[0].category).toBe('ppe')
  })
})
