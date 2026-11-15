import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { documents } from '../db/schema.js'

// Suggests the next ICS and PAR numbers in the office's style: ICS `YYYY-MM-NNN`, PAR `YYYY-RO-NN`.
// One counter per year and form type, continuing across months. Deleted forms still count (their number stays used).
// Nothing is reserved: the unique (type, doc_no) constraint is the real guard.
export async function suggestDocumentNumbers(issuedDate: string) {
  const year = issuedDate.slice(0, 4)
  const highest = async (type: 'ICS' | 'PAR', pattern: string) =>
    (await db.select({ m: sql<number | null>`max((regexp_match(${documents.docNo}, ${pattern}))[1]::int)` })
      .from(documents).where(eq(documents.type, type)))[0].m ?? 0
  const ics = (await highest('ICS', `^${year}-\\d{2}-(\\d+)$`)) + 1
  const par = (await highest('PAR', `^${year}-RO-(\\d+)$`)) + 1
  return { icsNo: `${issuedDate.slice(0, 7)}-${String(ics).padStart(3, '0')}`, parNo: `${year}-RO-${String(par).padStart(2, '0')}` }
}
