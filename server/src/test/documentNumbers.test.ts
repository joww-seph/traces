import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { resetDb, testPool } from './db.js'
import { agentFor, loginAs, makeDocument } from './helpers.js'

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

const next = (agent: ReturnType<typeof agentFor>, q: string) => agent.get(`/api/document-numbers/next?${q}`)

async function withDocs(docs: { type: 'ICS' | 'PAR'; docNo: string }[]) {
  const { agent } = await loginAs('supply_admin')
  for (const d of docs) await makeDocument(agent, d)
  return agent
}

describe('ICS/PAR number suggestion: YYYY-MM{UNIT}-NNN, one counter per year + unit + form type', () => {
  it('starts at 001 when the unit has none this year', async () => {
    const { agent } = await loginAs('supply_admin')
    const res = await next(agent, 'issuedDate=2026-11-15&unit=SARAi')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ icsNo: '2026-11SARAi-001', parNos: ['2026-11SARAi-001'] })
  })
  it('continues the unit’s highest number of the year, whatever the month; other units and the other form type are ignored', async () => {
    const agent = await withDocs([
      { type: 'ICS', docNo: '2026-03SARAi-005' }, { type: 'ICS', docNo: '2026-09SARAi-012' }, { type: 'ICS', docNo: '2026-09IT-040' },
      { type: 'ICS', docNo: '2026-09SARAi-012a' }, { type: 'PAR', docNo: '2026-05SARAi-001' }, { type: 'PAR', docNo: '2025-12SARAi-099' },
    ])
    expect((await next(agent, 'issuedDate=2026-11-15&unit=SARAi')).body).toEqual({ icsNo: '2026-11SARAi-013', parNos: ['2026-11SARAi-002'] })
    expect((await next(agent, 'issuedDate=2026-11-15&unit=IT')).body).toEqual({ icsNo: '2026-11IT-041', parNos: ['2026-11IT-001'] })
  })
  it('one PAR per PPE unit: parCount numbers in a row', async () => {
    const agent = await withDocs([{ type: 'PAR', docNo: '2026-05ADM-004' }])
    expect((await next(agent, 'issuedDate=2026-11-15&unit=ADM&parCount=3')).body.parNos).toEqual(['2026-11ADM-005', '2026-11ADM-006', '2026-11ADM-007'])
    expect((await next(agent, 'issuedDate=2026-11-15&unit=ADM&parCount=0')).body.parNos).toEqual([])
  })
  it('a new year starts again', async () => {
    const agent = await withDocs([{ type: 'ICS', docNo: '2026-09SARAi-012' }])
    expect((await next(agent, 'issuedDate=2027-01-05&unit=SARAi')).body.icsNo).toBe('2027-01SARAi-001')
  })
  it('a deleted form keeps its number used', async () => {
    const { agent } = await loginAs('supply_admin')
    const { doc } = await makeDocument(agent, { docNo: '2026-03SARAi-020' })
    expect((await agent.delete(`/api/documents/${doc.id}`)).status).toBe(200)
    expect((await next(agent, 'issuedDate=2026-04-01&unit=SARAi')).body.icsNo).toBe('2026-04SARAi-021')
  })
  it('bad date or unit -> 400, anonymous -> 401', async () => {
    const { agent } = await loginAs('supply_admin')
    expect((await next(agent, 'issuedDate=2026-13-01&unit=SARAi')).status).toBe(400)
    expect((await next(agent, 'issuedDate=2026-11-15')).status).toBe(400)
    expect((await next(agent, 'issuedDate=2026-11-15&unit=SA.*')).status).toBe(400)
    expect((await next(agentFor(), 'issuedDate=2026-11-15&unit=SARAi')).status).toBe(401)
  })
})

describe('units (the IT officer keeps the list)', () => {
  it('superadmin adds and renames or deactivates a unit; both roles read the list; the code is checked and unique', async () => {
    const { agent: it_ } = await loginAs('superadmin')
    const add = await it_.post('/api/units').send({ code: 'SARAi', name: 'SARAi project' })
    expect(add.status).toBe(201)
    expect((await it_.post('/api/units').send({ code: 'sarai', name: 'Again' })).status).toBe(409)
    expect((await it_.post('/api/units').send({ code: 'SA RAi', name: 'Bad' })).status).toBe(400)
    expect((await it_.patch('/api/units/SARAi').send({ active: false })).body.active).toBe(false)
    const { agent } = await loginAs('supply_admin')
    expect((await agent.get('/api/units')).body).toEqual([{ code: 'SARAi', name: 'SARAi project', active: false }])
    expect((await agent.post('/api/units').send({ code: 'IT', name: 'IT' })).status).toBe(403)
    expect((await agent.patch('/api/units/SARAi').send({ active: true })).status).toBe(403)
    const log = await testPool.query(`SELECT action FROM audit_logs WHERE entity = 'units' ORDER BY id`)
    expect(log.rows.map((r) => r.action)).toEqual(['unit.create', 'unit.update'])
  })
})
