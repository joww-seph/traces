// Must produce the same tables/constraints/indexes as docs/plans/traces-schema.sql.
// Views live in a hand-written migration (see drizzle/*_views.sql) and are typed in views.ts.
import { sql } from 'drizzle-orm'
import {
  bigint, boolean, char, check, date, index, inet, integer, json, jsonb, numeric, pgEnum, pgTable,
  primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core'

// ───────────── Enums ─────────────
export const userRole = pgEnum('user_role', ['supply_admin', 'superadmin'])
export const docType = pgEnum('doc_type', ['ICS', 'PAR'])
export const itemCategory = pgEnum('item_category', ['semi', 'ppe'])
export const movementType = pgEnum('movement_type', ['RECEIPT', 'ISSUE', 'RETURN', 'REISSUE', 'DISPOSE'])
export const itemCondition = pgEnum('item_condition', ['serviceable', 'unserviceable'])
export const countStatus = pgEnum('count_status', ['open', 'closed'])
export const cardRowMode = pgEnum('card_row_mode', ['merged', 'split'])
export const signatoryRole = pgEnum('signatory_role', ['committee', 'head_of_agency', 'coa_representative'])

const tstz = (name: string) => timestamp(name, { withTimezone: true })
const money = (name: string) => bigint(name, { mode: 'number' })
const day = (name: string) => date(name, { mode: 'string' })

// ───────────── Accounts ─────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull(),
  active: boolean('active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)])

// Session store (shape required by connect-pg-simple)
export const session = pgTable('session', {
  sid: varchar('sid').primaryKey(),
  sess: json('sess').notNull(),
  expire: timestamp('expire', { precision: 6 }).notNull(),
}, (t) => [index('session_expire_idx').on(t.expire)])

// ───────────── Settings (single row) ─────────────
export const settings = pgTable('settings', {
  id: smallint('id').primaryKey().default(1),
  entityName: text('entity_name').notNull(),
  defaultFundCluster: text('default_fund_cluster').notNull(),
  ppeThresholdCentavos: money('ppe_threshold_centavos').notNull(),
  cardRowMode: cardRowMode('card_row_mode').notNull().default('merged'),
  publicBaseUrl: text('public_base_url').notNull(),
  ppeRegistryTitle: text('ppe_registry_title').notNull().default('REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED'),
  // document-control box printed in the corner of the ICS / PAR exports; edit when the quality office issues a new revision
  icsFormCode: text('ics_form_code').notNull().default('FM-FAS-SUPPLY-07-10'),
  icsFormRevision: text('ics_form_revision').notNull().default('Rev. 1/07-25-22'),
  parFormCode: text('par_form_code').notNull().default('FM-FAS-SUPPLY-07-09'),
  parFormRevision: text('par_form_revision').notNull().default('Rev. 1/07-25-22'),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
}, (t) => [
  check('settings_single_row', sql`${t.id} = 1`),
  check('settings_threshold_positive', sql`${t.ppeThresholdCentavos} > 0`),
])

// ───────────── People ─────────────
export const officers = pgTable('officers', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  shortName: text('short_name').notNull(),
  position: text('position').notNull(),
  office: text('office').notNull().default(''),
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('officers_short_name_uq').on(sql`lower(${t.shortName})`)])

// ───────────── ICS / PAR ─────────────
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: docType('type').notNull(),
  docNo: text('doc_no').notNull(),
  fundCluster: text('fund_cluster').notNull(),
  issuedDate: day('issued_date').notNull(),
  issuedByOfficerId: uuid('issued_by_officer_id').notNull().references(() => officers.id),
  issuedByPosition: text('issued_by_position').notNull(), // as printed on the form (historical fact)
  receivedByOfficerId: uuid('received_by_officer_id').notNull().references(() => officers.id),
  receivedByPosition: text('received_by_position').notNull(), // as printed on the form (historical fact)
  purpose: text('purpose'),
  pdfStoredName: text('pdf_stored_name'),
  pdfOriginalName: text('pdf_original_name'),
  pdfSizeBytes: integer('pdf_size_bytes'),
  pdfPageCount: smallint('pdf_page_count'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
  deletedAt: tstz('deleted_at'),
}, (t) => [
  unique('documents_type_doc_no_uq').on(t.type, t.docNo),
  check('documents_pdf_size_positive', sql`${t.pdfSizeBytes} > 0`),
  check('documents_pdf_pages_positive', sql`${t.pdfPageCount} > 0`),
  check('documents_pdf_all_or_none', sql`
    (${t.pdfStoredName} IS NULL) = (${t.pdfOriginalName} IS NULL) AND
    (${t.pdfStoredName} IS NULL) = (${t.pdfSizeBytes} IS NULL) AND
    (${t.pdfStoredName} IS NULL) = (${t.pdfPageCount} IS NULL)`),
  index('documents_issued_date_idx').on(t.issuedDate.desc()),
  index('documents_received_by_idx').on(t.receivedByOfficerId),
])

export const lines = pgTable('lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  lineNo: integer('line_no').notNull(),
  qty: integer('qty').notNull(),
  unit: text('unit').notNull(),
  unitCostCentavos: money('unit_cost_centavos').notNull(),
  article: text('article').notNull(),
  description: text('description').notNull(),
  estUsefulLifeYears: smallint('est_useful_life_years'),
  dateAcquired: day('date_acquired'),
  iarNo: text('iar_no'),
  iarDate: day('iar_date'),
  category: itemCategory('category').notNull(), // frozen at create (BR-01)
  deletedAt: tstz('deleted_at'),
}, (t) => [
  unique('lines_document_line_no_uq').on(t.documentId, t.lineNo),
  check('lines_line_no_positive', sql`${t.lineNo} > 0`),
  check('lines_qty_positive', sql`${t.qty} > 0`),
  check('lines_unit_cost_nonneg', sql`${t.unitCostCentavos} >= 0`),
  check('lines_useful_life_positive', sql`${t.estUsefulLifeYears} > 0`),
  index('lines_category_idx').on(t.category).where(sql`deleted_at IS NULL`),
])

