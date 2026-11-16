import { expect, test } from '@playwright/test'
import { E2E } from '../playwright.config'
import { a11y, apiSeed, apiSign, login, noHorizontalScroll } from './helpers'

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
  await page.getByLabel('Search cards').fill('Chair')
  await page.getByRole('link', { name: 'Office chair' }).first().click()
  const [card] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export SPC' }).click()])
  expect(card.suggestedFilename()).toMatch(/\.xlsx$/)
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

test('a cost that does not fit the picked card: the row switches to the same model’s other card, or offers to create it', async ({ page }) => {
  await login(page)
  await apiSeed(page, '2026-05TWN-001', { main: '2026-05TWN-0001', part: '2026-05TWN-0001a', semi: '2026-05TWN-0002' }, { generate: false })
  // the laptop model also has an SPC card; the chair model has no PC card
  const twin = await page.request.post('/api/items', { headers: { Origin: `http://localhost:${E2E.webPort}` },
    data: { propertyTypeId: 1, article: 'Laptop', description: 'MSI Katana 2026-05TWN-001', unit: 'set', category: 'semi' } })
  expect(twin.status()).toBe(201)

  await page.goto('/issue')
  const r1 = page.getByRole('group', { name: 'Row 1' })
  await r1.getByLabel('Row 1, search cards').fill('MSI Katana 2026-05TWN')
  await r1.getByRole('button', { name: /MSI Katana 2026-05TWN-001 .*SPC/ }).click()
  await r1.getByLabel('Unit cost (₱)').fill('96,450.00') // PPE by cost
  await expect(r1.getByText('Switched to the PC card of this model.')).toBeVisible()
  await expect(r1.getByText('PC', { exact: true })).toBeVisible()
  await r1.getByRole('button', { name: 'Change card' }).click()
  await expect(r1.getByLabel('Row 1, search cards')).toHaveValue('MSI Katana 2026-05TWN-001') // the search keeps the model

  await page.getByRole('button', { name: 'Add a row' }).click()
  const r2 = page.getByRole('group', { name: 'Row 2' })
  await r2.getByLabel('Row 2, search cards').fill('Chair 2026-05TWN')
  await r2.getByRole('button', { name: /Chair 2026-05TWN-001 .*SPC/ }).click()
  await r2.getByLabel('Unit cost (₱)').fill('60,000.00')
  await r2.getByRole('button', { name: 'Create the PC card for this model' }).click()
  await expect(r2.getByLabel('Row 2, article', { exact: true })).toHaveValue('Office chair')
  await expect(r2.getByLabel('Row 2, model', { exact: true })).toHaveValue('Chair 2026-05TWN-001')
  await expect(r2.getByLabel('Unit cost (₱)')).toHaveValue('60,000.00') // nothing typed is lost
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
