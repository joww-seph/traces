import { expect, test, type Page } from '@playwright/test'
import { E2E } from '../playwright.config'
import { a11y, login, noHorizontalScroll, samplePdf } from './helpers'

test.describe.configure({ mode: 'serial' })

async function addOfficer(page: Page, fullName: string, shortName: string, position: string) {
  await page.goto('/officers')
  await page.getByRole('button', { name: 'Add officer' }).click()
  await page.locator('#o-fullName').fill(fullName)
  await page.locator('#o-shortName').fill(shortName)
  await page.locator('#o-position').fill(position)
  await page.getByRole('dialog').getByRole('button', { name: 'Add officer' }).click()
}

test.describe('sign in', () => {
  test('wrong password shows a clear message; the right one reaches the dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email address').fill(E2E.supply.email)
    await page.getByLabel('Password', { exact: true }).fill('not-the-password-1')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password')
    await login(page)
    await expect(page.getByText('User accounts')).toHaveCount(0) // supply admin sees no administration menu
  })

  test('protected pages send a signed-out visitor to the login page', async ({ page }) => {
    await page.goto('/documents')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('phone: no building illustration, brand and form visible together, nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'TRACES' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeInViewport()
    await expect(page.locator('img[src="/login-bg.webp"]')).toBeHidden()
    expect(await noHorizontalScroll(page)).toBe(0)
  })
})

test.describe('records flow', () => {
  test('officers: add two, a duplicate short name is refused', async ({ page }) => {
    await login(page)
    await addOfficer(page, 'Juan Dela Cruz', 'JDelaCruz', 'Administrative Officer V')
    await expect(page.getByRole('cell', { name: 'JDelaCruz' })).toBeVisible()
    await addOfficer(page, 'Maria Santos', 'MSantos', 'ARD for Field Operations')
    await expect(page.getByRole('cell', { name: 'MSantos' })).toBeVisible()
    await addOfficer(page, 'Someone Else', 'msantos', 'Clerk')
    await expect(page.getByText('That short name is already used')).toBeVisible()
  })

  test('new ICS: positions fill in, the date is spelled out, the PDF is required, the form saves', async ({ page }) => {
    await login(page)
    await page.goto('/documents/new')
    await page.locator('#docNo').fill('2026-03SARAi-005')
    await page.locator('#issuedDate').fill('2026-05-12')
    await expect(page.getByText('May 12, 2026')).toBeVisible()
    await page.locator('#issuedBy').selectOption({ label: 'Juan Dela Cruz (JDelaCruz)' })
    await page.locator('#receivedBy').selectOption({ label: 'Maria Santos (MSantos)' })
    await expect(page.locator('#issuedByPosition')).toHaveValue('Administrative Officer V')
    await expect(page.locator('#receivedByPosition')).toHaveValue('ARD for Field Operations')
    await page.getByRole('button', { name: 'Save and add lines' }).click()
    await expect(page.getByText('Attach the signed PDF of this form.')).toBeVisible()
    await page.locator('#pdf').setInputFiles(await samplePdf())
    await page.getByRole('button', { name: 'Save and add lines' }).click()
    await expect(page.getByRole('heading', { name: '2026-03SARAi-005' })).toBeVisible()
    await expect(page.getByText('Page 1 of 2')).toBeVisible()
    await expect(page.getByText('No lines yet')).toBeVisible()
  })

  test('a number already on file cannot be used twice', async ({ page }) => {
    await login(page)
    await page.goto('/documents/new')
    await page.locator('#docNo').fill('2026-03SARAi-005')
    await page.locator('#issuedDate').fill('2026-05-12')
    await page.locator('#issuedBy').selectOption({ label: 'Juan Dela Cruz (JDelaCruz)' })
    await page.locator('#receivedBy').selectOption({ label: 'Maria Santos (MSantos)' })
    await page.locator('#pdf').setInputFiles(await samplePdf())
    await page.getByRole('button', { name: 'Save and add lines' }).click()
    await expect(page.getByText(/already exists/)).toBeVisible()
  })

  test('add the laptop set with a box on the PDF; the registry data is right; a repeated number is refused', async ({ page }) => {
    await login(page)
    await page.goto('/documents')
    await page.getByRole('link', { name: '2026-03SARAi-005' }).first().click()
    await page.getByRole('link', { name: 'Add line' }).first().click()

    await page.locator('#qty').fill('1')
    await page.locator('#unit').fill('set')
    await page.locator('#unitCost').fill('96,450.00')
    await page.locator('#article').fill('Laptop')
    await page.locator('#description').fill('Laptop Unit, MSI Katana\nSpecification:\n- Memory: 16GB')
    await page.locator('#estUsefulLifeYears').fill('5')
    await expect(page.getByText('PPE', { exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'normally issued on a PAR' })).toBeVisible()

    await page.getByLabel('Property number 1', { exact: true }).fill('2026-09ICT-0199')
    await page.getByRole('button', { name: 'Add component' }).click()
    await page.getByRole('button', { name: 'Add component' }).click()
    await page.getByLabel('Property number 2', { exact: true }).fill('2026-09ICT-0199a')
    await page.getByLabel('Component label 2', { exact: true }).fill('Mouse')
    await page.getByLabel('Property number 3', { exact: true }).fill('2026-09ICT-0199b')
    await page.getByLabel('Component label 3', { exact: true }).fill('Headset')

    const surface = page.getByLabel('Draw a box around this line on the PDF')
    await surface.scrollIntoViewIfNeeded()
    const b = (await surface.boundingBox())!
    const y = Math.min(b.y + 120, 600)
    await page.mouse.move(b.x + b.width * 0.1, y)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.9, y + 40, { steps: 6 })
    await page.mouse.up()
    await expect(page.getByTestId('region-box')).toBeVisible()

    await page.getByRole('button', { name: 'Save line' }).click()
    await expect(page.getByRole('gridcell', { name: '₱96,450.00' }).first()).toBeVisible()

    // add a second line reusing a number in another letter case
    await page.getByRole('link', { name: 'Add line' }).first().click()
    await page.locator('#qty').fill('1')
    await page.locator('#unit').fill('unit')
    await page.locator('#unitCost').fill('1000')
    await page.locator('#article').fill('Mouse')
    await page.locator('#description').fill('Spare mouse')
    await page.getByLabel('Property number 1', { exact: true }).fill('2026-09ict-0199')
    await page.getByRole('button', { name: 'Save line' }).click()
    await expect(page.getByText('Property number 2026-09ict-0199 already exists').first()).toBeVisible()
    await expect(page).toHaveURL(/lines\/new$/)
  })

  test('edit: serial, old property number and a component label save; delete removes the line', async ({ page }) => {
    await login(page)
    await page.goto('/documents')
    await page.getByRole('link', { name: '2026-03SARAi-005' }).first().click()
    await page.locator('.ag-row').first().click()
    await expect(page.getByText('Box saved on page 1')).toBeVisible()
    await page.getByLabel('Serial number 1', { exact: true }).fill('K2507N0078345')
    await page.getByLabel('Old property number 1', { exact: true }).fill('10605140-00-7')
    await page.getByLabel('Component label 2', { exact: true }).fill('Wireless mouse')
    await page.getByRole('button', { name: 'Save line' }).click()
    await expect(page.getByRole('heading', { name: '2026-03SARAi-005' })).toBeVisible()

    await page.locator('.ag-row').first().click()
    await expect(page.getByLabel('Serial number 1', { exact: true })).toHaveValue('K2507N0078345')
    await expect(page.getByLabel('Old property number 1', { exact: true })).toHaveValue('10605140-00-7')
    await expect(page.getByLabel('Component label 2', { exact: true })).toHaveValue('Wireless mouse')

    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Delete line' }).click()
    await expect(page.getByText('No lines yet')).toBeVisible()
  })
})

