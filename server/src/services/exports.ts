import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { propertyTypes } from '../db/schema.js'
import { buildSpc, buildRpcsp } from '../exports/built.js'
import { buildPc, buildRegistry, buildRpcppe, type CountData } from '../exports/fill.js'
import { AppError } from '../middleware/error.js'
import { getSettings } from './settings.js'
import { card, officerReportRows, registry } from './views.js'

// ICS and PAR are no longer exported to Excel: TRACES generates the PDF forms (Update 02).
export const FORMS = ['spc', 'pc', 'regspi', 'regppe', 'rpcsp', 'rpcppe'] as const
export type Form = (typeof FORMS)[number]
export type ExportQuery = {
  itemId?: string; typeId?: number; officerId?: string; asAt?: string; from?: string; to?: string
  signatories?: { role: string; name: string; position?: string | null }[]
}

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined || v === '') throw new AppError('VALIDATION', 400, `This form needs ${what}`)
  return v
}
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_')

export async function exportForm(form: Form, q: ExportQuery): Promise<{ buffer: Buffer; filename: string }> {
  const s = await getSettings()

  if (form === 'spc' || form === 'pc') {
    const { header, rows } = await card(need(q.itemId, 'itemId (the card)'))
    const want = form === 'spc' ? 'semi' : 'ppe'
    if (header.category !== want) {
      throw new AppError('WRONG_FORM', 400, `This card is ${header.category === 'ppe' ? 'PPE' : 'semi-expendable'}; export it as ${header.category === 'ppe' ? 'pc' : 'spc'}`)
    }
    const range = header.propertyNoFirst === header.propertyNoLast ? header.propertyNoFirst ?? '' : `${header.propertyNoFirst} - ${header.propertyNoLast}`
    const data = { category: want as 'semi' | 'ppe', propertyNo: range, article: header.article, description: header.description, fundCluster: s.defaultFundCluster, rows }
    return { buffer: await (form === 'spc' ? buildSpc(s.entityName, data) : buildPc(s, data)), filename: `${form.toUpperCase()}_${safe(header.article)}_${safe(header.description)}.xlsx` }
  }

  const typeName = q.typeId ? (await db.select({ name: propertyTypes.name }).from(propertyTypes).where(eq(propertyTypes.id, q.typeId)))[0]?.name ?? null : null
  if (q.typeId && !typeName) throw new AppError('PROPERTY_TYPE_NOT_FOUND', 404, 'Property type not found')

  if (form === 'regspi' || form === 'regppe') {
    const category = form === 'regspi' ? 'semi' : 'ppe'
    const rows = await registry(category, { typeId: q.typeId, from: q.from, to: q.to })
    const span = q.from || q.to ? `${q.from ?? 'start'}_${q.to ?? 'today'}` : 'all'
    return {
      buffer: await buildRegistry(s, { category, fundCluster: s.defaultFundCluster, typeName, rows }),
      filename: `${form.toUpperCase()}_${typeName ? `${safe(typeName)}_` : ''}${span}.xlsx`,
    }
  }

  // rpcsp / rpcppe
  const want = form === 'rpcsp' ? 'semi' : 'ppe'
  const report = await officerReportRows({ officerId: need(q.officerId, 'officerId'), category: want, typeId: q.typeId, asAt: q.asAt })
  const data: CountData = {
    category: want, typeLabel: report.type?.name ?? 'All types', asAt: report.asAt, fundCluster: s.defaultFundCluster,
    officerName: report.officer.fullName, officerPosition: report.officer.position,
    // names typed on the report page win over the saved defaults
    signatories: (q.signatories ?? report.signatories).map((x) => ({ role: x.role, name: x.name, position: x.position ?? null })),
    rows: report.rows,
  }
  return {
    buffer: await (form === 'rpcsp' ? buildRpcsp(s.entityName, data) : buildRpcppe(s, data)),
    filename: `${form.toUpperCase()}_${safe(report.officer.fullName)}_${report.asAt}.xlsx`,
  }
}
