import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { officerDesignations, officers } from '../db/schema.js'
import { audit } from './audit.js'

// Columns: full_name, short_name, position, office, designations (" | " separated), note.
// Upserts by lower(short_name), so running it again (or over dev officers) updates instead of duplicating.

// RFC 4180: quoted fields may hold commas, newlines and doubled quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

export async function seedOfficers(csv: string) {
  const [header, ...data] = parseCsv(csv.replace(/^﻿/, ''))
  const col = (name: string) => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`The CSV has no "${name}" column`)
    return i
  }
  const [iFull, iShort, iPos, iOffice, iDes, iNote] = ['full_name', 'short_name', 'position', 'office', 'designations', 'note'].map(col)
  const notes: { shortName: string; note: string }[] = []

  await db.transaction(async (tx) => {
    for (const r of data) {
      const shortName = r[iShort].trim()
      const values = { fullName: r[iFull].trim(), shortName, position: r[iPos].trim(), office: (r[iOffice] ?? '').trim(), canReceive: true, active: true }
      const existing = (await tx.select({ id: officers.id }).from(officers).where(sql`lower(${officers.shortName}) = lower(${shortName})`))[0]
      const id = existing
        ? (await tx.update(officers).set(values).where(eq(officers.id, existing.id)).returning({ id: officers.id }))[0].id
        : (await tx.insert(officers).values(values).returning({ id: officers.id }))[0].id
      const list = (r[iDes] ?? '').split(' | ').map((x) => x.trim()).filter(Boolean)
      await tx.delete(officerDesignations).where(eq(officerDesignations.officerId, id))
      if (list.length) await tx.insert(officerDesignations).values(list.map((designation, i) => ({ officerId: id, sortOrder: i + 1, designation })))
      if ((r[iNote] ?? '').trim()) notes.push({ shortName, note: r[iNote].trim() })
    }
    await audit(tx, { actorId: null, ip: null }, 'officer.seed', 'officers', 'csv', null, { count: data.length })
  })
  return { count: data.length, notes }
}
