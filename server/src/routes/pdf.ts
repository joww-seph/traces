import type { Response } from 'express'
import { getPdfFile } from '../services/documents.js'

// Streams a document's PDF inline. Callers decide who may see it (staff session or a valid QR token).
export async function sendPdf(res: Response, documentId: string) {
  const { file, originalName } = await getPdfFile(documentId)
  res.type('application/pdf')
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`)
  // dotfiles: the path is server-controlled, and STORAGE_DIR may sit under a dot-directory
  await new Promise<void>((ok, fail) => res.sendFile(file, { dotfiles: 'allow' }, (err) => (err ? fail(err) : ok())))
}
