import { Response } from 'express';

// Sends a generated PDF to be shown in the browser (and saved under `filename`).
export function sendPdf(res: Response, pdf: Buffer, filename: string): void {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(pdf);
}
