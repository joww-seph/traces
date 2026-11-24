import { rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, ITEM, loginAs, makeDocument, makeOfficer, makeUser, PASSWORD } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

type Prop = { propertyNo: string; componentLabel?: string }
const token = async (no: string) =>
  (await testPool.query(`SELECT t.token FROM qr_tokens t JOIN properties p ON p.id=t.property_id WHERE p.property_no=$1 AND t.revoked_at IS NULL`, [no])).rows[0].token.trim() as string
const condition = async (no: string) => (await testPool.query(`SELECT condition FROM properties WHERE property_no=$1`, [no])).rows[0].condition as string

async function seed() {
  const { agent } = await loginAs('supply_admin')
  const { doc, receiver } = await makeDocument(agent)
  const add = (cost: number, properties: Prop[], description = 'Description') =>
    agent.post(`/api/documents/${doc.id}/lines`).send({ line: { ...ITEM, qty: properties.filter((p) => !p.componentLabel).length, unitCostCentavos: cost, description, dateAcquired: '2026-02-01' }, properties })
  await add(4870000, [{ propertyNo: 'S-1' }, { propertyNo: 'S-2' }], 'Chair')
  await add(9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }], 'Laptop')
  const start = async (over: object = {}) =>
    agent.post('/api/counts').send({ officerId: receiver.id, category: 'semi', asAt: '2026-06-30', ...over })
  return { agent, doc, receiver, start }
}

