import { rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const body = (cost: number, nos: { propertyNo: string; componentLabel?: string }[], region?: object) => ({
  line: { qty: 1, unit: 'set', unitCostCentavos: cost, article: 'Article', description: 'Described', estUsefulLifeYears: 5 },
  ...(region ? { region } : {}), properties: nos,
})

// ICS with a PPE laptop set (+ a boxed region) and a semi item, plus a PAR with another PPE item.
async function seed() {
  const { agent } = await loginAs('supply_admin')
  const ics = await makeDocument(agent)
  await agent.post(`/api/documents/${ics.doc.id}/lines`).send(body(9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }], { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.05 }))
  await agent.post(`/api/documents/${ics.doc.id}/lines`).send(body(4870000, [{ propertyNo: 'S-1' }]))
  const par = await makeDocument(agent, { type: 'PAR', docNo: '2025-RO-68', issuedDate: '2025-05-31' })
  await agent.post(`/api/documents/${par.doc.id}/lines`).send(body(9200000, [{ propertyNo: 'P-1' }]))
  return { agent, ics, par, receiver: ics.receiver }
}

type Tab = { rows: { id: string }[]; highlightRowId: string | null }

describe('GET /api/properties/:no/view (admin)', () => {
  it('every tab highlights a row that exists in that tab; the report is NOT_COUNTED without a count', async () => {
    const { agent } = await seed()
    const res = await agent.get('/api/properties/l-1/view')
    expect(res.status).toBe(200)
    const t = res.body.tabs
    for (const tab of ['icsPar', 'registry', 'card'] as const) {
      const x = t[tab] as Tab
      expect(x.rows.map((r) => r.id), tab).toContain(x.highlightRowId)
    }
    expect(t.report).toEqual({ empty: 'NOT_COUNTED' })
  })

  it('ICS/PAR tab: this document lines only, this line highlighted; line and region details', async () => {
    const { agent, ics } = await seed()
    const v = (await agent.get('/api/properties/L-1a/view')).body
    expect(v.tabs.icsPar.rows).toHaveLength(2)
    expect(v.tabs.icsPar.rows[0]).toMatchObject({ lineNo: 1, propertyNos: ['L-1', 'L-1a'], totalCostCentavos: 9645000 })
    expect(v.tabs.icsPar.highlightRowId).toBe(v.tabs.icsPar.rows[0].id)
    expect(v.property).toMatchObject({ propertyNo: 'L-1a', componentLabel: 'Mouse', category: 'ppe' })
    expect(v.document).toMatchObject({
      type: 'ICS', docNo: '2026-03SARAi-005', pdfUrl: `/api/documents/${ics.doc.id}/pdf`,
      pdfRegion: { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.05 }, receivedBy: { name: 'MSantos Full', position: 'Engineer II' },
    })
  })

  it('registry tab (admin): the whole category, scrolled to this line', async () => {
    const { agent } = await seed()
    const v = (await agent.get('/api/properties/L-1/view')).body
    expect(v.tabs.registry.header.title).toBe('REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED')
    expect(v.tabs.registry.rows.map((r: { propertyNos: string[] }) => r.propertyNos[0]).sort()).toEqual(['L-1', 'P-1'])
    const semi = (await agent.get('/api/properties/S-1/view')).body
    expect(semi.tabs.registry.header.title).toBe('REGISTRY OF SEMI-EXPENDABLE PROPERTY ISSUED')
    expect(semi.tabs.card.header.title).toBe('SEMI-EXPENDABLE PROPERTY CARD')
  })

  it('card tab: merged rows keyed by the ISSUE movement; the latest row is highlighted', async () => {
    const { agent } = await seed()
    const issueId = (await testPool.query(`SELECT m.id FROM movements m JOIN properties p ON p.id=m.property_id WHERE p.property_no='L-1' AND m.type='ISSUE'`)).rows[0].id
    const card = (await agent.get('/api/properties/L-1/view')).body.tabs.card
    expect(card.rows).toHaveLength(1)
    expect(card.highlightRowId).toBe(String(issueId))
    expect(card.rows[0]).toMatchObject({ receiptQty: 1, issueQty: 1, balanceQty: 1, amountCentavos: 9645000 })
  })

  it('report tab: appears once a count holds the property; highlight is the property number; old P# in remarks', async () => {
    const { agent, receiver } = await seed()
    await testPool.query(`UPDATE properties SET old_property_no='10605140-00-7' WHERE property_no='L-1'`)
    const userId = (await testPool.query('SELECT id FROM users LIMIT 1')).rows[0].id
    const countId = (await testPool.query(
      `INSERT INTO physical_counts (category, type_label, as_at, fund_cluster, officer_id, officer_position, created_by)
       VALUES ('ppe','ICT','2026-12-31','RAF',$1,'Engineer II',$2) RETURNING id`, [receiver.id, userId])).rows[0].id
    await testPool.query(
      `INSERT INTO count_items (count_id, property_id, qty_on_hand) SELECT $1, id, 1 FROM properties WHERE line_id IN (SELECT id FROM lines WHERE category='ppe')`, [countId])
    await testPool.query(`INSERT INTO count_signatories (count_id, role, name) VALUES ($1,'head_of_agency','The Director')`, [countId])
    const report = (await agent.get('/api/properties/L-1/view')).body.tabs.report
    expect(report.header).toMatchObject({ asAt: '2026-12-31', officerName: 'MSantos Full', signatories: [{ role: 'head_of_agency', name: 'The Director' }] })
    expect(report.highlightRowId).toBe('L-1')
    expect(report.rows.map((r: { id: string }) => r.id)).toContain('L-1')
    expect(report.rows.find((r: { id: string }) => r.id === 'L-1').remarks).toBe('Old P#: 10605140-00-7')
  })

  it('404 for an unknown property; 401 anonymous', async () => {
    const { agent } = await seed()
    expect((await agent.get('/api/properties/NOPE-1/view')).status).toBe(404)
    expect((await agentFor().get('/api/properties/L-1/view')).status).toBe(401)
  })
})

describe('registry and card endpoints', () => {
  it('GET /api/views/registry and /api/views/card/:no', async () => {
    const { agent } = await seed()
    const reg = await agent.get('/api/views/registry?category=semi')
    expect(reg.status).toBe(200)
    expect(reg.body.map((r: { propertyNos: string[] }) => r.propertyNos[0])).toEqual(['S-1'])
    expect((await agent.get('/api/views/registry?category=other')).status).toBe(400)
    expect((await agent.get('/api/views/registry?category=ppe&from=2026-01-01')).body).toHaveLength(1)
    const card = await agent.get('/api/views/card/p-1')
    expect(card.status).toBe(200)
    expect(card.body.rows).toHaveLength(1)
    expect((await agent.get('/api/views/card/NOPE')).status).toBe(404)
  })
})
