import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documents, items, linePdfRegions, lines, officers, properties, propertyTypes, qrTokens } from '../db/schema.js'
import { filesOf } from './documentFiles.js'
import { vCustody } from '../db/views.js'
import { AppError } from '../middleware/error.js'
import { buildPropertyView, type PropertyViewData } from '../projections/propertyView.js'
import { getDocument } from './documents.js'
import { regionOut } from './lines.js'
import { getSettings } from './settings.js'
import { cardHeader, cardRows, findPropertyByNo, officerReportRows, registry } from './views.js'

type Prop = typeof properties.$inferSelect

// Property + line + card + document, the document's lines, the card, the registry and the holder's report.
async function load(p: Prop, token: string | null): Promise<PropertyViewData> {
  const line = (await db.select().from(lines).where(and(eq(lines.id, p.lineId), isNull(lines.deletedAt))))[0]
  const doc = line && (await db.select().from(documents).where(and(eq(documents.id, line.documentId), isNull(documents.deletedAt))))[0]
  if (!line || !doc) throw new AppError('ITEM_REMOVED', 410, 'This item was removed')
  const item = (await db.select({ category: items.category, article: items.article, description: items.description, unit: items.unit, typeId: items.propertyTypeId, typeName: propertyTypes.name })
    .from(items).innerJoin(propertyTypes, eq(propertyTypes.id, items.propertyTypeId)).where(eq(items.id, line.itemId)))[0]

  const [issuer, receiver] = await Promise.all([
    db.select().from(officers).where(eq(officers.id, doc.issuedByOfficerId)),
    db.select().from(officers).where(eq(officers.id, doc.receivedByOfficerId)),
  ])
  const files = (await filesOf([doc.id])).get(doc.id)!
  const pdfKind = files.uploaded ? 'uploaded' as const : files.generated ? 'generated' as const : null
  const region = pdfKind ? (await db.select().from(linePdfRegions).where(and(eq(linePdfRegions.lineId, line.id), eq(linePdfRegions.kind, pdfKind))))[0] : undefined
  const holder = (await db.select({ holder: vCustody.holderOfficerId }).from(vCustody).where(eq(vCustody.propertyId, p.id)))[0]?.holder ?? null
  const mainNo = p.componentLabel
    ? (await db.select({ no: properties.propertyNo }).from(properties)
      .where(and(eq(properties.lineId, line.id), isNull(properties.componentLabel), isNull(properties.voidedAt))).limit(1))[0]?.no ?? null
    : null

  const [full, header, rows, registryRows, settings, report] = await Promise.all([
    getDocument(doc.id), cardHeader(line.itemId), cardRows(line.itemId), registry(item.category, { typeId: item.typeId }), getSettings(),
    holder ? officerReportRows({ officerId: holder, category: item.category, typeId: item.typeId }) : null,
  ])

  return {
    token, settings: { entityName: settings.entityName, ppeRegistryTitle: settings.ppeRegistryTitle },
    property: {
      id: p.id, propertyNo: p.propertyNo, serialNo: p.serialNo, oldPropertyNo: p.oldPropertyNo, componentLabel: p.componentLabel,
      condition: p.condition, partOfSetNo: mainNo,
    },
    line: {
      id: line.id, itemId: line.itemId, category: item.category, article: item.article, description: line.description, itemDescription: item.description,
      qty: line.qty, unit: item.unit, unitCostCentavos: line.unitCostCentavos, estUsefulLifeYears: line.estUsefulLifeYears,
      dateAcquired: line.dateAcquired, propertyTypeName: item.typeName,
    },
    region: regionOut(region),
    document: {
      id: doc.id, type: doc.type, docNo: doc.docNo, fundCluster: doc.fundCluster, issuedDate: doc.issuedDate, pdfKind,
      issuedBy: { name: issuer[0].fullName, position: doc.issuedByPosition },
      receivedBy: { name: receiver[0].fullName, position: doc.receivedByPosition },
    },
    docLines: full.lines.map((l) => ({
      id: l.id, lineNo: l.lineNo, qty: l.qty, unit: l.unit ?? '', unitCostCentavos: l.unitCostCentavos, description: l.description, article: l.article ?? '',
      estUsefulLifeYears: l.estUsefulLifeYears, dateAcquired: l.dateAcquired, properties: l.properties.map((x) => ({ propertyNo: x.propertyNo, componentLabel: x.componentLabel })),
    })),
    card: { propertyNoFirst: header.propertyNoFirst, propertyNoLast: header.propertyNoLast, rows },
    registry: registryRows,
    report: report ? { officerName: report.officer.fullName, officerPosition: report.officer.position, asAt: report.asAt, rows: report.rows } : null,
  }
}

const activeToken = async (propertyId: string) =>
  (await db.select({ token: qrTokens.token }).from(qrTokens).where(and(eq(qrTokens.propertyId, propertyId), isNull(qrTokens.revokedAt))))[0]?.token ?? null

// Admin: by property number (case-insensitive).
export async function adminPropertyView(propertyNo: string) {
  const p = await findPropertyByNo(propertyNo)
  try { return buildPropertyView(await load(p, await activeToken(p.id)), 'admin') } catch (e) {
    if (e instanceof AppError && e.code === 'ITEM_REMOVED') throw new AppError('PROPERTY_NOT_FOUND', 404, `Property ${propertyNo} not found`)
    throw e
  }
}

// Public: by QR token. 404 unknown, 410 replaced or removed. Nothing here touches the database for a malformed token (route checks the format).
export async function resolveToken(token: string) {
  const t = (await db.select().from(qrTokens).where(eq(qrTokens.token, token)))[0]
  if (!t) throw new AppError('NOT_FOUND', 404, 'Not found')
  if (t.revokedAt) throw new AppError('QR_REPLACED', 410, 'This QR code was replaced. Use the newer sticker on the item.')
  const p = (await db.select().from(properties).where(eq(properties.id, t.propertyId)))[0]
  if (!p || p.voidedAt) throw new AppError('ITEM_REMOVED', 410, 'This item was removed from the records.')
  return p
}

export async function publicPropertyView(token: string) {
  const p = await resolveToken(token)
  return buildPropertyView(await load(p, token), 'public')
}

// The signed PDF behind a QR token.
export async function publicPdfRef(token: string) {
  const p = await resolveToken(token)
  const line = (await db.select().from(lines).where(and(eq(lines.id, p.lineId), isNull(lines.deletedAt))))[0]
  if (!line) throw new AppError('ITEM_REMOVED', 410, 'This item was removed from the records.')
  return line.documentId
}
