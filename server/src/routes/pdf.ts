import type { Response } from 'express'
import { getPdfFile, type PdfKind } from '../services/documentFiles.js'

// The ONLY way a PDF leaves the server (SEC-09). Streams a document's PDF inline: the signed copy when there is one,
// else the TRACES-generated copy, unless a kind is asked for. Callers decide who may see it (staff session or a valid QR token).
export async function sendPdf(res: Response, documentId: string, kind?: PdfKind) {
  const { file, originalName } = await getPdfFile(documentId, kind)
  res.type('application/pdf')
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`)
  // dotfiles: the path is server-controlled, and STORAGE_DIR may sit under a dot-directory
  await new Promise<void>((ok, fail) => res.sendFile(file, { dotfiles: 'allow' }, (err) => (err ? fail(err) : ok())))
}
