import { documentMeta, documentPatch, isoDate, uuid } from '@traces/shared'
import { Router, type Request } from 'express'
import { z } from 'zod'
import { requireRole } from '../middleware/auth.js'
import { AppError } from '../middleware/error.js'
import { cleanupOnError, uploadPdf } from '../middleware/upload.js'
import { createDocument, getDocument, listDocuments, patchDocument, softDeleteDocument } from '../services/documents.js'
import { attachUploaded, readPdfMeta, removeUploaded } from '../services/documentFiles.js'
import { generateDocument } from '../services/generate.js'
import { ctx } from './ctx.js'
import { sendPdf } from './pdf.js'

const listQuery = z.object({
  type: z.enum(['ICS', 'PAR']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  officerId: uuid.optional(),
  q: z.string().trim().min(1).optional(),
  status: z.enum(['none', 'generated', 'signed', 'unsigned']).optional(),
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
    const file = req.file ? await readPdfMeta(req.file) : null // a PDF is optional: it can be generated or attached later
    res.status(201).json(await createDocument(meta, file, req.user!.id, ctx(req)))
  }))

  r.get('/documents/:id', async (req, res) => res.json(await getDocument(uuid.parse(req.params.id))))

  r.patch('/documents/:id', async (req, res) => res.json(await patchDocument(uuid.parse(req.params.id), documentPatch.parse(req.body ?? {}), ctx(req))))

  // (re)generate the official form as a PDF with computed highlight boxes; refused once a signed copy exists
  r.post('/documents/:id/generate', async (req, res) => res.json(await generateDocument(uuid.parse(req.params.id), ctx(req))))

  // attach or replace the uploaded copy (signed scan or an existing PDF)
  r.put('/documents/:id/pdf', uploadPdf, cleanupOnError(async (req, res) => {
    const id = uuid.parse(req.params.id)
    if (!req.file) throw new AppError('PDF_REQUIRED', 400, 'A PDF file is required (field "pdf")')
    res.json(await attachUploaded(id, await readPdfMeta(req.file), req.user!.id, ctx(req)))
  }))

  // remove the signed copy so the entries can be corrected; the file is archived, never deleted
  r.delete('/documents/:id/pdf', async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(1, 'A reason is required').max(300) }).parse(req.body ?? {})
    res.json(await removeUploaded(uuid.parse(req.params.id), reason, ctx(req)))
  })

  r.delete('/documents/:id', async (req, res) => {
    await softDeleteDocument(uuid.parse(req.params.id), ctx(req))
    res.json({ ok: true })
  })

  r.get('/documents/:id/pdf', async (req, res) => {
    const { kind } = z.object({ kind: z.enum(['generated', 'uploaded']).optional() }).parse(req.query)
    await sendPdf(res, uuid.parse(req.params.id), kind)
  })

  return r
}
