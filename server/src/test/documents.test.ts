import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs } from './helpers.js'

const PDF_DIR = path.resolve(process.env.STORAGE_DIR!, 'pdfs')
const files = () => (existsSync(PDF_DIR) ? readdirSync(PDF_DIR) : [])

let samplePdf: Buffer
beforeAll(async () => {
  const d = await PDFDocument.create()
  d.addPage(); d.addPage()
  samplePdf = Buffer.from(await d.save())
})
beforeEach(async () => {
  await resetDb()
  rmSync(path.resolve(process.env.STORAGE_DIR!), { recursive: true, force: true })
})
afterAll(async () => {
  rmSync(path.resolve(process.env.STORAGE_DIR!), { recursive: true, force: true })
  await pool.end(); await testPool.end()
})

type Agent = Awaited<ReturnType<typeof loginAs>>['agent']

async function setup() {
  const { agent } = await loginAs('supply_admin')
  const mk = async (shortName: string, position: string) =>
    (await agent.post('/api/officers').send({ fullName: `${shortName} Full`, shortName, position })).body
  const issuer = await mk('MJRamos', 'Supply Officer IV')
  const receiver = await mk('DPLibunao', 'Engineer II')
  const meta = (over: object = {}) => ({
    type: 'ICS', docNo: '2026-03SARAi-005', fundCluster: 'RAF', issuedDate: '2026-03-01',
    issuedByOfficerId: issuer.id, receivedByOfficerId: receiver.id, purpose: 'Office use', ...over,
  })
  return { agent, issuer, receiver, meta }
}

const upload = (agent: Agent, meta: object, pdf: Buffer | null = samplePdf, contentType = 'application/pdf') => {
  const req = agent.post('/api/documents').field('meta', JSON.stringify(meta))
  return pdf ? req.attach('pdf', pdf, { filename: 'ics.pdf', contentType }) : req
}

