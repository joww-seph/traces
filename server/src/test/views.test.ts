import { rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { card, listCards, officerReportRows, registry } from '../services/views.js'
import { testPool, resetDb } from './db.js'
import { agentFor, itemFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

type Item = { itemId: string } | { new: { propertyTypeId: number; article: string; description: string; unit: string } }
const lineBody = (qty: number, cost: number, nos: { propertyNo: string; componentLabel?: string; oldPropertyNo?: string }[],
  extra: object = {}, item: Item = itemFor(cost)) => ({
  line: { qty, unitCostCentavos: cost, description: 'Description', dateAcquired: '2026-02-01', ...extra }, item, properties: nos,
})

async function setup(docOver: Parameters<typeof makeDocument>[1] = {}) {
  const { agent } = await loginAs('supply_admin')
  const { doc, receiver } = await makeDocument(agent, docOver)
  return { agent, doc, receiver, add: (body: object, id = doc.id) => agent.post(`/api/documents/${id}/lines`).send(body) }
}

const thinkpad = { new: { propertyTypeId: 1, article: 'Laptop', description: 'Lenovo ThinkPad E14 Gen 5', unit: 'unit' } }
const itemIdOf = async (description: string) => (await testPool.query(`SELECT id FROM items WHERE description = $1`, [description])).rows[0].id as string

describe('registry', () => {
  it('a qty-3 line with 3 main units: issued 3, amount 3 x unit cost, nothing returned or disposed', async () => {
    const { add } = await setup()
    await add(lineBody(3, 4870000, [{ propertyNo: 'S-1' }, { propertyNo: 'S-2' }, { propertyNo: 'S-3' }]))
    const rows = await registry('semi')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      issuedQty: 3, returnedQty: 0, reissuedQty: 0, disposedQty: 0, balanceQty: 3, amountCentavos: 3 * 4870000,
      propertyNos: ['S-1', 'S-2', 'S-3'], reference: 'ICS 2026-03SARAi-005', issuedTo: 'MSantos', article: 'Article',
      propertyTypeCode: 'ICT',
    })
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/) // the line id: the row a QR scan highlights
  })

  it('components do not add to the quantity but their numbers are listed', async () => {
    const { add } = await setup()
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }]))
    const [r] = await registry('ppe')
    expect(r).toMatchObject({ issuedQty: 1, amountCentavos: 9645000, propertyNos: ['L-1', 'L-1a'] })
  })

  it('filters by category, property type and issued date; ordered by date', async () => {
    const { add, agent } = await setup({ issuedDate: '2026-03-01' })
    await add(lineBody(1, 4870000, [{ propertyNo: 'S-1' }]))
    await add(lineBody(1, 9645000, [{ propertyNo: 'P-1' }]))
    const second = await makeDocument(agent, { docNo: '2026-09-009', issuedDate: '2026-09-10' })
    await add(lineBody(1, 100000, [{ propertyNo: 'S-9' }], {}, { new: { propertyTypeId: 3, article: 'Stapler', description: 'Heavy duty', unit: 'unit' } }), second.doc.id)
    expect((await registry('semi')).map((r) => r.propertyNos[0])).toEqual(['S-1', 'S-9'])
    expect((await registry('ppe')).map((r) => r.propertyNos[0])).toEqual(['P-1'])
    expect((await registry('semi', { typeId: 3 })).map((r) => r.propertyNos[0])).toEqual(['S-9'])
    expect((await registry('semi', { typeId: 1 })).map((r) => r.propertyNos[0])).toEqual(['S-1'])
    expect((await registry('semi', { from: '2026-06-01', to: '2026-12-31' })).map((r) => r.propertyNos[0])).toEqual(['S-9'])
    expect(await registry('semi', { to: '2026-03-31' })).toHaveLength(1)
  })
})

