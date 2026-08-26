import { Schema, model, HydratedDocument, Types } from 'mongoose';

export interface IDailyProgress {
  employee: Types.ObjectId;
  order: Types.ObjectId;
  date: Date;
  completed: number;
  needsRework: number;
  partiallyAssembled: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DailyProgressDocument = HydratedDocument<IDailyProgress>;

const dailyProgressSchema = new Schema<IDailyProgress>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    date: { type: Date, required: true },
    completed: { type: Number, min: 0, default: 0 },
    needsRework: { type: Number, min: 0, default: 0 },
    partiallyAssembled: { type: Number, min: 0, default: 0 },
    notes: { type: String },
  },
  { timestamps: true }
);

dailyProgressSchema.index({ employee: 1, order: 1, date: 1 }, { unique: true });

export default model<IDailyProgress>('DailyProgress', dailyProgressSchema);
