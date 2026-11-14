import { rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, makeDocument, samplePdf } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const body = (cost: number, nos: { propertyNo: string; componentLabel?: string }[]) => ({
  line: { qty: 1, unit: 'unit', unitCostCentavos: cost, article: 'Article', description: 'Described' }, properties: nos,
})

// MSantos (receiver) holds: PPE laptop set L-1/L-1a and a semi chair S-1.
// JDelaCruz holds a PPE fume hood H-1 on a PAR addressed to them.
async function seed() {
  const { agent } = await loginAs('supply_admin')
  const ics = await makeDocument(agent)
  await agent.post(`/api/documents/${ics.doc.id}/lines`).send(body(9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }]))
  await agent.post(`/api/documents/${ics.doc.id}/lines`).send(body(450000, [{ propertyNo: 'S-1' }]))
  const par = await agent.post('/api/documents')
    .field('meta', JSON.stringify({ type: 'PAR', docNo: '2025-RO-68', fundCluster: 'RAF', issuedDate: '2025-05-31', issuedByOfficerId: ics.receiver.id, receivedByOfficerId: ics.issuer.id }))
    .attach('pdf', await samplePdf(), { filename: 'par.pdf', contentType: 'application/pdf' })
  await agent.post(`/api/documents/${par.body.id}/lines`).send(body(9200000, [{ propertyNo: 'H-1' }]))
  const count = (over: object = {}) => agent.post('/api/counts').send({
    category: 'ppe', typeLabel: 'ICT Equipment', asAt: '2026-12-31', fundCluster: 'RAF', officerId: ics.receiver.id, ...over,
  })
  return { agent, ics, count, issuer: ics.issuer, receiver: ics.receiver }
}

const nos = (rows: { propertyNo: string }[]) => rows.map((r) => r.propertyNo)

