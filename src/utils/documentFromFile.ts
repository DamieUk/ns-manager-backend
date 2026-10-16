import crypto from 'crypto';
import path from 'path';
import { uploadToStorage } from '../config/storage';
import type { NewDoc } from '../models/document.model';

export async function documentFromFile(file: Express.Multer.File, clientId: string, uploadedBy: string): Promise<NewDoc> {
  const key = `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`;
  await uploadToStorage(key, file.buffer);

  return {
    clientId,
    filename: key,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedBy,
  };
}
