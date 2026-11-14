import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { resetDb, testPool } from './db.js'
import { agentFor, loginAs } from './helpers.js'

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

const card = { propertyTypeId: 1, category: 'ppe', article: 'Laptop', description: 'Lenovo ThinkPad E14 Gen 5', unit: 'unit' }

describe('property types', () => {
  it('lists the seeded types and both roles can create and patch', async () => {
    const { agent } = await loginAs('supply_admin')
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

describe('items (cards)', () => {
  it('creates a card, lists and searches it', async () => {
    const { agent } = await loginAs('supply_admin')
    const created = await agent.post('/api/items').send(card)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ article: 'Laptop', category: 'ppe', propertyTypeCode: 'ICT' })
    await agent.post('/api/items').send({ ...card, category: 'semi', article: 'Mouse', description: 'Logitech M170' })
    expect((await agent.get('/api/items?q=thinkpad')).body).toHaveLength(1)
    expect((await agent.get('/api/items?q=LAPTOP')).body).toHaveLength(1)
    expect((await agent.get('/api/items?category=semi')).body.map((i: { article: string }) => i.article)).toEqual(['Mouse'])
    expect((await agent.get('/api/items?typeId=2')).body).toHaveLength(0)
  })
  it('a duplicate identity is 409 ITEM_EXISTS carrying the existing itemId', async () => {
    const { agent } = await loginAs('supply_admin')
    const first = await agent.post('/api/items').send(card)
    const dup = await agent.post('/api/items').send({ ...card, article: 'LAPTOP', description: 'lenovo thinkpad e14 gen 5' })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toMatchObject({ code: 'ITEM_EXISTS', details: { itemId: first.body.id } })
  })
  it('patches a card and writes an audit row', async () => {
    const { agent } = await loginAs('supply_admin')
    const c = await agent.post('/api/items').send(card)
    const p = await agent.patch(`/api/items/${c.body.id}`).send({ unit: 'set' })
    expect(p.body.unit).toBe('set')
    expect((await testPool.query(`SELECT action FROM audit_logs WHERE entity='items' ORDER BY id`)).rows.map((r) => r.action))
      .toEqual(['item.create', 'item.update'])
  })
  it('anonymous -> 401; invalid body -> 400', async () => {
    expect((await agentFor().get('/api/items')).status).toBe(401)
    const { agent } = await loginAs('supply_admin')
    expect((await agent.post('/api/items').send({ ...card, description: '' })).status).toBe(400)
    expect((await agent.post('/api/items').send({ ...card, propertyTypeId: 999 })).status).toBe(400)
  })
})
