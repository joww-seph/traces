import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Request, RequestHandler, Response } from 'express'
import multer from 'multer'
import { AppError } from './error.js'

// PDFs live outside any static folder and are only served through routes that check access.
export const pdfDir = () => path.resolve(process.env.STORAGE_DIR ?? './storage', 'pdfs')
export const removePdf = (storedName: string) => unlink(path.join(pdfDir(), storedName)).catch(() => {})

// A replaced or removed PDF is kept (signed originals are records): moved out of the live folder to STORAGE_DIR/archive/.
export const archiveDir = () => path.resolve(process.env.STORAGE_DIR ?? './storage', 'archive')
export async function archivePdf(storedName: string) {
  try {
    await mkdir(archiveDir(), { recursive: true })
    await rename(path.join(pdfDir(), storedName), path.join(archiveDir(), storedName))
  } catch { /* already gone: nothing to keep */ }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { mkdirSync(pdfDir(), { recursive: true }); cb(null, pdfDir()) },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.pdf`), // random name; original name is metadata only
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    file.mimetype === 'application/pdf' ? cb(null, true) : cb(new AppError('INVALID_PDF', 400, 'File must be a PDF')),
})

const checkMagicBytes: RequestHandler = async (req, _res, next) => {
  if (!req.file) return next()
  const fh = await open(req.file.path)
  const head = Buffer.alloc(5)
  await fh.read(head, 0, 5, 0)
  await fh.close()
  if (head.toString('latin1') !== '%PDF-') {
    await unlink(req.file.path)
    throw new AppError('INVALID_PDF', 400, 'File is not a PDF')
  }
  await chmod(req.file.path, 0o600) // signed forms: owner-only on POSIX hosts (no effect on Windows)
  next()
}

// multipart field "pdf": size, content type and %PDF- header checked; no-op for non-multipart requests.
export const uploadPdf = [upload.single('pdf'), checkMagicBytes]

// Wraps a handler so an uploaded file is deleted when anything after the upload fails.
export const cleanupOnError = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  async (req, res) => {
    try { await fn(req, res) } catch (e) {
      if (req.file) await unlink(req.file.path).catch(() => {})
      throw e
    }
  }
