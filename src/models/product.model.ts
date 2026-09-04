import { Schema, model, HydratedDocument, Types } from 'mongoose';
import { encryptField, decryptField } from '../utils/fieldEncryption';

export const PRODUCT_TYPES = ['PCB', 'Component', 'Other'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export interface IProduct {
  client: Types.ObjectId;
  name: string;
  sku: string;
  type: ProductType;
  description?: string;
  bomFile?: Types.ObjectId;
  additionalFiles: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type ProductDocument = HydratedDocument<IProduct>;

const productSchema = new Schema<IProduct>(
  {
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: PRODUCT_TYPES, required: true },
    description: { type: String, set: encryptField, get: decryptField },
    bomFile: { type: Schema.Types.ObjectId, ref: 'Document' },
    additionalFiles: { type: [Schema.Types.ObjectId], ref: 'Document', default: [] },
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

export default model<IProduct>('Product', productSchema);
