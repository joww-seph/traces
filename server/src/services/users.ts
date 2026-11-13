import { hash, verify } from '@node-rs/argon2'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { AppError } from '../middleware/error.js'
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