// x/y/w/h are fractions (0-1) of the page
export const linePdfRegions = pgTable('line_pdf_regions', {
  lineId: uuid('line_id').primaryKey().references(() => lines.id, { onDelete: 'cascade' }),
  page: smallint('page').notNull(),
  x: numeric('x', { precision: 6, scale: 5 }).notNull(),
  y: numeric('y', { precision: 6, scale: 5 }).notNull(),
  w: numeric('w', { precision: 6, scale: 5 }).notNull(),
  h: numeric('h', { precision: 6, scale: 5 }).notNull(),
}, (t) => [
  check('line_pdf_regions_page_positive', sql`${t.page} > 0`),
  check('line_pdf_regions_x', sql`${t.x} >= 0 AND ${t.x} <= 1`),
  check('line_pdf_regions_y', sql`${t.y} >= 0 AND ${t.y} <= 1`),
  check('line_pdf_regions_w', sql`${t.w} > 0 AND ${t.x} + ${t.w} <= 1.00001`),
  check('line_pdf_regions_h', sql`${t.h} > 0 AND ${t.y} + ${t.h} <= 1.00001`),
])

export const properties = pgTable('properties', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyNo: text('property_no').notNull(),
  lineId: uuid('line_id').notNull().references(() => lines.id),
  serialNo: text('serial_no'),
  oldPropertyNo: text('old_property_no'), // legacy number from earlier inventories (printed in RPC remarks)
  componentLabel: text('component_label'), // NULL = main unit
  condition: itemCondition('condition').notNull().default('serviceable'),
  voidedAt: tstz('voided_at'),
}, (t) => [
  check('properties_property_no_format', sql`${t.propertyNo} ~ '^[A-Za-z0-9-]+$'`),
  uniqueIndex('properties_property_no_uq').on(sql`upper(${t.propertyNo})`),
  index('properties_line_idx').on(t.lineId),
])

export const qrTokens = pgTable('qr_tokens', {
  token: char('token', { length: 10 }).primaryKey(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
  revokedAt: tstz('revoked_at'),
}, (t) => [
  check('qr_tokens_token_format', sql`${t.token} ~ '^[0-9A-Za-z]{10}$'`),
  // at most one active token per property
  uniqueIndex('qr_tokens_one_active_uq').on(t.propertyId).where(sql`revoked_at IS NULL`),
])

// ───────────── Ledger ─────────────
export const movements = pgTable('movements', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  type: movementType('type').notNull(),
  qty: integer('qty').notNull().default(1),
  date: day('date').notNull(),
  officerId: uuid('officer_id').references(() => officers.id),
  referenceDocumentId: uuid('reference_document_id').references(() => documents.id),
  referenceText: text('reference_text'),
  remarks: text('remarks'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  check('movements_qty_positive', sql`${t.qty} > 0`),
  check('movements_custody_needs_officer',
    sql`${t.type} NOT IN ('ISSUE', 'REISSUE', 'RETURN') OR ${t.officerId} IS NOT NULL`),
  index('movements_property_date_idx').on(t.propertyId, t.date, t.id),
  index('movements_officer_idx').on(t.officerId, t.type),
])

// ───────────── Physical count (RPCSP / RPCPPE) ─────────────
export const physicalCounts = pgTable('physical_counts', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: itemCategory('category').notNull(),
  typeLabel: text('type_label').notNull(),
  asAt: day('as_at').notNull(),
  fundCluster: text('fund_cluster').notNull(),
  officerId: uuid('officer_id').notNull().references(() => officers.id),
  officerPosition: text('officer_position').notNull(), // as printed on the report
  assumptionDate: day('assumption_date'),
  status: countStatus('status').notNull().default('open'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
  closedAt: tstz('closed_at'),
}, (t) => [unique('physical_counts_unique_session').on(t.category, t.officerId, t.asAt)])

export const countSignatories = pgTable('count_signatories', {
  countId: uuid('count_id').notNull().references(() => physicalCounts.id, { onDelete: 'cascade' }),
  role: signatoryRole('role').notNull(),
  sortOrder: smallint('sort_order').notNull().default(1),
  name: text('name').notNull(),
  position: text('position'),
}, (t) => [primaryKey({ columns: [t.countId, t.role, t.sortOrder] })])

export const countItems = pgTable('count_items', {
  countId: uuid('count_id').notNull().references(() => physicalCounts.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  qtyOnHand: integer('qty_on_hand'), // NULL until counted
  remarks: text('remarks'),
}, (t) => [
  primaryKey({ columns: [t.countId, t.propertyId] }),
  check('count_items_qty_nonneg', sql`${t.qtyOnHand} >= 0`),
  index('count_items_property_idx').on(t.propertyId),
])

// ───────────── Audit ─────────────
export const auditLogs = pgTable('audit_logs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(), // 'line.create', 'qr.rotate', 'user.deactivate'
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: inet('ip'),
  at: tstz('at').notNull().defaultNow(),
}, (t) => [
  index('audit_logs_entity_idx').on(t.entity, t.entityId),
  index('audit_logs_at_idx').on(t.at.desc()),
])
