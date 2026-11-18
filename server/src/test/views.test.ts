import { rmSync } from 'node:fs'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { card, listCards, officerReportRows, registry } from '../services/views.js'
import { testPool, resetDb } from './db.js'
import { agentFor, ITEM, loginAs, makeDocument, signDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

type Prop = { propertyNo: string; componentLabel?: string; oldPropertyNo?: string; serialNo?: string }
const lineBody = (qty: number, cost: number, nos: Prop[], extra: object = {}) => ({
  line: { ...ITEM, qty, unitCostCentavos: cost, description: 'Description', dateAcquired: '2026-02-01', ...extra }, properties: nos,
})

async function setup(docOver: Parameters<typeof makeDocument>[1] = {}) {
  const { agent } = await loginAs('supply_admin')
  const { doc, receiver } = await makeDocument(agent, docOver)
  return { agent, doc, receiver, add: (body: object, id = doc.id) => agent.post(`/api/documents/${id}/lines`).send(body) }
}

const propertyId = async (no: string) => (await testPool.query(`SELECT id FROM properties WHERE property_no = $1`, [no])).rows[0].id as string

describe('registry', () => {
  it('a qty-3 line with 3 main units: issued 3, amount 3 x unit cost, nothing returned or disposed', async () => {
    const { add } = await setup()
    await add(lineBody(3, 4870000, [{ propertyNo: 'S-1' }, { propertyNo: 'S-2' }, { propertyNo: 'S-3' }]))
    const rows = await registry('semi')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      issuedQty: 3, returnedQty: 0, reissuedQty: 0, disposedQty: 0, balanceQty: 3, amountCentavos: 3 * 4870000,
      propertyNos: ['S-1', 'S-2', 'S-3'], reference: 'ICS 2026-03SARAi-005', issuedTo: 'Maria Santos', article: 'Article',
      propertyTypeCode: 'ICT', rowNo: 1,
    })
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/) // the line id: the row a QR scan highlights
    expect(rows[0].documentId).toMatch(/^[0-9a-f-]{36}$/) // the row opens its ICS/PAR
  })

  it('the description carries the serials in brackets, N/A when none', async () => {
    const { add } = await setup()
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1', serialNo: 'ABC123' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }]))
    await add(lineBody(1, 4870000, [{ propertyNo: 'S-1' }]))
    expect((await registry('ppe'))[0].description).toBe('Description (S/N: ABC123, N/A)')
    expect((await registry('semi'))[0].description).toBe('Description (S/N: N/A)')
  })

  it('components do not add to the quantity but their numbers are listed', async () => {
    const { add } = await setup()
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }]))
    const [r] = await registry('ppe')
    expect(r).toMatchObject({ issuedQty: 1, amountCentavos: 9645000, propertyNos: ['L-1', 'L-1a'] })
  })

  it('filters by category, property type and issued date; No. counts the whole register and filters never renumber it', async () => {
    const { add, agent } = await setup({ issuedDate: '2026-03-01' })
    await add(lineBody(1, 4870000, [{ propertyNo: 'S-1' }]))
    await add(lineBody(1, 9645000, [{ propertyNo: 'P-1' }]))
    const second = await makeDocument(agent, { docNo: '2026-09-009', issuedDate: '2026-09-10' })
    await add(lineBody(1, 100000, [{ propertyNo: 'S-8' }]), second.doc.id)
    await add(lineBody(1, 100000, [{ propertyNo: 'S-9' }], { propertyTypeId: 3, article: 'Stapler' }), second.doc.id)
    expect((await registry('semi')).map((r) => r.propertyNos[0])).toEqual(['S-1', 'S-8', 'S-9'])
    expect((await registry('ppe')).map((r) => r.propertyNos[0])).toEqual(['P-1'])
    expect((await registry('semi', { typeId: 3 })).map((r) => [r.propertyNos[0], r.rowNo])).toEqual([['S-9', 1]])
    expect((await registry('semi', { typeId: 1 })).map((r) => [r.propertyNos[0], r.rowNo])).toEqual([['S-1', 1], ['S-8', 2]])
    expect((await registry('semi', { typeId: 1, from: '2026-06-01' })).map((r) => [r.propertyNos[0], r.rowNo])).toEqual([['S-8', 2]])
    expect(await registry('semi', { to: '2026-03-31' })).toHaveLength(1)
  })
})

