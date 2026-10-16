import crypto from 'crypto';
import path from 'path';
import { uploadToStorage } from '../config/storage';
import { assertDocumentType, type DocumentType, type NewDoc } from '../models/document.model';

export async function documentFromFile(
  file: Express.Multer.File,
  clientId: string,
  uploadedBy: string,
  type: DocumentType = 'other'
): Promise<NewDoc> {
  assertDocumentType(type); // before anything is written to disk
  const key = `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`;
  await uploadToStorage(key, file.buffer);

  return {
    clientId,
    filename: key,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    type,
    uploadedBy,
  };
}
