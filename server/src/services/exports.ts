import { db } from '../db/client.js'
import { officers } from '../db/schema.js'
import { buildSpc, buildRpcsp } from '../exports/built.js'
import { buildIcs, buildPar, buildPc, buildRegistry, buildRpcppe, type CountData, type DocData } from '../exports/fill.js'
import { AppError } from '../middleware/error.js'
import { getCount } from './counts.js'
import { getDocument } from './documents.js'
import { adminPropertyView } from './propertyView.js'
import { getSettings } from './settings.js'
import { registry } from './views.js'

export const FORMS = ['ics', 'par', 'spc', 'pc', 'regspi', 'regppe', 'rpcsp', 'rpcppe'] as const
export type Form = (typeof FORMS)[number]
export type ExportQuery = { documentId?: string; no?: string; countId?: string; from?: string; to?: string }

const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined || v === '') throw new AppError('VALIDATION', 400, `This form needs ${what}`)
  return v
}
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_')

export async function exportForm(form: Form, q: ExportQuery): Promise<{ buffer: Buffer; filename: string }> {
  const s = await getSettings()

  if (form === 'ics' || form === 'par') {
    const doc = await getDocument(need(q.documentId, 'documentId'))
    if (doc.type.toLowerCase() !== form) throw new AppError('WRONG_FORM', 400, `This document is a ${doc.type}; export it as ${doc.type.toLowerCase()}`)
    const names = new Map((await db.select({ id: officers.id, name: officers.fullName }).from(officers)).map((o) => [o.id, o.name]))
    const data: DocData = {
      type: doc.type, docNo: doc.docNo, fundCluster: doc.fundCluster, issuedDate: doc.issuedDate,
      issuedBy: { name: names.get(doc.issuedByOfficerId) ?? '', position: doc.issuedByPosition },
      receivedBy: { name: names.get(doc.receivedByOfficerId) ?? '', position: doc.receivedByPosition },
      lines: doc.lines.map((l) => ({
        qty: l.qty, unit: l.unit, unitCostCentavos: l.unitCostCentavos, description: l.description, propertyNos: l.properties.map((p) => p.propertyNo),
        estUsefulLifeYears: l.estUsefulLifeYears, dateAcquired: l.dateAcquired,
      })),
    }
    return { buffer: await (form === 'ics' ? buildIcs : buildPar)(s, data), filename: `${doc.type}_${safe(doc.docNo)}.xlsx` }
  }

  if (form === 'spc' || form === 'pc') {
    const v = await adminPropertyView(need(q.no, 'no (the property number)'))
    const want = form === 'spc' ? 'semi' : 'ppe'
    if (v.property.category !== want) {
      throw new AppError('WRONG_FORM', 400, `${v.property.propertyNo} is ${v.property.category === 'ppe' ? 'PPE' : 'semi-expendable'}; export it as ${v.property.category === 'ppe' ? 'pc' : 'spc'}`)
    }
    const data = {
      category: want as 'semi' | 'ppe', propertyNo: v.property.propertyNo, article: v.line.article, description: v.line.description,
      fundCluster: v.document.fundCluster, rows: v.tabs.card.rows,
    }
    return { buffer: await (form === 'spc' ? buildSpc(s.entityName, data) : buildPc(s, data)), filename: `${form.toUpperCase()}_${safe(v.property.propertyNo)}.xlsx` }
  }

  if (form === 'regspi' || form === 'regppe') {
    const category = form === 'regspi' ? 'semi' : 'ppe'
    const rows = await registry(category, q.from, q.to)
    const span = q.from || q.to ? `${q.from ?? 'start'}_${q.to ?? 'today'}` : 'all'
    return {
      buffer: await buildRegistry(s, { category, fundCluster: s.defaultFundCluster, rows }),
      filename: `${form.toUpperCase()}_${span}.xlsx`,
    }
  }

  // rpcsp / rpcppe
  const count = await getCount(need(q.countId, 'countId'))
  const want = form === 'rpcsp' ? 'semi' : 'ppe'
  if (count.category !== want) throw new AppError('WRONG_FORM', 400, `This count is for ${count.category === 'ppe' ? 'PPE' : 'semi-expendable property'}; export it as ${count.category === 'ppe' ? 'rpcppe' : 'rpcsp'}`)
  const data: CountData = {
    category: want, typeLabel: count.typeLabel, asAt: count.asAt, fundCluster: count.fundCluster, officerName: count.officerName,
    officerPosition: count.officerPosition, assumptionDate: count.assumptionDate, signatories: count.signatories, rows: count.rows,
  }
  return {
    buffer: await (form === 'rpcsp' ? buildRpcsp(s.entityName, data) : buildRpcppe(s, data)),
    filename: `${form.toUpperCase()}_${safe(count.officerShortName)}_${count.asAt}.xlsx`,
  }
}

