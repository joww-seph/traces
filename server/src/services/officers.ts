import { shortNameOf, titleCaseName, type officerInput, type officerPatch } from '@traces/shared'
import { and, asc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { officerDesignations, officers } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Officer = typeof officers.$inferSelect

const withDesignations = async (rows: Officer[], d: Pick<typeof db, 'select'> = db) => {
  const des = rows.length
    ? await d.select().from(officerDesignations).where(inArray(officerDesignations.officerId, rows.map((o) => o.id))).orderBy(asc(officerDesignations.sortOrder))
    : []
  return rows.map((o) => ({ ...o, designations: des.filter((x) => x.officerId === o.id).map((x) => x.designation) }))
}

// q searches the full name, the short name and the designations (so "SARAi" finds its focal persons).
export async function listOfficers(f: { active?: boolean; canReceive?: boolean; q?: string } = {}) {
  const term = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const rows = await db.select().from(officers).where(and(
    f.active === undefined ? undefined : eq(officers.active, f.active),
    f.canReceive === undefined ? undefined : eq(officers.canReceive, f.canReceive),
    term ? or(
      ilike(officers.fullName, term), ilike(officers.shortName, term),
      sql`exists (select 1 from ${officerDesignations} d where d.officer_id = ${officers.id} and d.designation ilike ${term})`,
    ) : undefined,
  )).orderBy(asc(officers.shortName))
  return withDesignations(rows)
}

const saveDesignations = async (tx: Tx, officerId: string, list: string[]) => {
  await tx.delete(officerDesignations).where(eq(officerDesignations.officerId, officerId))
  if (list.length) await tx.insert(officerDesignations).values(list.map((designation, i) => ({ officerId, sortOrder: i + 1, designation })))
}

// "MSantos", or "MSantos2" when another officer already has it (the unique index is case-insensitive)
export async function uniqueShortName(tx: Pick<typeof db, 'select'>, fullName: string, exceptId?: string) {
  const base = shortNameOf(fullName)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}${n}`
    const taken = await tx.select({ id: officers.id }).from(officers)
      .where(and(sql`lower(${officers.shortName}) = lower(${candidate})`, exceptId ? ne(officers.id, exceptId) : undefined))
    if (!taken.length) return candidate
  }
}

export async function createOfficer(input: z.infer<typeof officerInput>, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const { designations, ...rest } = input
    const fullName = titleCaseName(rest.fullName)
    const fields = { ...rest, fullName, shortName: await uniqueShortName(tx, fullName) }
    const [o] = await tx.insert(officers).values(fields).returning()
    await saveDesignations(tx, o.id, designations)
    const [full] = await withDesignations([o], tx)
    await audit(tx, ctx, 'officer.create', 'officers', o.id, null, full)
    return full
  })
}

async function change(id: string, set: z.infer<typeof officerPatch>, action: string, ctx: Ctx) {
  return db.transaction(async (tx) => {
    const before = (await tx.select().from(officers).where(eq(officers.id, id)).for('update'))[0]
    if (!before) throw new AppError('OFFICER_NOT_FOUND', 404, 'Officer not found')
    const [beforeFull] = await withDesignations([before], tx)
    const { designations, ...fields } = set as typeof set & { shortName?: string }
    if (fields.fullName) { // a corrected name corrects the short name too
      fields.fullName = titleCaseName(fields.fullName)
      fields.shortName = await uniqueShortName(tx, fields.fullName, id)
    }
    const [after] = Object.keys(fields).length ? await tx.update(officers).set(fields).where(eq(officers.id, id)).returning() : [before]
    if (designations) await saveDesignations(tx, id, designations)
    const [afterFull] = await withDesignations([after], tx)
    await audit(tx, ctx, action, 'officers', id, beforeFull, afterFull)
    return afterFull
  })
}

export const updateOfficer = (id: string, patch: z.infer<typeof officerPatch>, ctx: Ctx) => change(id, patch, 'officer.update', ctx)
// DELETE never removes the row: documents reference officers.
export const deactivateOfficer = (id: string, ctx: Ctx) => change(id, { active: false }, 'officer.deactivate', ctx)

// "Received by" on an ICS/PAR (and the report officer) must be someone who may receive.
export async function assertCanReceive(tx: Pick<typeof db, 'select'>, officerId: string) {
  const o = (await tx.select({ canReceive: officers.canReceive, shortName: officers.shortName }).from(officers).where(eq(officers.id, officerId)))[0]
  if (!o) throw new AppError('OFFICER_NOT_FOUND', 400, 'Officer not found')
  if (!o.canReceive) throw new AppError('OFFICER_CANNOT_RECEIVE', 400, `${o.shortName} is not on the list of officers who receive property`, { officerId })
}
