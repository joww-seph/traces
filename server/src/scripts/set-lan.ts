import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { db, pool } from '../db/client.js'
import { settings } from '../db/schema.js'
import { audit } from '../services/audit.js'
import { clearSettingsCache } from '../services/settings.js'

// Development helper: point the app at this machine's LAN address so phones on the same Wi-Fi can open it
// (and scan stickers). Re-run it whenever the laptop gets a new address.
//   npm run lan              detect the address
//   npm run lan -- 10.0.0.5  use this one
const PORT = process.env.CLIENT_PORT ?? '5173'
const VIRTUAL = /vethernet|wsl|virtualbox|vmware|docker|loopback|bluetooth|tailscale|hyper-v/i

function detect(): string | null {
  const found: { ip: string; rank: number }[] = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL.test(name)) continue
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const rank = a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : -1
      if (rank >= 0) found.push({ ip: a.address, rank })
    }
  }
  return found.sort((x, y) => x.rank - y.rank)[0]?.ip ?? null
}

const ip = process.argv[2] ?? detect()
if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
  console.error('No private network address found. Connect to Wi-Fi or pass one: npm run lan -- 192.168.1.20')
  process.exit(1)
}
const url = `http://${ip}:${PORT}`

// server/.env: the Origin check only accepts addresses listed in APP_ORIGIN
const envPath = fileURLToPath(new URL('../../.env', import.meta.url))
const origins = `http://localhost:${PORT},${url}`
let env = ''
try { env = readFileSync(envPath, 'utf8') } catch { /* no .env yet: created below */ }
env = /^APP_ORIGIN=.*$/m.test(env) ? env.replace(/^APP_ORIGIN=.*$/m, `APP_ORIGIN=${origins}`) : `${env.trimEnd()}\nAPP_ORIGIN=${origins}\n`
writeFileSync(envPath, env)

try {
  const rows = await db.select().from(settings).where(eq(settings.id, 1))
  if (rows[0]) {
    await db.transaction(async (tx) => {
      await tx.update(settings).set({ publicBaseUrl: url, updatedAt: new Date() }).where(eq(settings.id, 1))
      await audit(tx, { actorId: null, ip: null }, 'settings.update', 'settings', '1', { publicBaseUrl: rows[0].publicBaseUrl }, { publicBaseUrl: url })
    })
    clearSettingsCache()
  } else {
    console.warn('No settings row yet (run seed:superadmin first); only APP_ORIGIN was updated.')
  }
  console.log(`Public base URL: ${url}\nAPP_ORIGIN:      ${origins}\nRestart the API (npm run dev) so it picks up APP_ORIGIN.`)
} finally {
  await pool.end()
}
