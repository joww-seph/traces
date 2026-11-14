import { rmSync } from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { itemFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

async function seed() {
  const { agent } = await loginAs('supply_admin')
  const { doc } = await makeDocument(agent)
  const made = await agent.post(`/api/documents/${doc.id}/lines`).send({
    line: { qty: 1, unitCostCentavos: 9645000, description: 'Laptop set', estUsefulLifeYears: 5, dateAcquired: '2026-02-01' },
    item: itemFor(9645000),
    region: { page: 1, x: 0.1, y: 0.2, w: 0.8, h: 0.05 },
    properties: [{ propertyNo: 'L-1', serialNo: 'SN-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }],
  })
  const token = async (no: string) =>
    (await testPool.query(`SELECT t.token FROM qr_tokens t JOIN properties p ON p.id=t.property_id WHERE p.property_no=$1 AND t.revoked_at IS NULL`, [no])).rows[0].token.trim() as string
  return { agent, doc, lineId: made.body.lineId as string, token }
}

const anon = () => request(createApp())

describe('GET /api/public/q/:token', () => {
  it('opens the property without a login; no UUID, no user data, noindex', async () => {
    const { token } = await seed()
    const res = await anon().get(`/api/public/q/${await token('L-1')}`)
    expect(res.status).toBe(200)
    expect(res.headers['x-robots-tag']).toBe('noindex')
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(UUID)
    for (const banned of ['createdBy', 'email', 'passwordHash', 'userId', 'actor']) expect(text).not.toContain(banned)
    expect(res.body.property).toMatchObject({ propertyNo: 'L-1', serialNo: 'SN-1', category: 'ppe' })
    expect(res.body.property).not.toHaveProperty('token')
    expect(res.body.document.pdfUrl).toMatch(/^\/api\/public\/q\/[0-9A-Za-z]{10}\/pdf$/)
    expect(res.body.document.pdfRegion).toMatchObject({ page: 1, x: 0.1 })
  })

  it('every tab highlights a row present in that tab, with opaque row ids', async () => {
    const { token } = await seed()
    const t = (await anon().get(`/api/public/q/${await token('L-1a')}`)).body.tabs
    for (const tab of ['icsPar', 'registry', 'report'] as const) {
      expect(t[tab].rows.map((r: { id: string }) => r.id), tab).toContain(t[tab].highlightRowId)
      expect(t[tab].highlightRowId).toMatch(/^[lgr]\d+$/)
    }
    expect(t.card.highlightRowIds.length).toBeGreaterThan(0)
    for (const id of t.card.highlightRowIds) {
      expect(t.card.rows.map((r: { id: string }) => r.id)).toContain(id)
      expect(id).toMatch(/^c\d+$/)
    }
  })

  it('registry is limited to the same document', async () => {
    const { agent, token } = await seed()
    const other = await makeDocument(agent, { type: 'PAR', docNo: '2025-RO-68', issuedDate: '2025-05-31' })
    await agent.post(`/api/documents/${other.doc.id}/lines`).send({
      line: { qty: 1, unitCostCentavos: 9200000, description: 'Fume hood', dateAcquired: '2025-01-01' }, item: itemFor(9200000), properties: [{ propertyNo: 'P-1' }],
    })
    const reg = (await anon().get(`/api/public/q/${await token('L-1')}`)).body.tabs.registry
    expect(reg.rows).toHaveLength(1)
    expect(reg.rows[0].propertyNos).toEqual(['L-1', 'L-1a'])
  })

  it('a malformed token -> 404; an unknown well-formed token -> 404', async () => {
    await seed()
    expect((await anon().get('/api/public/q/short')).status).toBe(404)
    expect((await anon().get('/api/public/q/has-dashes!')).status).toBe(404)
    expect((await anon().get('/api/public/q/AAAAAAAAAA')).status).toBe(404)
  })

  it('a replaced (revoked) token -> 410 QR_REPLACED', async () => {
    const { token } = await seed()
    const t = await token('L-1')
    await testPool.query(`UPDATE qr_tokens SET revoked_at = now() WHERE token = $1`, [t])
    const res = await anon().get(`/api/public/q/${t}`)
    expect(res.status).toBe(410)
    expect(res.body.error.code).toBe('QR_REPLACED')
    expect((await anon().get(`/api/public/q/${t}/pdf`)).status).toBe(410)
  })

  it('a removed property, line or document -> 410 ITEM_REMOVED', async () => {
    const { agent, token, lineId, doc } = await seed()
    const a = await token('L-1')
    const b = await token('L-1a')
    await agent.patch(`/api/lines/${lineId}`).send({ removePropertyNos: ['L-1a'] }) // voids the property and revokes its token
    expect((await anon().get(`/api/public/q/${b}`)).status).toBe(410)
    await agent.delete(`/api/lines/${lineId}`)
    const line = await anon().get(`/api/public/q/${a}`)
    expect(line.status).toBe(410)
    expect(line.body.error.code).toBe('ITEM_REMOVED')
    // document removal on a fresh item
    const second = await agent.post(`/api/documents/${doc.id}/lines`).send({
      line: { qty: 1, unitCostCentavos: 100000, description: 'Y', dateAcquired: '2026-02-01' }, item: itemFor(100000), properties: [{ propertyNo: 'X-1' }],
    })
    expect(second.status).toBe(201)
    const c = await token('X-1')
    await agent.delete(`/api/documents/${doc.id}`)
    expect((await anon().get(`/api/public/q/${c}`)).body.error.code).toBe('ITEM_REMOVED')
  })
})

describe('GET /api/public/q/:token/pdf', () => {
  it('streams the signed PDF to anyone holding the token', async () => {
    const { token } = await seed()
    const res = await anon().get(`/api/public/q/${await token('L-1')}/pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
    expect(res.headers['x-robots-tag']).toBe('noindex')
  })
})

describe('rate limit', () => {
  it('over the per-minute limit -> 429 (limit lowered for this app)', async () => {
    process.env.PUBLIC_RATE_LIMIT_PER_MIN = '3'
    const app = createApp()
    process.env.PUBLIC_RATE_LIMIT_PER_MIN = '60'
    for (let i = 0; i < 3; i++) expect((await request(app).get('/api/public/q/AAAAAAAAAA')).status).toBe(404)
    const res = await request(app).get('/api/public/q/AAAAAAAAAA')
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('RATE_LIMITED')
  })
})
