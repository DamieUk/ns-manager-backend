import { Schema, model, HydratedDocument } from 'mongoose';

export interface IClient {
  name: string;
  code: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ClientDocument = HydratedDocument<IClient>;

const clientSchema = new Schema<IClient>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    contactName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    notes: { type: String },
  },
  { timestamps: true }
);

export default model<IClient>('Client', clientSchema);
