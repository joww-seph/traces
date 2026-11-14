import { rmSync } from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { clearSettingsCache } from '../services/settings.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

type Agent = Awaited<ReturnType<typeof loginAs>>['agent']

async function sheet(agent: Agent, url: string) {
  const res = await agent.get(url).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = []
    r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)))
  })
  expect(res.status, url).toBe(200)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer)
  return { ws: wb.worksheets[0], res, text: (a: string) => String(wb.worksheets[0].getCell(a).value ?? '') }
}

const lineBody = (cost: number, nos: { propertyNo: string; componentLabel?: string }[], extra: object = {}) => ({
  line: { qty: 1, unit: 'unit', unitCostCentavos: cost, article: 'Article', description: 'Described', estUsefulLifeYears: 5, ...extra }, properties: nos,
})

async function seed() {
  const { agent } = await loginAs('supply_admin')
  const ics = await makeDocument(agent, { issuedDate: '2026-03-19' })
  await agent.post(`/api/documents/${ics.doc.id}/lines`).send(lineBody(9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }], { article: 'Laptop', description: 'Laptop Unit\nSpecification:\n- Memory: 16GB' }))
  await agent.post(`/api/documents/${ics.doc.id}/lines`).send(lineBody(450000, [{ propertyNo: 'S-1' }], { article: 'Chair', description: 'Office chair' }))
  return { agent, ics }
}

describe('ICS export', () => {
  it('fills the header, lines, signatories and the form code from settings', async () => {
    const { agent, ics } = await seed()
    const x = await sheet(agent, `/api/exports/ics?documentId=${ics.doc.id}`)
    expect(x.res.headers['content-disposition']).toContain('ICS_2026-03SARAi-005.xlsx')
    expect(x.res.headers['content-type']).toContain('spreadsheetml')
    expect(x.text('A7')).toBe('Entity Name: DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1')
    expect(x.text('A8')).toBe('Fund Cluster : RAF')
    expect(x.text('E8')).toBe('ICS No : 2026-03SARAi-005')
    expect(x.text('F2')).toBe('FM-FAS-SUPPLY-07-10\nRev. 1/07-25-22')
    expect([x.ws.getCell('A12').value, x.ws.getCell('B12').value, x.ws.getCell('C12').value, x.ws.getCell('D12').value]).toEqual([1, 'unit', 96450, 96450])
    expect(x.text('E12')).toBe('Laptop Unit\nSpecification:\n- Memory: 16GB')
    expect(x.text('F12')).toBe('L-1\nL-1a')
    expect(x.ws.getCell('G12').value).toBe(5)
    expect(x.ws.getCell('D13').value).toBe(4500)
    expect(x.ws.getRow(12).height).toBeGreaterThan(40) // the 3-line description needs a taller row
    expect(x.text('A19')).toBe('JDELACRUZ FULL') // issuer, printed name in capitals
    expect(x.text('E19')).toBe('MSANTOS FULL')
    expect(x.text('A21')).toBe('Supply Officer IV')
    expect(x.text('E21')).toBe('Engineer II')
    expect(x.text('A23')).toBe('19-Mar-26')
  })

  it('the form code follows the settings (new revision)', async () => {
    const { agent, ics } = await seed()
    await testPool.query(`UPDATE settings SET ics_form_code='FM-FAS-SUPPLY-07-10', ics_form_revision='Rev. 2/01-02-27'`)
    clearSettingsCache()
    expect((await sheet(agent, `/api/exports/ics?documentId=${ics.doc.id}`)).text('F2')).toBe('FM-FAS-SUPPLY-07-10\nRev. 2/01-02-27')
  })

  it('more lines than the 5 template rows: rows are inserted, the footer moves down with its merges and print area', async () => {
    const { agent, ics } = await seed()
    for (let i = 0; i < 5; i++) await agent.post(`/api/documents/${ics.doc.id}/lines`).send(lineBody(100000, [{ propertyNo: `X-${i}` }]))
    const x = await sheet(agent, `/api/exports/ics?documentId=${ics.doc.id}`) // 7 lines -> 2 extra rows
    expect(x.ws.getCell('A18').value).toBe(1) // 7th line
    expect(x.text('F18')).toBe('X-4')
    expect(x.text('A21')).toBe('JDELACRUZ FULL') // footer names were on row 19
    expect(x.text('E23')).toBe('Engineer II')
    expect(x.ws.model.merges).toEqual(expect.arrayContaining(['F2:G3', 'A21:D21', 'E21:G21', 'A5:G5']))
    expect(x.ws.pageSetup.printArea).toBe('A1:G26')
  })
})

