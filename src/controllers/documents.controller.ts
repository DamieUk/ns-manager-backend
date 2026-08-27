import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Document from '../models/document.model';
import Client from '../models/client.model';
import { HttpError } from '../utils/HttpError';
import { UPLOAD_DIR } from '../middleware/upload';
import { documentFromFile } from '../utils/documentFromFile';

export async function list(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = {};
  if (req.query.client) filter.client = req.query.client;

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
  const { client } = req.body as { client?: string };

  const cleanup = () => {
    if (file) fs.unlink(file.path, () => {});
  };

  if (!file) throw new HttpError(400, 'file is required');

  if (!client) {
    cleanup();
    throw new HttpError(400, 'client is required');
  }

  const clientExists = await Client.exists({ _id: client });
  if (!clientExists) {
    cleanup();
    throw new HttpError(400, 'client does not exist');
  }

  const document = await Document.create(documentFromFile(file, new Types.ObjectId(client), req.user!._id));

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
