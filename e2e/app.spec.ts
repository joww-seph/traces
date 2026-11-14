import { expect, test, type Page } from '@playwright/test'
import { E2E } from '../playwright.config'
import { a11y, login, noHorizontalScroll } from './helpers'

test.describe.configure({ mode: 'serial' })

async function addOfficer(page: Page, fullName: string, position: string) {
  await page.goto('/officers')
  await page.getByRole('button', { name: 'Add officer' }).click()
  await page.locator('#o-fullName').fill(fullName)
  await page.locator('#o-position').fill(position)
  await page.getByRole('dialog').getByRole('button', { name: 'Add officer' }).click()
}

const ICT = 'ICT · Information and Communications Technology Equipment'
const FF = 'FF · Furniture and Fixtures'

// Fills one row of the issuance form with a new card.
async function fillRow(page: Page, n: number, r: { type: string; article: string; model: string; unit: string; description: string; cost: string; date: string }) {
  const row = page.getByRole('group', { name: `Row ${n}` })
  await row.getByRole('button', { name: 'New card' }).click()
  await row.getByLabel(`Row ${n}, property type`, { exact: true }).selectOption({ label: r.type })
  await row.getByLabel(`Row ${n}, article`, { exact: true }).fill(r.article)
  await row.getByLabel(`Row ${n}, model`, { exact: true }).fill(r.model)
  await row.getByLabel(`Row ${n}, unit`, { exact: true }).fill(r.unit)
  await row.getByLabel('Description as printed on the form').fill(r.description)
  await row.getByLabel('Unit cost (₱)').fill(r.cost)
  await row.getByLabel('Date acquired').fill(r.date)
  return row
}

