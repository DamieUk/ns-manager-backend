import { Request, Response } from 'express';
import { createDocument, deleteDocument, Doc, documentJson, findDocumentById, listDocuments } from '../models/document.model';
import { clientExists } from '../models/client.model';
import { HttpError } from '../utils/HttpError';
import { castId } from '../utils/validate';
import { deleteFromStorage, readFromStorage } from '../config/storage';
import { documentFromFile } from '../utils/documentFromFile';
import { ACTION_RANK } from '../constants/permissions';

// Anyone with ORDERS:view can browse the shared client document pool. An employee without
// that permission can still fetch a document they uploaded themselves (e.g. a photo attached
// to their own daily-progress report) — narrowly scoped to their own uploads only.
function canAccessDocument(req: Request, document: Doc): boolean {
  const entry = req.user!.permissions.find((p) => p.key === 'ORDERS');
  const actual = entry?.action ?? 'none';
  if (ACTION_RANK[actual] >= ACTION_RANK.view) return true;
  return document.uploadedBy === req.user!.id;
}

export async function list(req: Request, res: Response): Promise<void> {
  const documents = await listDocuments({ clientId: req.query.client || undefined });
  res.json(documents.map((d) => documentJson(d)));
}

export async function getById(req: Request, res: Response): Promise<void> {
  const document = await findDocumentById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');
  if (!canAccessDocument(req, document)) throw new HttpError(403, 'Requires ORDERS:view permission');
  res.json(documentJson(document));
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const file = req.file;
  const { client } = req.body as { client?: string };

  if (!file) throw new HttpError(400, 'file is required');
  if (!client) throw new HttpError(400, 'client is required');

  if (!(await clientExists(client))) throw new HttpError(400, 'client does not exist');

  const document = await createDocument(await documentFromFile(file, castId(client), req.user!.id));

  res.status(201).json(documentJson(document));
}

export async function download(req: Request, res: Response): Promise<void> {
  const document = await findDocumentById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');
  if (!canAccessDocument(req, document)) throw new HttpError(403, 'Requires ORDERS:view permission');

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
