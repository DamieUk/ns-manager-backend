import { Schema, model, HydratedDocument, Types } from 'mongoose';
import { encryptField, decryptField } from '../utils/fieldEncryption';

export const ORDER_STATUSES = ['active', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface IOrder {
  client: Types.ObjectId;
  product: Types.ObjectId;
  quantity: number;
  description: string;
  status: OrderStatus;
  dueDate?: Date;
  manager?: Types.ObjectId;
  assignedEmployees: Types.ObjectId[];
  documents: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type OrderDocument = HydratedDocument<IOrder>;

const orderSchema = new Schema<IOrder>(
  {
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    description: { type: String, required: true, set: encryptField, get: decryptField },
    status: { type: String, enum: ORDER_STATUSES, default: 'active' },
    dueDate: { type: Date },
    manager: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedEmployees: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    documents: { type: [Schema.Types.ObjectId], ref: 'Document', default: [] },
  },
  { timestamps: true, toJSON: { getters: true }, toObject: { getters: true } }
);

export default model<IOrder>('Order', orderSchema);
