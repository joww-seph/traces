import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs } from './helpers.js'

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

const officer = { fullName: 'Dana P. Libunao', shortName: 'DPLibunao', position: 'Supply Officer III', office: 'Supply Unit' }

describe('officers', () => {
  it('create, list, patch and deactivate', async () => {
    const { agent } = await loginAs('supply_admin')
    const created = await agent.post('/api/officers').send(officer)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ shortName: 'DPLibunao', active: true })

    expect((await agent.get('/api/officers')).body).toHaveLength(1)

    const patched = await agent.patch(`/api/officers/${created.body.id}`).send({ position: 'Supply Officer IV' })
    expect(patched.status).toBe(200)
    expect(patched.body.position).toBe('Supply Officer IV')

    expect((await agent.delete(`/api/officers/${created.body.id}`)).status).toBe(200)
    expect((await agent.get('/api/officers?active=true')).body).toHaveLength(0)
    expect((await agent.get('/api/officers?active=false')).body).toHaveLength(1)
    expect((await agent.get('/api/officers')).body).toHaveLength(1) // no filter = all

    const actions = (await testPool.query(`SELECT action FROM audit_logs WHERE entity='officers' ORDER BY id`)).rows
    expect(actions.map((r) => r.action)).toEqual(['officer.create', 'officer.update', 'officer.deactivate'])
  })

  it('duplicate short_name in a different case -> 409', async () => {
    const { agent } = await loginAs('supply_admin')
    await agent.post('/api/officers').send(officer)
    const dup = await agent.post('/api/officers').send({ ...officer, fullName: 'Someone Else', shortName: 'dplibunao' })
    expect(dup.status).toBe(409)
  })

  it('invalid body -> 400; unknown id -> 404; anonymous -> 401', async () => {
    const { agent } = await loginAs('supply_admin')
    expect((await agent.post('/api/officers').send({ fullName: '' })).status).toBe(400)
    expect((await agent.patch('/api/officers/00000000-0000-4000-8000-000000000000').send({ office: 'x' })).status).toBe(404)
    expect((await agent.patch('/api/officers/not-a-uuid').send({ office: 'x' })).status).toBe(400)
    expect((await agentFor().get('/api/officers')).status).toBe(401)
  })
})

describe('settings', () => {
  it('GET /api/settings is readable by supply_admin', async () => {
    const { agent } = await loginAs('supply_admin')
    const res = await agent.get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ppeThresholdCentavos: 5000000, cardRowMode: 'merged', defaultFundCluster: 'RAF' })
  })

  it('supply_admin cannot PATCH /api/admin/settings -> 403', async () => {
    const { agent } = await loginAs('supply_admin')
    expect((await agent.patch('/api/admin/settings').send({ ppeThresholdCentavos: 1 })).status).toBe(403)
  })

  it('superadmin PATCH updates the row, clears the cache and audits', async () => {
    const { agent, user } = await loginAs('superadmin')
    expect((await agent.get('/api/settings')).body.cardRowMode).toBe('merged') // primes the cache
    const res = await agent.patch('/api/admin/settings').send({ cardRowMode: 'split', ppeThresholdCentavos: 6000000 })
    expect(res.status).toBe(200)
    const after = await agent.get('/api/settings')
    expect(after.body).toMatchObject({ cardRowMode: 'split', ppeThresholdCentavos: 6000000 })
    expect((await testPool.query('SELECT updated_by FROM settings')).rows[0].updated_by).toBe(user.id)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='settings.update'`)).rowCount).toBe(1)
    expect((await agent.patch('/api/admin/settings').send({ ppeThresholdCentavos: 0 })).status).toBe(400)
  })
})
