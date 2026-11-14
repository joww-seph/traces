import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, samplePdf } from './helpers.js'

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

const officer = { fullName: 'Maria Santos', position: 'Supply Officer III', office: 'Supply Unit' }

describe('officers', () => {
  it('create, list, patch and deactivate', async () => {
    const { agent } = await loginAs('supply_admin')
    const created = await agent.post('/api/officers').send(officer)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ shortName: 'MSantos', active: true })

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

  it('the short name is made from the full name, never typed; names in capitals are written with capital initials only', async () => {
    const { agent } = await loginAs('supply_admin')
    const a = await agent.post('/api/officers').send({ ...officer, fullName: 'ANA MARIE B. DELA CRUZ', shortName: 'Typed' })
    expect(a.body).toMatchObject({ fullName: 'Ana Marie B. Dela Cruz', shortName: 'AMBDelaCruz' })
    // the same initials and surname get a number instead of being refused
    expect((await agent.post('/api/officers').send(officer)).body.shortName).toBe('MSantos')
    expect((await agent.post('/api/officers').send({ ...officer, fullName: 'Mario Santos' })).body.shortName).toBe('MSantos2')
    // a corrected name corrects the short name
    const p = await agent.patch(`/api/officers/${a.body.id}`).send({ fullName: 'Ana Maria B. Dela Cruz-Reyes' })
    expect(p.body).toMatchObject({ fullName: 'Ana Maria B. Dela Cruz-Reyes', shortName: 'AMBDelaCruz-Reyes' })
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

describe('accountable officers (update 01 U-06)', () => {
  const mk = (agent: Awaited<ReturnType<typeof loginAs>>['agent'], o: object) => agent.post('/api/officers').send({ ...officer, ...o })

  it('canReceive defaults to false; the list filters by it', async () => {
    const { agent } = await loginAs('supply_admin')
    const a = await mk(agent, { fullName: 'Ana Receiver', canReceive: true })
    const b = await mk(agent, { fullName: 'Ben Staff' })
    expect(a.body.canReceive).toBe(true)
    expect(b.body.canReceive).toBe(false)
    expect((await agent.get('/api/officers?canReceive=true')).body.map((o: { shortName: string }) => o.shortName)).toEqual(['AReceiver'])
    expect((await agent.get('/api/officers?canReceive=false')).body.map((o: { shortName: string }) => o.shortName)).toEqual(['BStaff'])
  })

  it('designations are stored in order, replaced on patch, and searched by q together with the names', async () => {
    const { agent } = await loginAs('supply_admin')
    const a = await mk(agent, { fullName: 'Ana One', designations: ['SARAi CENTRO, Focal Person', 'Records, Custodian'] })
    await mk(agent, { fullName: 'Ben Two', designations: ['SARAi, Coordinator'] })
    await mk(agent, { fullName: 'Cy Three' })
    expect(a.body.designations).toEqual(['SARAi CENTRO, Focal Person', 'Records, Custodian'])
    const found = (await agent.get('/api/officers?q=sarai')).body.map((o: { shortName: string }) => o.shortName)
    expect(found).toEqual(['AOne', 'BTwo'])
    expect((await agent.get('/api/officers?q=cy%20thr')).body).toHaveLength(1)
    expect((await agent.get('/api/officers?q=100%25')).body).toHaveLength(0) // % is literal, not a wildcard
    const patched = await agent.patch(`/api/officers/${a.body.id}`).send({ designations: ['Other'] })
    expect(patched.body.designations).toEqual(['Other'])
    expect((await agent.patch(`/api/officers/${a.body.id}`).send({ position: 'X' })).body.designations).toEqual(['Other']) // untouched when omitted
    expect((await agent.get('/api/officers?q=sarai')).body.map((o: { shortName: string }) => o.shortName)).toEqual(['BTwo'])
  })

  it('a document cannot be received by an officer who may not receive (400 OFFICER_CANNOT_RECEIVE)', async () => {
    const { agent } = await loginAs('supply_admin')
    const issuer = await mk(agent, { fullName: 'Issuer One', canReceive: true })
    const staff = await mk(agent, { fullName: 'Staff One' })
    const res = await agent.post('/api/documents')
      .field('meta', JSON.stringify({ type: 'ICS', docNo: 'X-1', fundCluster: 'RAF', issuedDate: '2026-03-01', issuedByOfficerId: issuer.body.id, receivedByOfficerId: staff.body.id }))
      .attach('pdf', await samplePdf(), { filename: 'a.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('OFFICER_CANNOT_RECEIVE')
    // the issuer need not be a receiver
    const ok = await agent.post('/api/documents')
      .field('meta', JSON.stringify({ type: 'ICS', docNo: 'X-2', fundCluster: 'RAF', issuedDate: '2026-03-01', issuedByOfficerId: staff.body.id, receivedByOfficerId: issuer.body.id }))
      .attach('pdf', await samplePdf(), { filename: 'a.pdf', contentType: 'application/pdf' })
    expect(ok.status).toBe(201)
  })
})

describe('seed-officers script', () => {
  const csv = [
    'full_name,short_name,position,office,designations,note',
    'Ana R. Reyes,ARReyes,Regional Director,Regional Office,"ORD, Regional Director | SARAi CENTRO, Focal Person",',
    'Ben S. Cruz,BSCruz,Engineer II,DOST La Union,"Laboratory, Head",first name unclear; confirm',
    '"Cy ""CJ"" Diaz",CDiaz,SRS II,Regional Office,,',
  ].join('\n')

  it('upserts by short name, replaces designations, marks everyone able to receive, and is idempotent', async () => {
    const { seedOfficers } = await import('../services/officerSeed.js')
    await testPool.query(`INSERT INTO officers (full_name, short_name, position) VALUES ('Old Name', 'arreyes', 'Old Position')`)
    const first = await seedOfficers(csv)
    expect(first.count).toBe(3)
    expect(first.notes).toEqual([{ shortName: 'BSCruz', note: 'first name unclear; confirm' }])
    await seedOfficers(csv)
    const rows = (await testPool.query(`SELECT short_name, full_name, position, can_receive, active FROM officers ORDER BY short_name`)).rows
    expect(rows).toHaveLength(3) // the existing arreyes was updated, not duplicated
    expect(rows.every((r) => r.can_receive && r.active)).toBe(true)
    expect(rows.find((r) => r.full_name === 'Ana R. Reyes')).toMatchObject({ position: 'Regional Director' })
    expect(rows.find((r) => r.short_name === 'CDiaz')).toMatchObject({ full_name: 'Cy "CJ" Diaz' })
    const des = (await testPool.query(`SELECT d.designation FROM officer_designations d JOIN officers o ON o.id=d.officer_id WHERE lower(o.short_name)='arreyes' ORDER BY d.sort_order`)).rows
    expect(des.map((d) => d.designation)).toEqual(['ORD, Regional Director', 'SARAi CENTRO, Focal Person'])
  })
})
