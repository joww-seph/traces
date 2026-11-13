import request from 'supertest'
import { createApp } from '../app.js'
import { createUser } from '../services/users.js'

export const ORIGIN = process.env.APP_ORIGIN!.split(',')[0]
export const PASSWORD = 'Correct-Horse-9'

export async function makeUser(role: 'supply_admin' | 'superadmin', over: { email?: string; mustChangePassword?: boolean } = {}) {
  return createUser(
    { email: over.email ?? `${role}@traces.test`, displayName: role, role, password: PASSWORD, mustChangePassword: over.mustChangePassword ?? false },
    { actorId: null, ip: null },
  )
}

// A supertest agent that keeps the session cookie and sends a valid Origin on every request.
export function agentFor(app = createApp()) {
  return request.agent(app).set('Origin', ORIGIN)
}

export async function loginAs(role: 'supply_admin' | 'superadmin', app = createApp()) {
  const user = await makeUser(role)
  const agent = agentFor(app)
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { agent, user, app }
}
