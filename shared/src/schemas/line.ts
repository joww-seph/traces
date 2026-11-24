import { z } from 'zod'
import { centavos, isoDate, nonEmpty, propertyNo } from './common.js'

export const lineFields = z.strictObject({
  lineNo: z.number().int().positive().optional(),
  propertyTypeId: z.number().int().positive(),
  article: nonEmpty.max(300),
  unit: nonEmpty.max(30),
  qty: z.number().int().positive(),
  unitCostCentavos: centavos,
  description: nonEmpty,
  estUsefulLifeYears: z.number().int().positive().optional(),
  dateAcquired: isoDate,
  iarNo: z.string().trim().min(1).optional(),
  iarDate: isoDate.optional(),
})

export const pdfRegion = z.object({
  page: z.number().int().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
}).refine((r) => r.x + r.w <= 1.00001 && r.y + r.h <= 1.00001, 'Region must stay inside the page')

export const propertyFields = z.object({
  propertyNo,
  serialNo: z.string().trim().transform((v) => (!v || /^n\/?a$/i.test(v) ? undefined : v)).optional(),
  oldPropertyNo: z.string().trim().min(1).optional(),
  componentLabel: z.string().trim().min(1).optional(),
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
  if (v.properties.some((p) => p.componentLabel) && v.properties.filter((p) => !p.componentLabel).length !== 1) {
    ctx.addIssue({ code: 'custom', path: ['properties'], message: 'A row with parts must have exactly one main unit' })
  }
})

export const linePatch = z.object({
  line: lineFields.partial().optional(),
  region: pdfRegion.nullable().optional(),
  addProperties: z.array(propertyFields).optional(),
  removePropertyNos: z.array(propertyNo).optional(),
})

export const batchInput = z.strictObject({ rows: z.array(lineInput).min(1).max(300) })
  .refine((b) => b.rows.reduce((n, r) => n + r.properties.length, 0) <= 1000, 'At most 1000 properties in one save')
