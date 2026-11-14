import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, itemFor, loginAs } from './helpers.js'

// the made-up people of these tests; their short names are made from these names (MSantos, JDelaCruz, ...)
const FULL_NAME: Record<string, string> = { JDelaCruz: 'Juan Dela Cruz', MSantos: 'Maria Santos', Staffer: 'Sam Staffer', Iss: 'Ivan Issuer', Rcv: 'Rita Receiver' }

const PDF_DIR = path.resolve(process.env.STORAGE_DIR!, 'pdfs')
const files = () => (existsSync(PDF_DIR) ? readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf')) : [])
const ARCHIVE_DIR = path.resolve(process.env.STORAGE_DIR!, 'archive')
const archived = () => (existsSync(ARCHIVE_DIR) ? readdirSync(ARCHIVE_DIR) : [])

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
    (await agent.post('/api/officers').send({ fullName: FULL_NAME[shortName] ?? shortName, position, canReceive: true })).body
  const issuer = await mk('JDelaCruz', 'Supply Officer IV')
  const receiver = await mk('MSantos', 'Engineer II')
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
      hasPdf: true, status: 'signed', files: { generated: null, uploaded: { originalName: 'ics.pdf', pageCount: 2 } },
    })
    expect(JSON.stringify(res.body)).not.toContain('storedName')
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

  it('no pdf is fine (it can be attached later); bad meta -> 400 and the file is removed; unknown officer -> 400', async () => {
    const { agent, meta } = await setup()
    const none = await upload(agent, meta({ docNo: 'NO-PDF-1' }), null)
    expect(none.status).toBe(201)
    expect(none.body).toMatchObject({ hasPdf: false, status: 'none', files: { generated: null, uploaded: null } })
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

  it('PATCH edits header fields and a duplicate number is 409', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta())).body
    const hdr = await agent.patch(`/api/documents/${doc.id}`).send({ purpose: 'New purpose' })
    // a signed document is locked: its header says what the printed form says
    expect(hdr.status).toBe(409)
    expect(hdr.body.error.code).toBe('DOCUMENT_SIGNED')
    const unsigned = (await upload(agent, meta({ docNo: 'EDIT-1' }), null)).body
    const ok = await agent.patch(`/api/documents/${unsigned.id}`).send({ purpose: 'New purpose' })
    expect(ok.status).toBe(200)
    expect(ok.body.purpose).toBe('New purpose')
    expect((await agent.patch(`/api/documents/${unsigned.id}`).send({ docNo: '2026-03SARAi-005' })).status).toBe(409)
  })

  it('unknown id -> 404, malformed id -> 400', async () => {
    const { agent } = await setup()
    expect((await agent.get('/api/documents/00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await agent.get('/api/documents/nope')).status).toBe(400)
  })
})

async function pdfBytes(res: ReturnType<ReturnType<typeof agentFor>['get']>) {
  return res.buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = []
    r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)))
  })
}

