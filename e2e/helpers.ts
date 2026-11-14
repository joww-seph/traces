import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

// Creates a document with one PPE line (laptop + mouse, boxed on the PDF) and one semi item through the API,
// signed in as the page's user. Officers JDelaCruz and MSantos must already exist.
export async function apiSeed(page: Page, docNo: string, nos: { main: string; part: string; semi: string }) {
  const headers = { Origin: `http://localhost:${E2E.webPort}` }
  const officers = (await (await page.request.get('/api/officers')).json()) as { id: string; shortName: string }[]
  const issuer = officers.find((o) => o.shortName === 'JDelaCruz')!
  const receiver = officers.find((o) => o.shortName === 'MSantos')!
  const doc = await page.request.post('/api/documents', {
    headers,
    multipart: {
      meta: JSON.stringify({
        type: 'ICS', docNo, fundCluster: 'RAF', issuedDate: '2026-05-12', issuedByOfficerId: issuer.id, receivedByOfficerId: receiver.id, purpose: 'ICT equipment',
      }),
      pdf: { name: 'ics.pdf', mimeType: 'application/pdf', buffer: readFileSync(await samplePdf(`${docNo}.pdf`)) },
    },
  })
  const docBody = await doc.json()
  if (doc.status() !== 201) throw new Error(`document: ${doc.status()} ${JSON.stringify(docBody)}`)
  const post = (body: object) => page.request.post(`/api/documents/${docBody.id}/lines`, { headers, data: body })
  await post({
    line: { qty: 1, unit: 'set', unitCostCentavos: 9645000, article: 'Laptop', description: 'Laptop Unit\nSpecification:\n- Memory: 16GB', estUsefulLifeYears: 5 },
    region: { page: 1, x: 0.08, y: 0.14, w: 0.84, h: 0.05 },
    properties: [{ propertyNo: nos.main, serialNo: 'SN-0199' }, { propertyNo: nos.part, componentLabel: 'Mouse' }],
  })
  await post({
    line: { qty: 1, unit: 'unit', unitCostCentavos: 450000, article: 'Office chair', description: 'Ergonomic chair' },
    properties: [{ propertyNo: nos.semi }],
  })
  const token = async (no: string) => ((await (await page.request.get(`/api/properties/${no}`)).json()) as { token: string }).token.trim()
  return { docId: docBody.id as string, token }
}