describe('create (BR-10)', () => {
  it("includes only that officer's holdings of that category; snapshots the position; items start uncounted", async () => {
    const { agent, count } = await seed()
    const res = await count()
    expect(res.status).toBe(201)
    const got = (await agent.get(`/api/counts/${res.body.id}`)).body
    expect(nos(got.rows)).toEqual(['L-1', 'L-1a'])
    expect(got).toMatchObject({ status: 'open', category: 'ppe', officerPosition: 'Engineer II', officerShortName: 'MSantos', progress: { total: 2, counted: 0 } })
    expect(got.rows[0]).toMatchObject({ qtyOnHand: null, shortageOverageQty: null, balancePerCard: 1 })
    const semi = (await agent.get(`/api/counts/${(await count({ category: 'semi' })).body.id}`)).body
    expect(nos(semi.rows)).toEqual(['S-1'])
  })

  it('another officer gets their own items only', async () => {
    const { agent, count, issuer } = await seed()
    const res = await count({ officerId: issuer.id })
    expect(nos((await agent.get(`/api/counts/${res.body.id}`)).body.rows)).toEqual(['H-1'])
  })

  it('items no longer held are left out: disposed, voided, deleted line', async () => {
    const { agent, count, ics } = await seed()
    await testPool.query(`INSERT INTO movements (property_id, type, date) SELECT id, 'DISPOSE', '2026-06-01' FROM properties WHERE property_no='L-1a'`)
    const lineId = (await testPool.query(`SELECT line_id FROM properties WHERE property_no='L-1'`)).rows[0].line_id
    await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['L-1'] })
    void ics
    const res = await count()
    expect((await agent.get(`/api/counts/${res.body.id}`)).body.rows).toEqual([])
  })

  it('the same category + officer + date twice -> 409', async () => {
    const { count } = await seed()
    expect((await count()).status).toBe(201)
    const dup = await count()
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('DUPLICATE_COUNT')
    expect((await count({ asAt: '2027-12-31' })).status).toBe(201)
  })

  it('signatories are saved and numbered per role; invalid body -> 400; unknown officer -> 400; anonymous -> 401', async () => {
    const { agent, count } = await seed()
    const res = await count({ signatories: [
      { role: 'committee', name: 'Chair A', position: 'Chair' }, { role: 'committee', name: 'Member B' },
      { role: 'head_of_agency', name: 'The Director', position: 'Regional Director' },
    ] })
    const got = (await agent.get(`/api/counts/${res.body.id}`)).body
    expect(got.signatories).toEqual([
      { role: 'committee', sortOrder: 1, name: 'Chair A', position: 'Chair' },
      { role: 'committee', sortOrder: 2, name: 'Member B', position: null },
      { role: 'head_of_agency', sortOrder: 1, name: 'The Director', position: 'Regional Director' },
    ])
    expect((await count({ asAt: 'tomorrow' })).status).toBe(400)
    expect((await count({ asAt: '2030-01-01', officerId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400)
    expect((await agentFor().post('/api/counts').send({})).status).toBe(401)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='count.create'`)).rowCount).toBe(1)
  })

  it('balance per card is as of the count date', async () => {
    const { agent, count } = await seed()
    const early = await count({ asAt: '2026-01-01' }) // before the 2026-03-01 receipt
    expect((await agent.get(`/api/counts/${early.body.id}`)).body.rows[0].balancePerCard).toBe(0)
  })
})

describe('refresh', () => {
  it('picks up a line saved later; a second refresh adds nothing', async () => {
    const { agent, count, ics } = await seed()
    const id = (await count()).body.id
    await agent.post(`/api/documents/${ics.doc.id}/lines`).send(body(9000000, [{ propertyNo: 'L-2' }]))
    const r1 = await agent.post(`/api/counts/${id}/refresh`)
    expect(r1.body.added).toBe(1)
    expect((await agent.post(`/api/counts/${id}/refresh`)).body.added).toBe(0)
    expect(nos((await agent.get(`/api/counts/${id}`)).body.rows)).toEqual(['L-1', 'L-1a', 'L-2'])
  })

  it('a refresh keeps counted quantities', async () => {
    const { agent, count } = await seed()
    const id = (await count()).body.id
    await agent.patch(`/api/counts/${id}/items/L-1`).send({ qtyOnHand: 1 })
    await agent.post(`/api/counts/${id}/refresh`)
    expect((await agent.get(`/api/counts/${id}`)).body.rows[0].qtyOnHand).toBe(1)
  })
})

describe('items: on hand per count', () => {
  it('records on hand, computes shortage/overage, keeps remarks and appends the old P#', async () => {
    const { agent, count } = await seed()
    await testPool.query(`UPDATE properties SET old_property_no='10605140-00-7' WHERE property_no='L-1'`)
    const id = (await count()).body.id
    const r = await agent.patch(`/api/counts/${id}/items/l-1`).send({ qtyOnHand: 0, remarks: 'lost' })
    expect(r.status).toBe(200)
    const row = (await agent.get(`/api/counts/${id}`)).body.rows[0]
    expect(row).toMatchObject({ qtyOnHand: 0, shortageOverageQty: -1, shortageOverageValueCentavos: -9645000, remarks: 'lost\nOld P#: 10605140-00-7' })
    expect((await agent.get(`/api/counts/${id}`)).body.progress).toEqual({ total: 2, counted: 1 })
    await agent.patch(`/api/counts/${id}/items/L-1`).send({ qtyOnHand: null }) // back to not counted
    expect((await agent.get(`/api/counts/${id}`)).body.progress.counted).toBe(0)
  })

  it('negative quantity -> 400; a property not in this count -> 404', async () => {
    const { agent, count } = await seed()
    const id = (await count()).body.id
    expect((await agent.patch(`/api/counts/${id}/items/L-1`).send({ qtyOnHand: -1 })).status).toBe(400)
    expect((await agent.patch(`/api/counts/${id}/items/S-1`).send({ qtyOnHand: 1 })).status).toBe(404)
    expect((await agent.patch(`/api/counts/${id}/items/NOPE`).send({ qtyOnHand: 1 })).status).toBe(404)
  })
})

describe('closing', () => {
  it('a closed count cannot be edited, refreshed or re-opened; closing is audited', async () => {
    const { agent, count } = await seed()
    const id = (await count()).body.id
    await agent.patch(`/api/counts/${id}/items/L-1`).send({ qtyOnHand: 1 })
    const closed = await agent.patch(`/api/counts/${id}`).send({ status: 'closed' })
    expect(closed.status).toBe(200)
    expect(closed.body.status).toBe('closed')
    for (const res of [
      await agent.patch(`/api/counts/${id}/items/L-1`).send({ qtyOnHand: 5 }),
      await agent.patch(`/api/counts/${id}`).send({ typeLabel: 'Changed' }),
      await agent.patch(`/api/counts/${id}`).send({ status: 'open' }),
      await agent.post(`/api/counts/${id}/refresh`),
    ]) {
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('COUNT_CLOSED')
    }
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='count.close'`)).rowCount).toBe(1)
    expect((await agent.get(`/api/counts/${id}`)).body.closedAt).not.toBeNull()
  })

  it('open counts: header and signatories can be edited; category and officer cannot change; unique date conflict -> 409', async () => {
    const { agent, count } = await seed()
    const a = (await count()).body.id
    await count({ asAt: '2027-12-31' })
    const ok = await agent.patch(`/api/counts/${a}`).send({ typeLabel: 'Office Equipment', signatories: [{ role: 'coa_representative', name: 'COA Rep' }] })
    expect(ok.status).toBe(200)
    expect((await agent.get(`/api/counts/${a}`)).body).toMatchObject({ typeLabel: 'Office Equipment', signatories: [{ role: 'coa_representative', name: 'COA Rep', sortOrder: 1 }] })
    expect((await agent.patch(`/api/counts/${a}`).send({ asAt: '2027-12-31' })).status).toBe(409)
    expect((await agent.patch(`/api/counts/${a}`).send({ category: 'semi' })).body.category).toBe('ppe') // unknown keys are ignored by the schema
  })
})

describe('list', () => {
  it('lists counts newest first with progress; 404 for an unknown id', async () => {
    const { agent, count } = await seed()
    const a = (await count({ asAt: '2026-06-30' })).body.id
    await count({ asAt: '2026-12-31' })
    await agent.patch(`/api/counts/${a}/items/L-1`).send({ qtyOnHand: 1 })
    const list = (await agent.get('/api/counts')).body
    expect(list.map((c: { asAt: string }) => c.asAt)).toEqual(['2026-12-31', '2026-06-30'])
    expect(list[1]).toMatchObject({ officerShortName: 'MSantos', category: 'ppe', status: 'open', progress: { total: 2, counted: 1 } })
    expect((await agent.get('/api/counts/00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await agent.get('/api/counts/nope')).status).toBe(400)
  })
})
