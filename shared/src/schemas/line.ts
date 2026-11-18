import { z } from 'zod'
import { centavos, isoDate, nonEmpty, propertyNo } from './common.js'

// The line carries the item (decision 2026-11-18: one card per property). The category comes from the cost, never typed.
// description is the one description, as printed on the ICS/PAR row (model and specs); serials are added when shown.
export const lineFields = z.strictObject({
  lineNo: z.number().int().positive().optional(),
  propertyTypeId: z.number().int().positive(),
  article: nonEmpty.max(300),
  unit: nonEmpty.max(30),
  qty: z.number().int().positive(),
  unitCostCentavos: centavos,
  description: nonEmpty,
  estUsefulLifeYears: z.number().int().positive().optional(),
  dateAcquired: isoDate, // drives the property number month and the card RECEIPT date
  iarNo: z.string().trim().min(1).optional(),
  iarDate: isoDate.optional(),
})

// Fractions (0-1) of the page, same bounds as the line_pdf_regions CHECKs.
export const pdfRegion = z.object({
  page: z.number().int().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
}).refine((r) => r.x + r.w <= 1.00001 && r.y + r.h <= 1.00001, 'Region must stay inside the page')

export const propertyFields = z.object({
  propertyNo,
  // "N/A" (the form's default) or blank means no serial
  serialNo: z.string().trim().transform((v) => (!v || /^n\/?a$/i.test(v) ? undefined : v)).optional(),
  oldPropertyNo: z.string().trim().min(1).optional(),
  componentLabel: z.string().trim().min(1).optional(), // absent = main unit
  condition: z.enum(['serviceable', 'unserviceable']).optional(),
})

export const lineInput = z.strictObject({
  line: lineFields,
  region: pdfRegion.optional(),
  properties: z.array(propertyFields).min(1, 'At least one property is required'),
}).superRefine((v, ctx) => {
  const seen = new Set<string>()
  v.properties.forEach((p, i) => {
    const k = p.propertyNo.toUpperCase()
    if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['properties', i, 'propertyNo'], message: 'Duplicate property number' })
    seen.add(k)
  })
  // a component belongs to one unit, whose card lists it
  if (v.properties.some((p) => p.componentLabel) && v.properties.filter((p) => !p.componentLabel).length !== 1) {
    ctx.addIssue({ code: 'custom', path: ['properties'], message: 'A row with parts must have exactly one main unit' })
  }
})

// PATCH: line fields + region changes; property add/remove handled by dedicated arrays.
export const linePatch = z.object({
  line: lineFields.partial().optional(),
  region: pdfRegion.nullable().optional(),
  addProperties: z.array(propertyFields).optional(),
  removePropertyNos: z.array(propertyNo).optional(),
})

// Many rows in one save (entry grid, issuance form)
export const batchInput = z.strictObject({ rows: z.array(lineInput).min(1).max(300) })
  .refine((b) => b.rows.reduce((n, r) => n + r.properties.length, 0) <= 1000, 'At most 1000 properties in one save')
