import { Schema, model, HydratedDocument, Types } from 'mongoose';

export const ORDER_STATUSES = ['active', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface IOrder {
  client: Types.ObjectId;
  product: Types.ObjectId;
  quantity: number;
  status: OrderStatus;
  assignedEmployees: Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
}

export type OrderDocument = HydratedDocument<IOrder>;

const orderSchema = new Schema<IOrder>(
  {
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ORDER_STATUSES, default: 'active' },
    assignedEmployees: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
  },
  { timestamps: true }
);

export default model<IOrder>('Order', orderSchema);
