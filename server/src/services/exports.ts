import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { propertyTypes } from '../db/schema.js'
import { buildIcsParList, buildIirup, buildSpc, buildRpcsp } from '../exports/built.js'
import { listDocuments } from './documents.js'
import { buildPc, buildRegistry, buildRpcppe, type CountData } from '../exports/fill.js'
import { AppError } from '../middleware/error.js'
import { getSettings } from './settings.js'
import { card, officerReportRows, registry, unserviceableRows } from './views.js'

export const FORMS = ['spc', 'pc', 'registry-semi', 'registry-ppe', 'rpcsp', 'rpcppe', 'icspar', 'iirup', 'iirusp'] as const
export type Form = (typeof FORMS)[number]
export type ExportQuery = {
  cardId?: string; typeId?: number; type?: 'ICS' | 'PAR'; status?: 'none' | 'generated' | 'signed' | 'unsigned'; q?: string; officerId?: string; countId?: string; asAt?: string; from?: string; to?: string
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
    const { header, rows } = await card(need(q.cardId, 'cardId (the card)'))
    const want = form === 'spc' ? 'semi' : 'ppe'
    if (header.category !== want) {
      throw new AppError('WRONG_FORM', 400, `This card is ${header.category === 'ppe' ? 'PPE' : 'semi-expendable'}; export it as ${header.category === 'ppe' ? 'pc' : 'spc'}`)
    }
    const data = { category: want as 'semi' | 'ppe', propertyNo: header.propertyNo, article: header.article, description: header.description, fundCluster: s.defaultFundCluster, rows }
    return { buffer: await (form === 'spc' ? buildSpc(s.entityName, data) : buildPc(s, data)), filename: `${form.toUpperCase()}_${safe(header.propertyNo)}.xlsx` }
  }

  if (form === 'icspar') {
    const { rows } = await listDocuments({ type: q.type, from: q.from, to: q.to, officerId: q.officerId, q: q.q, status: q.status, page: 1 }, true)
    const list = rows.map((r) => ({ rowNo: r.rowNo, type: r.type, docNo: r.docNo, issuedDate: r.issuedDate, receivedByName: r.receivedByName, status: r.status }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.rowNo - b.rowNo)
    return { buffer: await buildIcsParList({ entityName: s.entityName, rows: list }), filename: `ICS-PAR_${q.type ?? 'all'}.xlsx` }
  }

  const typeName = q.typeId ? (await db.select({ name: propertyTypes.name }).from(propertyTypes).where(eq(propertyTypes.id, q.typeId)))[0]?.name ?? null : null
  if (q.typeId && !typeName) throw new AppError('PROPERTY_TYPE_NOT_FOUND', 404, 'Property type not found')

  if (form === 'registry-semi' || form === 'registry-ppe') {
    const category = form === 'registry-semi' ? 'semi' : 'ppe'
    const rows = await registry(category, { typeId: q.typeId, from: q.from, to: q.to })
    const span = q.from || q.to ? `${q.from ?? 'start'}_${q.to ?? 'today'}` : 'all'
    return {
      buffer: await buildRegistry(s, { category, fundCluster: s.defaultFundCluster, typeName, rows }),
      filename: `${form.toUpperCase()}_${typeName ? `${safe(typeName)}_` : ''}${span}.xlsx`,
    }
  }

  if (form === 'iirup' || form === 'iirusp') {
    const category = form === 'iirup' ? 'ppe' : 'semi'
    const u = await unserviceableRows({ officerId: need(q.officerId, 'officerId'), category, typeId: q.typeId, asAt: q.asAt })
    return {
      buffer: await buildIirup({ category, entityName: s.entityName, asAt: u.asAt, fundCluster: s.defaultFundCluster, officerName: u.officer.fullName, officerPosition: u.officer.position, station: u.officer.office ?? '', rows: u.rows }),
      filename: `${form.toUpperCase()}_${safe(u.officer.fullName)}_${u.asAt}.xlsx`,
    }
  }

  const want = form === 'rpcsp' ? 'semi' : 'ppe'
  const report = await officerReportRows({ officerId: need(q.officerId, 'officerId'), category: want, typeId: q.typeId, asAt: q.asAt, countId: q.countId })
  const data: CountData = {
    category: want, typeLabel: report.type?.name ?? 'All types', asAt: report.asAt, fundCluster: s.defaultFundCluster,
    officerName: report.officer.fullName, officerPosition: report.officer.position,
    signatories: (q.signatories ?? report.signatories).map((x) => ({ role: x.role, name: x.name, position: x.position ?? null })),
    rows: report.rows,
  }
  return {
    buffer: await (form === 'rpcsp' ? buildRpcsp(s.entityName, data) : buildRpcppe(s, data)),
    filename: `${form.toUpperCase()}_${safe(report.officer.fullName)}_${report.asAt}.xlsx`,
  }
}
