import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { resetDb, testPool } from './db.js'
import { agentFor, DEFAULT_ITEM, loginAs, makeDocument } from './helpers.js'

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

async function withNumbers(nos: string[]) {
  const { agent } = await loginAs('supply_admin')
  const { doc } = await makeDocument(agent)
  const res = await agent.post(`/api/documents/${doc.id}/lines`).send({
    line: { qty: nos.length, unitCostCentavos: 100000, description: 'x', dateAcquired: '2026-03-01' },
    item: { itemId: DEFAULT_ITEM.semi }, properties: nos.map((propertyNo) => ({ propertyNo })),
  })
  expect(res.status).toBe(201)
  return agent
}
const next = (agent: ReturnType<typeof agentFor>, q: string) => agent.get(`/api/property-numbers/next?${q}`)

describe('property number suggestion (U-05)', () => {
  it('continues the highest number of the year and type, whatever the month', async () => {
    const agent = await withNumbers(['2026-09ICT-0001', '2026-03ICT-0187', '2026-09ICT-202'])
    const res = await next(agent, 'typeId=1&dateAcquired=2026-10-01')
    expect(res.status).toBe(200)
    expect(res.body.suggestions).toEqual(['2026-10ICT-0203'])
  })
  it('count = 3 gives three consecutive numbers', async () => {
    const agent = await withNumbers(['2026-03ICT-0202'])
    expect((await next(agent, 'typeId=1&dateAcquired=2026-10-01&count=3')).body.suggestions)
      .toEqual(['2026-10ICT-0203', '2026-10ICT-0204', '2026-10ICT-0205'])
  })
  it('a different year starts again at 0001; a different type has its own counter', async () => {
    const agent = await withNumbers(['2026-03ICT-0202', '2026-03OE-0007'])
    expect((await next(agent, 'typeId=1&dateAcquired=2027-01-05')).body.suggestions).toEqual(['2027-01ICT-0001'])
    expect((await next(agent, 'typeId=3&dateAcquired=2026-04-05')).body.suggestions).toEqual(['2026-04OE-0008'])
    expect((await next(agent, 'typeId=2&dateAcquired=2026-04-05')).body.suggestions).toEqual(['2026-04FF-0001'])
  })
  it('component letters do not count as a new number; legacy numbers are ignored', async () => {
    const agent = await withNumbers(['2026-03ICT-0010', '2026-03ICT-0010a', '1998-05-140-TSE000-RSTL15'])
    expect((await next(agent, 'typeId=1&dateAcquired=2026-03-05')).body.suggestions).toEqual(['2026-03ICT-0011'])
  })
  it('a voided number is never reused', async () => {
    const agent = await withNumbers(['2026-03ICT-0010', '2026-03ICT-0011'])
    await testPool.query(`UPDATE properties SET voided_at = now() WHERE property_no = '2026-03ICT-0011'`)
    expect((await next(agent, 'typeId=1&dateAcquired=2026-03-05')).body.suggestions).toEqual(['2026-03ICT-0012'])
  })
  it('bad input -> 400, unknown type -> 404, anonymous -> 401', async () => {
    const { agent } = await loginAs('supply_admin')
    expect((await next(agent, 'typeId=1&dateAcquired=2026-13-01')).status).toBe(400)
    expect((await next(agent, 'typeId=1&dateAcquired=2026-03-01&count=301')).status).toBe(400)
    expect((await next(agent, 'typeId=99&dateAcquired=2026-03-01')).status).toBe(404)
    expect((await next(agentFor(), 'typeId=1&dateAcquired=2026-03-01')).status).toBe(401)
  })
})
