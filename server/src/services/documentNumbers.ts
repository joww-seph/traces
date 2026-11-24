import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documents } from '../db/schema.js'

export async function suggestDocumentNumbers(issuedDate: string, unit: string, parCount = 1) {
  const pattern = `^${issuedDate.slice(0, 4)}-\\d{2}${unit}-(\\d+)$`
  const last = async (type: 'ICS' | 'PAR') => (await db.select({ m: sql<number | null>`max((regexp_match(${documents.docNo}, ${pattern}))[1]::int)` })
    .from(documents).where(eq(documents.type, type)))[0].m ?? 0
  const no = (n: number) => `${issuedDate.slice(0, 7)}${unit}-${String(n).padStart(3, '0')}`
  const par = await last('PAR')
  return { icsNo: no((await last('ICS')) + 1), parNos: Array.from({ length: parCount }, (_, i) => no(par + 1 + i)) }
}