describe('physical count', () => {
  it('starting a count is idempotent for officer + category + as-at and reports progress', async () => {
    const { start } = await seed()
    const a = await start()
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ category: 'semi', asAt: '2026-06-30', total: 2, counted: 0, unserviceable: 0, closedAt: null })
    const b = await start()
    expect(b.body.id).toBe(a.body.id)
    expect((await start({ asAt: '2026-07-31' })).body.id).not.toBe(a.body.id)
  })

  it('a serviceable scan marks the unit counted and keeps it on the report; the report shows counted per row', async () => {
    const { agent, receiver, start } = await seed()
    const c = (await start()).body
    const res = await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('S-1'), condition: 'serviceable' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ propertyNo: 'S-1', condition: 'serviceable', counted: 1, total: 2 })
    expect(await condition('S-1')).toBe('serviceable')
    const rpc = (await agent.get(`/api/reports/rpc?officerId=${receiver.id}&category=semi&asAt=2026-06-30&countId=${c.id}`)).body
    expect(rpc.rows).toHaveLength(1)
    expect(rpc.rows[0]).toMatchObject({ balancePerCard: 2, countedUnits: 1, counted: false })
    await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('S-2'), condition: 'serviceable' })
    const done = (await agent.get(`/api/reports/rpc?officerId=${receiver.id}&category=semi&asAt=2026-06-30&countId=${c.id}`)).body
    expect(done.rows[0]).toMatchObject({ countedUnits: 2, counted: true })
  })

  it('without a count the report stays blank for hand count: no counted fields', async () => {
    const { agent, receiver } = await seed()
    const rpc = (await agent.get(`/api/reports/rpc?officerId=${receiver.id}&category=semi&asAt=2026-06-30`)).body
    expect(rpc.rows[0].counted).toBeNull()
    expect(rpc.rows[0].countedUnits).toBeNull()
  })

  it('an unserviceable scan counts the unit, leaves it off the report and puts it on the IIRUSP', async () => {
    const { agent, receiver, start } = await seed()
    const c = (await start()).body
    const res = await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('S-1'), condition: 'unserviceable' })
    expect(res.body).toMatchObject({ condition: 'unserviceable', counted: 1, total: 2, unserviceable: 1 })
    expect(await condition('S-1')).toBe('unserviceable')
    const rpc = (await agent.get(`/api/reports/rpc?officerId=${receiver.id}&category=semi&asAt=2026-06-30&countId=${c.id}`)).body
    expect(rpc.rows.map((r: { propertyNos: string[] }) => r.propertyNos)).toEqual([['S-2']])
    const iirusp = (await agent.get(`/api/reports/unserviceable?officerId=${receiver.id}&category=semi&asAt=2026-06-30`)).body
    expect(iirusp.rows).toHaveLength(1)
    expect(iirusp.rows[0]).toMatchObject({ propertyNos: ['S-1'], unitValueCentavos: 4870000, qty: 1, totalCostCentavos: 4870000 })
    expect((await agent.get(`/api/reports/unserviceable?officerId=${receiver.id}&category=ppe&asAt=2026-06-30`)).body.rows).toEqual([])
  })

  it('scanning again with the other condition changes it (a mis-tap is fixed by scanning again)', async () => {
    const { agent, start } = await seed()
    const c = (await start()).body
    const t = await token('S-1')
    await agent.post(`/api/counts/${c.id}/scans`).send({ token: t, condition: 'unserviceable' })
    const back = await agent.post(`/api/counts/${c.id}/scans`).send({ token: t, condition: 'serviceable' })
    expect(back.body).toMatchObject({ condition: 'serviceable', counted: 1, unserviceable: 0 })
    expect(await condition('S-1')).toBe('serviceable')
  })

  it('a component cannot be counted; its unit is', async () => {
    const { agent, receiver, start } = await seed()
    const c = (await start({ category: 'ppe' })).body
    const res = await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('L-1a'), condition: 'serviceable' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('COUNT_COMPONENT')
    expect(res.body.error.details).toMatchObject({ mainPropertyNo: 'L-1' })
    const ok = await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('L-1'), condition: 'unserviceable' })
    expect(ok.status).toBe(200)
    expect(await condition('L-1a')).toBe('unserviceable')
    void receiver
  })

  it('an item that another officer holds is refused with who holds it', async () => {
    const { agent, start } = await seed()
    const other = await makeOfficer({ fullName: 'Pedro Penduko', position: 'Clerk', canReceive: true })
    const c = (await start({ officerId: other.id })).body
    const res = await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('S-1'), condition: 'serviceable' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_HOLDER')
    expect(res.body.error.details.holder).toBe('Maria Santos')
  })

  it('an item of the other category is refused', async () => {
    const { agent, start } = await seed()
    const c = (await start()).body
    const res = await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('L-1'), condition: 'serviceable' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('WRONG_CATEGORY')
  })

  it('a closed count takes no more scans and cannot be reopened', async () => {
    const { agent, start } = await seed()
    const c = (await start()).body
    expect((await agent.post(`/api/counts/${c.id}/close`)).body.closedAt).toBeTruthy()
    const res = await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('S-1'), condition: 'serviceable' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('COUNT_CLOSED')
    expect((await start()).body.closedAt).toBeTruthy()
  })

  it('an unknown or replaced token is refused; a scan can be removed', async () => {
    const { agent, start } = await seed()
    const c = (await start()).body
    expect((await agent.post(`/api/counts/${c.id}/scans`).send({ token: 'zzzzzzzzzz', condition: 'serviceable' })).status).toBe(404)
    await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('S-1'), condition: 'serviceable' })
    const pid = (await testPool.query(`SELECT id FROM properties WHERE property_no='S-1'`)).rows[0].id
    const del = await agent.delete(`/api/counts/${c.id}/scans/${pid}`)
    expect(del.status).toBe(200)
    expect(del.body.counted).toBe(0)
  })

  it('every scan writes an audit row; the count and its scans are staff-only', async () => {
    const { agent, start } = await seed()
    const c = (await start()).body
    await agent.post(`/api/counts/${c.id}/scans`).send({ token: await token('S-1'), condition: 'unserviceable' })
    const rows = (await testPool.query(`SELECT action FROM audit_logs WHERE action LIKE 'count.%' ORDER BY id`)).rows.map((r) => r.action)
    expect(rows).toEqual(['count.start', 'count.scan'])

    const anon = agentFor()
    expect((await anon.get('/api/counts')).status).toBe(401)
    expect((await anon.post(`/api/counts/${c.id}/scans`).send({ token: 'abcdefghij', condition: 'serviceable' })).status).toBe(401)
    const it = await makeUser('superadmin')
    const itAgent = agentFor()
    await itAgent.post('/api/auth/login').send({ email: it.email, password: PASSWORD })
    expect((await itAgent.get('/api/counts')).status).toBe(403)
  })
})
