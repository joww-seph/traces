// Read-only typings for the SQL views created in drizzle/0005_update01_views.sql. Never migrated by drizzle-kit (.existing()).
// bigint(mode:number) columns are converted to JS numbers by drizzle.
import { sql } from 'drizzle-orm'
import { bigint, date, integer, pgView, smallint, text, uuid } from 'drizzle-orm/pg-core'
import { db } from './client.js'
import { docType, itemCategory, itemCondition, movementType } from './schema.js'

const day = (n: string) => date(n, { mode: 'string' })
const money = (n: string) => bigint(n, { mode: 'number' })

export const vActiveProperties = pgView('v_active_properties', {
  propertyId: uuid('property_id'),
  propertyNo: text('property_no'),
  serialNo: text('serial_no'),
  componentLabel: text('component_label'),
  condition: itemCondition('condition'),
  lineId: uuid('line_id'),
  category: itemCategory('category'),
  unitCostCentavos: money('unit_cost_centavos'),
  lineDescription: text('line_description'),
  itemId: uuid('item_id'),
  article: text('article'),
  itemDescription: text('item_description'),
  unit: text('unit'),
  propertyTypeId: smallint('property_type_id'),
  propertyTypeCode: text('property_type_code'),
  propertyTypeName: text('property_type_name'),
  documentId: uuid('document_id'),
  docType: docType('doc_type'),
  docNo: text('doc_no'),
  fundCluster: text('fund_cluster'),
  issuedDate: day('issued_date'),
}).existing()

// one row per event per line (a set is one row); balance = stock held by the Supply Unit
export const vItemCard = pgView('v_item_card', {
  itemId: uuid('item_id'),
  lineId: uuid('line_id'),
  type: movementType('type'),
  date: day('date'),
  officerId: uuid('officer_id'),
  referenceDocumentId: uuid('reference_document_id'),
  referenceText: text('reference_text'),
  remarks: text('remarks'),
  unitCostCentavos: money('unit_cost_centavos'),
  qty: integer('qty'),
  itemNos: text('item_nos'),
  firstMovementId: bigint('first_movement_id', { mode: 'number' }),
  officerName: text('officer_name'),
  officerShort: text('officer_short'),
  referenceDocType: docType('reference_doc_type'),
  referenceDocNo: text('reference_doc_no'),
  balanceQty: bigint('balance_qty', { mode: 'number' }),
  balanceAmountCentavos: money('balance_amount_centavos'),
}).existing()

export const vCustody = pgView('v_custody', {
  propertyId: uuid('property_id'),
  holderOfficerId: uuid('holder_officer_id'),
  since: day('since'),
}).existing()

export const vRegistry = pgView('v_registry', {
  lineId: uuid('line_id'),
  category: itemCategory('category'),
  propertyTypeId: smallint('property_type_id'),
  propertyTypeCode: text('property_type_code'),
  itemId: uuid('item_id'),
  date: day('date'),
  docType: docType('doc_type'),
  docNo: text('doc_no'),
  propertyNos: text('property_nos'),
  article: text('article'),
  description: text('description'),
  estUsefulLifeYears: smallint('est_useful_life_years'),
  issuedTo: text('issued_to'),
  issuedQty: bigint('issued_qty', { mode: 'number' }),
  returnedQty: bigint('returned_qty', { mode: 'number' }),
  reissuedQty: bigint('reissued_qty', { mode: 'number' }),
  disposedQty: bigint('disposed_qty', { mode: 'number' }),
  balanceQty: bigint('balance_qty', { mode: 'number' }),
  amountCentavos: money('amount_centavos'),
  remarks: text('remarks'),
  fundCluster: text('fund_cluster'),
}).existing()

export type OfficerReportRow = {
  officerId: string; lineId: string; itemId: string; category: 'semi' | 'ppe'; propertyTypeId: number
  article: string; description: string; propertyNos: string; unit: string; unitValueCentavos: number
  balancePerCard: number; docType: 'ICS' | 'PAR'; docNo: string; issuedDate: string
}

// RPCSP / RPCPPE rows as at a date. A function, not a view, so it goes through raw SQL.
export async function officerReport(asAt: string, d: Pick<typeof db, 'execute'> = db): Promise<OfficerReportRow[]> {
  const r = await d.execute(sql`SELECT officer_id, line_id, item_id, category, property_type_id, article, description,
    property_nos, unit, unit_value_centavos, balance_per_card, doc_type, doc_no, issued_date::text AS issued_date
    FROM fn_officer_report(${asAt}::date)`)
  return r.rows.map((x) => ({
    officerId: String(x.officer_id), lineId: String(x.line_id), itemId: String(x.item_id), category: x.category as 'semi' | 'ppe',
    propertyTypeId: Number(x.property_type_id), article: String(x.article), description: String(x.description),
    propertyNos: String(x.property_nos), unit: String(x.unit), unitValueCentavos: Number(x.unit_value_centavos),
    balancePerCard: Number(x.balance_per_card), docType: x.doc_type as 'ICS' | 'PAR', docNo: String(x.doc_no), issuedDate: String(x.issued_date),
  }))
}
