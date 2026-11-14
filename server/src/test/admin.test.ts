import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, makeUser, PASSWORD } from './helpers.js'

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

const newUser = { email: 'new.person@traces.test', displayName: 'New Person', role: 'supply_admin' }
const login = (agent: ReturnType<typeof agentFor>, email: string, password: string) => agent.post('/api/auth/login').send({ email, password })

describe('access', () => {
  it('a supply_admin gets 403 on every /api/admin route; anonymous gets 401', async () => {
    const { agent } = await loginAs('supply_admin')
    for (const [method, url] of [['get', '/api/admin/users'], ['post', '/api/admin/users'], ['patch', '/api/admin/users/00000000-0000-4000-8000-000000000000'],
      ['get', '/api/admin/audit-logs'], ['get', '/api/admin/settings'], ['patch', '/api/admin/settings']] as const) {
      expect((await agent[method](url).send({})).status, `${method} ${url}`).toBe(403)
    }
    expect((await agentFor().get('/api/admin/users')).status).toBe(401)
  })
})

describe('create user', () => {
  it('the server makes a temporary password; the user must change it before anything else', async () => {
    const { agent } = await loginAs('superadmin')
    const res = await agent.post('/api/admin/users').send(newUser)
    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ email: newUser.email, role: 'supply_admin', active: true, mustChangePassword: true })
    expect(res.body.user).not.toHaveProperty('passwordHash')
    const temp: string = res.body.temporaryPassword
    expect(temp.length).toBeGreaterThanOrEqual(16)

    const fresh = agentFor()
    expect((await login(fresh, newUser.email, temp)).status).toBe(200)
    const blocked = await fresh.get('/api/officers')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    expect((await fresh.post('/api/me/password').send({ currentPassword: temp, newPassword: 'My-New-Password-1' })).status).toBe(200)
    expect((await fresh.get('/api/officers')).status).toBe(200)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='user.create' AND entity_id=$1`, [res.body.user.id])).rowCount).toBe(1)
  })

  it('a duplicate email in another letter case -> 409; invalid body -> 400', async () => {
    const { agent } = await loginAs('superadmin')
    await agent.post('/api/admin/users').send(newUser)
    const dup = await agent.post('/api/admin/users').send({ ...newUser, email: 'NEW.Person@traces.test' })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('EMAIL_TAKEN')
    expect((await agent.post('/api/admin/users').send({ ...newUser, email: 'nope' })).status).toBe(400)
    expect((await agent.post('/api/admin/users').send({ ...newUser, role: 'root' })).status).toBe(400)
  })

  it('GET lists users without secrets', async () => {
    const { agent } = await loginAs('superadmin')
    await makeUser('supply_admin')
    const list = (await agent.get('/api/admin/users')).body
    expect(list).toHaveLength(2)
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|argon2/)
    expect(list.map((u: { role: string }) => u.role).sort()).toEqual(['superadmin', 'supply_admin'])
  })
})

describe('update user', () => {
  it('deactivating signs the user out at once and blocks login; reactivating restores it', async () => {
    const { agent } = await loginAs('superadmin')
    const staff = await makeUser('supply_admin')
    const staffAgent = agentFor()
    expect((await login(staffAgent, staff.email, PASSWORD)).status).toBe(200)
    expect((await staffAgent.get('/api/me')).status).toBe(200)

    expect((await agent.patch(`/api/admin/users/${staff.id}`).send({ active: false })).status).toBe(200)
    expect((await staffAgent.get('/api/me')).status).toBe(401)
    expect((await login(agentFor(), staff.email, PASSWORD)).status).toBe(401)
    expect((await testPool.query(`SELECT 1 FROM session WHERE sess->>'userId' = $1`, [staff.id])).rowCount).toBe(0)

    expect((await agent.patch(`/api/admin/users/${staff.id}`).send({ active: true })).status).toBe(200)
    expect((await login(agentFor(), staff.email, PASSWORD)).status).toBe(200)
    expect((await testPool.query(`SELECT action FROM audit_logs WHERE entity_id=$1 ORDER BY id`, [staff.id])).rows.map((r) => r.action))
      .toEqual(['user.create', 'user.deactivate', 'user.activate'])
  })

  it('a role change takes effect on the next request', async () => {
    const { agent } = await loginAs('superadmin')
    const staff = await makeUser('supply_admin')
    const staffAgent = agentFor()
    await login(staffAgent, staff.email, PASSWORD)
    expect((await staffAgent.get('/api/admin/users')).status).toBe(403)
    await agent.patch(`/api/admin/users/${staff.id}`).send({ role: 'superadmin', displayName: 'Promoted' })
    expect((await staffAgent.get('/api/admin/users')).status).toBe(200)
    expect((await staffAgent.get('/api/me')).body).toMatchObject({ role: 'superadmin', displayName: 'Promoted' })
  })

  it('reset password: a new temporary password, old one dead, sessions cleared, change required', async () => {
    const { agent } = await loginAs('superadmin')
    const staff = await makeUser('supply_admin')
    const staffAgent = agentFor()
    await login(staffAgent, staff.email, PASSWORD)
    const res = await agent.patch(`/api/admin/users/${staff.id}`).send({ resetPassword: true })
    expect(res.status).toBe(200)
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(16)
    expect((await staffAgent.get('/api/me')).status).toBe(401)
    expect((await login(agentFor(), staff.email, PASSWORD)).status).toBe(401)
    const again = agentFor()
    expect((await login(again, staff.email, res.body.temporaryPassword)).body.user.mustChangePassword).toBe(true)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='user.password_reset'`)).rowCount).toBe(1)
  })

  it('a superadmin cannot lock themselves out; the last superadmin stays', async () => {
    const { agent, user } = await loginAs('superadmin')
    for (const body of [{ active: false }, { role: 'supply_admin' }]) {
      const res = await agent.patch(`/api/admin/users/${user.id}`).send(body)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('LAST_SUPERADMIN')
    }
    const second = await makeUser('superadmin', { email: 'second.super@traces.test' })
    expect((await agent.patch(`/api/admin/users/${second.id}`).send({ active: false })).status).toBe(200) // another one remains
    expect((await agent.patch(`/api/admin/users/${user.id}`).send({ active: false })).status).toBe(409)
  })

  it('unknown user 404; malformed id 400; empty patch is harmless', async () => {
    const { agent, user } = await loginAs('superadmin')
    expect((await agent.patch('/api/admin/users/00000000-0000-4000-8000-000000000000').send({ active: false })).status).toBe(404)
    expect((await agent.patch('/api/admin/users/nope').send({})).status).toBe(400)
    expect((await agent.patch(`/api/admin/users/${user.id}`).send({})).status).toBe(200)
  })
})

