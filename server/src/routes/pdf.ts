import type { Response } from 'express'
import { getPdfFile, type PdfKind } from '../services/documentFiles.js'

export async function sendPdf(res: Response, documentId: string, kind?: PdfKind) {
  const { file, originalName } = await getPdfFile(documentId, kind)
  res.type('application/pdf')
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(originalName)}`)
  await new Promise<void>((ok, fail) => res.sendFile(file, { dotfiles: 'allow' }, (err) => (err ? fail(err) : ok())))
}
