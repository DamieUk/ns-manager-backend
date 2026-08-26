import { Schema, model, HydratedDocument, Types } from 'mongoose';

export const CONTRACT_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface IContract {
  title: string;
  client: Types.ObjectId;
  startDate?: Date;
  endDate?: Date;
  status: ContractStatus;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ContractDocument = HydratedDocument<IContract>;

const contractSchema = new Schema<IContract>(
  {
    title: { type: String, required: true, trim: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    startDate: { type: Date },
    endDate: { type: Date },
    status: { type: String, enum: CONTRACT_STATUSES, default: 'draft' },
    notes: { type: String },
  },
  { timestamps: true }
);

export default model<IContract>('Contract', contractSchema);
