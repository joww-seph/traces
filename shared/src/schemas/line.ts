import { z } from 'zod'
import { centavos, isoDate, nonEmpty, propertyNo, uuid } from './common.js'
import { itemInput } from './item.js'

// article and unit live on the card (item); description is the text as printed on the ICS/PAR row
export const lineFields = z.strictObject({
  lineNo: z.number().int().positive().optional(),
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

// the card: pick an existing one, or create it with the line
export const itemRef = z.union([
  z.strictObject({ itemId: uuid }),
  z.strictObject({ new: itemInput }),
])

export const propertyFields = z.object({
  propertyNo,
  serialNo: z.string().trim().min(1).optional(),
  oldPropertyNo: z.string().trim().min(1).optional(),
  componentLabel: z.string().trim().min(1).optional(), // absent = main unit
  condition: z.enum(['serviceable', 'unserviceable']).optional(),
})

export const lineInput = z.strictObject({
  line: lineFields,
  item: itemRef,
  region: pdfRegion.optional(),
  properties: z.array(propertyFields).min(1, 'At least one property is required'),
}).superRefine((v, ctx) => {
  const seen = new Set<string>()
  v.properties.forEach((p, i) => {
    const k = p.propertyNo.toUpperCase()
    if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['properties', i, 'propertyNo'], message: 'Duplicate property number' })
    seen.add(k)
  })
})

// PATCH: line fields + region changes; property add/remove handled by dedicated arrays.
export const linePatch = z.object({
  line: lineFields.partial().optional(),
  item: itemRef.optional(), // move the line to another card of the same category
  region: pdfRegion.nullable().optional(),
  addProperties: z.array(propertyFields).optional(),
  removePropertyNos: z.array(propertyNo).optional(),
})

// Many rows in one save (entry grid, issuance form)
export const batchInput = z.strictObject({ rows: z.array(lineInput).min(1).max(300) })
  .refine((b) => b.rows.reduce((n, r) => n + r.properties.length, 0) <= 1000, 'At most 1000 properties in one save')
