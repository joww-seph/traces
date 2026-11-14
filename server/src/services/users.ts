import { randomInt } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import type { userPatch } from '@traces/shared'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { AppError, pgErrorOf } from '../middleware/error.js'
import { audit, type Ctx } from './audit.js'

// @node-rs/argon2 defaults to argon2id.
export const hashPassword = (password: string) => hash(password)
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password)

// Verified against when the email is unknown, so unknown and wrong-password take the same time.
const dummyHash = hashPassword('traces-dummy-password')

export const findByEmail = async (email: string) =>
  (await db.select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`))[0]

export const findById = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]

export async function checkCredentials(email: string, password: string) {
  const user = await findByEmail(email)
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash), password)
  return ok && user?.active ? user : null
}

export async function createUser(
  input: { email: string; displayName: string; role: 'supply_admin' | 'superadmin'; password: string; mustChangePassword?: boolean },
  ctx: Ctx,
) {
  const passwordHash = await hashPassword(input.password)
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({
      email: input.email.trim(), displayName: input.displayName, role: input.role, passwordHash,
      mustChangePassword: input.mustChangePassword ?? true,
    }).returning()
    await audit(tx, ctx, 'user.create', 'users', user.id, null, { email: user.email, role: user.role })
    return user
  })
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, ctx: Ctx) {
  const user = await findById(userId)
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Current password is incorrect')
  }
  const passwordHash = await hashPassword(newPassword)
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, userId))
    await audit(tx, ctx, 'user.password_change', 'users', userId)
  })
}

// Kicks the user out immediately: flag off + every session row deleted.
export async function deactivateUser(userId: string, ctx: Ctx) {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ active: false, updatedAt: new Date() }).where(eq(users.id, userId))
    await tx.execute(sql`DELETE FROM session WHERE sess->>'userId' = ${userId}`)
    await audit(tx, ctx, 'user.deactivate', 'users', userId)
  })
}

// 20 characters, no look-alikes (0/O, 1/l/I), at least one of each class. Used for temporary passwords.
export function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+']
  const all = sets.join('')
  const chars = sets.map((set) => set[randomInt(set.length)])
  while (chars.length < 20) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]] }
  return chars.join('')
}

// ───────────── superadmin user management ─────────────
const columns = {
  id: users.id, email: users.email, displayName: users.displayName, role: users.role, active: users.active,
  mustChangePassword: users.mustChangePassword, createdAt: users.createdAt, updatedAt: users.updatedAt,
}

export const listUsers = () => db.select(columns).from(users).orderBy(asc(users.displayName))

export async function adminCreateUser(input: { email: string; displayName: string; role: 'supply_admin' | 'superadmin' }, ctx: Ctx) {
  const temporaryPassword = generatePassword()
  try {
    const u = await createUser({ ...input, password: temporaryPassword, mustChangePassword: true }, ctx)
    return { user: { id: u.id, email: u.email, displayName: u.displayName, role: u.role, active: u.active, mustChangePassword: u.mustChangePassword }, temporaryPassword }
  } catch (e) {
    if (pgErrorOf(e)?.constraint === 'users_email_lower_uq') throw new AppError('EMAIL_TAKEN', 409, 'Someone already uses that email address')
    throw e
  }
}

export async function adminUpdateUser(id: string, patch: z.infer<typeof userPatch>, ctx: Ctx) {
  let temporaryPassword: string | undefined
  const user = await db.transaction(async (tx) => {
    const before = (await tx.select().from(users).where(eq(users.id, id)).for('update'))[0]
    if (!before) throw new AppError('USER_NOT_FOUND', 404, 'User not found')

    // never leave the system without an active superadmin (also stops a superadmin locking themselves out)
    const losesSuperadmin = before.role === 'superadmin' && before.active && (patch.active === false || (patch.role && patch.role !== 'superadmin'))
    if (losesSuperadmin) {
      const others = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, 'superadmin'), eq(users.active, true), ne(users.id, id))).limit(1)
      if (!others.length) throw new AppError('LAST_SUPERADMIN', 409, 'This is the last active superadmin. Make another superadmin first.')
    }

    const set: Partial<typeof users.$inferInsert> = {}
    if (patch.displayName !== undefined) set.displayName = patch.displayName
    if (patch.role !== undefined) set.role = patch.role
    if (patch.active !== undefined) set.active = patch.active
    if (patch.resetPassword) {
      temporaryPassword = generatePassword()
      set.passwordHash = await hashPassword(temporaryPassword)
      set.mustChangePassword = true
    }
    if (!Object.keys(set).length) return before
    const [after] = await tx.update(users).set({ ...set, updatedAt: new Date() }).where(eq(users.id, id)).returning()

    if (patch.active === false || patch.resetPassword) await tx.execute(sql`DELETE FROM session WHERE sess->>'userId' = ${id}`)
    if (patch.active !== undefined && patch.active !== before.active) await audit(tx, ctx, patch.active ? 'user.activate' : 'user.deactivate', 'users', id)
    if (patch.role !== undefined && patch.role !== before.role) await audit(tx, ctx, 'user.role', 'users', id, { role: before.role }, { role: after.role })
    if (patch.displayName !== undefined && patch.displayName !== before.displayName) await audit(tx, ctx, 'user.update', 'users', id, { displayName: before.displayName }, { displayName: after.displayName })
    if (patch.resetPassword) await audit(tx, ctx, 'user.password_reset', 'users', id)
    return after
  })
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, active: user.active, mustChangePassword: user.mustChangePassword },
    ...(temporaryPassword ? { temporaryPassword } : {}),
  }
}
