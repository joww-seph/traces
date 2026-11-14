import { documentMeta, documentPatch, isoDate, uuid } from '@traces/shared'
import { Router, type Request } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { cleanupOnError, uploadPdf } from '../middleware/upload.js'
import { createDocument, getDocument, listDocuments, patchDocument, readPdfMeta, softDeleteDocument } from '../services/documents.js'
import { ctx } from './ctx.js'
import { sendPdf } from './pdf.js'

const listQuery = z.object({
  type: z.enum(['ICS', 'PAR']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  officerId: uuid.optional(),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
})

// multipart: JSON in the "meta" field; plain JSON requests carry the fields at the top level.
function metaOf(req: Request): unknown {
  const raw = req.body?.meta
  if (typeof raw !== 'string') return req.body ?? {}
  try { return JSON.parse(raw) } catch { throw new AppError('BAD_JSON', 400, 'meta is not valid JSON') }
}

export function documentsRouter() {
  const r = Router()
  r.use('/documents', requireRole('supply_admin', 'superadmin'))

  r.get('/documents', async (req, res) => res.json(await listDocuments(listQuery.parse(req.query))))

  r.post('/documents', uploadPdf, cleanupOnError(async (req, res) => {
    const meta = documentMeta.parse(metaOf(req))
    if (!req.file) throw new AppError('PDF_REQUIRED', 400, 'A PDF file is required (field "pdf")')
    const file = await readPdfMeta(req.file)
    res.status(201).json(await createDocument(meta, file, req.user!.id, ctx(req)))
  }))

  r.get('/documents/:id', async (req, res) => res.json(await getDocument(uuid.parse(req.params.id))))

  r.patch('/documents/:id', uploadPdf, cleanupOnError(async (req, res) => {
    const patch = documentPatch.parse(metaOf(req))
    const file = req.file ? await readPdfMeta(req.file) : null
    res.json(await patchDocument(uuid.parse(req.params.id), patch, file, ctx(req)))
  }))

  r.delete('/documents/:id', async (req, res) => {
    await softDeleteDocument(uuid.parse(req.params.id), ctx(req))
    res.json({ ok: true })
  })

  r.get('/documents/:id/pdf', async (req, res) => {
    await sendPdf(res, uuid.parse(req.params.id))
  })

  return r
}
