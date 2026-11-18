import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { resetDb, testPool } from './db.js'
import { loginAs, ORIGIN, makeOfficer } from './helpers.js'

// the made-up people of these tests; their short names are made from these names (MSantos, JDelaCruz, ...)
const FULL_NAME: Record<string, string> = { JDelaCruz: 'Juan Dela Cruz', MSantos: 'Maria Santos', Staffer: 'Sam Staffer', Iss: 'Ivan Issuer', Rcv: 'Rita Receiver' }

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

const ID = '00000000-0000-4000-8000-0000000000a1'
type R = readonly [method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string]

// Every route added by updates 01 and 02 (and the ones they changed): signed-in only, and mutating ones need an allowed Origin.
const READ: R[] = [
  ['get', '/api/property-types'], ['get', '/api/property-numbers/next?typeId=1&dateAcquired=2026-01-01'],
  ['get', '/api/views/cards'], ['get', `/api/views/card/${ID}`], ['get', '/api/views/registry?category=semi'],
  ['get', `/api/reports/rpc?officerId=${ID}&category=ppe`], ['get', '/api/report-signatories'], ['get', `/api/exports/spc?cardId=${ID}`],
  ['get', `/api/documents/${ID}/pdf`], ['get', `/api/documents/${ID}/pdf?kind=generated`],
  ['get', `/api/documents/${ID}/history`], ['get', `/api/reports/forms?officerId=${ID}`], ['get', `/api/reports/forms.pdf?officerId=${ID}`],
]
const WRITE: R[] = [
  ['post', '/api/issuances'], ['patch', '/api/views/card-rows/1'], ['post', '/api/property-types'], ['patch', '/api/property-types/1'],
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
    const mk = async (shortName: string, canReceive: boolean) => makeOfficer({ fullName: FULL_NAME[shortName] ?? shortName, position: 'Clerk', canReceive })
    const issuer = await mk('Iss', false)
    const receiver = await mk('Rcv', true)
    const out = await agent.post('/api/issuances').send({
      header: { receivedByOfficerId: receiver.id, issuedByOfficerId: issuer.id, issuedDate: '2026-03-01', fundCluster: 'RAF', icsNo: 'SEC-1' },
      rows: [{ line: { propertyTypeId: 1, article: 'Article', unit: 'unit', qty: 1, unitCostCentavos: 100000, description: 'x', dateAcquired: '2026-02-01' }, properties: [{ propertyNo: 'SEC-0001' }] }],
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

// Least privilege: the IT officer keeps accounts, settings and the lists, but does not touch the records (as a supply admin does not touch accounts).
const RECORDS: R[] = [
  ['get', '/api/dashboard'], ['get', '/api/documents'], ['post', '/api/documents'], ['get', `/api/documents/${ID}`], ['patch', `/api/documents/${ID}`],
  ['post', `/api/documents/${ID}/generate`], ['put', `/api/documents/${ID}/pdf`], ['delete', `/api/documents/${ID}/pdf`], ['delete', `/api/documents/${ID}`],
  ['get', `/api/documents/${ID}/pdf`], ['get', `/api/exports/spc?cardId=${ID}`], ['post', '/api/issuances'],
  ['get', `/api/documents/${ID}/history`], ['get', `/api/reports/forms?officerId=${ID}`], ['get', `/api/reports/forms.pdf?officerId=${ID}`],
  ['patch', '/api/views/card-rows/1'],
  ['post', `/api/documents/${ID}/lines`], ['post', `/api/documents/${ID}/lines/batch`], ['get', `/api/lines/${ID}`], ['patch', `/api/lines/${ID}`],
  ['put', `/api/lines/${ID}/region`], ['delete', `/api/lines/${ID}`],
  ['get', '/api/properties/X-1/view'], ['post', '/api/properties/X-1/qr/rotate'], ['get', '/api/properties/X-1'], ['patch', '/api/properties/X-1'],
  ['get', '/api/property-numbers/next?typeId=1&dateAcquired=2026-01-01'], ['get', '/api/document-numbers/next?issuedDate=2026-01-01&unit=ADM'],
  ['get', '/api/stickers'], ['get', '/api/views/registry?category=semi'], ['get', '/api/views/cards'], ['get', `/api/views/card/${ID}`],
  ['get', `/api/reports/rpc?officerId=${ID}&category=ppe`], ['get', '/api/report-signatories'], ['put', '/api/report-signatories'],
]

describe('the IT officer has no access to the records', () => {
  it.each(RECORDS)('%s %s -> 403 for the superadmin', async (method, path) => {
    const { agent } = await loginAs('superadmin')
    expect((await agent[method](path).send({})).status).toBe(403)
  })
  it('the supply admin still opens them; the IT officer still reads the lists it keeps', async () => {
    const { agent } = await loginAs('supply_admin')
    for (const path of ['/api/dashboard', '/api/documents', '/api/views/cards', '/api/report-signatories']) expect((await agent.get(path)).status, path).toBe(200)
    const { agent: it_ } = await loginAs('superadmin')
    for (const path of ['/api/officers', '/api/property-types', '/api/units', '/api/settings']) expect((await it_.get(path)).status, path).toBe(200)
  })
})
