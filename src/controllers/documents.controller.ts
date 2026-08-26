import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import Document, { DOCUMENT_RELATED_TYPES, DocumentRelatedType } from '../models/document.model';
import Order from '../models/order.model';
import Contract from '../models/contract.model';
import { HttpError } from '../utils/HttpError';
import { UPLOAD_DIR } from '../middleware/upload';

export async function list(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (req.query.relatedType) filter.relatedType = req.query.relatedType;
  if (req.query.relatedId) filter.relatedId = req.query.relatedId;

  const documents = await Document.find(filter).sort({ createdAt: -1 });
  res.json(documents);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const document = await Document.findById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');
  res.json(document);
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const file = req.file;
  const { relatedType, relatedId } = req.body as { relatedType?: string; relatedId?: string };

  const cleanup = () => {
    if (file) fs.unlink(file.path, () => {});
  };

  if (!file) throw new HttpError(400, 'file is required');

  if (!relatedType || !DOCUMENT_RELATED_TYPES.includes(relatedType as DocumentRelatedType)) {
    cleanup();
    throw new HttpError(400, 'Invalid relatedType');
  }
  if (!relatedId) {
    cleanup();
    throw new HttpError(400, 'relatedId is required');
  }

  const safeRelatedType = relatedType as DocumentRelatedType;

  const relatedExists =
    safeRelatedType === 'Order' ? await Order.exists({ _id: relatedId }) : await Contract.exists({ _id: relatedId });
  if (!relatedExists) {
    cleanup();
    throw new HttpError(400, `${safeRelatedType} does not exist`);
  }

  const document = await Document.create({
    relatedType: safeRelatedType,
    relatedId,
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedBy: req.user!._id,
  });

  res.status(201).json(document);
}

export async function download(req: Request, res: Response): Promise<void> {
  const document = await Document.findById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');

  const filePath = path.join(UPLOAD_DIR, document.filename);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'File missing on disk');

  res.download(filePath, document.originalName);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const document = await Document.findById(req.params.id);
  if (!document) throw new HttpError(404, 'Document not found');

  await document.deleteOne();
  fs.unlink(path.join(UPLOAD_DIR, document.filename), () => {});
  res.status(204).send();
}