describe('upload', () => {
  it('201: stores the pdf, counts pages, copies positions from the officers, hides the stored name', async () => {
    const { agent, meta } = await setup()
    const res = await upload(agent, meta())
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      type: 'ICS', docNo: '2026-03SARAi-005', issuedByPosition: 'Supply Officer IV', receivedByPosition: 'Engineer II',
      pdfOriginalName: 'ics.pdf', pdfPageCount: 2, hasPdf: true,
    })
    expect(res.body).not.toHaveProperty('pdfStoredName')
    expect(files()).toHaveLength(1)
    expect(files()[0]).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='document.create'`)).rowCount).toBe(1)
  })

  it('an explicit position (as printed) overrides the officer snapshot', async () => {
    const { agent, meta } = await setup()
    const res = await upload(agent, meta({ receivedByPosition: 'Acting Chief' }))
    expect(res.body.receivedByPosition).toBe('Acting Chief')
    expect(res.body.issuedByPosition).toBe('Supply Officer IV')
  })

  it('duplicate ICS number -> 409 and the new file is removed', async () => {
    const { agent, meta } = await setup()
    expect((await upload(agent, meta())).status).toBe(201)
    const dup = await upload(agent, meta())
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('DUPLICATE_DOCUMENT_NO')
    expect(files()).toHaveLength(1)
  })

  it('an ICS and a PAR with the same number are both fine', async () => {
    const { agent, meta } = await setup()
    expect((await upload(agent, meta({ type: 'ICS' }))).status).toBe(201)
    expect((await upload(agent, meta({ type: 'PAR' }))).status).toBe(201)
  })

  it('fake pdf (wrong magic bytes) -> 400 and no file left', async () => {
    const { agent, meta } = await setup()
    const res = await upload(agent, meta(), Buffer.from('this is not a pdf at all'))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_PDF')
    expect(files()).toHaveLength(0)
  })

  it('%PDF- header but unreadable body -> 400 and no file left', async () => {
    const { agent, meta } = await setup()
    const res = await upload(agent, meta(), Buffer.from('%PDF-1.7 garbage garbage'))
    expect(res.status).toBe(400)
    expect(files()).toHaveLength(0)
  })

  it('wrong content type -> 400', async () => {
    const { agent, meta } = await setup()
    expect((await upload(agent, meta(), samplePdf, 'text/plain')).status).toBe(400)
    expect(files()).toHaveLength(0)
  })

  it('missing pdf -> 400; bad meta -> 400 and the file is removed; unknown officer -> 400', async () => {
    const { agent, meta } = await setup()
    expect((await upload(agent, meta(), null)).status).toBe(400)
    expect((await upload(agent, meta({ docNo: '' }))).status).toBe(400)
    expect((await agent.post('/api/documents').field('meta', '{bad').attach('pdf', samplePdf, { filename: 'a.pdf', contentType: 'application/pdf' })).status).toBe(400)
    expect((await upload(agent, meta({ receivedByOfficerId: '00000000-0000-4000-8000-000000000000' }))).status).toBe(400)
    expect(files()).toHaveLength(0)
  })

  it('over 20 MB -> 413 and nothing stored', async () => {
    const { agent, meta } = await setup()
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(21 * 1024 * 1024)])
    expect((await upload(agent, meta(), big)).status).toBe(413)
    expect(files()).toHaveLength(0)
  })

  it('anonymous -> 401', async () => {
    expect((await agentFor().post('/api/documents')).status).toBe(401)
  })
})

describe('read, patch, delete', () => {
  it('list filters, soft delete hides, and the number stays reserved', async () => {
    const { agent, meta } = await setup()
    const a = (await upload(agent, meta())).body
    await upload(agent, meta({ type: 'PAR', docNo: '2025-RO-68', issuedDate: '2025-05-12' }))

    expect((await agent.get('/api/documents')).body.total).toBe(2)
    expect((await agent.get('/api/documents?type=PAR')).body.rows.map((r: { docNo: string }) => r.docNo)).toEqual(['2025-RO-68'])
    expect((await agent.get('/api/documents?q=sarai')).body.total).toBe(1)
    expect((await agent.get('/api/documents?from=2026-01-01')).body.total).toBe(1)
    expect((await agent.get(`/api/documents?officerId=${a.receivedByOfficerId}`)).body.total).toBe(2)

    expect((await agent.delete(`/api/documents/${a.id}`)).status).toBe(200)
    const list = await agent.get('/api/documents')
    expect(list.body.rows.map((r: { id: string }) => r.id)).not.toContain(a.id)
    expect((await agent.get(`/api/documents/${a.id}`)).status).toBe(404)
    expect((await upload(agent, meta())).status).toBe(409)
  })

  it('GET /:id returns the document with its (empty) lines; /pdf streams the file', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta())).body
    const got = await agent.get(`/api/documents/${doc.id}`)
    expect(got.status).toBe(200)
    expect(got.body.lines).toEqual([])
    const pdf = await agent.get(`/api/documents/${doc.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
    expect((await agentFor().get(`/api/documents/${doc.id}/pdf`)).status).toBe(401)
  })

  it('PATCH edits header fields; replacing the pdf deletes the old file only after commit', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta())).body
    const [oldFile] = files()

    const hdr = await agent.patch(`/api/documents/${doc.id}`).send({ purpose: 'New purpose' })
    expect(hdr.status).toBe(200)
    expect(hdr.body.purpose).toBe('New purpose')

    const rep = await agent.patch(`/api/documents/${doc.id}`).field('meta', '{}')
      .attach('pdf', samplePdf, { filename: 'new.pdf', contentType: 'application/pdf' })
    expect(rep.status).toBe(200)
    expect(rep.body.pdfOriginalName).toBe('new.pdf')
    expect(files()).toHaveLength(1)
    expect(files()[0]).not.toBe(oldFile)

    // a failed patch (duplicate number) must keep the old pdf and drop the new upload
    const other = (await upload(agent, meta({ docNo: 'OTHER-1' }))).body
    expect(files()).toHaveLength(2)
    const bad = await agent.patch(`/api/documents/${other.id}`).field('meta', JSON.stringify({ docNo: '2026-03SARAi-005' }))
      .attach('pdf', samplePdf, { filename: 'x.pdf', contentType: 'application/pdf' })
    expect(bad.status).toBe(409)
    expect(files()).toHaveLength(2)
  })

  it('unknown id -> 404, malformed id -> 400', async () => {
    const { agent } = await setup()
    expect((await agent.get('/api/documents/00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await agent.get('/api/documents/nope')).status).toBe(400)
  })
})
