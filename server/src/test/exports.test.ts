import { rmSync } from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { testPool, resetDb } from './db.js'
import { agentFor, loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

type Agent = Awaited<ReturnType<typeof loginAs>>['agent']
const ICT = 'Information and Communications Technology Equipment'

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

const card = (propertyTypeId: number, article: string, description: string) => ({ new: { propertyTypeId, article, description, unit: 'unit' } })
const lineBody = (cost: number, nos: { propertyNo: string; componentLabel?: string }[], item: object, extra: object = {}) => ({
  line: { qty: 1, unitCostCentavos: cost, description: 'Described', estUsefulLifeYears: 5, dateAcquired: '2026-03-19', ...extra }, item, properties: nos,
})

// A PPE laptop set (ICT) and a semi chair (Furniture and Fixtures) issued to MSantos on 2026-03-19.
async function seed() {
  const { agent } = await loginAs('supply_admin')
  const ics = await makeDocument(agent, { issuedDate: '2026-03-19' })
  const laptop = await agent.post(`/api/documents/${ics.doc.id}/lines`).send(lineBody(9645000,
    [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }], card(1, 'Laptop', 'Lenovo ThinkPad E14'), { description: 'Laptop Unit\nSpecification:\n- Memory: 16GB' }))
  const chair = await agent.post(`/api/documents/${ics.doc.id}/lines`).send(lineBody(450000, [{ propertyNo: 'S-1' }], card(2, 'Chair', 'Office chair')))
  const itemOf = async (lineId: string) => (await testPool.query(`SELECT item_id FROM lines WHERE id=$1`, [lineId])).rows[0].item_id as string
  return { agent, ics, laptopItem: await itemOf(laptop.body.lineId), chairItem: await itemOf(chair.body.lineId) }
}

describe('cards (PC / SPC), one per model', () => {
  it('PC: header text and the merged card row, balance and amount from the view', async () => {
    const { agent, laptopItem } = await seed()
    const x = await sheet(agent, `/api/exports/pc?itemId=${laptopItem}`)
    expect(x.res.headers['content-disposition']).toContain('PC_Laptop_Lenovo_ThinkPad_E14.xlsx')
    expect(x.text('B8')).toBe('Property, Plant and Equipment : Laptop')
    expect(x.text('I9')).toBe('Property Number: L-1')
    expect(x.text('B10')).toContain('Lenovo ThinkPad E14')
    expect(x.ws.getCell('B13').value).toEqual(new Date(Date.UTC(2026, 2, 19)))
    expect(x.text('C13')).toBe('ICS 2026-03SARAi-005')
    // receipt and issue on the same day merge; the Supply Unit holds nothing after the issue
    expect([x.ws.getCell('D13').value, x.ws.getCell('E13').value, x.text('F13'), x.ws.getCell('H13').value, x.ws.getCell('I13').value]).toEqual([1, 1, 'MSantos', 0, 0])
    expect(x.ws.model.merges).toContain('F13:G13')
  })

  it('SPC: the semi-expendable card is drawn with receipt unit cost and total cost', async () => {
    const { agent, chairItem } = await seed()
    const x = await sheet(agent, `/api/exports/spc?itemId=${chairItem}`)
    expect(x.text('A1')).toBe('SEMI-EXPENDABLE PROPERTY CARD')
    expect(x.text('H4')).toBe('Semi-expendable Property Number: S-1')
    expect([x.ws.getCell('C8').value, x.ws.getCell('D8').value, x.ws.getCell('E8').value, x.text('F8'), x.ws.getCell('G8').value, x.text('H8'), x.ws.getCell('I8').value, x.ws.getCell('J8').value])
      .toEqual([1, 4500, 4500, 'S-1', 1, 'MSantos', 0, 0])
  })

  it('the wrong form for the category -> 400 WRONG_FORM', async () => {
    const { agent, laptopItem, chairItem } = await seed()
    const pc = await agent.get(`/api/exports/pc?itemId=${chairItem}`)
    expect(pc.status).toBe(400)
    expect(pc.body.error.code).toBe('WRONG_FORM')
    expect((await agent.get(`/api/exports/spc?itemId=${laptopItem}`)).status).toBe(400)
  })
})

describe('registries (per category and type)', () => {
  it('RegSPI: one row per semi line from row 11; the header names the type; PPE swaps the title; filters; empty is fine', async () => {
    const { agent } = await seed()
    const semi = await sheet(agent, '/api/exports/regspi?typeId=2')
    expect(semi.text('C4')).toBe('REGISTRY OF SEMI-EXPENDABLE PROPERTY ISSUED')
    expect(semi.text('A7')).toBe('Semi-expendable Property: Furniture and Fixtures')
    expect(semi.text('L6')).toBe('Fund Cluster: RAF')
    expect([semi.text('B11'), semi.text('C11'), semi.text('D11'), semi.ws.getCell('F11').value, semi.text('G11'), semi.ws.getCell('M11').value, semi.ws.getCell('N11').value, semi.text('O11')])
      .toEqual(['ICS 2026-03SARAi-005', 'S-1', 'Described', 1, 'MSantos', 1, 4500, ''])
    expect(semi.ws.getCell('A11').value).toEqual(new Date(Date.UTC(2026, 2, 19)))
    const ppe = await sheet(agent, '/api/exports/regppe?typeId=1')
    expect(ppe.text('C4')).toBe('REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED')
    expect(ppe.text('A7')).toBe(`Property, Plant and Equipment: ${ICT}`)
    expect(ppe.text('C10')).toBe('Property No.')
    expect(ppe.text('C11')).toBe('L-1\nL-1a')
    expect(ppe.ws.getCell('N11').value).toBe(96450)
    expect((await sheet(agent, '/api/exports/regspi?typeId=1')).text('B11')).toBe('') // no ICT semi lines
    expect((await sheet(agent, '/api/exports/regspi?from=2030-01-01')).text('B11')).toBe('')
    expect((await sheet(agent, '/api/exports/regspi')).text('A7')).toBe('Semi-expendable Property: All types')
  })
})

