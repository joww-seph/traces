// Must produce the same tables/constraints/indexes as docs/plans/traces-schema.sql.
// Views live in a hand-written migration (see drizzle/*_views.sql) and are typed in views.ts.
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn, bigint, boolean, char, check, date, foreignKey, index, inet, integer, json, jsonb, numeric, pgEnum, pgTable,
  primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core'

// ───────────── Enums ─────────────
export const userRole = pgEnum('user_role', ['supply_admin', 'superadmin'])
export const docType = pgEnum('doc_type', ['ICS', 'PAR'])
export const itemCategory = pgEnum('item_category', ['semi', 'ppe'])
export const movementType = pgEnum('movement_type', ['RECEIPT', 'ISSUE', 'RETURN', 'REISSUE', 'DISPOSE'])
export const itemCondition = pgEnum('item_condition', ['serviceable', 'unserviceable'])
export const pdfKind = pgEnum('pdf_kind', ['generated', 'uploaded'])
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
  // default "Received from / Issued by" on generated ICS/PAR (the supply officer)
  defaultIssuedByOfficerId: uuid('default_issued_by_officer_id').references((): AnyPgColumn => officers.id),
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
  canReceive: boolean('can_receive').notNull().default(false), // may appear as "Received by" / on the officer report
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('officers_short_name_uq').on(sql`lower(${t.shortName})`)])

// programs / projects the officer is focal person of ("SARAi CENTRO, Focal Person"); searched by the officer dropdown
export const officerDesignations = pgTable('officer_designations', {
  officerId: uuid('officer_id').notNull().references(() => officers.id, { onDelete: 'cascade' }),
  sortOrder: smallint('sort_order').notNull(),
  designation: text('designation').notNull(),
}, (t) => [primaryKey({ columns: [t.officerId, t.sortOrder] })])

// ───────────── Property types and items (cards) ─────────────
export const propertyTypes = pgTable('property_types', {
  id: smallint('id').primaryKey().generatedAlwaysAsIdentity(),
  code: text('code').notNull(), // letters inside property numbers, e.g. ICT
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [
  check('property_types_code_check', sql`${t.code} ~ '^[A-Z]{2,8}$'`),
  uniqueIndex('property_types_code_uq').on(t.code),
  uniqueIndex('property_types_name_uq').on(sql`lower(${t.name})`),
])

// One card per model: SPC (semi) or PC (ppe)
export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyTypeId: smallint('property_type_id').notNull().references(() => propertyTypes.id),
  category: itemCategory('category').notNull(),
  article: text('article').notNull(), // general term: "Laptop"
  description: text('description').notNull(), // the model: "Lenovo ThinkPad E14 Gen 5"
  unit: text('unit').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  unique('items_id_category_uq').on(t.id, t.category), // target of lines_item_category_fk
  uniqueIndex('items_identity_uq').on(t.category, t.propertyTypeId, sql`lower(${t.article})`, sql`lower(${t.description})`),
  index('items_type_idx').on(t.propertyTypeId, t.category).where(sql`active`),
])

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
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
  deletedAt: tstz('deleted_at'),
}, (t) => [
  unique('documents_type_doc_no_uq').on(t.type, t.docNo),
  index('documents_issued_date_idx').on(t.issuedDate.desc()),
  index('documents_received_by_idx').on(t.receivedByOfficerId),
])

// Up to two PDFs per document: the one TRACES generated and the uploaded one (signed scan or an existing file)
export const documentFiles = pgTable('document_files', {
  documentId: uuid('document_id').notNull().references(() => documents.id),
  kind: pdfKind('kind').notNull(),
  storedName: text('stored_name').notNull(),
  originalName: text('original_name'), // NULL for generated files
  sizeBytes: integer('size_bytes').notNull(),
  pageCount: smallint('page_count').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.documentId, t.kind] }),
  check('document_files_size_positive', sql`${t.sizeBytes} > 0`),
  check('document_files_pages_positive', sql`${t.pageCount} > 0`),
  check('document_files_name_rule', sql`(${t.kind} = 'generated') = (${t.originalName} IS NULL)`),
])

export const lines = pgTable('lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').notNull(),
  qty: integer('qty').notNull(),
  unitCostCentavos: money('unit_cost_centavos').notNull(),
  description: text('description').notNull(), // as printed on the ICS/PAR row (specs, serials)
  estUsefulLifeYears: smallint('est_useful_life_years'),
  dateAcquired: day('date_acquired'),
  iarNo: text('iar_no'),
  iarDate: day('iar_date'),
  category: itemCategory('category').notNull(), // frozen at create (BR-01)
  deletedAt: tstz('deleted_at'),
}, (t) => [
  unique('lines_document_line_no_uq').on(t.documentId, t.lineNo),
  // a line's frozen category must equal its card's category (BR-01)
  foreignKey({ name: 'lines_item_category_fk', columns: [t.itemId, t.category], foreignColumns: [items.id, items.category] }),
  index('lines_item_idx').on(t.itemId),
  check('lines_line_no_positive', sql`${t.lineNo} > 0`),
  check('lines_qty_positive', sql`${t.qty} > 0`),
  check('lines_unit_cost_nonneg', sql`${t.unitCostCentavos} >= 0`),
  check('lines_useful_life_positive', sql`${t.estUsefulLifeYears} > 0`),
  index('lines_category_idx').on(t.category).where(sql`deleted_at IS NULL`),
])

// x/y/w/h are fractions (0-1) of the page. One box per line on each kind of PDF.
export const linePdfRegions = pgTable('line_pdf_regions', {
  lineId: uuid('line_id').notNull().references(() => lines.id, { onDelete: 'cascade' }),
  kind: pdfKind('kind').notNull(),
  page: smallint('page').notNull(),
  x: numeric('x', { precision: 6, scale: 5 }).notNull(),
  y: numeric('y', { precision: 6, scale: 5 }).notNull(),
  w: numeric('w', { precision: 6, scale: 5 }).notNull(),
  h: numeric('h', { precision: 6, scale: 5 }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.lineId, t.kind] }),
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

// ───────────── Report footers (RPCSP / RPCPPE) ─────────────
// default names printed under the report; editable on the page before printing
export const reportSignatories = pgTable('report_signatories', {
  role: signatoryRole('role').notNull(),
  sortOrder: smallint('sort_order').notNull().default(1),
  name: text('name').notNull(),
  position: text('position'),
}, (t) => [primaryKey({ columns: [t.role, t.sortOrder] })])

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
