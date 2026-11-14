import { expect, test } from '@playwright/test'
import { a11y, apiSeed, login, noHorizontalScroll } from './helpers'

// Runs after app.spec.ts and day2.spec.ts in the same database (officers JDelaCruz and MSantos exist).
test.describe.configure({ mode: 'serial' })

const nos = { main: '2026-09ICT-0401', part: '2026-09ICT-0401a', semi: '2026-09ICT-0402' }
let countUrl = ''
let scanToken = ''

test('seed: MSantos holds a PPE laptop set and a semi chair', async ({ page }) => {
  await login(page)
  const s = await apiSeed(page, '2026-05D3-001', nos)
  scanToken = await s.token(nos.main)
  expect(scanToken).toMatch(/^[0-9A-Za-z]{10}$/)
})

test('counts: empty state, then a new count starts with the officer\'s PPE items only', async ({ page }) => {
  await login(page)
  await page.goto('/counts')
  await expect(page.getByText('No counts yet')).toBeVisible()
  await page.getByRole('button', { name: 'New count' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Create count' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Choose the accountable officer')
  await dialog.locator('#c-officer').selectOption({ label: 'Maria Santos (MSantos)' })
  await expect(dialog.getByText('Printed as: ARD for Field Operations')).toBeVisible()
  await dialog.locator('#c-type').fill('ICT Equipment')
  await dialog.locator('#c-asat').fill('2026-12-31')
  await dialog.getByRole('button', { name: 'Create count' }).click()
  await expect(page.getByRole('heading', { name: /RPCPPE/ })).toBeVisible()
  countUrl = page.url()
  // MSantos's PPE from the earlier tests (0301, 0301a) and this test's (0401, 0401a); the semi chairs are not PPE
  await expect(page.locator('.ag-row')).toHaveCount(4)
  await expect(page.getByText('0 of 4')).toBeVisible()
  await expect(page.getByRole('gridcell', { name: nos.semi })).toHaveCount(0)
})

test('on hand per count: typing a quantity works out the shortage; refresh adds late items', async ({ page }) => {
  await login(page)
  await page.goto(countUrl)
  const row = page.locator(`.ag-row[row-id="${nos.main}"]`) // AG Grid row ids are the property numbers
  const first = row.locator('.ag-cell[col-id="qtyOnHand"]')
  await first.dblclick()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('0')
  await page.keyboard.press('Enter')
  await expect(page.getByText('1 of 4')).toBeVisible()
  await expect(row).toContainText('-₱96,450.00')
  await expect(page.locator('dd', { hasText: '₱96,450.00' }).first()).toBeVisible() // shortage total in the summary

  // a bad entry keeps the old value
  await first.dblclick()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('abc')
  await page.keyboard.press('Enter')
  await expect(first).toHaveText('0')

  const s = await apiSeed(page, '2026-05D3-002', { main: '2026-09ICT-0403', part: '2026-09ICT-0403a', semi: '2026-09ICT-0404' })
  expect(s.docId).toBeTruthy()
  await page.reload()
  await expect(page.locator('.ag-row')).toHaveCount(4)
  await page.getByRole('button', { name: 'Add new holdings' }).click()
  await expect(page.getByText('2 new items added')).toBeVisible()
  await expect(page.locator('.ag-row')).toHaveCount(6)
})

test('the scan page Report tab shows the count with the item highlighted', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`/q/${scanToken}#report`)
  await expect(page.getByText('REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT')).toBeVisible()
  await expect(page.locator('.traces-highlight')).toHaveCount(1)
  await expect(page.locator('.traces-highlight')).toContainText('-₱96,450.00')
  await ctx.close()
})

test('closing: asks first, then the count is read-only and cannot be re-opened', async ({ page }) => {
  await login(page)
  await page.goto(countUrl)
  await page.getByRole('button', { name: 'Close count' }).click()
  await expect(page.getByRole('dialog')).toContainText('cannot be changed or re-opened')
  await expect(page.getByRole('dialog')).toContainText('items have no quantity yet')
  await page.getByRole('dialog').getByRole('button', { name: 'Close the count' }).click()
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close count' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save details' })).toHaveCount(0)
  const cell = page.locator('.ag-row').first().locator('.ag-cell[col-id="qtyOnHand"]')
  await cell.dblclick()
  await expect(page.locator('.ag-cell-inline-editing')).toHaveCount(0)
  const res = await page.request.patch(countUrl.replace('/counts/', '/api/counts/') + `/items/${nos.main}`, {
    headers: { Origin: new URL(page.url()).origin }, data: { qtyOnHand: 5 },
  })
  expect(res.status()).toBe(409)
})

test('counts list, phone width and accessibility', async ({ page }) => {
  await login(page)
  await page.goto('/counts')
  await expect(page.getByRole('cell', { name: 'RPCPPE · ICT Equipment' })).toBeVisible()
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible()
  expect(await a11y(page), 'counts list').toEqual([])
  await page.goto(countUrl)
  await expect(page.locator('.ag-row').first()).toBeVisible()
  expect(await a11y(page), 'closed count').toEqual([])
  await page.setViewportSize({ width: 360, height: 780 })
  for (const p of ['/counts', countUrl.replace(/^https?:\/\/[^/]+/, '')]) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    expect(await noHorizontalScroll(page), p).toBe(0)
  }
})
