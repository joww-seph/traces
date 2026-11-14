import { rmSync } from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

async function seed() {
  const { agent } = await loginAs('supply_admin')
  const { doc } = await makeDocument(agent)
  const line = (await agent.post(`/api/documents/${doc.id}/lines`).send({
    line: { qty: 1, unit: 'set', unitCostCentavos: 9645000, article: 'Laptop', description: 'Laptop set' },
    properties: [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }],
  })).body
  await agent.post(`/api/documents/${doc.id}/lines`).send({
    line: { qty: 1, unit: 'unit', unitCostCentavos: 100000, article: 'Chair', description: 'Chair' }, properties: [{ propertyNo: 'S-1' }],
  })
  const token = async (no: string) =>
    (await testPool.query(`SELECT t.token FROM qr_tokens t JOIN properties p ON p.id=t.property_id WHERE p.property_no=$1 AND t.revoked_at IS NULL`, [no])).rows[0].token.trim() as string
  return { agent, doc, lineId: line.lineId as string, token }
}

describe('POST /api/properties/:no/qr/rotate (BR-11)', () => {
  it('revokes the old token, issues a new one, audits; the old sticker says "replaced"', async () => {
    const { agent, token } = await seed()
    const old = await token('L-1')
    const res = await agent.post('/api/properties/l-1/qr/rotate')
    expect(res.status).toBe(200)
    expect(res.body.token).toMatch(/^[0-9A-Za-z]{10}$/)
    expect(res.body.token).not.toBe(old)
    expect(await token('L-1')).toBe(res.body.token)
    const anon = request(createApp())
    const replaced = await anon.get(`/api/public/q/${old}`)
    expect(replaced.status).toBe(410)
    expect(replaced.body.error.code).toBe('QR_REPLACED')
    expect((await anon.get(`/api/public/q/${res.body.token}`)).status).toBe(200)
    const active = await testPool.query(`SELECT count(*) FROM qr_tokens t JOIN properties p ON p.id=t.property_id WHERE p.property_no='L-1' AND t.revoked_at IS NULL`)
    expect(Number(active.rows[0].count)).toBe(1)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='qr.rotate'`)).rowCount).toBe(1)
  })

  it('rotating twice keeps exactly one active token; unknown/voided -> 404; anonymous -> 401', async () => {
    const { agent, lineId } = await seed()
    await agent.post('/api/properties/L-1/qr/rotate')
    await agent.post('/api/properties/L-1/qr/rotate')
    expect(Number((await testPool.query(`SELECT count(*) FROM qr_tokens WHERE revoked_at IS NULL AND property_id=(SELECT id FROM properties WHERE property_no='L-1')`)).rows[0].count)).toBe(1)
    expect((await agent.post('/api/properties/NOPE-1/qr/rotate')).status).toBe(404)
    await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['L-1a'] })
    expect((await agent.post('/api/properties/L-1a/qr/rotate')).status).toBe(404)
    expect((await agentFor().post('/api/properties/L-1/qr/rotate')).status).toBe(401)
  })
})

describe('GET /api/stickers', () => {
  it('by document: one entry per active property with the public URL built from public_base_url', async () => {
    const { agent, doc, token } = await seed()
    const res = await agent.get(`/api/stickers?documentId=${doc.id}`)
    expect(res.status).toBe(200)
    expect(res.body.map((s: { propertyNo: string }) => s.propertyNo)).toEqual(['L-1', 'L-1a', 'S-1'])
    expect(res.body[0].url).toBe(`http://localhost:5173/q/${await token('L-1')}`)
  })

  it('by numbers (case-insensitive, comma-separated); a rotated token shows up as the new url', async () => {
    const { agent } = await seed()
    const rotated = (await agent.post('/api/properties/S-1/qr/rotate')).body.token
    const res = await agent.get('/api/stickers?nos=s-1,L-1a')
    expect(res.body.map((s: { propertyNo: string; url: string }) => [s.propertyNo, s.url.endsWith(rotated)])).toEqual([['L-1a', false], ['S-1', true]])
  })

  it('leaves out voided properties and deleted lines; needs documentId or nos', async () => {
    const { agent, doc, lineId } = await seed()
    await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['L-1a'] })
    expect((await agent.get(`/api/stickers?documentId=${doc.id}`)).body.map((s: { propertyNo: string }) => s.propertyNo)).toEqual(['L-1', 'S-1'])
    await agent.delete(`/api/lines/${lineId}`)
    expect((await agent.get(`/api/stickers?documentId=${doc.id}`)).body.map((s: { propertyNo: string }) => s.propertyNo)).toEqual(['S-1'])
    expect((await agent.get('/api/stickers')).status).toBe(400)
    expect((await agentFor().get('/api/stickers?nos=S-1')).status).toBe(401)
  })

  it('uses the current public_base_url (trailing slash tolerated)', async () => {
    const { agent } = await seed()
    await testPool.query(`UPDATE settings SET public_base_url='http://192.168.100.211:5173/'`)
    const { clearSettingsCache } = await import('../services/settings.js')
    clearSettingsCache()
    expect((await agent.get('/api/stickers?nos=S-1')).body[0].url).toMatch(/^http:\/\/192\.168\.100\.211:5173\/q\/[0-9A-Za-z]{10}$/)
  })
})
