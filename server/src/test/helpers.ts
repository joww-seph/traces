import { PDFDocument } from 'pdf-lib'
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

export async function samplePdf(pages = 1) {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage()
  return Buffer.from(await d.save())
}

// Two officers + one ICS (or PAR) document with a PDF, created through the API.
export async function makeDocument(
  agent: ReturnType<typeof agentFor>,
  over: { type?: 'ICS' | 'PAR'; docNo?: string; issuedDate?: string } = {},
) {
  const mk = async (shortName: string, position: string) =>
    (await agent.post('/api/officers').send({ fullName: `${shortName} Full`, shortName, position, canReceive: true })).body
  const existing = (await agent.get('/api/officers')).body as { id: string; shortName: string }[]
  const issuer = existing.find((o) => o.shortName === 'JDelaCruz') ?? (await mk('JDelaCruz', 'Supply Officer IV'))
  const receiver = existing.find((o) => o.shortName === 'MSantos') ?? (await mk('MSantos', 'Engineer II'))
  const res = await agent.post('/api/documents')
    .field('meta', JSON.stringify({
      type: over.type ?? 'ICS', docNo: over.docNo ?? '2026-03SARAi-005', fundCluster: 'RAF',
      issuedDate: over.issuedDate ?? '2026-03-01', issuedByOfficerId: issuer.id, receivedByOfficerId: receiver.id,
    }))
    .attach('pdf', await samplePdf(2), { filename: 'doc.pdf', contentType: 'application/pdf' })
  if (res.status !== 201) throw new Error(`makeDocument failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { doc: res.body as { id: string }, issuer, receiver }
}

// Two default cards (one per category) that resetDb() creates, so a test body can say item: itemFor(cost).
export const DEFAULT_ITEM = { semi: '00000000-0000-4000-8000-0000000000a1', ppe: '00000000-0000-4000-8000-0000000000a2' }
export const itemFor = (costCentavos: number) => ({ itemId: costCentavos >= 5000000 ? DEFAULT_ITEM.ppe : DEFAULT_ITEM.semi })
