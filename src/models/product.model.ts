import { Schema, model, HydratedDocument } from 'mongoose';

export interface IProduct {
  name: string;
  sku: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ProductDocument = HydratedDocument<IProduct>;

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String },
  },
  { timestamps: true }
);

export default model<IProduct>('Product', productSchema);
