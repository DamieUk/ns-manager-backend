import crypto from 'crypto';
import path from 'path';
import { Types } from 'mongoose';
import { uploadToStorage } from '../config/storage';

export async function documentFromFile(file: Express.Multer.File, client: Types.ObjectId, uploadedBy: Types.ObjectId) {
  const key = `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`;
  await uploadToStorage(key, file.buffer, file.mimetype);

  return {
    client,
    filename: key,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedBy,
  };
}
