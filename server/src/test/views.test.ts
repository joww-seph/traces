import { rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db/client.js'
import { card, countRows, registry } from '../services/views.js'
import { testPool, resetDb } from './db.js'
import { loginAs, makeDocument } from './helpers.js'

const STORAGE = path.resolve(process.env.STORAGE_DIR!)
beforeEach(async () => { await resetDb(); rmSync(STORAGE, { recursive: true, force: true }) })
afterAll(async () => { rmSync(STORAGE, { recursive: true, force: true }); await pool.end(); await testPool.end() })

const lineBody = (qty: number, cost: number, nos: { propertyNo: string; componentLabel?: string; oldPropertyNo?: string }[], extra: object = {}) => ({
  line: { qty, unit: 'unit', unitCostCentavos: cost, article: 'Article', description: 'Description', ...extra }, properties: nos,
})

async function setup(docOver: Parameters<typeof makeDocument>[1] = {}) {
  const { agent } = await loginAs('supply_admin')
  const { doc, receiver } = await makeDocument(agent, docOver)
  return { agent, doc, receiver, add: (body: object) => agent.post(`/api/documents/${doc.id}/lines`).send(body) }
}

describe('registry', () => {
  it('a qty-3 line with 3 main units: issued 3, amount 3 x unit cost, nothing returned or disposed', async () => {
    const { add } = await setup()
    await add(lineBody(3, 4870000, [{ propertyNo: 'S-1' }, { propertyNo: 'S-2' }, { propertyNo: 'S-3' }]))
    const rows = await registry('semi')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      issuedQty: 3, returnedQty: 0, reissuedQty: 0, disposedQty: 0, balanceQty: 3, amountCentavos: 3 * 4870000,
      propertyNos: ['S-1', 'S-2', 'S-3'], reference: 'ICS 2026-03SARAi-005', issuedTo: 'MSantos',
    })
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/) // the line id: the row a QR scan highlights
  })

  it('components do not add to the quantity but their numbers are listed', async () => {
    const { add } = await setup()
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }, { propertyNo: 'L-1a', componentLabel: 'Mouse' }]))
    const [r] = await registry('ppe')
    expect(r).toMatchObject({ issuedQty: 1, amountCentavos: 9645000, propertyNos: ['L-1', 'L-1a'] })
  })

  it('filters by category and issued date; ordered by date', async () => {
    const { add, agent } = await setup({ issuedDate: '2026-03-01' })
    await add(lineBody(1, 4870000, [{ propertyNo: 'S-1' }]))
    await add(lineBody(1, 9645000, [{ propertyNo: 'P-1' }]))
    const second = await makeDocument(agent, { docNo: '2026-09-009', issuedDate: '2026-09-10' })
    await agent.post(`/api/documents/${second.doc.id}/lines`).send(lineBody(1, 100000, [{ propertyNo: 'S-9' }]))
    expect((await registry('semi')).map((r) => r.propertyNos[0])).toEqual(['S-1', 'S-9'])
    expect((await registry('ppe')).map((r) => r.propertyNos[0])).toEqual(['P-1'])
    expect((await registry('semi', '2026-06-01', '2026-12-31')).map((r) => r.propertyNos[0])).toEqual(['S-9'])
    expect(await registry('semi', undefined, '2026-03-31')).toHaveLength(1)
  })
})

describe('card', () => {
  it('merged: one row with receipt, issue, officer, balance 1 and amount = unit cost', async () => {
    const { add } = await setup()
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }]))
    const c = await card('l-1')
    expect(c.property).toMatchObject({ propertyNo: 'L-1', category: 'ppe' })
    expect(c.rows).toHaveLength(1)
    expect(c.rows[0]).toMatchObject({ receiptQty: 1, issueQty: 1, officer: 'MSantos', balanceQty: 1, amountCentavos: 9645000 })
  })

  it('split (setting): 2 rows', async () => {
    const { add } = await setup()
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }]))
    await testPool.query(`UPDATE settings SET card_row_mode='split'`)
    const { clearSettingsCache } = await import('../services/settings.js')
    clearSettingsCache()
    expect((await card('L-1')).rows).toHaveLength(2)
  })

  it('a DISPOSE inserted directly gives balance 0 and amount 0', async () => {
    const { add } = await setup()
    await add(lineBody(1, 9645000, [{ propertyNo: 'L-1' }]))
    await testPool.query(`INSERT INTO movements (property_id, type, date) SELECT id, 'DISPOSE', '2026-09-01' FROM properties WHERE property_no='L-1'`)
    const rows = (await card('L-1')).rows
    expect(rows.at(-1)).toMatchObject({ balanceQty: 0, amountCentavos: 0, remarks: 'Disposed' })
  })

  it('unknown or voided property -> 404', async () => {
    await setup()
    await expect(card('NOPE-1')).rejects.toMatchObject({ status: 404 })
  })
})

describe('countRows', () => {
  async function seedCount(onHand: number | null) {
    const { add, receiver } = await setup()
    await add(lineBody(1, 4870000, [{ propertyNo: 'S-1', oldPropertyNo: '10605140-00-7' }]))
    const userId = (await testPool.query('SELECT id FROM users LIMIT 1')).rows[0].id
    const countId = (await testPool.query(
      `INSERT INTO physical_counts (category, type_label, as_at, fund_cluster, officer_id, officer_position, created_by)
       VALUES ('semi','ICT','2026-12-31','RAF',$1,'Engineer',$2) RETURNING id`, [receiver.id, userId])).rows[0].id
    await testPool.query(`INSERT INTO count_items (count_id, property_id, qty_on_hand) SELECT $1, id, $2 FROM properties`, [countId, onHand])
    return countId as string
  }

  it('not counted yet: on hand and shortage are null', async () => {
    const rows = await countRows(await seedCount(null))
    expect(rows[0]).toMatchObject({ id: 'S-1', balancePerCard: 1, qtyOnHand: null, shortageOverageQty: null, shortageOverageValueCentavos: null })
  })

  it('on hand 0 against balance 1: -1 and minus the unit value', async () => {
    const rows = await countRows(await seedCount(0))
    expect(rows[0]).toMatchObject({ qtyOnHand: 0, shortageOverageQty: -1, shortageOverageValueCentavos: -4870000, unitValueCentavos: 4870000 })
  })

  it('the old property number is added to Remarks automatically', async () => {
    const countId = await seedCount(1)
    await testPool.query(`UPDATE count_items SET remarks='good, in use'`)
    expect((await countRows(countId))[0].remarks).toBe('good, in use\nOld P#: 10605140-00-7')
  })
})