describe('audit log', () => {
  it('newest first with the actor; filters by entity, actor and dates; keyset pagination', async () => {
    const { agent, user } = await loginAs('superadmin')
    await agent.post('/api/admin/users').send(newUser)
    await agent.post('/api/officers').send({ fullName: 'A B', shortName: 'AB', position: 'Clerk' })
    const all = (await agent.get('/api/admin/audit-logs')).body
    expect(all.rows[0].action).toBe('officer.create')
    expect(all.rows[0].actor).toMatchObject({ email: 'superadmin@traces.test' })
    expect(all.rows.map((r: { id: number }) => r.id)).toEqual([...all.rows.map((r: { id: number }) => r.id)].sort((a, b) => b - a))

    const users = (await agent.get('/api/admin/audit-logs?entity=users')).body.rows
    expect(users.every((r: { entity: string }) => r.entity === 'users')).toBe(true)
    expect((await agent.get(`/api/admin/audit-logs?actorId=${user.id}`)).body.rows.length).toBeGreaterThanOrEqual(2)
    expect((await agent.get('/api/admin/audit-logs?from=2999-01-01')).body.rows).toEqual([])
    expect((await agent.get('/api/admin/audit-logs?to=2000-01-01')).body.rows).toEqual([])
    const today = new Date().toISOString().slice(0, 10)
    expect((await agent.get(`/api/admin/audit-logs?from=${today}&to=${today}`)).body.rows.length).toBe(all.rows.length)

    for (let i = 0; i < 55; i++) await agent.post('/api/officers').send({ fullName: `P ${i}`, shortName: `P${i}`, position: 'Clerk' })
    const p1 = (await agent.get('/api/admin/audit-logs')).body
    expect(p1.rows).toHaveLength(50)
    expect(p1.nextBefore).toBe(p1.rows[49].id)
    const p2 = (await agent.get(`/api/admin/audit-logs?before=${p1.nextBefore}`)).body
    expect(p2.rows[0].id).toBeLessThan(p1.rows[49].id)
    expect(p2.rows.length).toBeGreaterThan(0)
    expect(p2.rows.length + p1.rows.length).toBe(Number((await testPool.query('SELECT count(*) FROM audit_logs')).rows[0].count))
    expect(p2.nextBefore).toBeNull()
    expect((await agent.get('/api/admin/audit-logs?before=abc')).status).toBe(400)
  })

  it('shows what changed (before/after) for an entry', async () => {
    const { agent } = await loginAs('superadmin')
    await agent.patch('/api/admin/settings').send({ cardRowMode: 'split' })
    const row = (await agent.get('/api/admin/audit-logs?entity=settings')).body.rows[0]
    expect(row.action).toBe('settings.update')
    expect(row.before.cardRowMode).toBe('merged')
    expect(row.after.cardRowMode).toBe('split')
  })
})
