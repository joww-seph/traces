import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { E2E } from '../playwright.config'

// Fresh traces_test with the two test accounts and the settings row, and an empty PDF folder.
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E.db, NODE_ENV: 'development' }
  const run = (cmd: string) => execSync(cmd, { env, stdio: 'inherit' })
  run('npm -w server run prepare:testdb')
  run(`npm -w server run seed:superadmin -- --email ${E2E.superadmin.email} --password ${E2E.superadmin.password} --name "E2E Superadmin" --base-url http://localhost:${E2E.webPort}`)
  run(`npm -w server run seed:superadmin -- --email ${E2E.supply.email} --password ${E2E.supply.password} --name "E2E Supply" --role supply_admin`)
  rmSync(path.resolve('server', 'storage-e2e'), { recursive: true, force: true })
}
