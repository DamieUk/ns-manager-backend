import { Types } from 'mongoose';

export function documentFromFile(file: Express.Multer.File, client: Types.ObjectId, uploadedBy: Types.ObjectId) {
  return {
    client,
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedBy,
  };
}
