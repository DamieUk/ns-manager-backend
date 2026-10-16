import { Request, Response } from 'express';
import { createDocument, deleteDocument, Doc, DocumentType, documentJson, findDocumentById, listDocuments, setDocumentType } from '../models/document.model';
import { clientExists } from '../models/client.model';
import { HttpError } from '../utils/HttpError';
import { castId } from '../utils/validate';
import { deleteFromStorage, readFromStorage } from '../config/storage';
import { documentFromFile } from '../utils/documentFromFile';
import { ACTION_RANK } from '../constants/permissions';
import { isDocumentOfAssignedOrder } from '../models/order.model';

// Anyone with ORDERS:view can browse the shared client document pool. An employee without
// that permission can still fetch a document they uploaded themselves (e.g. a photo attached
// to their own daily-progress report) — narrowly scoped to their own uploads only.
// ORDERS:view opens every document; otherwise one's own uploads and the files of the batches
// one is assigned to (BOM, P&P program, thermal profile, ...).
async function canAccessDocument(req: Request, document: Doc): Promise<boolean> {
  const entry = req.user!.permissions.find((p) => p.key === 'ORDERS');
  const actual = entry?.action ?? 'none';
  if (ACTION_RANK[actual] >= ACTION_RANK.view) return true;
  if (document.uploadedBy === req.user!.id) return true;
  return isDocumentOfAssignedOrder(document.id, req.user!.id);
}

export async function list(req: Request, res: Response): Promise<void> {
  const documents = await listDocuments({ clientId: req.query.client || undefined });
  res.json(documents.map((d) => documentJson(d)));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const document = await findDocumentById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');
  if (!(await canAccessDocument(req, document))) throw new HttpError(403, 'Requires ORDERS:view permission');
  res.json(documentJson(document));
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const file = req.file;
  const { client, type } = req.body as { client?: string; type?: DocumentType };

  if (!file) throw new HttpError(400, 'file is required');
  if (!client) throw new HttpError(400, 'client is required');

  if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');

  const document = await createDocument(await documentFromFile(file, castId(client), req.user!.id, type || 'other'));

  res.status(201).json(documentJson(document));
}

// Re-classifies a file (e.g. an «other» upload that is really the client's NDA).
export async function update(req: Request, res: Response): Promise<void> {
  const document = await findDocumentById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');

  const { type } = req.body as { type?: unknown };
  if (type !== undefined) await setDocumentType(document, type);
  res.json(documentJson(document));
}

export async function download(req: Request, res: Response): Promise<void> {
  const document = await findDocumentById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');
  if (!(await canAccessDocument(req, document))) throw new HttpError(403, 'Requires ORDERS:view permission');

  let object;
  try {
    object = await readFromStorage(document.filename);
  } catch {
    throw new HttpError(404, 'File missing in storage');
  }

  res.setHeader('Content-Type', document.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.originalName)}"`);
  res.setHeader('Content-Length', object.contentLength);
  object.body.pipe(res);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const document = await findDocumentById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');

  await deleteDocument(document.id);
  deleteFromStorage(document.filename).catch(() => {});
  res.status(204).send();
}
