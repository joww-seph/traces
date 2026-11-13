import express from 'express'
import helmet from 'helmet'
import { pool } from './db/client.js'
import { errorHandler, notFound } from './middleware/error.js'
import { originCheck } from './middleware/origin.js'
import { sessionMiddleware } from './middleware/session.js'
import { adminSettingsRouter } from './routes/admin/settings.js'
import { authRouter } from './routes/auth.js'
import { officersRouter } from './routes/officers.js'
import { settingsRouter } from './routes/settings.js'

export function createApp() {
  const app = express()
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1) // behind nginx
  app.use(helmet())
  app.use(originCheck())
  app.use(express.json({ limit: '1mb' }))
  app.use(sessionMiddleware())

  app.get('/api/health', async (_req, res) => {
    await pool.query('select 1')
    res.json({ ok: true, db: true })
  })

  app.use('/api', authRouter(), settingsRouter(), officersRouter(), adminSettingsRouter())
  // routers mount here as they are built
  app.use('/api', notFound)
  app.use(errorHandler)
  return app
}
