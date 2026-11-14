import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  countItems, countSignatories, documents, linePdfRegions, lines, officers, physicalCounts, properties, qrTokens,
} from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { buildPropertyView, type PropertyViewData } from '../projections/propertyView.js'
import { getDocument } from './documents.js'
import { regionOut } from './lines.js'
import { getSettings } from './settings.js'
import { cardForProperty, countRows, findPropertyByNo, registry } from './views.js'

type Prop = typeof properties.$inferSelect

// Around five queries (plus the registry and card views): property+line+document, the document's lines, the card,
// the registry, and the latest count that contains this property.
async function load(p: Prop, token: string | null): Promise<PropertyViewData> {
  const line = (await db.select().from(lines).where(and(eq(lines.id, p.lineId), isNull(lines.deletedAt))))[0]
  const doc = line && (await db.select().from(documents).where(and(eq(documents.id, line.documentId), isNull(documents.deletedAt))))[0]
  if (!line || !doc) throw new AppError('ITEM_REMOVED', 410, 'This item was removed')

  const [issuer, receiver] = await Promise.all([
    db.select().from(officers).where(eq(officers.id, doc.issuedByOfficerId)),
    db.select().from(officers).where(eq(officers.id, doc.receivedByOfficerId)),
  ])
  const region = (await db.select().from(linePdfRegions).where(eq(linePdfRegions.lineId, line.id)))[0]
  const [full, cardRows, registryRows, settings] = await Promise.all([
    getDocument(doc.id), cardForProperty(p.id), registry(line.category), getSettings(),
  ])

  const last = (await db.select({ id: physicalCounts.id }).from(countItems)
    .innerJoin(physicalCounts, eq(physicalCounts.id, countItems.countId)).where(eq(countItems.propertyId, p.id))
    .orderBy(desc(physicalCounts.asAt), desc(physicalCounts.createdAt)).limit(1))[0]
  let count: PropertyViewData['count'] = null
  if (last) {
    const c = (await db.select().from(physicalCounts).where(eq(physicalCounts.id, last.id)))[0]
    const officer = (await db.select().from(officers).where(eq(officers.id, c.officerId)))[0]
    const sigs = await db.select().from(countSignatories).where(eq(countSignatories.countId, c.id))
    count = {
      typeLabel: c.typeLabel, asAt: c.asAt, fundCluster: c.fundCluster, officerName: officer.fullName, officerPosition: c.officerPosition,
      assumptionDate: c.assumptionDate, status: c.status,
      signatories: sigs.sort((a, b) => a.sortOrder - b.sortOrder).map((s) => ({ role: s.role, name: s.name, position: s.position })),
      rows: await countRows(c.id),
    }
  }

  return {
    token, settings: { entityName: settings.entityName, ppeRegistryTitle: settings.ppeRegistryTitle },
    property: { id: p.id, propertyNo: p.propertyNo, serialNo: p.serialNo, oldPropertyNo: p.oldPropertyNo, componentLabel: p.componentLabel, condition: p.condition },
    line: {
      id: line.id, category: line.category, article: line.article, description: line.description, qty: line.qty, unit: line.unit,
      unitCostCentavos: line.unitCostCentavos, estUsefulLifeYears: line.estUsefulLifeYears, dateAcquired: line.dateAcquired,
    },
    region: regionOut(region),
    document: {
      id: doc.id, type: doc.type, docNo: doc.docNo, fundCluster: doc.fundCluster, issuedDate: doc.issuedDate, hasPdf: doc.pdfStoredName !== null,
      issuedBy: { name: issuer[0].fullName, position: doc.issuedByPosition },
      receivedBy: { name: receiver[0].fullName, position: doc.receivedByPosition },
    },
    docLines: full.lines.map((l) => ({
      id: l.id, lineNo: l.lineNo, qty: l.qty, unit: l.unit, unitCostCentavos: l.unitCostCentavos, description: l.description, article: l.article,
      estUsefulLifeYears: l.estUsefulLifeYears, dateAcquired: l.dateAcquired, properties: l.properties.map((x) => ({ propertyNo: x.propertyNo })),
    })),
    card: cardRows,
    registry: registryRows,
    count,
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