describe('officer reports (RPCPPE / RPCSP): count columns are printed blank', () => {
  it('RPCPPE: header sentence, one row per line, balance per card, old P# in remarks, signatories from the request', async () => {
    const { agent, ics } = await seed()
    await testPool.query(`UPDATE properties SET old_property_no='10605140-00-7' WHERE property_no='L-1'`)
    const sigs = encodeURIComponent(JSON.stringify([{ role: 'committee', name: 'Chair A' }, { role: 'committee', sortOrder: 2, name: 'Member B' }, { role: 'head_of_agency', name: 'The Director' }, { role: 'coa_representative', name: 'COA Rep' }]))
    const x = await sheet(agent, `/api/exports/rpcppe?officerId=${ics.receiver.id}&typeId=1&asAt=2026-12-31&signatories=${sigs}`)
    expect(x.res.headers['content-disposition']).toContain('RPCPPE_MSantos_Full_2026-12-31.xlsx')
    expect(x.text('C4')).toBe(ICT)
    expect(x.text('C6')).toBe('As at December 31, 2026')
    expect(x.text('C9')).toBe('Fund Cluster : RAF')
    expect(x.text('C10')).toBe('For which MSantos Full, Engineer II, DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1 is accountable, having assumed such accountability on ________')
    expect([x.text('C15'), x.text('E15'), x.text('F15'), x.ws.getCell('G15').value, x.ws.getCell('H15').value]).toEqual(['Laptop', 'L-1\nL-1a', 'unit', 96450, 1])
    expect([x.text('I15'), x.text('J15'), x.text('K15')]).toEqual(['', '', '']) // On Hand, Shortage/Overage: blank
    expect(x.text('L15')).toBe('Old P#: 10605140-00-7')
    expect(x.text('C16')).toBe('') // the chair is not ICT PPE
    expect([x.text('D38'), x.text('G38'), x.text('K38')]).toEqual(['Chair A\nMember B', 'The Director', 'COA Rep'])
  })

  it('the signatories default to the saved list', async () => {
    const { agent, ics } = await seed()
    await agent.put('/api/report-signatories').send([{ role: 'head_of_agency', name: 'Saved Director' }])
    expect((await sheet(agent, `/api/exports/rpcppe?officerId=${ics.receiver.id}`)).text('G38')).toBe('Saved Director')
  })

  it('RPCSP: drawn form with the semi report and the witnessed-by block; an as-at date before the ICS lists nothing', async () => {
    const { agent, ics } = await seed()
    const x = await sheet(agent, `/api/exports/rpcsp?officerId=${ics.receiver.id}&asAt=2026-12-31`)
    expect(x.text('A1')).toBe('REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY')
    expect(x.text('A4')).toBe('As at December 31, 2026')
    expect([x.text('A11'), x.text('C11'), x.ws.getCell('F11').value, x.text('G11'), x.text('H11'), x.text('I11')]).toEqual(['Chair', 'S-1', 1, '', '', ''])
    const cells = x.ws.getRows(1, 40)!.flatMap((r) => (r.values as unknown[]).map(String))
    expect(cells).toEqual(expect.arrayContaining(['Witnessed by:']))
    expect((await sheet(agent, `/api/exports/rpcsp?officerId=${ics.receiver.id}&asAt=2026-03-18`)).text('A11')).toBe('')
  })

  it('more than 20 lines inserts rows and moves the signature block', async () => {
    const { agent, ics } = await seed()
    for (let i = 0; i < 22; i++) {
      await agent.post(`/api/documents/${ics.doc.id}/lines`).send(lineBody(9000000, [{ propertyNo: `P-${String(i).padStart(2, '0')}` }], card(1, `Monitor ${String(i).padStart(2, '0')}`, 'Dell')))
    }
    await agent.put('/api/report-signatories').send([{ role: 'head_of_agency', name: 'The Director' }])
    const x = await sheet(agent, `/api/exports/rpcppe?officerId=${ics.receiver.id}`) // 23 PPE lines -> 3 extra rows
    expect(x.text('E37')).toBe('P-21') // 23rd row
    expect(x.text('G41')).toBe('The Director') // was G38
  })
})

describe('request checks', () => {
  it('unknown form 404 (ICS/PAR are no longer exported); missing parameter 400; unknown card 404; anonymous 401', async () => {
    const { agent } = await seed()
    expect((await agent.get('/api/exports/nope')).status).toBe(404)
    expect((await agent.get('/api/exports/ics')).status).toBe(404)
    expect((await agent.get('/api/exports/pc')).status).toBe(400)
    expect((await agent.get('/api/exports/rpcppe')).status).toBe(400)
    expect((await agent.get('/api/exports/pc?itemId=00000000-0000-4000-8000-0000000000ff')).status).toBe(404)
    expect((await agentFor().get('/api/exports/regspi')).status).toBe(401)
  })

  it('every export writes an audit row', async () => {
    const { agent } = await seed()
    await agent.get('/api/exports/regspi')
    expect((await testPool.query(`SELECT action FROM audit_logs WHERE action LIKE 'export.%'`)).rows).toEqual([{ action: 'export.regspi' }])
  })
})
