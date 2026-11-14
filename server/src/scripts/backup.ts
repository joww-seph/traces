import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// npm run backup
// Writes backups/<timestamp>/ with traces.dump (pg_dump custom format) and storage.tar.gz (signed PDFs, including pdfs/replaced).
// pg_dump runs from PATH (or PG_DUMP=<path>); in development, where PostgreSQL lives in Docker, it runs inside the container.
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1) }
const root = path.resolve(process.env.BACKUP_DIR ?? path.join(process.cwd(), '..', 'backups'))
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dir = path.join(root, stamp)
mkdirSync(dir, { recursive: true })
const dump = path.join(dir, 'traces.dump')

function pgDump() {
  try {
    const out = execFileSync(process.env.PG_DUMP ?? 'pg_dump', ['-Fc', '--dbname', url!], { maxBuffer: 1 << 30 })
    writeFileSync(dump, out)
    return 'pg_dump'
  } catch {
    const u = new URL(url!)
    const out = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'pg_dump', '-Fc', '-U', decodeURIComponent(u.username), u.pathname.slice(1)],
      { cwd: path.join(process.cwd(), '..'), maxBuffer: 1 << 30 })
    writeFileSync(dump, out)
    return 'docker compose exec db pg_dump'
  }
}

const how = pgDump()
const storage = path.resolve(process.env.STORAGE_DIR ?? './storage')
let files = 'no storage folder yet'
if (existsSync(storage)) {
  // relative archive name + cwd: GNU tar on Windows reads a drive letter ('C:') in the archive path as a remote host
  execFileSync('tar', ['-czf', 'storage.tar.gz', '-C', storage, '.'], { cwd: dir })
  files = `${(statSync(path.join(dir, 'storage.tar.gz')).size / 1024).toFixed(0)} KB`
}
console.log(`Backup written to ${dir}\n  database: ${(statSync(dump).size / 1024).toFixed(0)} KB (${how})\n  files:    ${files}`)
console.log('Copy it off this machine and keep it encrypted: it holds signed forms and personal data.')