describe('card (one per model)', () => {
  async function threeThinkPads() {
    const s = await setup({ docNo: 'ICS-A', issuedDate: '2026-03-01' })
    await s.add(lineBody(2, 3709200, [{ propertyNo: 'T-1' }, { propertyNo: 'T-2' }], { dateAcquired: '2026-02-20' }, thinkpad))
    const itemId = await itemIdOf('Lenovo ThinkPad E14 Gen 5')
    const second = await makeDocument(s.agent, { docNo: 'ICS-B', issuedDate: '2026-04-10' })
    await s.add(lineBody(1, 3709200, [{ propertyNo: 'T-3' }], { dateAcquired: '2026-04-01' }, { itemId }), second.doc.id)
    return { ...s, itemId }
  }

  it('2 + 1 ThinkPads on two ICS: one card, 4 rows, balances 2, 0, 1, 0 and the amount ends at 0 (split)', async () => {
    const { itemId } = await threeThinkPads()
    const c = await card(itemId, 'split')
    expect(c.header).toMatchObject({ article: 'Laptop', description: 'Lenovo ThinkPad E14 Gen 5', category: 'semi', propertyNoFirst: 'T-1', propertyNoLast: 'T-3' })
    expect(c.rows.map((r) => r.balanceQty)).toEqual([2, 0, 1, 0])
    expect(c.rows.at(-1)!.amountCentavos).toBe(0)
    expect(c.rows[0].amountCentavos).toBe(2 * 3709200)
  })

  it('merged: each ICS shows its receipt and issue as separate rows when the dates differ', async () => {
    const { itemId } = await threeThinkPads()
    expect((await card(itemId, 'merged')).rows).toHaveLength(4)
  })

  it('merged: receipt and issue of a line on the same date are one row', async () => {
    const { add } = await setup({ issuedDate: '2026-03-01' })
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }], { dateAcquired: '2026-03-01' }))
    const c = await card((await testPool.query('SELECT item_id FROM lines')).rows[0].item_id)
    expect(c.rows).toHaveLength(1)
    expect(c.rows[0]).toMatchObject({ receiptQty: 1, issueQty: 1, officer: 'MSantos', balanceQty: 0, amountCentavos: 0 })
  })

  it('a set is one row listing every number; a component-only DISPOSE has quantity 0', async () => {
    const { add } = await setup({ issuedDate: '2026-03-01' })
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }]))
    await testPool.query(`INSERT INTO movements (property_id, type, date) SELECT id, 'DISPOSE', '2026-09-01' FROM properties WHERE property_no='L-1a'`)
    const c = await card((await testPool.query('SELECT item_id FROM lines')).rows[0].item_id, 'split')
    expect(c.rows[0].receiptQty).toBe(1)
    expect(c.rows[1].issueItemNo).toBe('L-1\nL-1a')
    expect(c.rows.at(-1)).toMatchObject({ issueQty: 0, issueItemNo: 'L-1a', remarks: 'Disposed' })
  })

  it('unknown card -> 404', async () => {
    await expect(card('00000000-0000-4000-8000-0000000000ff')).rejects.toMatchObject({ status: 404 })
  })

  it('the card list shows the balance held by the Supply Unit and the units issued', async () => {
    await threeThinkPads()
    const rows = await listCards({ q: 'thinkpad' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ article: 'Laptop', balanceQty: 0, unitsIssued: 3, propertyTypeCode: 'ICT' })
  })

  it('API: GET /api/views/card/:itemId marks the rows of ?highlightLineId, and the old /:no route is gone', async () => {
    const { agent, itemId } = await threeThinkPads()
    const lineId = (await testPool.query(`SELECT id FROM lines WHERE description='Description' ORDER BY line_no LIMIT 1`)).rows[0].id
    const res = await agent.get(`/api/views/card/${itemId}?highlightLineId=${lineId}`)
    expect(res.status).toBe(200)
    expect(res.body.highlightRowIds.length).toBe(2)
    expect((await agent.get('/api/views/card/T-1')).status).toBe(400)
    expect((await agentFor().get(`/api/views/card/${itemId}`)).status).toBe(401)
  })
})

describe('officer report (RPCSP / RPCPPE)', () => {
  async function held() {
    const s = await setup({ issuedDate: '2026-10-20' })
    await s.add(lineBody(1, 4870000, [{ propertyNo: 'S-1', oldPropertyNo: '10605140-00-7' }]))
    await s.add(lineBody(1, 9645000, [{ propertyNo: 'P-1' }]))
    return s
  }

  it('one row per line with balance per card; the count columns do not exist', async () => {
    const { receiver } = await held()
    const r = await officerReportRows({ officerId: receiver.id, category: 'semi', asAt: '2026-12-31' })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ article: 'Article', propertyNos: ['S-1'], unit: 'unit', unitValueCentavos: 4870000, balancePerCard: 1, remarks: 'Old P#: 10605140-00-7' })
    expect(Object.keys(r.rows[0])).not.toEqual(expect.arrayContaining(['qtyOnHand']))
    expect(r.officer).toMatchObject({ id: receiver.id })
  })

  it('an as-at date before the ICS leaves it out', async () => {
    const { receiver } = await held()
    expect((await officerReportRows({ officerId: receiver.id, category: 'semi', asAt: '2026-10-19' })).rows).toHaveLength(0)
    expect((await officerReportRows({ officerId: receiver.id, category: 'semi', asAt: '2026-10-20' })).rows).toHaveLength(1)
  })

  it('filters by category and type; defaults the date to today', async () => {
    const { receiver } = await held()
    expect((await officerReportRows({ officerId: receiver.id, category: 'ppe' })).rows.map((x) => x.propertyNos[0])).toEqual(['P-1'])
    expect((await officerReportRows({ officerId: receiver.id, category: 'ppe', typeId: 3 })).rows).toHaveLength(0)
  })

  it('API: the officer is required (400); anonymous 401; the signatory defaults round-trip', async () => {
    const { agent, receiver } = await held()
    expect((await agent.get('/api/reports/rpc?category=semi')).status).toBe(400)
    const ok = await agent.get(`/api/reports/rpc?officerId=${receiver.id}&category=semi&asAt=2026-12-31`)
    expect(ok.status).toBe(200)
    expect(ok.body.rows).toHaveLength(1)
    expect((await agentFor().get('/api/reports/rpc')).status).toBe(401)

    const sigs = [{ role: 'committee', sortOrder: 1, name: 'Ana Reyes', position: 'Chair' }, { role: 'head_of_agency', sortOrder: 1, name: 'Ben Cruz' }]
    expect((await agent.put('/api/report-signatories').send(sigs)).status).toBe(200)
    expect((await agent.get('/api/report-signatories')).body).toHaveLength(2)
    expect((await agent.get(`/api/reports/rpc?officerId=${receiver.id}&category=semi`)).body.signatories).toHaveLength(2)
    expect((await testPool.query(`SELECT action FROM audit_logs WHERE entity='report_signatories'`)).rows).toHaveLength(1)
  })

  it('no /api/counts route exists any more', async () => {
    const { agent } = await setup()
    expect((await agent.get('/api/counts')).status).toBe(404)
  })
})
