import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documents } from '../db/schema.js'

// Suggests the next ICS and PAR numbers, YYYY-MM{UNIT}-NNN (e.g. 2026-11SARAi-001), for an issue date and unit.
// One counter per year + unit + form type, continuing across months. Deleted forms still count (their number stays used).
// Nothing is reserved: the unique (type, doc_no) constraint is the real guard.
export async function suggestDocumentNumbers(issuedDate: string, unit: string) {
  // the unit code is letters and digits only (checked by the route), so it is safe inside the pattern
  const pattern = `^${issuedDate.slice(0, 4)}-\\d{2}${unit}-(\\d+)$`
  const next = async (type: 'ICS' | 'PAR') => {
    const row = (await db.select({ m: sql<number | null>`max((regexp_match(${documents.docNo}, ${pattern}))[1]::int)` })
      .from(documents).where(eq(documents.type, type)))[0]
    return `${issuedDate.slice(0, 7)}${unit}-${String((row.m ?? 0) + 1).padStart(3, '0')}`
  }
  return { icsNo: await next('ICS'), parNo: await next('PAR') }
}
