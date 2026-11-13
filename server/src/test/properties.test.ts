import { rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const line = (cost: number, nos: { propertyNo: string; componentLabel?: string; oldPropertyNo?: string }[]) => ({
  line: { qty: 1, unit: 'set', unitCostCentavos: cost, article: 'Laptop', description: 'Laptop set' }, properties: nos,
})

async function setup() {
  const { agent } = await loginAs('supply_admin')
  const { doc } = await makeDocument(agent)
  const made = await agent.post(`/api/documents/${doc.id}/lines`).send(line(9645000, [{ propertyNo: '2026-09ICT-0199' }, { propertyNo: '2026-09ICT-0199a', componentLabel: 'Mouse' }]))
  return { agent, doc, lineId: made.body.lineId as string }
}

describe('properties', () => {
  it('GET /:no returns the property with its single active token (case-insensitive)', async () => {
    const { agent } = await setup()
    const res = await agent.get('/api/properties/2026-09ict-0199')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ propertyNo: '2026-09ICT-0199', condition: 'serviceable', componentLabel: null })
    expect(res.body.token).toMatch(/^[0-9A-Za-z]{10}$/)
  })

  it('PATCH updates serial, label and condition and audits before/after', async () => {
    const { agent } = await setup()
    const res = await agent.patch('/api/properties/2026-09ICT-0199a').send({ serialNo: 'SN-123', componentLabel: 'Wireless mouse', condition: 'unserviceable', oldPropertyNo: '10605140-00-7' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ serialNo: 'SN-123', componentLabel: 'Wireless mouse', condition: 'unserviceable', oldPropertyNo: '10605140-00-7' })
    const a = (await testPool.query(`SELECT before, after FROM audit_logs WHERE action='property.update'`)).rows
    expect(a).toHaveLength(1)
    expect(a[0].before.serialNo).toBeNull()
    expect(a[0].after.serialNo).toBe('SN-123')
  })

  it('null clears serial and label (component becomes a main unit, registry quantity follows)', async () => {
    const { agent } = await setup()
    await agent.patch('/api/properties/2026-09ICT-0199a').send({ serialNo: 'X' })
    const res = await agent.patch('/api/properties/2026-09ICT-0199a').send({ serialNo: null, componentLabel: null })
    expect(res.body).toMatchObject({ serialNo: null, componentLabel: null })
    expect(Number((await testPool.query('SELECT issued_qty FROM v_registry')).rows[0].issued_qty)).toBe(2)
  })

  it('unknown or voided property -> 404; invalid body -> 400; anonymous -> 401', async () => {
    const { agent, lineId } = await setup()
    expect((await agent.patch('/api/properties/NOPE-1').send({ serialNo: 'x' })).status).toBe(404)
    expect((await agent.patch('/api/properties/2026-09ICT-0199a').send({ condition: 'broken' })).status).toBe(400)
    await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['2026-09ICT-0199a'] })
    expect((await agent.patch('/api/properties/2026-09ICT-0199a').send({ serialNo: 'x' })).status).toBe(404)
    expect((await agentFor().get('/api/properties/2026-09ICT-0199')).status).toBe(401)
  })
})

describe('old property number', () => {
  it('is stored when a line is created and returned by GET', async () => {
    const { agent } = await loginAs('supply_admin')
    const { doc } = await makeDocument(agent)
    await agent.post(`/api/documents/${doc.id}/lines`).send(line(9200000, [{ propertyNo: '1998-05-140-TSE000-RSTL15', oldPropertyNo: '10605140-00-7' }]))
    expect((await agent.get('/api/properties/1998-05-140-TSE000-RSTL15')).body.oldPropertyNo).toBe('10605140-00-7')
  })
})

describe('dashboard', () => {
  it('counts documents and properties/value per category (zeros when empty)', async () => {
    const { agent } = await loginAs('supply_admin')
    expect((await agent.get('/api/dashboard')).body).toEqual({
      documents: { ICS: 0, PAR: 0 },
      categories: { semi: { properties: 0, mainUnits: 0, valueCentavos: 0 }, ppe: { properties: 0, mainUnits: 0, valueCentavos: 0 } },
    })
    const { doc } = await makeDocument(agent)
    await agent.post(`/api/documents/${doc.id}/lines`).send(line(9645000, [{ propertyNo: 'P-1' }, { propertyNo: 'P-1a', componentLabel: 'Mouse' }]))
    await agent.post(`/api/documents/${doc.id}/lines`).send(line(4870000, [{ propertyNo: 'S-1' }]))
    const res = await agent.get('/api/dashboard')
    expect(res.body.documents).toEqual({ ICS: 1, PAR: 0 })
    expect(res.body.categories.ppe).toEqual({ properties: 2, mainUnits: 1, valueCentavos: 9645000 })
    expect(res.body.categories.semi).toEqual({ properties: 1, mainUnits: 1, valueCentavos: 4870000 })
  })

  it('ignores deleted documents and lines; anonymous -> 401', async () => {
    const { agent } = await loginAs('supply_admin')
    const { doc } = await makeDocument(agent)
    const { body } = await agent.post(`/api/documents/${doc.id}/lines`).send(line(4870000, [{ propertyNo: 'S-1' }]))
    await agent.delete(`/api/lines/${body.lineId}`)
    expect((await agent.get('/api/dashboard')).body.categories.semi.properties).toBe(0)
    await agent.delete(`/api/documents/${doc.id}`)
    expect((await agent.get('/api/dashboard')).body.documents.ICS).toBe(0)
    expect((await agentFor().get('/api/dashboard')).status).toBe(401)
  })
})
