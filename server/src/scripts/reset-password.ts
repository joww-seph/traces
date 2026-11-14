import 'dotenv/config'
import { randomInt } from 'node:crypto'
import { parseArgs } from 'node:util'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../db/client.js'
import { users } from '../db/schema.js'
import { audit } from '../services/audit.js'
import { hashPassword } from '../services/users.js'

// Last-resort password reset from the server console (the superadmin page does this in the browser).
//   npm run reset:password -- --email it@traces.local --generate
//   npm run reset:password -- --email it@traces.local --password '<at least 10 characters>' [--must-change]
const { values } = parseArgs({
  options: { email: { type: 'string' }, password: { type: 'string' }, generate: { type: 'boolean' }, 'must-change': { type: 'boolean' } },
})
if (!values.email || (!values.password && !values.generate)) {
  console.error('Usage: npm run reset:password -- --email <email> (--generate | --password <password>) [--must-change]')
  process.exit(1)
}

// 20 characters, no look-alikes (0/O, 1/l/I), at least one of each class
function generate(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+']
  const all = sets.join('')
  const chars = sets.map((s) => s[randomInt(s.length)])
  while (chars.length < 20) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]] }
  return chars.join('')
}

const password = values.password ?? generate()
if (password.length < 10) { console.error('Password must be at least 10 characters'); process.exit(1) }

try {
  const user = (await db.select().from(users).where(sql`lower(${users.email}) = ${values.email.toLowerCase()}`))[0]
  if (!user) { console.error(`No user ${values.email}`); process.exitCode = 1 } else {
    const passwordHash = await hashPassword(password)
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, mustChangePassword: !!values['must-change'], active: true, updatedAt: new Date() }).where(eq(users.id, user.id))
      await tx.execute(sql`DELETE FROM session WHERE sess->>'userId' = ${user.id}`) // sign them out everywhere
      await audit(tx, { actorId: null, ip: null }, 'user.password_reset', 'users', user.id)
    })
    console.log(`Password reset for ${user.email}${values.generate ? `\nNew password: ${password}` : ''}`)
  }
} finally {
  await pool.end()
}
