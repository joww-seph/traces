import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, itemFor, loginAs, makeDocument, signDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
const PDF_DIR = path.join(STORAGE, 'pdfs')
const files = () => (existsSync(PDF_DIR) ? readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf')) : [])
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const lineBody = (n: number, over: object = {}) => ({
  line: { qty: 1, unitCostCentavos: 4870000, description: `Laptop ${n}\nSpecification:\n- Memory: 16GB`, dateAcquired: '2026-03-01', estUsefulLifeYears: 5, ...over },
  item: itemFor(4870000), properties: [{ propertyNo: `2026-03ICT-${String(n).padStart(4, '0')}` }],
})

async function seed(lines = 3) {
  const { agent } = await loginAs('supply_admin')
  const { doc } = await makeDocument(agent)
  for (let i = 1; i <= lines; i++) expect((await agent.post(`/api/documents/${doc.id}/lines`).send(lineBody(i))).status).toBe(201)
  return { agent, doc }
}
const regions = async (kind: string) => (await testPool.query(`SELECT line_id, page, x::float, y::float, w::float, h::float FROM line_pdf_regions WHERE kind=$1 ORDER BY y`, [kind])).rows

describe('POST /api/documents/:id/generate', () => {
  it('stores the generated PDF, one box per line, and the PDF streams without a signed copy', async () => {
    const { agent, doc } = await seed(3)
    const res = await agent.post(`/api/documents/${doc.id}/generate`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'generated', hasPdf: true, files: { generated: { pageCount: 1 }, uploaded: null } })
    expect(files()).toHaveLength(1)
    expect(await regions('generated')).toHaveLength(3)
    expect((await testPool.query(`SELECT 1 FROM audit_logs WHERE action='document.generate'`)).rowCount).toBe(1)
    const pdf = await agent.get(`/api/documents/${doc.id}/pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(pdf.status).toBe(200)
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
    const got = (await agent.get(`/api/documents/${doc.id}`)).body
    expect(got.lines.every((l: { generatedRegion: { page: number } | null }) => l.generatedRegion?.page === 1)).toBe(true)
  })

  it('generating twice keeps one generated file and replaces the boxes; the old file is removed', async () => {
    const { agent, doc } = await seed(2)
    await agent.post(`/api/documents/${doc.id}/generate`)
    const [first] = files()
    await agent.post(`/api/documents/${doc.id}/lines`).send(lineBody(3))
    expect((await agent.post(`/api/documents/${doc.id}/generate`)).status).toBe(200)
    expect((await testPool.query(`SELECT count(*) FROM document_files WHERE kind='generated'`)).rows[0].count).toBe('1')
    expect(await regions('generated')).toHaveLength(3)
    expect(files()).toHaveLength(1)
    expect(files()[0]).not.toBe(first)
  })

  it('a long form runs to a second page and its boxes follow', async () => {
    const { agent, doc } = await seed(25)
    const res = await agent.post(`/api/documents/${doc.id}/generate`)
    expect(res.body.files.generated.pageCount).toBeGreaterThanOrEqual(2)
    const pages = new Set((await regions('generated')).map((r) => r.page))
    expect(pages.size).toBeGreaterThanOrEqual(2)
  })

  it('with a signed copy -> 409 DOCUMENT_SIGNED and nothing changes', async () => {
    const { agent, doc } = await seed(2)
    await signDocument(agent, doc.id)
    const before = files().length
    const res = await agent.post(`/api/documents/${doc.id}/generate`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DOCUMENT_SIGNED')
    expect(files()).toHaveLength(before)
    expect(await regions('generated')).toHaveLength(0)
  })

  it('no lines -> 400; unknown document -> 404; anonymous -> 401; a removed line is not on the form', async () => {
    const { agent } = await loginAs('supply_admin')
    const { doc } = await makeDocument(agent)
    expect((await agent.post(`/api/documents/${doc.id}/generate`)).status).toBe(400)
    expect((await agent.post('/api/documents/00000000-0000-4000-8000-000000000000/generate')).status).toBe(404)
    expect((await agentFor().post(`/api/documents/${doc.id}/generate`)).status).toBe(401)
    const a = (await agent.post(`/api/documents/${doc.id}/lines`).send(lineBody(1))).body
    await agent.post(`/api/documents/${doc.id}/lines`).send(lineBody(2))
    await agent.delete(`/api/lines/${a.lineId}`)
    await agent.post(`/api/documents/${doc.id}/generate`)
    expect(await regions('generated')).toHaveLength(1)
  })

  it('a failed render leaves nothing behind (the data is untouched, no stray file)', async () => {
    const { doc } = await seed(1)
    const { generateDocument } = await import('../services/generate.js')
    const user = (await testPool.query('SELECT id FROM users LIMIT 1')).rows[0].id
    await expect(generateDocument(doc.id, { actorId: user, ip: null }, async () => { throw new Error('render exploded') })).rejects.toThrow('render exploded')
    expect(files()).toHaveLength(0)
    expect((await testPool.query(`SELECT count(*) FROM document_files`)).rows[0].count).toBe('0')
  })
})
