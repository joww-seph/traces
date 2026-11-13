import express from 'express'
import helmet from 'helmet'
import { pool } from './db/client.js'

export function createApp() {
  const app = express()
  app.use(helmet())
  app.use(express.json({ limit: '1mb' }))
  app.get('/api/health', async (_req, res) => {
    await pool.query('select 1')
    res.json({ ok: true, db: true })
  })
  return app
}
