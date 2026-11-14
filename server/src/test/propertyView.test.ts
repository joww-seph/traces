import { rmSync } from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, itemFor, loginAs, makeDocument, signDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const body = (cost: number, nos: { propertyNo: string; componentLabel?: string }[], region?: object, item: object = itemFor(cost)) => ({
  line: { qty: 1, unitCostCentavos: cost, description: 'Described', estUsefulLifeYears: 5, dateAcquired: '2026-02-01' }, item,
  ...(region ? { region } : {}), properties: nos,
})
const thinkpad = { new: { propertyTypeId: 1, article: 'Laptop', description: 'Lenovo ThinkPad E14', unit: 'unit' } }

// ICS with a PPE laptop set (+ a boxed region) and a semi item, plus a PAR with another PPE item.
async function seed() {
  const { agent } = await loginAs('supply_admin')
  const ics = await makeDocument(agent)
  await agent.post(`/api/documents/${ics.doc.id}/lines`).send(body(9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }], { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.05 }, thinkpad))
  await agent.post(`/api/documents/${ics.doc.id}/lines`).send(body(4870000, [{ propertyNo: 'S-1' }]))
  const par = await makeDocument(agent, { type: 'PAR', docNo: '2025-RO-68', issuedDate: '2025-05-31' })
  await agent.post(`/api/documents/${par.doc.id}/lines`).send(body(9200000, [{ propertyNo: 'P-1' }]))
  return { agent, ics, par, receiver: ics.receiver }
}

type Tab = { rows: { id: string }[]; highlightRowId?: string | null; highlightRowIds?: string[] }

describe('GET /api/properties/:no/view (admin)', () => {
  it('every highlight exists in its tab; the report is the holder’s', async () => {
    const { agent } = await seed()
    const res = await agent.get('/api/properties/l-1/view')
    expect(res.status).toBe(200)
    const t = res.body.tabs
    for (const tab of ['icsPar', 'registry', 'report'] as const) {
      const x = t[tab] as Tab
      expect(x.rows.map((r) => r.id), tab).toContain(x.highlightRowId)
    }
    expect(t.card.highlightRowIds.length).toBeGreaterThan(0)
    for (const id of t.card.highlightRowIds) expect(t.card.rows.map((r: { id: string }) => r.id)).toContain(id)
  })

  it('ICS/PAR tab: this document lines only, this line highlighted; scanning the mouse names the set', async () => {
    const { agent, ics } = await seed()
    await signDocument(agent, ics.doc.id)
    const v = (await agent.get('/api/properties/L-1a/view')).body
    expect(v.tabs.icsPar.rows).toHaveLength(2)
    expect(v.tabs.icsPar.rows[0]).toMatchObject({ lineNo: 1, propertyNos: ['L-1', 'L-1a'], totalCostCentavos: 9645000 })
    expect(v.tabs.icsPar.highlightRowId).toBe(v.tabs.icsPar.rows[0].id)
    expect(v.property).toMatchObject({ propertyNo: 'L-1a', componentLabel: 'Mouse', partOfSetNo: 'L-1', category: 'ppe' })
    expect(v.document).toMatchObject({
      type: 'ICS', docNo: '2026-03SARAi-005', pdfUrl: `/api/documents/${ics.doc.id}/pdf`,
      pdfRegion: { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.05 }, receivedBy: { name: 'Maria Santos', position: 'Engineer II' },
    })
    // the main unit has no "part of set"
    expect((await agent.get('/api/properties/L-1/view')).body.property.partOfSetNo).toBeNull()
  })

  it('registry tab (admin): the same category and type, scrolled to this line', async () => {
    const { agent } = await seed()
    const v = (await agent.get('/api/properties/L-1/view')).body
    expect(v.tabs.registry.header).toMatchObject({ title: 'REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED', typeName: 'Information and Communications Technology Equipment' })
    expect(v.tabs.registry.rows.map((r: { propertyNos: string[] }) => r.propertyNos[0]).sort()).toEqual(['L-1', 'P-1'])
    const semi = (await agent.get('/api/properties/S-1/view')).body
    expect(semi.tabs.registry.header.title).toBe('REGISTRY OF SEMI-EXPENDABLE PROPERTY ISSUED')
    expect(semi.tabs.card.header.title).toBe('SEMI-EXPENDABLE PROPERTY CARD')
  })

  it('card tab: the model card, this line’s rows highlighted', async () => {
    const { agent } = await seed()
    const issueId = (await testPool.query(`SELECT m.id FROM movements m JOIN properties p ON p.id=m.property_id WHERE p.property_no='L-1' AND m.type='ISSUE'`)).rows[0].id
    const card = (await agent.get('/api/properties/L-1/view')).body.tabs.card
    expect(card.header).toMatchObject({ article: 'Laptop', description: 'Lenovo ThinkPad E14', propertyNoFirst: 'L-1', propertyNoLast: 'L-1' })
    expect(card.rows).toHaveLength(2) // receipt (2026-02-01) and issue (2026-03-01)
    expect(card.highlightRowIds).toContain(String(issueId))
    expect(card.rows.at(-1)).toMatchObject({ issueQty: 1, balanceQty: 0 })
  })

  it('report tab: the current holder’s rows of the same category and type, this line highlighted; old P# in remarks', async () => {
    const { agent, receiver } = await seed()
    await testPool.query(`UPDATE properties SET old_property_no='10605140-00-7' WHERE property_no='L-1'`)
    const report = (await agent.get('/api/properties/L-1/view')).body.tabs.report
    expect(report.header).toMatchObject({ officerName: 'Maria Santos', typeLabel: 'Information and Communications Technology Equipment' })
    expect(report.rows.map((r: { propertyNos: string[] }) => r.propertyNos[0]).sort()).toEqual(['L-1', 'P-1'])
    expect(report.highlightRowId).toBeTruthy()
    const mine = report.rows.find((r: { id: string }) => r.id === report.highlightRowId)
    expect(mine).toMatchObject({ propertyNos: ['L-1', 'L-1a'], balancePerCard: 1, remarks: 'Old P#: 10605140-00-7' })
    expect(receiver.id).toBeTruthy()
  })

  it('report tab: NOT_ISSUED when nobody holds the property (returned)', async () => {
    const { agent, receiver } = await seed()
    await testPool.query(`INSERT INTO movements (property_id, type, date, officer_id) SELECT id, 'RETURN', '2026-06-01', $1 FROM properties WHERE property_no='L-1'`, [receiver.id])
    expect((await agent.get('/api/properties/L-1/view')).body.tabs.report).toEqual({ empty: 'NOT_ISSUED' })
  })

  it('404 for an unknown property; 401 anonymous', async () => {
    const { agent } = await seed()
    expect((await agent.get('/api/properties/NOPE-1/view')).status).toBe(404)
    expect((await agentFor().get('/api/properties/L-1/view')).status).toBe(401)
  })
})

