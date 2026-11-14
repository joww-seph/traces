import { count, isNull, sql, sum } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documentFiles, documents, items } from '../db/schema.js'
import { vActiveProperties, vRegistry } from '../db/views.js'

const zero = () => ({ properties: 0, mainUnits: 0, valueCentavos: 0 })

// Everything is read from the views, so the numbers always agree with the registry.
export async function dashboard() {
  const docs = await db.select({ type: documents.type, n: count() }).from(documents).where(isNull(documents.deletedAt)).groupBy(documents.type)
  const props = await db.select({
    category: vActiveProperties.category,
    properties: count(),
    mainUnits: sql<number>`count(*) filter (where ${vActiveProperties.componentLabel} is null)`.mapWith(Number),
  }).from(vActiveProperties).groupBy(vActiveProperties.category)
  const value = await db.select({ category: vRegistry.category, v: sum(vRegistry.amountCentavos) }).from(vRegistry).groupBy(vRegistry.category)

  const cards = (await db.select({ n: count() }).from(items))[0].n
  const unsigned = (await db.select({ n: count() }).from(documents)
    .where(sql`${documents.deletedAt} is null and not exists (select 1 from ${documentFiles} f where f.document_id = ${documents.id} and f.kind = 'uploaded')`))[0].n

  const categories = { semi: zero(), ppe: zero() }
  for (const r of props) if (r.category) Object.assign(categories[r.category], { properties: r.properties, mainUnits: r.mainUnits })
  for (const r of value) if (r.category) categories[r.category].valueCentavos = Number(r.v ?? 0)
  return {
    documents: { ICS: docs.find((d) => d.type === 'ICS')?.n ?? 0, PAR: docs.find((d) => d.type === 'PAR')?.n ?? 0 },
    categories,
    cards, // models with a card
    unsignedDocuments: unsigned, // ICS/PAR without an uploaded (signed) copy
  }
}
