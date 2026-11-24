import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { E2E } from '../playwright.config'

export async function pickOfficer(page: Page, id: string, fullName: string) {
  await page.locator(`#${id}`).fill(fullName)
  await page.getByRole('listbox', { name: 'Officers' }).getByRole('option', { name: `${fullName} (` }).first().click()
  await expect(page.locator(`#${id}`)).toHaveValue(new RegExp(`^${fullName} [(]`))
}

export async function login(page: Page, who: { email: string; password: string } = E2E.supply) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(who.email)
  await page.getByLabel('Password', { exact: true }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: who === E2E.superadmin ? 'User accounts' : 'Dashboard' })).toBeVisible()
}

export async function samplePdf(name = 'ics.pdf', pages = 2) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= pages; n++) {
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

export async function a11y(page: Page, exclude: string[] = []) {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  for (const sel of exclude) b = b.exclude(sel)
  const { violations } = await b.analyze()
  return violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`)
}

export const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const headers = () => ({ Origin: `http://localhost:${E2E.webPort}` })

export async function officerIds(page: Page) {
  const officers = (await (await page.request.get('/api/officers')).json()) as { id: string; shortName: string }[]
  return { issuer: officers.find((o) => o.shortName === 'JDelaCruz')!, receiver: officers.find((o) => o.shortName === 'MSantos')! }
}

export async function apiSeed(page: Page, docNo: string, nos: { main: string; part: string; semi: string }, over: { generate?: boolean; model?: string } = {}) {
  const { issuer, receiver } = await officerIds(page)
  const model = over.model ?? `MSI Katana ${docNo}`
  const res = await page.request.post('/api/issuances', {
    headers: headers(),
    data: {
      header: { receivedByOfficerId: receiver.id, issuedByOfficerId: issuer.id, issuedDate: '2026-05-12', fundCluster: 'RAF', purpose: 'ICT equipment', icsNo: docNo, parNos: [`${docNo}-P`] },
      rows: [
        {
          line: { propertyTypeId: 1, article: 'Laptop', unit: 'set', qty: 1, unitCostCentavos: 9645000, description: `${model}\nSpecification:\n- Memory: 16GB`, estUsefulLifeYears: 5, dateAcquired: '2026-05-01' },
          properties: [{ propertyNo: nos.main, serialNo: 'SN-0199' }, { propertyNo: nos.part, componentLabel: 'Mouse' }],
        },
        {
          line: { propertyTypeId: 2, article: 'Office chair', unit: 'unit', qty: 1, unitCostCentavos: 450000, description: `Chair ${docNo}, ergonomic`, dateAcquired: '2026-05-01' },
          properties: [{ propertyNo: nos.semi }],
        },
      ],
      generate: over.generate ?? true,
    },
  })
  const body = await res.json()
  if (res.status() !== 201) throw new Error(`issuance: ${res.status()} ${JSON.stringify(body)}`)
  const docs = body.documents as { id: string; type: 'ICS' | 'PAR'; docNo: string }[]
  const token = async (no: string) => ((await (await page.request.get(`/api/properties/${no}`)).json()) as { token: string }).token.trim()
  const cardId = async (no: string) => ((await (await page.request.get(`/api/properties/${no}/view`)).json()) as { line: { cardId: string } }).line.cardId
  return { icsId: docs.find((d) => d.type === 'ICS')!.id, parId: docs.find((d) => d.type === 'PAR')!.id, token, cardId }
}

export async function apiSign(page: Page, documentId: string, pages = 2) {
  const res = await page.request.put(`/api/documents/${documentId}/pdf`, {
    headers: headers(), multipart: { pdf: { name: 'signed.pdf', mimeType: 'application/pdf', buffer: readFileSync(await samplePdf(`signed-${documentId}.pdf`, pages)) } },
  })
  if (res.status() !== 200) throw new Error(`sign: ${res.status()} ${await res.text()}`)
}
