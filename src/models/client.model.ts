import { Schema, model, HydratedDocument } from 'mongoose';
import { encryptField, decryptField } from '../utils/fieldEncryption';

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
    contactName: {
      type: String,
      set: (v?: string) => encryptField(v?.trim()),
      get: decryptField,
    },
    email: {
      type: String,
      set: (v?: string) => encryptField(v?.trim().toLowerCase()),
      get: decryptField,
    },
    phone: {
      type: String,
      set: (v?: string) => encryptField(v?.trim()),
      get: decryptField,
    },
    address: {
      type: String,
      set: (v?: string) => encryptField(v?.trim()),
      get: decryptField,
    },
    notes: {
      type: String,
      set: encryptField,
      get: decryptField,
    },
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

export default model<IClient>('Client', clientSchema);
