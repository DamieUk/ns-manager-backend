import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Document, { DocumentDocument } from '../models/document.model';
import Client from '../models/client.model';
import { HttpError } from '../utils/HttpError';
import { deleteFromStorage, readFromStorage } from '../config/storage';
import { documentFromFile } from '../utils/documentFromFile';
import { ACTION_RANK } from '../constants/permissions';

// Anyone with ORDERS:view can browse the shared client document pool. An employee without
// that permission can still fetch a document they uploaded themselves (e.g. a photo attached
// to their own daily-progress report) — narrowly scoped to their own uploads only.
function canAccessDocument(req: Request, document: DocumentDocument): boolean {
  const entry = req.user!.permissions.find((p) => p.key === 'ORDERS');
  const actual = entry?.action ?? 'none';
  if (ACTION_RANK[actual] >= ACTION_RANK.view) return true;
  return document.uploadedBy.equals(req.user!._id);
}

export async function list(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (req.query.client) filter.client = req.query.client;

  const documents = await Document.find(filter).sort({ createdAt: -1 });
  res.json(documents);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const document = await Document.findById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');
  if (!canAccessDocument(req, document)) throw new HttpError(403, 'Requires ORDERS:view permission');
  res.json(document);
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const file = req.file;
  const { client } = req.body as { client?: string };

  if (!file) throw new HttpError(400, 'file is required');
  if (!client) throw new HttpError(400, 'client is required');

  const clientExists = await Client.exists({ _id: client });
  if (!clientExists) throw new HttpError(400, 'client does not exist');

  const document = await Document.create(await documentFromFile(file, new Types.ObjectId(client), req.user!._id));

  res.status(201).json(document);
}

export async function download(req: Request, res: Response): Promise<void> {
  const document = await Document.findById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');
  if (!canAccessDocument(req, document)) throw new HttpError(403, 'Requires ORDERS:view permission');

  let object;
  try {
    object = await readFromStorage(document.filename);
  } catch {
    throw new HttpError(404, 'File missing in storage');
  }

  res.setHeader('Content-Type', object.contentType || document.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.originalName)}"`);
  if (object.contentLength) res.setHeader('Content-Length', object.contentLength);
  object.body.pipe(res);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const document = await Document.findById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');

  await document.deleteOne();
  deleteFromStorage(document.filename).catch(() => {});
  res.status(204).send();
}
