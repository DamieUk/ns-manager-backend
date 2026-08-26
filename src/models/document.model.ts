import { Schema, model, HydratedDocument, Types } from 'mongoose';

export const DOCUMENT_RELATED_TYPES = ['Order', 'Contract'] as const;
export type DocumentRelatedType = (typeof DOCUMENT_RELATED_TYPES)[number];

export interface IDocument {
  relatedType: DocumentRelatedType;
  relatedId: Types.ObjectId;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DocumentDocument = HydratedDocument<IDocument>;

const documentSchema = new Schema<IDocument>(
  {
    relatedType: { type: String, enum: DOCUMENT_RELATED_TYPES, required: true },
    relatedId: { type: Schema.Types.ObjectId, required: true, refPath: 'relatedType' },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export default model<IDocument>('Document', documentSchema);
