import { expect, test } from '@playwright/test'
import { a11y, apiSeed, login, noHorizontalScroll } from './helpers'

// Runs after app.spec.ts in the same database: officers JDelaCruz and MSantos already exist.
test.describe.configure({ mode: 'serial' })

const nos = { main: '2026-09ICT-0301', part: '2026-09ICT-0301a', semi: '2026-09ICT-0302' }
let docId = ''
let tokens: Record<string, string> = {}

test('seed: a document with a boxed PPE line and a semi item', async ({ page }) => {
  await login(page)
  const s = await apiSeed(page, '2026-05D2-001', nos)
  docId = s.docId
  tokens = { main: await s.token(nos.main), part: await s.token(nos.part), semi: await s.token(nos.semi) }
  expect(tokens.main).toMatch(/^[0-9A-Za-z]{10}$/)
})

test('a scan opens the property without signing in: four tabs, each with its row highlighted, the PDF box on the form', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`/q/${tokens.main}`)
  await expect(page.getByRole('heading', { name: 'Laptop', level: 1 })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveText(['ICS/PAR', 'Report', 'Registry', 'Card'])
  await expect(page.getByTestId('region-highlight')).toBeVisible() // the box over the ICS row on the PDF
  await expect(page.locator('.traces-highlight')).toHaveCount(1) // the line in the ICS grid
  await page.getByRole('tab', { name: 'Report' }).click()
  await expect(page.getByText('Not counted yet')).toBeVisible()
  await page.getByRole('tab', { name: 'Registry' }).click()
  await expect(page.locator('.traces-highlight')).toHaveCount(1)
  await expect(page.getByText('REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED')).toBeVisible()
  await page.getByRole('tab', { name: 'Card' }).click()
  await expect(page.locator('.traces-highlight')).toHaveCount(1)
  await expect(page).toHaveURL(/#card$/)
  await ctx.close()
})

test('phone (360 px): the scan page fits and every tab works', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } })
  const page = await ctx.newPage()
  await page.goto(`/q/${tokens.semi}`)
  await expect(page.getByRole('heading', { name: 'Office chair', level: 1 })).toBeVisible()
  for (const name of ['ICS/PAR', 'Report', 'Registry', 'Card']) {
    await page.getByRole('tab', { name }).click()
    await page.waitForTimeout(300)
    expect(await noHorizontalScroll(page), name).toBe(0)
  }
  await ctx.close()
})

test('unknown code and malformed code show friendly pages', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/q/AAAAAAAAAA')
  await expect(page.getByRole('heading', { name: 'QR code not recognised' })).toBeVisible()
  await page.goto('/q/short')
  await expect(page.getByRole('heading', { name: 'QR code not recognised' })).toBeVisible()
  await ctx.close()
})

test('registry: category switch, title, row opens the property', async ({ page }) => {
  await login(page)
  await page.goto('/registry')
  await expect(page.getByText('REGISTRY OF SEMI-EXPENDABLE PROPERTY ISSUED')).toBeVisible()
  await expect(page.getByRole('gridcell', { name: /Ergonomic chair/ })).toBeVisible()
  await page.getByRole('radio', { name: 'Property, plant and equipment' }).click()
  await expect(page.getByText('REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED')).toBeVisible()
  await expect(page.getByRole('gridcell', { name: /Laptop Unit/ })).toBeVisible()
  await page.locator('.ag-row').first().click()
  await expect(page).toHaveURL(new RegExp(`/properties/${nos.main}$`))
  await expect(page.getByRole('heading', { name: nos.main })).toBeVisible()
})

test('property page: edit, the card page, and replacing the QR code kills the old sticker', async ({ page, browser }) => {
  await login(page)
  await page.goto(`/properties/${nos.main}`)
  await page.locator('#serialNo').fill('SN-0199-EDITED')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Property updated')).toBeVisible()
  await page.reload()
  await expect(page.locator('#serialNo')).toHaveValue('SN-0199-EDITED')

  await page.goto(`/cards/${nos.main}`)
  await expect(page.getByRole('heading', { name: 'PROPERTY CARD', level: 1 })).toBeVisible()
  await expect(page.getByRole('gridcell', { name: '₱96,450.00' }).first()).toBeVisible()

  await page.goto(`/properties/${nos.main}`)
  await page.getByRole('button', { name: 'Replace QR code' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Replace the code' }).click()
  await expect(page.getByText(/New QR code issued/)).toBeVisible()
  const ctx = await browser.newContext()
  const anon = await ctx.newPage()
  await anon.goto(`/q/${tokens.main}`)
  await expect(anon.getByRole('heading', { name: 'This sticker was replaced' })).toBeVisible()
  await ctx.close()
})

test('sticker sheet: QR images for every active number, both sizes, test-address warning', async ({ page }) => {
  await login(page)
  await page.goto(`/stickers?documentId=${docId}`)
  await expect(page.getByTestId('sticker-sheet')).toBeVisible()
  const imgs = page.getByTestId('sticker-sheet').locator('img')
  await expect(imgs).toHaveCount(3)
  await expect.poll(() => imgs.evaluateAll((els) => els.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await expect(page.getByRole('alert')).toContainText('Test stickers only')
  const mm = (px: number) => (px * 25.4) / 96
  const one = (await page.locator('.sticker').first().boundingBox())!
  expect(mm(one.width)).toBeGreaterThan(25.2)
  expect(mm(one.width)).toBeLessThan(25.6)
  await page.getByRole('radio', { name: 'Passport size' }).click()
  const box = (await page.locator('.sticker').first().boundingBox())!
  expect(mm(box.width)).toBeGreaterThan(34.8)
  expect(mm(box.width)).toBeLessThan(35.2)
  expect(mm(box.height)).toBeGreaterThan(44.8)
  expect(mm(box.height)).toBeLessThan(45.2)
  await page.goto(`/stickers?nos=${nos.semi.toLowerCase()}`)
  await expect(page.locator('.sticker')).toHaveCount(1)
})

test('accessibility: scan page, property page, registry, stickers', async ({ page, browser }) => {
  const ctx = await browser.newContext()
  const anon = await ctx.newPage()
  await anon.goto(`/q/${tokens.semi}`)
  await expect(anon.getByRole('heading', { name: 'Office chair', level: 1 })).toBeVisible()
  for (const tab of ['ICS/PAR', 'Registry', 'Card']) {
    await anon.getByRole('tab', { name: tab }).click()
    await anon.waitForLoadState('networkidle')
    expect(await a11y(anon), `scan page / ${tab}`).toEqual([])
  }
  await ctx.close()
  await login(page)
  for (const p of ['/registry', `/properties/${nos.semi}`, `/cards/${nos.semi}`, `/stickers?documentId=${docId}`, '/stickers']) {
    await page.goto(p)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(600)
    expect(await a11y(page), p).toEqual([])
  }
})