describe('PAR export', () => {
  it('Received by on the left (end user), Issued by on the right; long dates; 34 lines insert rows', async () => {
    const { agent } = await loginAs('supply_admin')
    const par = await makeDocument(agent, { type: 'PAR', docNo: '2025-RO-68', issuedDate: '2025-05-31' })
    await agent.post(`/api/documents/${par.doc.id}/lines`).send(lineBody(9200000, [{ propertyNo: 'H-1' }], { article: 'Fume hood', description: 'Fume hood, fabricated', dateAcquired: '1998-08-10', estUsefulLifeYears: undefined }))
    const x = await sheet(agent, `/api/exports/par?documentId=${par.doc.id}`)
    expect(x.text('E2')).toBe('FM-FAS-SUPPLY-07-09\nRev. 1/07-25-22')
    expect(x.text('E7')).toBe('PAR No.: 2025-RO-68')
    expect([x.ws.getCell('A11').value, x.text('C11'), x.text('D11'), x.text('E11'), x.ws.getCell('F11').value]).toEqual([1, 'Fume hood, fabricated', 'H-1', 'August 10, 1998', 92000])
    expect(x.text('A45')).toBe('MSANTOS FULL')
    expect(x.text('D45')).toBe('JDELACRUZ FULL')
    expect(x.text('A49')).toBe('May 31, 2025')
    for (let i = 0; i < 34; i++) await agent.post(`/api/documents/${par.doc.id}/lines`).send(lineBody(100000, [{ propertyNo: `Y-${i}` }]))
    const big = await sheet(agent, `/api/exports/par?documentId=${par.doc.id}`) // 35 lines, 33 fit -> 2 extra
    expect(big.text('A47')).toBe('MSANTOS FULL')
    expect(big.ws.pageSetup.printArea).toBe('A1:F52')
  })
})

describe('cards (PC / SPC)', () => {
  it('PC: header text and the merged card row, balance and amount from the view', async () => {
    const { agent } = await seed()
    const x = await sheet(agent, '/api/exports/pc?no=l-1')
    expect(x.res.headers['content-disposition']).toContain('PC_L-1.xlsx')
    expect(x.text('B8')).toBe('Property, Plant and Equipment : Laptop')
    expect(x.text('I9')).toBe('Property Number: L-1')
    expect(x.text('B10')).toContain('Laptop Unit; Specification:')
    expect(x.ws.getCell('B13').value).toEqual(new Date(Date.UTC(2026, 2, 19)))
    expect(x.text('C13')).toBe('ICS 2026-03SARAi-005')
    expect([x.ws.getCell('D13').value, x.ws.getCell('E13').value, x.text('F13'), x.ws.getCell('H13').value, x.ws.getCell('I13').value]).toEqual([1, 1, 'MSantos', 1, 96450])
    expect(x.ws.model.merges).toContain('F13:G13')
  })

  it('SPC: the semi-expendable card is drawn with receipt unit cost and total cost', async () => {
    const { agent } = await seed()
    const x = await sheet(agent, '/api/exports/spc?no=S-1')
    expect(x.text('A1')).toBe('SEMI-EXPENDABLE PROPERTY CARD')
    expect(x.text('H4')).toBe('Semi-expendable Property Number: S-1')
    expect([x.ws.getCell('C8').value, x.ws.getCell('D8').value, x.ws.getCell('E8').value, x.text('F8'), x.ws.getCell('G8').value, x.text('H8'), x.ws.getCell('I8').value, x.ws.getCell('J8').value])
      .toEqual([1, 4500, 4500, 'S-1', 1, 'MSantos', 1, 4500])
  })

  it('the wrong form for the category -> 400 WRONG_FORM', async () => {
    const { agent } = await seed()
    const pc = await agent.get('/api/exports/pc?no=S-1')
    expect(pc.status).toBe(400)
    expect(pc.body.error.code).toBe('WRONG_FORM')
    expect((await agent.get('/api/exports/spc?no=L-1')).status).toBe(400)
  })
})