describe('card (one per property, decision 2026-11-18)', () => {
  it('each unit of a line has its own card; the date is the date issued; balance 1 then 0', async () => {
    const { add } = await setup({ issuedDate: '2026-03-01' })
    await add(lineBody(2, 3709200, [{ propertyNo: 'T-1', serialNo: 'SN1' }, { propertyNo: 'T-2' }], { dateAcquired: '2026-02-20', article: 'Laptop' }))
    const c1 = await card(await propertyId('T-1'), 'split')
    expect(c1.header).toMatchObject({ propertyNo: 'T-1', article: 'Laptop', description: 'Description (S/N: SN1)', category: 'semi', docNo: '2026-03SARAi-005' })
    expect(c1.rows.map((r) => [r.date, r.balanceQty, r.issueItemNo])).toEqual([['2026-03-01', 1, null], ['2026-03-01', 0, 'T-1']])
    expect(c1.rows.at(-1)!.amountCentavos).toBe(0)
    expect((await card(await propertyId('T-2'))).header.propertyNo).toBe('T-2')
  })

  it('merged: the receipt and the issue are one row (same date)', async () => {
    const { add } = await setup({ issuedDate: '2026-03-01' })
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }], { dateAcquired: '2026-01-10' }))
    const c = await card(await propertyId('L-1'), 'merged')
    expect(c.rows).toHaveLength(1)
    expect(c.rows[0]).toMatchObject({ date: '2026-03-01', receiptQty: 1, issueQty: 1, officer: 'Maria Santos', balanceQty: 0, amountCentavos: 0 })
  })

  it('a set: the unit’s card lists its parts; scanning a part opens the unit’s card', async () => {
    const { add } = await setup({ issuedDate: '2026-03-01' })
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse', serialNo: 'M9' }]))
    const c = await card(await propertyId('L-1a'), 'split')
    expect(c.header).toMatchObject({ propertyNo: 'L-1', components: [{ propertyNo: 'L-1a', label: 'Mouse', serialNo: 'M9' }] })
    expect(c.rows[1].issueItemNo).toBe('L-1\nL-1a')
  })

  it('unknown card -> 404', async () => {
    await expect(card('00000000-0000-4000-8000-0000000000ff')).rejects.toMatchObject({ status: 404 })
  })

  it('the card list has one row per unit (no parts), searchable by number, serial, description or holder', async () => {
    const { add } = await setup()
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1', serialNo: 'ZX-77' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }], { description: 'MSI Katana' }))
    await add(lineBody(1, 4870000, [{ propertyNo: 'S-1' }], { description: 'Office chair' }))
    expect((await listCards()).map((r) => r.propertyNo).sort()).toEqual(['L-1', 'S-1'])
    expect((await listCards({ q: 'zx-7' })).map((r) => r.propertyNo)).toEqual(['L-1'])
    expect((await listCards({ q: 'katana' })).map((r) => r.propertyNo)).toEqual(['L-1'])
    expect((await listCards({ q: 'maria' }))).toHaveLength(2)
    expect((await listCards({ category: 'semi' }))[0]).toMatchObject({ propertyNo: 'S-1', holder: 'Maria Santos', docNo: '2026-03SARAi-005' })
  })

  it('API: GET /api/views/card/:propertyId marks the rows of ?highlightLineId; remarks are edited per row and audited', async () => {
    const { agent, add } = await setup()
    const { lineId } = (await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }]))).body
    const id = await propertyId('L-1')
    const res = await agent.get(`/api/views/card/${id}?highlightLineId=${lineId}`)
    expect(res.status).toBe(200)
    expect(res.body.highlightRowIds).toHaveLength(1)
    expect((await agent.get('/api/views/card/L-1')).status).toBe(400)
    expect((await agentFor().get(`/api/views/card/${id}`)).status).toBe(401)

    const rowId = res.body.rows[0].id
    const set = await agent.patch(`/api/views/card-rows/${rowId}`).send({ remarks: 'Transferred to ARD office' })
    expect(set.status).toBe(200)
    expect((await agent.get(`/api/views/card/${id}`)).body.rows[0].remarks).toBe('Transferred to ARD office')
    expect((await agent.patch(`/api/views/card-rows/${rowId}`).send({ remarks: '  ' })).body.remarks).toBeNull()
    expect((await testPool.query(`SELECT count(*) FROM audit_logs WHERE action = 'card.remarks'`)).rows[0].count).toBe('2')
    expect((await agent.patch('/api/views/card-rows/999999').send({ remarks: 'x' })).status).toBe(404)
  })
})