describe('signed copy: attach, replace, remove (update 01 U-07, update 02 V-04..V-06)', () => {
  const att = (agent: Agent, id: string, pdf: Buffer = samplePdf, filename = 'signed.pdf', type = 'application/pdf') =>
    agent.put(`/api/documents/${id}/pdf`).attach('pdf', pdf, { filename, contentType: type })

  it('attach to a document without a PDF: 200, page count set, status signed', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta(), null)).body
    const res = await att(agent, doc.id)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'signed', files: { uploaded: { originalName: 'signed.pdf', pageCount: 2 } } })
    expect(files()).toHaveLength(1)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='document.upload'`)).rowCount).toBe(1)
    expect((await pdfBytes(agent.get(`/api/documents/${doc.id}/pdf`))).status).toBe(200)
  })

  it('a fake pdf -> 400 and nothing changes', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta(), null)).body
    expect((await att(agent, doc.id, Buffer.from('not a pdf'))).status).toBe(400)
    expect((await att(agent, doc.id, samplePdf, 'x.pdf', 'text/plain')).status).toBe(400)
    expect(files()).toHaveLength(0)
    expect((await agent.get(`/api/documents/${doc.id}`)).body.status).toBe('none')
    expect((await agent.put(`/api/documents/${doc.id}/pdf`)).status).toBe(400) // no file
    expect((await att(agentFor(), doc.id)).status).toBe(401)
  })

  it('replacing archives the old signed file (after commit) and keeps one live file', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta())).body
    const [oldFile] = files()
    expect((await att(agent, doc.id, samplePdf, 'new.pdf')).status).toBe(200)
    expect(files()).toHaveLength(1)
    expect(files()[0]).not.toBe(oldFile)
    expect(archived()).toEqual([oldFile]) // the signed original is kept, not deleted
  })

  it('a generated copy with the same page count lends its boxes; a different page count does not', async () => {
    const { agent, meta } = await setup()
    const seedGenerated = async (docId: string, pages: number) => {
      await testPool.query(`INSERT INTO document_files (document_id, kind, stored_name, size_bytes, page_count, created_by)
        VALUES ($1,'generated','g.pdf',10,$2,(SELECT id FROM users LIMIT 1))`, [docId, pages])
      const line = (await agent.post(`/api/documents/${docId}/lines`).send({
        line: { qty: 1, unitCostCentavos: 100000, description: 'x', dateAcquired: '2026-02-01' }, item: itemFor(100000), properties: [{ propertyNo: `G-${pages}-${docId.slice(0, 4)}` }],
      })).body
      await testPool.query(`INSERT INTO line_pdf_regions (line_id, kind, page, x, y, w, h) VALUES ($1,'generated',2,0.1,0.2,0.5,0.1)`, [line.lineId])
      return line.lineId as string
    }
    const same = (await upload(agent, meta({ docNo: 'SAME-1' }), null)).body
    const lineSame = await seedGenerated(same.id, 2)
    expect((await att(agent, same.id)).body.regionsCopied).toBe(1)
    expect((await testPool.query(`SELECT page, x::float FROM line_pdf_regions WHERE line_id=$1 AND kind='uploaded'`, [lineSame])).rows).toEqual([{ page: 2, x: 0.1 }])

    const diff = (await upload(agent, meta({ docNo: 'DIFF-1' }), null)).body
    const lineDiff = await seedGenerated(diff.id, 3) // generated 3 pages, signed scan has 2
    expect((await att(agent, diff.id)).body.regionsCopied).toBe(0)
    expect((await testPool.query(`SELECT 1 FROM line_pdf_regions WHERE line_id=$1 AND kind='uploaded'`, [lineDiff])).rowCount).toBe(0)
  })

  it('signing locks the entries (409 DOCUMENT_SIGNED) but boxes can still be set', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta(), null)).body
    const line = (await agent.post(`/api/documents/${doc.id}/lines`).send({
      line: { qty: 1, unitCostCentavos: 100000, description: 'x', dateAcquired: '2026-02-01' }, item: itemFor(100000), properties: [{ propertyNo: 'K-1' }],
    })).body
    await att(agent, doc.id)
    const add = { line: { qty: 1, unitCostCentavos: 100000, description: 'y', dateAcquired: '2026-02-01' }, item: itemFor(100000), properties: [{ propertyNo: 'K-2' }] }
    for (const res of [
      await agent.post(`/api/documents/${doc.id}/lines`).send(add),
      await agent.post(`/api/documents/${doc.id}/lines/batch`).send({ rows: [add] }),
      await agent.patch(`/api/lines/${line.lineId}`).send({ line: { description: 'changed' } }),
      await agent.patch(`/api/lines/${line.lineId}`).send({ addProperties: [{ propertyNo: 'K-3' }] }),
      await agent.delete(`/api/lines/${line.lineId}`),
    ]) {
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('DOCUMENT_SIGNED')
    }
    const region = { kind: 'uploaded', page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.05 }
    expect((await agent.put(`/api/lines/${line.lineId}/region`).send(region)).status).toBe(200)
    expect((await agent.patch(`/api/lines/${line.lineId}`).send({ region: { page: 2, x: 0, y: 0, w: 0.5, h: 0.5 } })).status).toBe(200)
    expect((await agent.put(`/api/lines/${line.lineId}/region`).send({ ...region, kind: 'bogus' })).status).toBe(400)
  })

  it('remove: needs a reason, archives the file, drops its boxes, audits the reason and unlocks the entries', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta(), null)).body
    const line = (await agent.post(`/api/documents/${doc.id}/lines`).send({
      line: { qty: 1, unitCostCentavos: 100000, description: 'x', dateAcquired: '2026-02-01' }, item: itemFor(100000), properties: [{ propertyNo: 'R-1' }],
    })).body
    await att(agent, doc.id)
    await agent.put(`/api/lines/${line.lineId}/region`).send({ kind: 'uploaded', page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.05 })
    const [stored] = files()

    expect((await agent.delete(`/api/documents/${doc.id}/pdf`).send({})).status).toBe(400)
    expect((await agent.delete(`/api/documents/${doc.id}/pdf`).send({ reason: 'x'.repeat(301) })).status).toBe(400)
    const res = await agent.delete(`/api/documents/${doc.id}/pdf`).send({ reason: 'Wrong receiver typed' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('none')
    expect(files()).toEqual([])
    expect(archived()).toEqual([stored])
    expect((await testPool.query(`SELECT 1 FROM line_pdf_regions WHERE line_id=$1 AND kind='uploaded'`, [line.lineId])).rowCount).toBe(0)
    const log = (await testPool.query(`SELECT after FROM audit_logs WHERE action='document.unsign'`)).rows
    expect(log).toHaveLength(1)
    expect(log[0].after.reason).toBe('Wrong receiver typed')
    expect((await agent.patch(`/api/lines/${line.lineId}`).send({ line: { description: 'fixed' } })).status).toBe(200)
    expect((await agent.delete(`/api/documents/${doc.id}/pdf`).send({ reason: 'again' })).status).toBe(404) // nothing left to remove
  })

  it('the list filters by status: none, generated, signed, unsigned', async () => {
    const { agent, meta } = await setup()
    const none = (await upload(agent, meta({ docNo: 'S-NONE' }), null)).body
    const signed = (await upload(agent, meta({ docNo: 'S-SIGNED' }))).body
    const gen = (await upload(agent, meta({ docNo: 'S-GEN' }), null)).body
    await testPool.query(`INSERT INTO document_files (document_id, kind, stored_name, size_bytes, page_count, created_by) VALUES ($1,'generated','g.pdf',10,1,(SELECT id FROM users LIMIT 1))`, [gen.id])
    const docNos = async (q: string) => (await agent.get(`/api/documents?status=${q}`)).body.rows.map((r: { docNo: string }) => r.docNo).sort()
    expect(await docNos('none')).toEqual(['S-NONE'])
    expect(await docNos('generated')).toEqual(['S-GEN'])
    expect(await docNos('signed')).toEqual(['S-SIGNED'])
    expect(await docNos('unsigned')).toEqual(['S-GEN', 'S-NONE'])
    expect((await agent.get('/api/documents?status=bogus')).status).toBe(400)
    expect(none.id && signed.id).toBeTruthy()
  })

  it('the pdf route can pick a kind: the generated copy when asked, 404 when that kind is missing', async () => {
    const { agent, meta } = await setup()
    const doc = (await upload(agent, meta())).body
    expect((await pdfBytes(agent.get(`/api/documents/${doc.id}/pdf?kind=uploaded`))).status).toBe(200)
    expect((await agent.get(`/api/documents/${doc.id}/pdf?kind=generated`)).status).toBe(404)
    expect((await agent.get(`/api/documents/${doc.id}/pdf?kind=bogus`)).status).toBe(400)
  })
})