describe('registries', () => {
  it('RegSPI: one row per semi line from row 11; PPE registry swaps the title; date filter; empty is fine', async () => {
    const { agent } = await seed()
    const semi = await sheet(agent, '/api/exports/regspi')
    expect(semi.text('C4')).toBe('REGISTRY OF SEMI-EXPENDABLE PROPERTY ISSUED')
    expect(semi.text('L6')).toBe('Fund Cluster: RAF')
    expect([semi.text('B11'), semi.text('C11'), semi.text('D11'), semi.ws.getCell('F11').value, semi.text('G11'), semi.ws.getCell('M11').value, semi.ws.getCell('N11').value, semi.text('O11')])
      .toEqual(['ICS 2026-03SARAi-005', 'S-1', 'Office chair', 1, 'MSantos', 1, 4500, ''])
    expect(semi.ws.getCell('A11').value).toEqual(new Date(Date.UTC(2026, 2, 19)))
    const ppe = await sheet(agent, '/api/exports/regppe')
    expect(ppe.text('C4')).toBe('REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED')
    expect(ppe.text('C10')).toBe('Property No.')
    expect(ppe.text('C11')).toBe('L-1\nL-1a')
    expect(ppe.ws.getCell('N11').value).toBe(96450)
    const none = await sheet(agent, '/api/exports/regspi?from=2030-01-01')
    expect(none.text('B11')).toBe('')
  })

  it('many rows: every registry row is written below the header', async () => {
    const { agent, ics } = await seed()
    for (let i = 0; i < 12; i++) await agent.post(`/api/documents/${ics.doc.id}/lines`).send(lineBody(100000, [{ propertyNo: `Z-${i}` }]))
    const x = await sheet(agent, '/api/exports/regspi')
    expect(x.ws.getRow(23).getCell(3).value).toBeTruthy() // 13 semi lines -> rows 11..23
    expect(x.ws.getRow(24).getCell(3).value).toBeNull()
  })
})

