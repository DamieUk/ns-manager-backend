import { Schema, model, HydratedDocument, Types } from 'mongoose';

// A login session. The browser holds the raw token in an httpOnly cookie; only its SHA-256
// hash is stored, so a database leak does not hand out usable sessions.
export interface ISession {
  tokenHash: string;
  user: Types.ObjectId;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SessionDocument = HydratedDocument<ISession>;

const sessionSchema = new Schema<ISession>(
  {
    tokenHash: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // MongoDB's TTL monitor removes expired sessions (it runs about once a minute, so
    // requireAuth also checks expiresAt itself).
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export default model<ISession>('Session', sessionSchema);
