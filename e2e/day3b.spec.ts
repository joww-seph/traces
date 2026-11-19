import { expect, test } from '@playwright/test'
import { E2E } from '../playwright.config'
import { a11y, apiSeed, apiSign, login, noHorizontalScroll, pickOfficer } from './helpers'

// Files run in name order, so this runs after day3.spec.ts in the same database (the semi chair 2026-09ICT-0402 exists).
test.describe.configure({ mode: 'serial' })

const person = { name: 'Pat Example', email: 'pexample@region1.dost.gov.ph' }
let temp = ''

test('exports: registry and a model card download an .xlsx', async ({ page }) => {
  await login(page)
  await page.goto('/registry')
  const [registry] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Export/ }).first().click()])
  expect(registry.suggestedFilename()).toMatch(/\.xlsx$/)
  await page.goto('/cards')
  await page.getByLabel('Search cards').fill('2026-09ICT-0402')
  await page.getByRole('link', { name: '2026-09ICT-0402' }).first().click()
  const [card] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export SPC' }).click()])
  expect(card.suggestedFilename()).toMatch(/\.xlsx$/)
})

test('issuance form opens when the officer list arrives after the settings', async ({ page }) => {
  await login(page)
  const loops: string[] = []
  page.on('console', (m) => { if (m.text().includes('Maximum update depth')) loops.push(m.text()) })
  await page.route('**/api/officers?active=true', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue() })
  await page.goto('/issue')
  await page.waitForTimeout(2000)
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0)
  expect(loops).toEqual([])
  await expect(page.getByLabel('Row 1, article')).toBeVisible()
  await page.unroute('**/api/officers?active=true')
})

test('delete form: an unsigned ICS can be deleted after confirming; a signed PAR has no delete button', async ({ page }) => {
  await login(page)
  const nos = { main: '2026-05DEL-0001', part: '2026-05DEL-0001a', semi: '2026-05DEL-0002' }
  const s = await apiSeed(page, '2026-05DEL-001', nos)
  await apiSign(page, s.parId, 1)
  const semiToken = await s.token(nos.semi)

  await page.goto(`/documents/${s.parId}`)
  await expect(page.getByText('its entries are locked')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete form' })).toHaveCount(0)

  await page.goto(`/documents/${s.icsId}`)
  await page.getByRole('button', { name: 'Delete form' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('cannot be used again')).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep the form' }).click()
  await expect(page).toHaveURL(new RegExp(`/documents/${s.icsId}$`)) // nothing happened

  await page.getByRole('button', { name: 'Delete form' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete ICS 2026-05DEL-001' }).click()
  await expect(page).toHaveURL(/\/documents$/)
  await expect(page.getByText('ICS 2026-05DEL-001 deleted')).toBeVisible()
  await page.getByLabel('Search by document number').fill('2026-05DEL-001')
  await expect(page.getByRole('link', { name: '2026-05DEL-001-P' })).toBeVisible() // the signed PAR stays
  await expect(page.getByRole('link', { name: '2026-05DEL-001', exact: true })).toHaveCount(0)

  await page.goto(`/q/${semiToken}`) // its sticker stops working
  await expect(page.getByText('This item was removed')).toBeVisible()
})

test('one PAR per PPE unit: two laptops in one row get two PAR numbers in a row; the history of a form shows what was done', async ({ page }) => {
  await login(page)
  await page.goto('/issue')
  const r1 = page.getByRole('group', { name: 'Row 1' })
  await r1.getByLabel('Row 1, property type', { exact: true }).selectOption({ label: 'ICT · Information and Communications Technology Equipment' })
  await r1.getByLabel('Row 1, article', { exact: true }).fill('Laptop')
  await r1.getByLabel('Row 1, unit', { exact: true }).fill('unit')
  await r1.getByLabel('Description (model and specifications, as printed)').fill('Lenovo ThinkPad E14')
  await r1.getByLabel('Quantity').fill('2')
  await r1.getByLabel('Unit cost (₱)').fill('60,000.00')
  await r1.getByLabel('Date acquired').fill('2026-05-03')
  await r1.getByLabel('Row 1, unit 1, property number').fill('2026-05TWO-0001')
  await r1.getByLabel('Row 1, unit 2, property number').fill('2026-05TWO-0002')
  await r1.getByLabel('Row 1, unit 2, serial number').fill('PF-2')
  await pickOfficer(page, 'rcv', 'Maria Santos')
  await pickOfficer(page, 'issuer', 'Juan Dela Cruz')
  await page.locator('#date').fill('2026-05-12')
  await page.getByLabel('Office unit').selectOption('ADM')
  await expect(page.getByTestId('summary')).toHaveText('This creates 2 PAR (one per PPE unit).')
  await expect(page.locator('#parNo-0')).toHaveValue(/^2026-05ADM-\d{3}$/) // the suggestion arrives from the server
  const first = await page.locator('#parNo-0').inputValue()
  const next = `2026-05ADM-${String(Number(first.slice(-3)) + 1).padStart(3, '0')}`
  await expect(page.locator('#parNo-1')).toHaveValue(next) // consecutive
  await page.getByRole('button', { name: "Save, I'll upload the PDF" }).click()
  await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible()
  await expect(page.getByText(first)).toBeVisible()
  await expect(page.getByText(next)).toBeVisible()

  // the second PAR's page: its History lists the save
  await page.getByRole('listitem').filter({ hasText: next }).getByRole('link', { name: 'Open' }).click()
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
  await expect(page.getByText('Form created')).toBeVisible()
  await expect(page.getByText('Line added')).toBeVisible()
  await expect(page.getByRole('gridcell', { name: '2026-05TWO-0002' })).toBeVisible() // this PAR holds the second laptop only
  await page.evaluate(() => localStorage.clear()) // no draft left for later tests
})

test('a supply admin does not see the admin pages', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('link', { name: 'User accounts' })).toHaveCount(0)
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'User accounts' })).toHaveCount(0)
  // officers and property types are kept by the IT officer
  await expect(page.getByRole('link', { name: 'Officers' })).toHaveCount(0)
  for (const url of ['/officers', '/property-types', '/units']) {
    await page.goto(url)
    await expect(page.getByRole('button', { name: /Add (officer|type)/ })).toHaveCount(0)
  }
})

