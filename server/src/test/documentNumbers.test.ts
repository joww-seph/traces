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

describe('ICS/PAR number suggestion (office style: ICS YYYY-MM-NNN, PAR YYYY-RO-NN)', () => {
  it('starts at 001 and 01 when the year has none', async () => {
    const { agent } = await loginAs('supply_admin')
    const res = await next(agent, 'issuedDate=2026-11-15')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ icsNo: '2026-11-001', parNo: '2026-RO-01' })
  })
  it('continues the highest number of the year, whatever the month; other styles and types are ignored', async () => {
    const agent = await withDocs([
      { type: 'ICS', docNo: '2026-03-007' }, { type: 'ICS', docNo: '2026-09-012' }, { type: 'ICS', docNo: '2026-03SARAi-005' },
      { type: 'ICS', docNo: '2026-RO-90' }, { type: 'PAR', docNo: '2026-RO-68' }, { type: 'PAR', docNo: '2025-RO-99' },
    ])
    expect((await next(agent, 'issuedDate=2026-11-15')).body).toEqual({ icsNo: '2026-11-013', parNo: '2026-RO-69' })
  })
  it('a new year starts again', async () => {
    const agent = await withDocs([{ type: 'ICS', docNo: '2026-09-012' }, { type: 'PAR', docNo: '2026-RO-68' }])
    expect((await next(agent, 'issuedDate=2027-01-05')).body).toEqual({ icsNo: '2027-01-001', parNo: '2027-RO-01' })
  })
  it('a deleted form keeps its number used', async () => {
    const { agent } = await loginAs('supply_admin')
    const { doc } = await makeDocument(agent, { docNo: '2026-03-020' })
    expect((await agent.delete(`/api/documents/${doc.id}`)).status).toBe(200)
    expect((await next(agent, 'issuedDate=2026-04-01')).body.icsNo).toBe('2026-04-021')
  })
  it('bad date -> 400, anonymous -> 401', async () => {
    const { agent } = await loginAs('supply_admin')
    expect((await next(agent, 'issuedDate=2026-13-01')).status).toBe(400)
    expect((await next(agentFor(), 'issuedDate=2026-11-15')).status).toBe(401)
  })
})
