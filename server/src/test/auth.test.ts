import express, { type Request, type Response } from 'express'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { errorHandler } from '../middleware/error.js'
import { requireRole } from '../middleware/auth.js'
import { originCheck } from '../middleware/origin.js'
import { sessionMiddleware } from '../middleware/session.js'
import { authRouter } from '../routes/auth.js'
import { deactivateUser } from '../services/users.js'
import { agentFor, loginAs, makeUser, ORIGIN, PASSWORD } from './helpers.js'
import { resetDb, testPool } from './db.js'

beforeEach(resetDb)
afterAll(async () => { await pool.end(); await testPool.end() })

const login = (agent: ReturnType<typeof agentFor>, email: string, password: string) =>
  agent.post('/api/auth/login').send({ email, password })

describe('login / logout / me', () => {
  it('wrong password -> 401 generic message; unknown email gets the same', async () => {
    const u = await makeUser('supply_admin')
    const a = await login(agentFor(), u.email, 'nope-nope-nope')
    const b = await login(agentFor(), 'ghost@traces.test', 'nope-nope-nope')
    expect(a.status).toBe(401)
    expect(b.status).toBe(401)
    expect(a.body.error.message).toBe('Invalid email or password')
    expect(b.body.error.message).toBe(a.body.error.message)
  })

  it('correct password -> 200, httpOnly cookie, /api/me returns the role; email match is case-insensitive', async () => {
    const u = await makeUser('supply_admin')
    const agent = agentFor()
    const res = await login(agent, u.email.toUpperCase(), PASSWORD)
    expect(res.status).toBe(200)
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toContain('traces.sid=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    const me = await agent.get('/api/me')
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ email: u.email, role: 'supply_admin', mustChangePassword: false })
    expect(me.body).not.toHaveProperty('passwordHash')
  })

  it('logout -> /api/me is 401 and the session row is gone', async () => {
    const { agent } = await loginAs('supply_admin')
    expect((await agent.post('/api/auth/logout')).status).toBe(200)
    expect((await agent.get('/api/me')).status).toBe(401)
    expect((await testPool.query('SELECT 1 FROM session')).rowCount).toBe(0)
  })

  it('login regenerates the session id (no fixation)', async () => {
    const u = await makeUser('supply_admin')
    const agent = agentFor()
    const first = await login(agent, u.email, PASSWORD)
    const second = await login(agent, u.email, PASSWORD)
    expect(first.headers['set-cookie']).not.toEqual(second.headers['set-cookie'])
  })

  it('inactive user cannot log in', async () => {
    const u = await makeUser('supply_admin')
    await deactivateUser(u.id, { actorId: null, ip: null })
    expect((await login(agentFor(), u.email, PASSWORD)).status).toBe(401)
  })
})

describe('CSRF: origin + content type', () => {
  it('POST without Origin -> 403', async () => {
    const u = await makeUser('supply_admin')
    const res = await request(createApp()).post('/api/auth/login').send({ email: u.email, password: PASSWORD })
    expect(res.status).toBe(403)
  })
  it('POST with a foreign Origin -> 403', async () => {
    const res = await request(createApp()).post('/api/auth/login').set('Origin', 'http://evil.example').send({})
    expect(res.status).toBe(403)
  })
  it('POST with a body but a form content type -> 403', async () => {
    const res = await request(createApp()).post('/api/auth/login').set('Origin', ORIGIN)
      .type('form').send('email=a&password=b')
    expect(res.status).toBe(403)
  })
  it('GET needs no Origin', async () => {
    expect((await request(createApp()).get('/api/health')).status).toBe(200)
  })
})

describe('roles and live user state', () => {
  function probeApp() {
    const app = express()
    app.use(express.json())
    app.use(originCheck())
    app.use(sessionMiddleware())
    app.use('/api', authRouter())
    app.get('/api/su', requireRole('superadmin'), (_req: Request, res: Response) => res.json({ ok: true }))
    app.get('/api/any', requireRole('supply_admin', 'superadmin'), (_req: Request, res: Response) => res.json({ ok: true }))
    app.use(errorHandler)
    return app
  }

  it('supply_admin on a superadmin route -> 403; superadmin -> 200; anonymous -> 401', async () => {
    const app = probeApp()
    expect((await request(app).get('/api/su')).status).toBe(401)
    const { agent } = await loginAs('supply_admin', app)
    expect((await agent.get('/api/su')).status).toBe(403)
    expect((await agent.get('/api/any')).status).toBe(200)
    await testPool.query(`UPDATE users SET role='superadmin'`) // role is read from the DB, not the session
    expect((await agent.get('/api/su')).status).toBe(200)
  })

  it('deactivateUser -> next request 401 and sessions deleted', async () => {
    const { agent, user } = await loginAs('supply_admin')
    expect((await agent.get('/api/me')).status).toBe(200)
    await deactivateUser(user.id, { actorId: null, ip: null })
    expect((await agent.get('/api/me')).status).toBe(401)
    expect((await testPool.query('SELECT 1 FROM session')).rowCount).toBe(0)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='user.deactivate'`)).rowCount).toBe(1)
  })
})

describe('temporary password', () => {
  it('blocks every route except /me, /me/password and logout until changed', async () => {
    const app = (() => {
      const a = express()
      a.use(express.json()); a.use(originCheck()); a.use(sessionMiddleware()); a.use('/api', authRouter())
      a.get('/api/any', requireRole('supply_admin'), (_req: Request, res: Response) => res.json({ ok: true }))
      a.use(errorHandler)
      return a
    })()
    const u = await makeUser('supply_admin', { mustChangePassword: true })
    const agent = agentFor(app)
    expect((await login(agent, u.email, PASSWORD)).status).toBe(200)
    expect((await agent.get('/api/me')).body.mustChangePassword).toBe(true)
    const blocked = await agent.get('/api/any')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')

    const bad = await agent.post('/api/me/password').send({ currentPassword: 'wrong-wrong-1', newPassword: 'New-Password-77' })
    expect(bad.status).toBe(401)
    const short = await agent.post('/api/me/password').send({ currentPassword: PASSWORD, newPassword: 'short' })
    expect(short.status).toBe(400)
    const ok = await agent.post('/api/me/password').send({ currentPassword: PASSWORD, newPassword: 'New-Password-77' })
    expect(ok.status).toBe(200)

    expect((await agent.get('/api/any')).status).toBe(200)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='user.password_change'`)).rowCount).toBe(1)
    expect((await login(agentFor(app), u.email, 'New-Password-77')).status).toBe(200)
  })
})

describe('rate limit', () => {
  it('the 11th login attempt -> 429', async () => {
    process.env.LOGIN_RATE_LIMIT = '10'
    const app = createApp()
    process.env.LOGIN_RATE_LIMIT = '1000'
    const u = await makeUser('supply_admin')
    const agent = agentFor(app)
    for (let i = 0; i < 10; i++) expect((await login(agent, u.email, 'wrong-wrong-1')).status).toBe(401)
    expect((await login(agent, u.email, PASSWORD)).status).toBe(429)
    // keyed by IP + email: another email is unaffected
    const other = await makeUser('superadmin')
    expect((await login(agentFor(app), other.email, PASSWORD)).status).toBe(200)
  })
})
