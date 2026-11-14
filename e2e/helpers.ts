import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { E2E } from '../playwright.config'

export async function login(page: Page, who: { email: string; password: string } = E2E.supply) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

// A two-page signed-form stand-in, written to a temp file the upload field can take.
export async function samplePdf(name = 'ics.pdf') {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const n of [1, 2]) {
    const p = pdf.addPage([595, 842])
    p.drawText(`INVENTORY CUSTODIAN SLIP, page ${n}`, { x: 50, y: 790, size: 14, font })
    p.drawText('1  set  96,450.00  Laptop set  2026-09ICT-0199', { x: 50, y: 700, size: 11, font })
  }
  const dir = path.join(os.tmpdir(), 'traces-e2e')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  writeFileSync(file, await pdf.save())
  return file
}

// Accessibility scan: WCAG 2 A and AA. Returns the violations so a test can assert on them.
export async function a11y(page: Page, exclude: string[] = []) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  for (const sel of exclude) b = b.exclude(sel)
  const { violations } = await b.analyze()
  return violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`)
}

export const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
