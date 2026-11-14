import { formatPropertyNo } from '@traces/shared'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { properties, propertyTypes } from '../db/schema.js'
import { AppError } from '../middleware/error.js'

// Suggests the next `count` property numbers for a type and acquisition date (Update 01 U-05).
// One counter per year + type, continuing across months; voided numbers still count (never reused).
// Nothing is reserved: the unique index is the real guard.
export async function suggestPropertyNumbers(typeId: number, dateAcquired: string, count: number) {
  const type = (await db.select({ code: propertyTypes.code }).from(propertyTypes).where(eq(propertyTypes.id, typeId)))[0]
  if (!type) throw new AppError('PROPERTY_TYPE_NOT_FOUND', 404, 'Property type not found')
  const year = Number(dateAcquired.slice(0, 4))
  const month = Number(dateAcquired.slice(5, 7))
  // the code is 2-8 capital letters (CHECK on property_types), so it is safe inside the pattern
  const pattern = `^${year}-\\d{2}${type.code}-(\\d+)[a-z]?$`
  const row = (await db.select({ m: sql<number | null>`max((regexp_match(${properties.propertyNo}, ${pattern}))[1]::int)` }).from(properties))[0]
  const start = (row.m ?? 0) + 1
  return Array.from({ length: count }, (_, i) => formatPropertyNo({ year, month, code: type.code, n: start + i }))
}