describe('public view of a shared model card (SEC-10)', () => {
  it('never shows another line’s officer on the card, registry or report tab', async () => {
    const { agent, ics } = await seed()
    const second = await makeDocument(agent, { docNo: '2026-04TEST-001', issuedDate: '2026-04-01' })
    const other = (await agent.post('/api/officers').send({ fullName: 'Zed O. Other', position: 'Clerk' })).body
    await testPool.query(`UPDATE documents SET received_by_officer_id = $1 WHERE id = $2`, [other.id, second.doc.id])
    const itemId = (await testPool.query(`SELECT item_id FROM lines WHERE description='Described' ORDER BY line_no LIMIT 1`)).rows[0].item_id
    await agent.post(`/api/documents/${second.doc.id}/lines`).send(body(9645000, [{ propertyNo: 'L-2' }], undefined, { itemId }))
    await testPool.query(`UPDATE movements SET officer_id = $1 WHERE property_id = (SELECT id FROM properties WHERE property_no='L-2') AND type='ISSUE'`, [other.id])
    const token = (await testPool.query(`SELECT t.token FROM qr_tokens t JOIN properties p ON p.id=t.property_id WHERE p.property_no='L-1'`)).rows[0].token.trim()

    const pub = (await request(createApp()).get(`/api/public/q/${token}`)).body
    const text = JSON.stringify(pub)
    expect(text).not.toContain('ZOOther')
    expect(text).not.toContain('Zed O. Other')
    expect(text).not.toContain('L-2')
    expect(pub.tabs.card.rows.length).toBe(2) // this line's receipt + issue only
    // while staff see both issuances on the card
    expect(JSON.stringify((await agent.get('/api/properties/L-1/view')).body.tabs.card)).toContain('Zed O. Other')
    expect(ics.doc.id).toBeTruthy()
  })
})

describe('registry and card endpoints', () => {
  it('GET /api/views/registry', async () => {
    const { agent } = await seed()
    const reg = await agent.get('/api/views/registry?category=semi')
    expect(reg.status).toBe(200)
    expect(reg.body.map((r: { propertyNos: string[] }) => r.propertyNos[0])).toEqual(['S-1'])
    expect((await agent.get('/api/views/registry?category=other')).status).toBe(400)
    expect((await agent.get('/api/views/registry?category=ppe&from=2026-01-01')).body).toHaveLength(1)
  })
})
