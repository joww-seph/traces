import 'dotenv/config'
import { parseArgs } from 'node:util'
import { pool, db } from '../db/client.js'
import { settings } from '../db/schema.js'
import { createUser } from '../services/users.js'

// npm run seed:superadmin -- --email it@traces.local --password '<at least 10 characters>' [--name IT] [--role supply_admin] [--base-url http://...]
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string', default: 'Superadmin' },
    role: { type: 'string', default: 'superadmin' },
    'base-url': { type: 'string', default: 'http://localhost:5173' },
  },
})
if (!values.email || !values.password) {
  console.error('Usage: npm run seed:superadmin -- --email <email> --password <password> [--name <name>] [--role superadmin|supply_admin] [--base-url <url>]')
  process.exit(1)
}
if (values.role !== 'superadmin' && values.role !== 'supply_admin') {
  console.error('--role must be superadmin or supply_admin')
  process.exit(1)
}
if (values.password.length < 10) {
  console.error('Password must be at least 10 characters')
  process.exit(1)
}

try {
  const user = await createUser(
    { email: values.email, displayName: values.name!, role: values.role, password: values.password, mustChangePassword: false },
    { actorId: null, ip: null },
  )
  await db.insert(settings).values({
    entityName: 'DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1',
    defaultFundCluster: 'RAF',
    ppeThresholdCentavos: 5000000,
    publicBaseUrl: values['base-url']!,
  }).onConflictDoNothing()
  console.log(`${user.role} created: ${user.email}`)
} catch (e) {
  console.error((e as { code?: string }).code === '23505' ? `User ${values.email} already exists` : e)
  process.exitCode = 1
} finally {
  await pool.end()
}