describe('officer report (RPCSP / RPCPPE)', () => {
  async function held() {
    const s = await setup({ issuedDate: '2026-10-20' })
    await s.add(lineBody(1, 4870000, [{ propertyNo: 'S-1', oldPropertyNo: '10605140-00-7' }]))
    await s.add(lineBody(1, 9645000, [{ propertyNo: 'P-1' }]))
    return s
  }

  it('one row per line with balance per card, a No. and its form; the count columns do not exist', async () => {
    const { receiver, doc } = await held()
    const r = await officerReportRows({ officerId: receiver.id, category: 'semi', asAt: '2026-12-31' })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ rowNo: 1, documentId: doc.id, article: 'Article', description: 'Description (S/N: N/A)', propertyNos: ['S-1'], unit: 'unit', unitValueCentavos: 4870000, balancePerCard: 1, remarks: 'Old P#: 10605140-00-7' })
    expect(Object.keys(r.rows[0])).not.toEqual(expect.arrayContaining(['qtyOnHand']))
    expect(r.officer).toMatchObject({ id: receiver.id })
  })

  it('an as-at date before the ICS leaves it out', async () => {
    const { receiver } = await held()
    expect((await officerReportRows({ officerId: receiver.id, category: 'semi', asAt: '2026-10-19' })).rows).toHaveLength(0)
    expect((await officerReportRows({ officerId: receiver.id, category: 'semi', asAt: '2026-10-20' })).rows).toHaveLength(1)
  })

  it('filters by category and type; defaults the date to today', async () => {
    const { receiver } = await held()
    expect((await officerReportRows({ officerId: receiver.id, category: 'ppe' })).rows.map((x) => x.propertyNos[0])).toEqual(['P-1'])
    expect((await officerReportRows({ officerId: receiver.id, category: 'ppe', typeId: 3 })).rows).toHaveLength(0)
  })

  it('API: the officer is required (400); anonymous 401; the signatory defaults round-trip', async () => {
    const { agent, receiver } = await held()
    expect((await agent.get('/api/reports/rpc?category=semi')).status).toBe(400)
    const ok = await agent.get(`/api/reports/rpc?officerId=${receiver.id}&category=semi&asAt=2026-12-31`)
    expect(ok.status).toBe(200)
    expect(ok.body.rows).toHaveLength(1)
    expect((await agentFor().get('/api/reports/rpc')).status).toBe(401)

    const sigs = [{ role: 'committee', sortOrder: 1, name: 'Ana Reyes', position: 'Chair' }, { role: 'head_of_agency', sortOrder: 1, name: 'Ben Cruz' }]
    expect((await agent.put('/api/report-signatories').send(sigs)).status).toBe(200)
    expect((await agent.get('/api/report-signatories')).body).toHaveLength(2)
    expect((await agent.get(`/api/reports/rpc?officerId=${receiver.id}&category=semi`)).body.signatories).toHaveLength(2)
    expect((await testPool.query(`SELECT action FROM audit_logs WHERE entity='report_signatories'`)).rows).toHaveLength(1)
  })

  it('the officer’s ICS/PAR: listed in issue order, and all of them as one PDF (signed copy first, else generated)', async () => {
    const { agent, receiver, doc, add } = await held()
    const par = await makeDocument(agent, { type: 'PAR', docNo: 'PAR-7', issuedDate: '2026-10-25' })
    await add(lineBody(1, 9645000, [{ propertyNo: 'P-7' }]), par.doc.id)
    const list = await agent.get(`/api/reports/forms?officerId=${receiver.id}`)
    expect(list.status).toBe(200)
    expect(list.body.map((f: { docNo: string; hasPdf: boolean }) => [f.docNo, f.hasPdf])).toEqual([['2026-03SARAi-005', false], ['PAR-7', false]])
    expect((await agent.get(`/api/reports/forms.pdf?officerId=${receiver.id}`)).status).toBe(404) // nothing to merge yet

    await signDocument(agent, doc.id) // 2-page signed copy
    expect((await agent.post(`/api/documents/${par.doc.id}/generate`)).status).toBe(200)
    const pdf = await agent.get(`/api/reports/forms.pdf?officerId=${receiver.id}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/)
    expect((await PDFDocument.load(pdf.body as Buffer)).getPageCount()).toBe(3) // 2 signed + 1 generated
  })

  it('no /api/counts route exists any more', async () => {
    const { agent } = await setup()
    expect((await agent.get('/api/counts')).status).toBe(404)
  })
})
