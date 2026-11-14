import { expect, test } from '@playwright/test'
import { E2E } from '../playwright.config'
import { a11y, apiSeed, login, noHorizontalScroll, officerIds, samplePdf } from './helpers'

// Runs after app.spec.ts and day2.spec.ts in the same database (officers JDelaCruz and MSantos exist; MSantos holds PPE).
test.describe.configure({ mode: 'serial' })

const nos = { main: '2026-09ICT-0401', part: '2026-09ICT-0401a', semi: '2026-09ICT-0402' }
let icsId = ''

test('seed: MSantos receives another laptop set and a chair', async ({ page }) => {
  await login(page)
  const s = await apiSeed(page, '2026-05D3-001', nos)
  icsId = s.icsId
  expect(icsId).toBeTruthy()
})

test('reports: one row per line, balance per card filled, the count columns blank, an earlier date leaves them out', async ({ page }) => {
  await login(page)
  // a program on the officer makes them findable by it
  const { receiver } = await officerIds(page)
  const patched = await page.request.patch(`/api/officers/${receiver.id}`, { headers: { Origin: `http://localhost:${E2E.webPort}` }, data: { designations: ['SARAi CENTRO, Focal Person'] } })
  expect(patched.status()).toBe(200)

  await page.goto('/reports')
  await expect(page.getByText('Choose an accountable officer')).toBeVisible()
  await page.locator('#r-search').fill('SARAi')
  await expect(page.locator('#r-officer option', { hasText: 'Maria Santos' })).toHaveCount(1)
  await page.locator('#r-officer').selectOption({ label: 'Maria Santos (MSantos)' })
  await page.locator('#r-asat').fill('2026-12-31')
  await expect(page.getByText('REPORT ON THE PHYSICAL COUNT OF PROPERTY, PLANT AND EQUIPMENT')).toBeVisible()
  await expect(page.locator('.ag-row')).toHaveCount(4) // four laptop sets (app, day2 x2, day3), one row each
  await expect(page.getByRole('gridcell', { name: nos.main })).toBeVisible()
  await expect(page.locator('.ag-cell[col-id]').filter({ hasText: /^$/ }).first()).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'On Hand per Count' })).toBeVisible()
  await expect(page.locator('input[type="text"].ag-input-field-input')).toHaveCount(0) // nothing to type into: counted by hand

  await page.locator('#r-category').selectOption('semi')
  await expect(page.getByText('REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY')).toBeVisible()
  await page.locator('#r-category').selectOption('ppe')

  await page.locator('#r-asat').fill('2026-05-11') // before the first issuance
  await expect(page.getByText('Nothing held on that date')).toBeVisible()
  await page.locator('#r-asat').fill('2026-12-31')
  await expect(page.locator('.ag-row')).toHaveCount(4)
})

test('reports: the footer names are used for printing and saved only as a default; the Excel export downloads', async ({ page }) => {
  await login(page)
  await page.goto('/reports')
  await page.locator('#r-officer').selectOption({ label: 'Maria Santos (MSantos)' })
  await expect(page.locator('.ag-row').first()).toBeVisible()
  await page.locator('#sig-head_of_agency').fill('The Director')
  await page.getByRole('button', { name: 'Save these names as the default' }).click()
  await expect(page.getByText('Saved as the default names')).toBeVisible()
  await page.reload()
  await page.locator('#r-officer').selectOption({ label: 'Maria Santos (MSantos)' })
  await expect(page.locator('#sig-head_of_agency')).toHaveValue('The Director')
  await page.locator('#sig-committee').fill('Chair A\nMember B') // not saved
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export to Excel' }).click()])
  expect(file.suggestedFilename()).toMatch(/^RPCPPE_.*\.xlsx$/)
  await page.reload()
  await page.locator('#r-officer').selectOption({ label: 'Maria Santos (MSantos)' })
  await expect(page.locator('#sig-committee')).toHaveValue('') // the unsaved edit is gone
  await expect(page.getByRole('button', { name: 'Print' })).toBeEnabled()
})

test('signed copy: uploading locks the entries, removing it asks for a reason and unlocks them', async ({ page }) => {
  await login(page)
  await page.goto(`/documents/${icsId}`)
  await expect(page.getByText('Generated, unsigned').first()).toBeVisible()
  await page.getByLabel('Choose the PDF to attach').setInputFiles(await samplePdf('signed-scan.pdf'))
  await expect(page.getByText(/Signed copy attached|PDF attached/)).toBeVisible()
  await expect(page.getByText('Signed', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('its entries are locked')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add lines' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Regenerate' })).toHaveCount(0)

  // the add-rows address refuses a signed form, and the line page is read-only
  await page.goto(`/issue?documentId=${icsId}`)
  await expect(page.getByText('This form has a signed copy')).toBeVisible()
  await page.goto(`/documents/${icsId}`)
  await page.locator('.ag-row').first().click()
  await expect(page.getByRole('heading', { name: 'Edit line' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save line' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Delete line' })).toBeDisabled()

  await page.goto(`/documents/${icsId}`)
  await page.getByRole('button', { name: 'Remove signed copy' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Remove signed copy' })).toBeDisabled() // a reason is required
  await dialog.getByLabel('Why is it being removed?').fill('Wrong receiver typed on the form')
  await dialog.getByRole('button', { name: 'Remove signed copy' }).click()
  await expect(page.getByText(/Signed copy removed/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add lines' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible()
})

test('dashboard: tiles open their pages and the unsigned count follows', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('link', { name: /Unsigned ICS\/PAR/ })).toBeVisible()
  await page.getByRole('link', { name: /Cards/ }).first().click()
  await expect(page).toHaveURL(/\/cards$/)
  await page.goto('/')
  await page.getByRole('link', { name: /Unsigned ICS\/PAR/ }).click()
  await expect(page).toHaveURL(/status=unsigned/)
  await expect(page.getByRole('row').nth(1)).toBeVisible()
})

test('reports and the signed-copy pages: phone width and accessibility', async ({ page }) => {
  await login(page)
  await page.goto('/reports')
  await page.locator('#r-officer').selectOption({ label: 'Maria Santos (MSantos)' })
  await expect(page.locator('.ag-row').first()).toBeVisible()
  expect(await a11y(page), 'reports').toEqual([])
  await page.goto(`/documents/${icsId}`)
  await expect(page.getByText('Page 1 of 1')).toBeVisible()
  expect(await a11y(page), 'document').toEqual([])
  await page.setViewportSize({ width: 360, height: 780 })
  for (const p of ['/reports', `/documents/${icsId}`, '/cards']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    expect(await noHorizontalScroll(page), p).toBe(0)
  }
})