async function chooseHeader(page: Page, o: { receiver?: boolean; issuer?: boolean } = {}) {
  if (o.receiver !== false) await page.locator('#rcv').selectOption({ label: 'Maria Santos (MSantos)' })
  if (o.issuer !== false) await page.locator('#issuer').selectOption({ label: 'Juan Dela Cruz (JDelaCruz)' })
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
  test('officers: the short name is made from the name, a clash gets a number', async ({ page }) => {
    await login(page)
    await addOfficer(page, 'JUAN DELA CRUZ', 'Administrative Officer V')
    await expect(page.getByRole('row', { name: /Juan Dela Cruz/ })).toContainText('JDelaCruz')
    await addOfficer(page, 'Maria Santos', 'ARD for Field Operations')
    await expect(page.getByRole('row', { name: /Maria Santos/ })).toContainText('MSantos')
    await addOfficer(page, 'Mario Santos', 'Clerk')
    await expect(page.getByRole('row', { name: /Mario Santos/ })).toContainText('MSantos2')
  })

  test('the old "new document" address opens the issuance form', async ({ page }) => {
    await login(page)
    await page.goto('/documents/new')
    await expect(page).toHaveURL(/\/issue$/)
    await expect(page.getByRole('heading', { name: 'New issuance' })).toBeVisible()
  })

  test('a mixed purchase: one save makes an ICS and a PAR, suggested numbers follow the series, the forms are generated', async ({ page }) => {
    await login(page)
    await page.goto('/issue')
    await expect(page.getByRole('heading', { name: '1. Property card' })).toBeVisible()

    // row 1: a PPE laptop set with two parts; the numbers are suggested from the type and the date acquired
    const r1 = await fillRow(page, 1, { type: ICT, article: 'Laptop', model: 'MSI Katana', unit: 'set', description: 'Laptop Unit, MSI Katana\nSpecification:\n- Memory: 16GB', cost: '96,450.00', date: '2026-05-01' })
    await expect(r1.getByText('PPE · PC · PAR')).toBeVisible()
    await r1.getByRole('button', { name: 'Add component' }).click()
    await r1.getByRole('button', { name: 'Add component' }).click()
    await r1.getByLabel('Row 1, component 1, label').fill('Mouse')
    await r1.getByLabel('Row 1, component 2, label').fill('Headset')
    await expect(r1.getByLabel('Row 1, unit 1, property number')).toHaveAttribute('placeholder', '2026-05ICT-0001')
    await expect(r1.getByLabel('Row 1, component 1, property number')).toHaveAttribute('placeholder', '2026-05ICT-0001a')
    await expect(r1.getByLabel('Row 1, component 2, property number')).toHaveAttribute('placeholder', '2026-05ICT-0001b')
    await r1.getByLabel('Row 1, unit 1, serial number').fill('K2507N0078345')

    // row 2: a semi-expendable chair; the second ICT row of the same date would continue at 0002
    await page.getByRole('button', { name: 'Add a row' }).click()
    const r2 = await fillRow(page, 2, { type: FF, article: 'Office chair', model: 'Ergonomic office chair', unit: 'unit', description: 'Ergonomic office chair, mesh back', cost: '4,500.00', date: '2026-05-01' })
    await expect(r2.getByText('Semi-expendable · SPC · ICS')).toBeVisible()
    await expect(r2.getByLabel('Row 2, unit 1, property number')).toHaveAttribute('placeholder', '2026-05FF-0001')

    // section 3 previews the report rows
    await expect(page.getByRole('cell', { name: 'RPCPPE' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'RPCSP' })).toBeVisible()

    // section 2 and 4
    await chooseHeader(page)
    await page.locator('#date').fill('2026-05-12')
    await page.locator('#purpose').fill('ICT equipment for SARAi staff operations')
    await expect(page.locator('#issuerPos')).toHaveValue('Administrative Officer V')
    await expect(page.getByTestId('summary')).toHaveText('This creates 1 ICS (1 row) and 1 PAR (1 row).')
    await page.locator('#icsNo').fill('2026-03SARAi-005')
    await page.locator('#parNo').fill('2025-RO-68')
    await page.getByRole('button', { name: 'Save and generate ICS/PAR' }).click()

    await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible()
    await expect(page.getByText('2026-03SARAi-005')).toBeVisible()
    await expect(page.getByText('2025-RO-68')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Print' })).toHaveCount(2)
    await expect(page.getByText('could not be generated')).toHaveCount(0)
  })

  test('the generated ICS: status, the PDF with its boxes, and the actions for an unsigned form', async ({ page }) => {
    await login(page)
    await page.goto('/documents')
    await expect(page.getByRole('cell', { name: 'Generated, unsigned' })).toHaveCount(2)
    await page.getByRole('link', { name: '2026-03SARAi-005' }).first().click()
    await expect(page.getByRole('heading', { name: '2026-03SARAi-005' })).toBeVisible()
    await expect(page.getByText('Generated, unsigned').first()).toBeVisible()
    await expect(page.getByText('Page 1 of 1')).toBeVisible()
    for (const name of ['Print generated', 'Regenerate', 'Upload signed copy', 'Adjust highlights', 'Print stickers']) {
      await expect(page.getByRole('link', { name }).or(page.getByRole('button', { name }))).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Remove signed copy' })).toHaveCount(0) // nothing signed yet
    await expect(page.getByRole('gridcell', { name: /Ergonomic office chair/ })).toBeVisible()
  })

  test('the status filter finds the forms that still need a signed copy', async ({ page }) => {
    await login(page)
    await page.goto('/documents')
    await page.getByLabel('Signed copy').selectOption('unsigned')
    await expect(page.getByRole('row')).toHaveCount(3) // header + 2
    await page.getByLabel('Signed copy').selectOption('signed')
    await expect(page.getByText('No documents match')).toBeVisible()
  })

  test('copying a row keeps the card and continues the number series (Ctrl+D copies one row)', async ({ page }) => {
    await login(page)
    await page.goto('/issue')
    const row = await fillRow(page, 1, { type: ICT, article: 'Docking station', model: 'Dell WD19', unit: 'unit', description: 'Docking station', cost: '9,000.00', date: '2026-05-04' })
    await expect(row.getByLabel('Row 1, unit 1, property number')).toHaveAttribute('placeholder', '2026-05ICT-0002') // 0001 is the laptop saved above
    await row.getByLabel('Row 1, number of copies').fill('3')
    await row.getByRole('button', { name: 'Make copies' }).click()
    for (const [n, no] of [[2, '0003'], [3, '0004'], [4, '0005']] as const) {
      const copy = page.getByRole('group', { name: `Row ${n}` })
      await expect(copy.getByLabel(`Row ${n}, unit 1, property number`)).toHaveAttribute('placeholder', `2026-05ICT-${no}`)
      await expect(copy.getByLabel('Description as printed on the form')).toHaveValue('Docking station')
    }
    await page.getByRole('group', { name: 'Row 4' }).getByLabel('Description as printed on the form').press('Control+d')
    await expect(page.getByRole('group', { name: 'Row 5' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Row 5' }).getByLabel('Row 5, unit 1, property number')).toHaveAttribute('placeholder', '2026-05ICT-0006')
  })

  test('a number already on file cannot be used twice, and a missing number is asked for', async ({ page }) => {
    await login(page)
    await page.goto('/issue')
    await fillRow(page, 1, { type: FF, article: 'Steel cabinet', model: 'Steel filing cabinet, 4-drawer', unit: 'unit', description: 'Steel cabinet', cost: '8,800.00', date: '2026-05-02' })
    await chooseHeader(page)
    await page.getByRole('button', { name: 'Save and generate ICS/PAR' }).click() // no ICS number yet
    await expect(page.getByText(/Enter the ICS number/).first()).toBeVisible()
    await page.locator('#icsNo').fill('2026-03SARAi-005')
    await page.getByRole('button', { name: 'Save and generate ICS/PAR' }).click()
    await expect(page.getByText(/ICS 2026-03SARAi-005 already exists/).first()).toBeVisible()
  })

  test('a repeated property number marks its row and saves nothing', async ({ page }) => {
    await login(page)
    await page.goto('/issue')
    const row = await fillRow(page, 1, { type: FF, article: 'Steel cabinet', model: 'Steel filing cabinet, 4-drawer', unit: 'unit', description: 'Steel cabinet', cost: '8,800.00', date: '2026-05-02' })
    await row.getByLabel('Row 1, unit 1, property number').fill('2026-05ICT-0001') // already used by the laptop
    await chooseHeader(page)
    await page.locator('#icsNo').fill('2026-05TEST-002')
    await page.getByRole('button', { name: 'Save, I\'ll upload the PDF' }).click()
    await expect(row.getByRole('alert')).toContainText('already used or repeated')
    await page.goto('/documents')
    await expect(page.getByRole('link', { name: '2026-05TEST-002' })).toHaveCount(0)
  })

  test('the unsaved entry survives a reload (draft on this computer) and can be discarded', async ({ page }) => {
    await login(page)
    await page.goto('/issue')
    await page.locator('#desc-0').fill('Typed but not saved')
    await page.waitForTimeout(700)
    await page.reload()
    await expect(page.getByText('Your unsaved entry was restored')).toBeVisible()
    await expect(page.locator('#desc-0')).toHaveValue('Typed but not saved')
    await page.getByRole('button', { name: 'Discard draft' }).click()
    await expect(page.locator('#desc-0')).toHaveValue('')
  })

  test('save without a PDF: the form is stored for a later upload, and rows can be added to it', async ({ page }) => {
    await login(page)
    await page.goto('/issue')
    await fillRow(page, 1, { type: FF, article: 'Steel cabinet', model: 'Steel filing cabinet, 4-drawer', unit: 'unit', description: 'Steel cabinet', cost: '8,800.00', date: '2026-05-02' })
    await chooseHeader(page)
    await page.locator('#icsNo').fill('2026-05OLD-001')
    await page.getByRole('button', { name: 'Save, I\'ll upload the PDF' }).click()
    await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Print' })).toHaveCount(0) // nothing was generated
    await page.getByRole('link', { name: 'Open' }).click()
    await expect(page.getByText('No PDF').first()).toBeVisible()

    // add rows to the same form in a second sitting, using the existing card
    await page.getByRole('link', { name: 'Add lines' }).click()
    await expect(page.getByRole('heading', { name: /Add rows to ICS 2026-05OLD-001/ })).toBeVisible()
    const row = page.getByRole('group', { name: 'Row 1' })
    await row.getByLabel('Row 1, search cards').fill('cabinet')
    await row.getByRole('button', { name: /Steel cabinet/ }).click()
    await row.getByLabel('Description as printed on the form').fill('Steel cabinet, second unit')
    await row.getByLabel('Unit cost (₱)').fill('8,800.00')
    await row.getByLabel('Date acquired').fill('2026-05-02')
    await page.getByRole('button', { name: 'Save rows' }).click()
    await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible()
  })

  test('edit: serial, old property number and a component label save', async ({ page }) => {
    await login(page)
    await page.goto('/documents')
    await page.getByRole('link', { name: '2025-RO-68' }).first().click()
    await page.locator('.ag-row').first().click()
    await expect(page.getByRole('heading', { name: 'Edit line' })).toBeVisible()
    await page.getByLabel('Old property number 1', { exact: true }).fill('10605140-00-7')
    await page.getByLabel('Component label 2', { exact: true }).fill('Wireless mouse')
    await page.getByRole('button', { name: 'Save line' }).click()
    await expect(page.getByRole('heading', { name: '2025-RO-68' })).toBeVisible()

    await page.locator('.ag-row').first().click()
    await expect(page.getByLabel('Serial number 1', { exact: true })).toHaveValue('K2507N0078345')
    await expect(page.getByLabel('Old property number 1', { exact: true })).toHaveValue('10605140-00-7')
    await expect(page.getByLabel('Component label 2', { exact: true })).toHaveValue('Wireless mouse')
  })
})

test.describe('phone width (360 px)', () => {
  test.use({ viewport: { width: 360, height: 800 } })

  test('nothing scrolls sideways and the menu opens', async ({ page }) => {
    await login(page)
    for (const p of ['/', '/documents', '/issue', '/cards', '/reports', '/officers', '/property-types', '/account/password']) {
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
    for (const p of ['/', '/documents', '/issue', '/cards', '/reports', '/officers', '/property-types', '/account/password']) {
      await page.goto(p)
      await page.waitForLoadState('networkidle')
      expect(await a11y(page), p).toEqual([])
    }
  })

  test('the issuance form with rows, the document page and the line form', async ({ page }) => {
    await login(page)
    await page.goto('/issue')
    await fillRow(page, 1, { type: ICT, article: 'Monitor', model: 'Dell 24 inch', unit: 'unit', description: 'Monitor', cost: '9,000.00', date: '2026-05-03' })
    await page.getByRole('button', { name: 'Add a row' }).click()
    await page.waitForLoadState('networkidle')
    expect(await a11y(page), 'issuance form').toEqual([])
    await page.goto('/documents')
    await page.getByRole('link', { name: '2026-03SARAi-005' }).first().click()
    await expect(page.getByText('Page 1 of 1')).toBeVisible()
    expect(await a11y(page), 'document page').toEqual([])
    await page.locator('.ag-row').first().click()
    await expect(page.getByRole('heading', { name: 'Edit line' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await a11y(page), 'line form').toEqual([])
  })
})
