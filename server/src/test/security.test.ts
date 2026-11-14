import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { resetDb, testPool } from './db.js'
import { loginAs, ORIGIN } from './helpers.js'

// the made-up people of these tests; their short names are made from these names (MSantos, JDelaCruz, ...)
const FULL_NAME: Record<string, string> = { JDelaCruz: 'Juan Dela Cruz', MSantos: 'Maria Santos', Staffer: 'Sam Staffer', Iss: 'Ivan Issuer', Rcv: 'Rita Receiver' }

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

const ID = '00000000-0000-4000-8000-0000000000a1'
type R = readonly [method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string]

// Every route added by updates 01 and 02 (and the ones they changed): signed-in only, and mutating ones need an allowed Origin.
const READ: R[] = [
  ['get', '/api/items'], ['get', '/api/property-types'], ['get', '/api/property-numbers/next?typeId=1&dateAcquired=2026-01-01'],
  ['get', '/api/views/cards'], ['get', `/api/views/card/${ID}`], ['get', '/api/views/registry?category=semi'],
  ['get', `/api/reports/rpc?officerId=${ID}&category=ppe`], ['get', '/api/report-signatories'], ['get', `/api/exports/spc?itemId=${ID}`],
  ['get', `/api/documents/${ID}/pdf`], ['get', `/api/documents/${ID}/pdf?kind=generated`],
]
const WRITE: R[] = [
  ['post', '/api/issuances'], ['post', '/api/items'], ['patch', `/api/items/${ID}`], ['post', '/api/property-types'], ['patch', '/api/property-types/1'],
  ['post', `/api/documents/${ID}/generate`], ['put', `/api/documents/${ID}/pdf`], ['delete', `/api/documents/${ID}/pdf`],
  ['post', `/api/documents/${ID}/lines/batch`], ['put', `/api/lines/${ID}/region`], ['put', '/api/report-signatories'],
]

describe('the new routes are closed to visitors', () => {
  it.each(READ)('%s %s -> 401 without a session', async (method, path) => {
    expect((await request(createApp())[method](path)).status).toBe(401)
  })
  it.each(WRITE)('%s %s -> 401 without a session (even with a good Origin)', async (method, path) => {
    expect((await request(createApp())[method](path).set('Origin', ORIGIN).send({})).status).toBe(401)
  })
})

describe('mutating routes check the Origin (CSRF)', () => {
  it.each(WRITE)('%s %s -> 403 from a foreign Origin, even signed in', async (method, path) => {
    const { agent } = await loginAs('supply_admin')
    expect((await agent[method](path).set('Origin', 'http://evil.example').send({})).status).toBe(403)
  })
  it.each(WRITE)('%s %s -> 403 without an Origin', async (method, path) => {
    expect((await request(createApp())[method](path).send({})).status).toBe(403) // the Origin check runs before sign-in is looked at
  })
})

describe('the old count routes are gone', () => {
  it.each(['/api/counts', `/api/counts/${ID}`] as const)('%s -> 404', async (path) => {
    const { agent } = await loginAs('superadmin')
    expect((await agent.get(path)).status).toBe(404)
  })
})

describe('the public view never carries staff data', () => {
  it('no uuid, no user, no stored file name anywhere in a public response', async () => {
    const { agent } = await loginAs('supply_admin')
    const mk = async (shortName: string, canReceive: boolean) => (await agent.post('/api/officers').send({ fullName: FULL_NAME[shortName] ?? shortName, position: 'Clerk', canReceive })).body
    const issuer = await mk('Iss', false)
    const receiver = await mk('Rcv', true)
    const out = await agent.post('/api/issuances').send({
      header: { receivedByOfficerId: receiver.id, issuedByOfficerId: issuer.id, issuedDate: '2026-03-01', fundCluster: 'RAF', icsNo: 'SEC-1' },
      rows: [{ line: { qty: 1, unitCostCentavos: 100000, description: 'x', dateAcquired: '2026-02-01' }, item: { itemId: '00000000-0000-4000-8000-0000000000a1' }, properties: [{ propertyNo: 'SEC-0001' }] }],
      generate: true,
    })
    expect(out.status).toBe(201)
    const token = (await testPool.query(`SELECT t.token FROM qr_tokens t JOIN properties p ON p.id=t.property_id WHERE p.property_no='SEC-0001'`)).rows[0].token.trim()
    const res = await request(createApp()).get(`/api/public/q/${token}`)
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    for (const banned of ['storedName', 'stored_name', 'createdBy', 'passwordHash', 'email', 'itemId']) expect(text).not.toContain(banned)
    expect(res.body.document.pdfUrl).toMatch(/^\/api\/public\/q\/[0-9A-Za-z]{10}\/pdf$/)
    // and the generated PDF behind it is served only through the token route
    const pdf = await request(createApp()).get(`/api/public/q/${token}/pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
  })
})
