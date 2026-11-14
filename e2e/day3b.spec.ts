import { expect, test } from '@playwright/test'
import { E2E } from '../playwright.config'
import { a11y, login, noHorizontalScroll } from './helpers'

// Files run in name order, so this runs after day3.spec.ts in the same database (the semi chair 2026-09ICT-0402 exists).
test.describe.configure({ mode: 'serial' })

const person = { name: 'Pat Example', email: 'pat.example@traces.test' }
let temp = ''

test('exports: registry and property card download an .xlsx', async ({ page }) => {
  await login(page)
  await page.goto('/registry')
  const [registry] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /^Export/ }).first().click()])
  expect(registry.suggestedFilename()).toMatch(/\.xlsx$/)
  await page.goto('/cards/2026-09ICT-0402')
  const [card] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export SPC' }).click()])
  expect(card.suggestedFilename()).toMatch(/\.xlsx$/)
})

test('a supply admin does not see the admin pages', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('link', { name: 'User accounts' })).toHaveCount(0)
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'User accounts' })).toHaveCount(0)
})

test('users: add shows a one-time temporary password, which works once', async ({ page, browser }) => {
  await login(page, E2E.superadmin)
  await page.goto('/admin/users')
  await page.getByRole('button', { name: 'Add user' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Full name').fill(person.name)
  await dialog.getByLabel('Email').fill('not-an-email')
  await dialog.getByRole('button', { name: 'Add user' }).click()
  await expect(dialog.getByText(/valid email|Invalid email/i)).toBeVisible()
  await dialog.getByLabel('Email').fill(person.email)
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

  // adding the same email again is refused
  await page.getByRole('button', { name: 'Add user' }).first().click()
  await dialog.getByLabel('Full name').fill('Someone Else')
  await dialog.getByLabel('Email').fill(person.email.toUpperCase())
  await dialog.getByRole('button', { name: 'Add user' }).click()
  await expect(dialog.getByText('Someone already uses that email address')).toBeVisible()
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
  for (const url of ['/admin/users', '/admin/settings', '/admin/audit']) {
    await page.goto(url)
    await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
    expect(await noHorizontalScroll(page), url).toBe(0)
  }
})
