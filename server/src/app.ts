import { fileURLToPath } from 'node:url'
import express from 'express'
import helmet from 'helmet'
import { pool } from './db/client.js'
import { errorHandler, notFound } from './middleware/error.js'
import { originCheck } from './middleware/origin.js'
import { sessionMiddleware } from './middleware/session.js'
import { adminSettingsRouter } from './routes/admin/settings.js'
import { authRouter } from './routes/auth.js'
import { countsRouter } from './routes/counts.js'
import { documentsRouter } from './routes/documents.js'
import { exportsRouter } from './routes/exports.js'
import { linesRouter } from './routes/lines.js'
import { officersRouter } from './routes/officers.js'
import { propertiesRouter } from './routes/properties.js'
import { publicRouter } from './routes/public.js'
import { viewsRouter } from './routes/views.js'
import { settingsRouter } from './routes/settings.js'
import { stickersRouter } from './routes/stickers.js'

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

  app.use('/api', authRouter(), settingsRouter(), officersRouter(), documentsRouter(), linesRouter(), countsRouter(), exportsRouter(), propertiesRouter(), viewsRouter(), stickersRouter(), publicRouter(), adminSettingsRouter())
  // routers mount here as they are built
  app.use('/api', notFound)

  // Production: one process serves the API and the built React app (same origin, so no CORS).
  if (process.env.NODE_ENV === 'production') {
    const dist = fileURLToPath(new URL('../../client/dist', import.meta.url)) // same depth from src/ and from the bundled dist/
    app.use(express.static(dist, { index: false }))
    app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/assets/') ? res.sendFile('index.html', { root: dist, headers: { 'Cache-Control': 'no-cache' } }) : next()))
  }
  app.use(errorHandler)
  return app
}
