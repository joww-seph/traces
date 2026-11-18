import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { resetDb, testPool } from './db.js'
import { agentFor, loginAs } from './helpers.js'

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

describe('property types', () => {
  it('lists the seeded types; the IT officer can create and patch', async () => {
    const { agent } = await loginAs('superadmin')
    const list = await agent.get('/api/property-types')
    expect(list.status).toBe(200)
    expect(list.body.map((t: { code: string }) => t.code)).toEqual(['FF', 'ICT', 'OE'])
    const created = await agent.post('/api/property-types').send({ code: 'MV', name: 'Motor Vehicles' })
    expect(created.status).toBe(201)
    const patched = await agent.patch(`/api/property-types/${created.body.id}`).send({ name: 'Motor Vehicles and Equipment', active: false })
    expect(patched.body).toMatchObject({ name: 'Motor Vehicles and Equipment', active: false })
    const actions = (await testPool.query(`SELECT action FROM audit_logs WHERE entity='property_types' ORDER BY id`)).rows
    expect(actions.map((r) => r.action)).toEqual(['property_type.create', 'property_type.update'])
  })
  it('rejects a bad code (400) and a duplicate code (409)', async () => {
    const { agent } = await loginAs('superadmin')
    expect((await agent.post('/api/property-types').send({ code: 'ict1', name: 'x' })).status).toBe(400)
    expect((await agent.post('/api/property-types').send({ code: 'ICT', name: 'Another' })).status).toBe(409)
  })
  it('anonymous -> 401', async () => {
    expect((await agentFor().get('/api/property-types')).status).toBe(401)
  })
})