test.describe('phone width (360 px)', () => {
  test.use({ viewport: { width: 360, height: 800 } })

  test('nothing scrolls sideways and the menu opens', async ({ page }) => {
    await login(page)
    for (const p of ['/', '/documents', '/documents/new', '/officers', '/account/password']) {
      await page.goto(p)
      await page.waitForLoadState('networkidle')
      expect(await noHorizontalScroll(page), p).toBe(0)
    }
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('link', { name: 'ICS and PAR' })).toBeVisible()
    await page.getByRole('link', { name: 'ICS and PAR' }).click()
    await expect(page.getByRole('heading', { name: 'ICS and PAR' })).toBeVisible()
  })
})

test.describe('accessibility (WCAG 2.1 A and AA)', () => {
  test('login', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    expect(await a11y(page)).toEqual([])
  })

  test('signed-in pages', async ({ page }) => {
    await login(page)
    for (const p of ['/', '/documents', '/documents/new', '/officers', '/account/password']) {
      await page.goto(p)
      await page.waitForLoadState('networkidle')
      expect(await a11y(page), p).toEqual([])
    }
  })

  test('document page and line form', async ({ page }) => {
    await login(page)
    await page.goto('/documents')
    await page.getByRole('link', { name: '2026-03SARAi-005' }).first().click()
    await expect(page.getByText('Page 1 of 2')).toBeVisible()
    expect(await a11y(page), 'document page').toEqual([])
    await page.getByRole('link', { name: 'Add line' }).first().click()
    await expect(page.getByRole('heading', { name: 'Add line' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await a11y(page), 'line form').toEqual([])
  })
})