test('the IT officer does not see the records pages', async ({ page }) => {
  await login(page, E2E.superadmin)
  await expect(page).toHaveURL(/\/admin\/users$/) // starts on the accounts page, not the dashboard
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const name of ['Dashboard', 'New issuance', 'ICS and PAR', 'Cards', 'Registry', 'Reports', 'Stickers']) await expect(nav.getByRole('link', { name })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'User accounts' })).toBeVisible()
  for (const url of ['/issue', '/documents', '/cards', '/registry', '/reports', '/stickers', '/properties/2026-09ICT-0402']) {
    await page.goto(url)
    await expect(page.getByText('You do not have access to this page.')).toBeVisible()
  }
})

test('users: add shows a one-time temporary password, which works once', async ({ page, browser }) => {
  await login(page, E2E.superadmin)
  await page.goto('/admin/users')
  await page.getByRole('button', { name: 'Add user' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Full name').fill(person.name)
  // the email is made from the name
  await expect(dialog.getByLabel(/^Email/)).toHaveValue(person.email)
  await dialog.getByRole('button', { name: 'Add user' }).click()

  const pw = page.getByRole('dialog')
  await expect(pw.getByRole('heading', { name: `Temporary password for ${person.name}` })).toBeVisible()
  temp = await pw.getByLabel('Temporary password').inputValue()
  expect(temp.length).toBeGreaterThanOrEqual(16)
  expect(await a11y(page)).toEqual([])
  await pw.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('row', { name: new RegExp(person.email) })).toContainText('must change password')

  // the new person signs in with it and is sent to change it
  const ctx = await browser.newContext({ baseURL: `http://localhost:${E2E.webPort}` })
  const other = await ctx.newPage()
  await other.goto('/login')
  await other.getByLabel('Email address').fill(person.email)
  await other.getByLabel('Password', { exact: true }).fill(temp)
  await other.getByRole('button', { name: 'Sign in' }).click()
  await expect(other).toHaveURL(/account\/password/)
  await ctx.close()

  // a second person with the same short name gets a numbered address
  await page.getByRole('button', { name: 'Add user' }).first().click()
  await dialog.getByLabel('Full name').fill('Pia Example')
  await dialog.getByRole('button', { name: 'Add user' }).click()
  await pw.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('row', { name: /pexample2@region1\.dost\.gov\.ph/ })).toBeVisible()
})

