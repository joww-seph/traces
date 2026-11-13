// Read-only typings for the SQL views created in drizzle/0001_views.sql. Never migrated by drizzle-kit (.existing()).
// bigint(mode:number) columns are converted to JS numbers by drizzle.
import { bigint, date, integer, pgView, smallint, text, uuid } from 'drizzle-orm/pg-core'
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
  unit: text('unit'),
  unitCostCentavos: money('unit_cost_centavos'),
  article: text('article'),
  description: text('description'),
  documentId: uuid('document_id'),
  docType: docType('doc_type'),
  docNo: text('doc_no'),
  fundCluster: text('fund_cluster'),
  issuedDate: day('issued_date'),
}).existing()

export const vCardMovements = pgView('v_card_movements', {
  movementId: bigint('movement_id', { mode: 'number' }),
  propertyId: uuid('property_id'),
  type: movementType('type'),
  qty: integer('qty'),
  date: day('date'),
  officerId: uuid('officer_id'),
  officerName: text('officer_name'),
  officerShort: text('officer_short'),
  referenceDocumentId: uuid('reference_document_id'),
  referenceDocType: docType('reference_doc_type'),
  referenceDocNo: text('reference_doc_no'),
  referenceText: text('reference_text'),
  remarks: text('remarks'),
  unitCostCentavos: money('unit_cost_centavos'),
  propertyNo: text('property_no'),
  category: itemCategory('category'),
  balanceQty: bigint('balance_qty', { mode: 'number' }),
}).existing()

export const vCustody = pgView('v_custody', {
  propertyId: uuid('property_id'),
  holderOfficerId: uuid('holder_officer_id'),
  since: day('since'),
}).existing()

export const vHoldings = pgView('v_holdings', {
  propertyId: uuid('property_id'),
  propertyNo: text('property_no'),
  lineId: uuid('line_id'),
  category: itemCategory('category'),
  unit: text('unit'),
  unitCostCentavos: money('unit_cost_centavos'),
  article: text('article'),
  description: text('description'),
  documentId: uuid('document_id'),
  holderOfficerId: uuid('holder_officer_id'),
  since: day('since'),
}).existing()

export const vRegistry = pgView('v_registry', {
  lineId: uuid('line_id'),
  category: itemCategory('category'),
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

export const vCountRows = pgView('v_count_rows', {
  countId: uuid('count_id'),
  propertyId: uuid('property_id'),
  article: text('article'),
  description: text('description'),
  propertyNo: text('property_no'),
  unit: text('unit'),
  unitValueCentavos: money('unit_value_centavos'),
  balancePerCard: integer('balance_per_card'),
  qtyOnHand: integer('qty_on_hand'),
  shortageOverageQty: integer('shortage_overage_qty'),
  shortageOverageValueCentavos: money('shortage_overage_value_centavos'),
  remarks: text('remarks'),
}).existing()
