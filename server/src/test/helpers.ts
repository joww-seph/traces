import { PDFDocument } from 'pdf-lib'
import { officerInput } from '@traces/shared'
import request from 'supertest'
import { createApp } from '../app.js'
import { createOfficer } from '../services/officers.js'
import { createUser } from '../services/users.js'

const FULL_NAME: Record<string, string> = { JDelaCruz: 'Juan Dela Cruz', MSantos: 'Maria Santos', Staffer: 'Sam Staffer', Iss: 'Ivan Issuer', Rcv: 'Rita Receiver' }

export const ORIGIN = process.env.APP_ORIGIN!.split(',')[0]
export const PASSWORD = 'Correct-Horse-9'

export async function makeUser(role: 'supply_admin' | 'superadmin', over: { email?: string; mustChangePassword?: boolean } = {}) {
  return createUser(
    { email: over.email ?? `${role}@traces.test`, displayName: role, role, password: PASSWORD, mustChangePassword: over.mustChangePassword ?? false },
    { actorId: null, ip: null },
  )
}

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

export async function makeOfficer(o: { fullName: string; position: string; canReceive?: boolean }) {
  return createOfficer(officerInput.parse(o), { actorId: null, ip: null })
}

export async function makeDocument(
  agent: ReturnType<typeof agentFor>,
  over: { type?: 'ICS' | 'PAR'; docNo?: string; issuedDate?: string } = {},
) {
  const mk = (shortName: string, position: string) => makeOfficer({ fullName: FULL_NAME[shortName] ?? shortName, position, canReceive: true })
  const existing = (await agent.get('/api/officers')).body as { id: string; shortName: string }[]
  const issuer = existing.find((o) => o.shortName === 'JDelaCruz') ?? (await mk('JDelaCruz', 'Supply Officer IV'))
  const receiver = existing.find((o) => o.shortName === 'MSantos') ?? (await mk('MSantos', 'Engineer II'))
  const res = await agent.post('/api/documents').send({
    type: over.type ?? 'ICS', docNo: over.docNo ?? '2026-03SARAi-005', fundCluster: 'RAF',
    issuedDate: over.issuedDate ?? '2026-03-01', issuedByOfficerId: issuer.id, receivedByOfficerId: receiver.id,
  })
  if (res.status !== 201) throw new Error(`makeDocument failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { doc: res.body as { id: string }, issuer, receiver }
}

export async function signDocument(agent: ReturnType<typeof agentFor>, documentId: string) {
  const res = await agent.put(`/api/documents/${documentId}/pdf`).attach('pdf', await samplePdf(2), { filename: 'signed.pdf', contentType: 'application/pdf' })
  if (res.status !== 200) throw new Error(`signDocument failed: ${res.status} ${JSON.stringify(res.body)}`)
}

export const ITEM = { propertyTypeId: 1, article: 'Article', unit: 'unit' }