describe('count reports (RPCPPE / RPCSP)', () => {
  async function seedCount(category: 'ppe' | 'semi') {
    const { agent, ics } = await seed()
    await testPool.query(`UPDATE properties SET old_property_no='10605140-00-7' WHERE property_no=$1`, [category === 'ppe' ? 'L-1' : 'S-1'])
    const created = await agent.post('/api/counts').send({
      category, typeLabel: 'ICT Equipment', asAt: '2026-12-31', fundCluster: 'RAF', officerId: ics.receiver.id, assumptionDate: '2024-01-15',
      signatories: [{ role: 'committee', name: 'Chair A' }, { role: 'committee', name: 'Member B' }, { role: 'head_of_agency', name: 'The Director' }, { role: 'coa_representative', name: 'COA Rep' }],
    })
    await agent.patch(`/api/counts/${created.body.id}/items/${category === 'ppe' ? 'L-1' : 'S-1'}`).send({ qtyOnHand: 0, remarks: 'lost' })
    return { agent, id: created.body.id as string }
  }

  it('RPCPPE: header sentence, rows with shortage, old P# in remarks, signatories', async () => {
    const { agent, id } = await seedCount('ppe')
    const x = await sheet(agent, `/api/exports/rpcppe?countId=${id}`)
    expect(x.res.headers['content-disposition']).toContain('RPCPPE_MSantos_2026-12-31.xlsx')
    expect(x.text('C4')).toBe('ICT Equipment')
    expect(x.text('C6')).toBe('As at December 31, 2026')
    expect(x.text('C9')).toBe('Fund Cluster : RAF')
    expect(x.text('C10')).toBe('For which MSantos Full, Engineer II, DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1 is accountable, having assumed such accountability on January 15, 2024')
    expect([x.text('C15'), x.text('E15'), x.text('F15'), x.ws.getCell('G15').value, x.ws.getCell('H15').value, x.ws.getCell('I15').value, x.ws.getCell('J15').value, x.ws.getCell('K15').value])
      .toEqual(['Laptop', 'L-1', 'unit', 96450, 1, 0, -1, -96450])
    expect(x.text('L15')).toBe('lost\nOld P#: 10605140-00-7')
    expect(x.ws.getCell('I16').value).toBe('') // L-1a not counted yet
    expect([x.text('D38'), x.text('G38'), x.text('K38')]).toEqual(['Chair A\nMember B', 'The Director', 'COA Rep'])
  })

  it('RPCPPE with more than 20 items inserts rows and moves the signature block', async () => {
    const { agent, ics } = await seed()
    await agent.post(`/api/documents/${ics.doc.id}/lines`).send(lineBody(9000000, Array.from({ length: 22 }, (_, i) => ({ propertyNo: `P-${String(i).padStart(2, '0')}` }))))
    const id = (await agent.post('/api/counts').send({
      category: 'ppe', typeLabel: 'Many', asAt: '2026-12-31', fundCluster: 'RAF', officerId: ics.receiver.id,
      signatories: [{ role: 'head_of_agency', name: 'The Director' }],
    })).body.id // 2 + 22 = 24 items -> 4 extra rows
    const x = await sheet(agent, `/api/exports/rpcppe?countId=${id}`)
    expect(x.text('E38')).toBe('P-21') // 24th row
    expect(x.text('G42')).toBe('The Director') // was G38
    expect(x.ws.model.merges).toEqual(expect.arrayContaining(['G42:I42', 'K42:L42']))
  })

  it('RPCSP: drawn form with the semi count, witnessed-by block', async () => {
    const { agent, id } = await seedCount('semi')
    const x = await sheet(agent, `/api/exports/rpcsp?countId=${id}`)
    expect(x.text('A1')).toBe('REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY')
    expect(x.text('A4')).toBe('As at December 31, 2026')
    expect([x.text('A11'), x.text('C11'), x.ws.getCell('F11').value, x.ws.getCell('G11').value, x.ws.getCell('H11').value, x.ws.getCell('I11').value]).toEqual(['Chair', 'S-1', 1, 0, -1, -4500])
    expect(x.text('J11')).toBe('lost\nOld P#: 10605140-00-7')
    const cells = x.ws.getRows(1, 40)!.flatMap((r) => (r.values as unknown[]).map(String))
    expect(cells).toEqual(expect.arrayContaining(['Witnessed by:', 'COA Rep', 'Chair A\nMember B']))
  })

  it('the wrong count form -> 400; unknown count -> 404', async () => {
    const { agent, id } = await seedCount('ppe')
    expect((await agent.get(`/api/exports/rpcsp?countId=${id}`)).status).toBe(400)
    expect((await agent.get('/api/exports/rpcppe?countId=00000000-0000-4000-8000-000000000000')).status).toBe(404)
  })
})

describe('request checks', () => {
  it('unknown form 404; missing parameter 400; bad document 404; anonymous 401', async () => {
    const { agent, ics } = await seed()
    expect((await agent.get('/api/exports/nope')).status).toBe(404)
    expect((await agent.get('/api/exports/ics')).status).toBe(400)
    expect((await agent.get('/api/exports/pc')).status).toBe(400)
    expect((await agent.get('/api/exports/ics?documentId=00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await agent.get(`/api/exports/par?documentId=${ics.doc.id}`)).body.error.code).toBe('WRONG_FORM')
    expect((await agentFor().get('/api/exports/regspi')).status).toBe(401)
  })
})