test('users: reset, deactivate, and the last superadmin is protected', async ({ page }) => {
  await login(page, E2E.superadmin)
  await page.goto('/admin/users')
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Reset password of ${person.name}` }).click()
  const pw = page.getByRole('dialog')
  await expect(pw.getByLabel('Temporary password')).not.toHaveValue(temp)
  await pw.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: `Deactivate ${person.name}` }).click()
  await expect(page.getByRole('row', { name: new RegExp(person.email) })).toContainText('Inactive')
  await page.getByRole('button', { name: `Reactivate ${person.name}` }).click()
  await expect(page.getByRole('row', { name: new RegExp(person.email) })).toContainText('Active')

  await page.getByRole('button', { name: /^Deactivate E2E Super/ }).click()
  await expect(page.getByText('last active superadmin')).toBeVisible()
})

test('settings: change the entity name and the PPE threshold, then put them back', async ({ page }) => {
  await login(page, E2E.superadmin)
  await page.goto('/admin/settings')
  const name = page.getByLabel('Entity name')
  const original = await name.inputValue()
  await name.fill('DOST Region 1 (E2E)')
  await page.getByLabel('PPE threshold (pesos)').fill('abc')
  await expect(page.getByText('Enter pesos, for example 50,000.00.')).toBeVisible()
  await page.getByLabel('PPE threshold (pesos)').fill('50,000.00')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Settings saved')).toBeVisible()
  await page.reload()
  await expect(name).toHaveValue('DOST Region 1 (E2E)')
  expect(await a11y(page)).toEqual([])
  await name.fill(original)
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Settings saved')).toBeVisible()
})

test('audit log: shows the changes with before and after, and filters', async ({ page }) => {
  await login(page, E2E.superadmin)
  await page.goto('/admin/audit')
  await expect(page.getByRole('row').nth(1)).toBeVisible()
  await page.getByLabel('Record type').selectOption('settings')
  const first = page.getByRole('row').nth(1)
  await expect(first).toContainText('settings.update')
  await first.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByText('DOST Region 1 (E2E)').first()).toBeVisible()
  expect(await a11y(page)).toEqual([])
  await page.getByLabel('From').fill('2999-01-01')
  await expect(page.getByText('No entries match these filters.')).toBeVisible()
  expect(await noHorizontalScroll(page)).toBe(0)
})

test('admin pages fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await login(page, E2E.superadmin)
  for (const url of ['/admin/users', '/admin/settings', '/admin/audit', '/officers', '/property-types', '/units']) {
    await page.goto(url)
    await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
    expect(await noHorizontalScroll(page), url).toBe(0)
  }
})

test('an unknown address shows a not-found page inside the app', async ({ page }) => {
  await login(page)
  await page.goto('/no/such/page')
  await expect(page.getByText('Page not found')).toBeVisible()
  await page.getByRole('link', { name: 'Go to the dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})

test('physical count by QR scan: counted rows, unserviceable items go to the IIRUSP, and only the counting phone sees the panel', async ({ page, browser }) => {
  await login(page)
  const s = await apiSeed(page, '2026-05CNT-001', { main: '2026-05CNT-0001', part: '2026-05CNT-0001a', semi: '2026-05CNT-0002' })
  const chair = await s.token('2026-05CNT-0002')
  const openReport = async () => {
    await page.goto('/reports')
    await pickOfficer(page, 'r-officer', 'Maria Santos')
    await page.getByLabel('Report', { exact: true }).selectOption('semi')
  }

  // a phone with no count on it shows the plain page
  await page.goto(`/q/${chair}`)
  await expect(page.getByRole('heading', { name: 'Office chair', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Physical count' })).toHaveCount(0)

  await openReport()
  await page.getByRole('button', { name: 'Start the count' }).click()
  await expect(page.getByText(/0 of \d+ counted/)).toBeVisible()

  // scanning with this phone: serviceable
  await page.goto(`/q/${chair}`)
  await expect(page.getByRole('heading', { name: 'Physical count' })).toBeVisible()
  await page.getByRole('button', { name: 'Serviceable', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '2026-05CNT-0002 counted as serviceable' })).toBeVisible()
  await expect(page.getByText(/1 of \d+ counted/)).toBeVisible()

  await openReport()
  await page.getByLabel('Show', { exact: true }).selectOption('counted')
  const report = page.getByRole('region', { name: 'REPORT ON THE PHYSICAL COUNT OF SEMI-EXPENDABLE PROPERTY' })
  await expect(report.getByText('2026-05CNT-0002')).toBeVisible()
  await expect(report.getByRole('gridcell', { name: 'Counted', exact: true }).first()).toBeVisible()

  // a mis-tap is fixed by scanning again; this time it is unserviceable and leaves the report for the IIRUSP
  await page.goto(`/q/${chair}`)
  await page.getByRole('button', { name: 'Unserviceable' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'counted as unserviceable' })).toContainText('IIRUSP')
  await openReport()
  await expect(report.getByText('2026-05CNT-0002')).toHaveCount(0)
  const iirusp = page.getByRole('region', { name: 'Unserviceable property (IIRUSP)' })
  await expect(iirusp.getByText('2026-05CNT-0002')).toBeVisible()

  // another browser, signed in or not, does not get the panel
  const other = await browser.newContext()
  const anon = await other.newPage()
  await anon.goto(`/q/${chair}`)
  await expect(anon.getByRole('heading', { name: 'Office chair', level: 1 })).toBeVisible()
  await expect(anon.getByRole('heading', { name: 'Physical count' })).toHaveCount(0)
  await other.close()

  // close the count: no more scans
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Close the count' }).click()
  await expect(page.getByText(/· closed/)).toBeVisible()
  await page.goto(`/q/${chair}`)
  await expect(page.getByRole('heading', { name: 'Office chair', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Physical count' })).toHaveCount(0) // closing it stopped counting on this phone
})
